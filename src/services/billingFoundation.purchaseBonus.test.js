import assert from 'node:assert/strict';
import test from 'node:test';
import { BillingError, reviewPurchase } from './billingFoundation.js';

// Verifies the package_bonus_credit_snapshot fix in isolation: purchase
// approval must grant base + package bonus credits as one total, never
// double-grant on repeated approval, and correctly no-op replay on an
// identical Idempotency-Key.

const env = { P2_BILLING_ENABLED: 'true', DATABASE_URL: 'postgresql://db.example/blink' };

const createHarness = () => {
  const state = {
    users: new Map([
      ['buyer-uid', { id: 'buyer-id', firebaseUid: 'buyer-uid', status: 'active' }],
      ['owner-uid', { id: 'owner-id', firebaseUid: 'owner-uid', status: 'active' }],
    ]),
    roles: new Map([['owner-id', { userId: 'owner-id', role: 'super_admin' }]]),
    balances: new Map(),
    ledger: [],
    audit: [],
    idempotency: new Map(),
    assignments: new Map(),
    purchases: new Map(),
    redemptions: new Map(),
    plans: new Map([['pro', { id: 'pro-plan-id', code: 'pro', active: true }]]),
  };

  const ensureBalance = userId => {
    if (!state.balances.has(userId)) state.balances.set(userId, { postedBalance: 0n, reservedBalance: 0n });
    return state.balances.get(userId);
  };

  const deps = {
    transaction: async work => work({}),
    users: {
      ensureUser: async identity => state.users.get(identity.firebaseUid),
      findUserById: async id => [...state.users.values()].find(u => u.id === id) || null,
      findUserByFirebaseUid: async uid => state.users.get(uid) || null,
    },
    roles: {
      findRoleByUserId: async userId => state.roles.get(userId) || null,
    },
    plans: {
      findPlanByCode: async code => state.plans.get(code) || null,
    },
    balances: {
      ensureBalanceAccountForUpdate: async userId => {
        const balance = ensureBalance(userId);
        return { userId, availableBalance: balance.postedBalance - balance.reservedBalance, ...balance };
      },
      findBalanceAccount: async userId => {
        const balance = state.balances.get(userId);
        return balance && { userId, availableBalance: balance.postedBalance - balance.reservedBalance, ...balance };
      },
      addPostedCredits: async (userId, amount) => {
        const balance = ensureBalance(userId);
        balance.postedBalance += amount;
        return { userId, availableBalance: balance.postedBalance - balance.reservedBalance, ...balance };
      },
    },
    ledger: {
      insertLedgerEntry: async entry => {
        const stored = { id: `ledger-${state.ledger.length + 1}`, ...entry };
        state.ledger.push(stored);
        return stored;
      },
    },
    audit: {
      insertAuditLog: async entry => { state.audit.push(entry); return entry; },
    },
    idempotency: {
      claimIdempotencyKey: async ({ idempotencyKey, requestHash }) => {
        const existing = state.idempotency.get(idempotencyKey);
        if (existing) return existing;
        const record = { request_hash: requestHash, state: 'in_progress' };
        state.idempotency.set(idempotencyKey, record);
        return record;
      },
      completeIdempotencyKey: async ({ idempotencyKey, responseStatus, responseBody }) => {
        state.idempotency.set(idempotencyKey, {
          request_hash: state.idempotency.get(idempotencyKey).request_hash,
          state: 'completed', response_status: responseStatus, response_body: responseBody,
        });
      },
    },
    billing: {
      findPurchase: async id => state.purchases.get(id) || null,
      approvePurchase: async ({ id, reviewerId, purchaseLedgerEntryId, bonusLedgerEntryId }) => {
        const purchase = state.purchases.get(id);
        const updated = {
          ...purchase, status: 'approved', reviewedByUserId: reviewerId,
          purchaseLedgerEntryId, bonusLedgerEntryId,
        };
        state.purchases.set(id, updated);
        return updated;
      },
      rejectPurchase: async ({ id, reviewerId, reason }) => {
        const purchase = state.purchases.get(id);
        const updated = { ...purchase, status: 'rejected', reviewedByUserId: reviewerId, rejectionReason: reason };
        state.purchases.set(id, updated);
        return updated;
      },
      findPromotionRedemption: async userId => state.redemptions.get(userId) || null,
      insertPromotionRedemption: async redemption => {
        if (state.redemptions.has(redemption.userId)) return null;
        const row = { ...redemption };
        state.redemptions.set(redemption.userId, row);
        return row;
      },
      replaceCurrentAssignment: async ({ userId, planId, source }) => {
        const assignment = { id: `assignment-${userId}-${planId}`, userId, planId, source, status: 'active' };
        state.assignments.set(userId, assignment);
        return assignment;
      },
    },
  };

  return { state, deps };
};

const owner = { uid: 'owner-uid', role: 'super_admin' };

test('purchase approval grants base + package bonus as one total: 40 base + 20 bonus = exactly 60 credits', async () => {
  const { state, deps } = createHarness();
  state.purchases.set('purchase-1', {
    id: 'purchase-1', userId: 'buyer-id', status: 'pending',
    credits: 40n, packageBonusCredits: 20n, bonusPolicySnapshot: null,
  });
  const result = await reviewPurchase(owner, 'purchase-1', { decision: 'approved' }, {
    env, deps, idempotencyKey: 'approve-1',
  });
  assert.equal(result.body.purchaseLedger.amount, '60');
  assert.equal(state.balances.get('buyer-id').postedBalance, 60n);
  assert.equal(state.ledger.filter(entry => entry.entryType === 'purchase').length, 1);
  const auditEntry = state.audit.find(entry => entry.eventType === 'credit_purchase.approved');
  assert.equal(auditEntry.afterState.baseCredits, '40');
  assert.equal(auditEntry.afterState.packageBonusCredits, '20');
  assert.equal(auditEntry.afterState.totalCreditsGranted, '60');
});

test('a package with zero bonus grants exactly the base amount', async () => {
  const { state, deps } = createHarness();
  state.purchases.set('purchase-zero', {
    id: 'purchase-zero', userId: 'buyer-id', status: 'pending',
    credits: 100n, packageBonusCredits: 0n, bonusPolicySnapshot: null,
  });
  await reviewPurchase(owner, 'purchase-zero', { decision: 'approved' }, { env, deps, idempotencyKey: 'approve-zero' });
  assert.equal(state.balances.get('buyer-id').postedBalance, 100n);
});

test('a purchase snapshotted without packageBonusCredits (legacy/undefined) is treated as zero bonus, not an error', async () => {
  const { state, deps } = createHarness();
  state.purchases.set('purchase-legacy', {
    id: 'purchase-legacy', userId: 'buyer-id', status: 'pending',
    credits: 15n, bonusPolicySnapshot: null,
  });
  const result = await reviewPurchase(owner, 'purchase-legacy', { decision: 'approved' }, {
    env, deps, idempotencyKey: 'approve-legacy',
  });
  assert.equal(result.body.purchaseLedger.amount, '15');
});

test('repeated approval of the same purchase never double-grants credits', async () => {
  const { state, deps } = createHarness();
  state.purchases.set('purchase-2', {
    id: 'purchase-2', userId: 'buyer-id', status: 'pending',
    credits: 40n, packageBonusCredits: 20n, bonusPolicySnapshot: null,
  });
  await reviewPurchase(owner, 'purchase-2', { decision: 'approved' }, { env, deps, idempotencyKey: 'approve-2' });
  await assert.rejects(
    reviewPurchase(owner, 'purchase-2', { decision: 'approved' }, { env, deps, idempotencyKey: 'approve-3' }),
    error => error instanceof BillingError && error.code === 'INVALID_PURCHASE_STATE' && error.status === 409,
  );
  assert.equal(state.balances.get('buyer-id').postedBalance, 60n);
  assert.equal(state.ledger.filter(entry => entry.entryType === 'purchase').length, 1);
});

test('idempotency-key replay of the same approval request returns the stored result without re-granting', async () => {
  const { state, deps } = createHarness();
  state.purchases.set('purchase-3', {
    id: 'purchase-3', userId: 'buyer-id', status: 'pending',
    credits: 40n, packageBonusCredits: 20n, bonusPolicySnapshot: null,
  });
  const first = await reviewPurchase(owner, 'purchase-3', { decision: 'approved' }, {
    env, deps, idempotencyKey: 'replay-key',
  });
  const second = await reviewPurchase(owner, 'purchase-3', { decision: 'approved' }, {
    env, deps, idempotencyKey: 'replay-key',
  });
  assert.equal(second.replayed, true);
  assert.deepEqual(first.body.purchase, second.body.purchase);
  assert.equal(state.balances.get('buyer-id').postedBalance, 60n);
  assert.equal(state.ledger.filter(entry => entry.entryType === 'purchase').length, 1);
});
