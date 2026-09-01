import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approveTrialRequest,
  BillingError,
  checkAndExpireTrial,
  listTrialRequests,
  requestTrial,
  reviewPurchase,
  selectPlan,
} from './billingFoundation.js';

const env = {
  P2_BILLING_ENABLED: 'true',
  DATABASE_URL: 'postgresql://db.example/blink',
};

// Minimal but faithful in-memory harness: `deps.transaction` just invokes the
// work callback with a placeholder client (matching the liveJobBilling.test.js
// pattern), and every repo method mutates a shared `state` object.
const createHarness = ({ ownerRole = 'super_admin' } = {}) => {
  const state = {
    users: new Map([
      ['requester-uid', { id: 'requester-id', firebaseUid: 'requester-uid', status: 'active' }],
      ['owner-uid', { id: 'owner-id', firebaseUid: 'owner-uid', status: 'active' }],
    ]),
    roles: new Map(),
    trialRequests: new Map(),
    trialGrants: new Map(),
    balances: new Map(),
    ledger: [],
    audit: [],
    idempotency: new Map(),
    assignments: new Map(),
    plans: new Map([
      ['trial', { id: 'trial-plan-id', code: 'trial', active: true, archivedAt: null }],
      ['pro', { id: 'pro-plan-id', code: 'pro', active: true, archivedAt: null }],
    ]),
    policies: new Map([
      ['trial-plan-id', {
        id: 'trial-policy-id', billingMode: 'byok', creditsPerBlock: 1n,
        trialAllowanceCredits: 0n, billingBlockSeconds: 30,
      }],
    ]),
  };

  const ensureBalance = userId => {
    if (!state.balances.has(userId)) state.balances.set(userId, { postedBalance: 0n, reservedBalance: 0n });
    return state.balances.get(userId);
  };

  const deps = {
    transaction: async work => work({}),
    users: {
      ensureUser: async identity => state.users.get(identity.firebaseUid),
      findUserById: async id => [...state.users.values()].find(user => user.id === id) || null,
      findUserByFirebaseUid: async uid => state.users.get(uid) || null,
    },
    roles: {
      findRoleByUserId: async userId => state.roles.get(userId) || null,
      assignRole: async ({ userId, role }) => {
        const row = { userId, role, source: 'firebase_sync', assignedByUserId: null };
        state.roles.set(userId, row);
        return row;
      },
    },
    plans: {
      findPlanByCode: async code => state.plans.get(code) || null,
      findEffectivePlanPolicy: async planId =>
        [...state.policies.entries()].find(([id]) => id === planId)?.[1] || null,
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
        if (balance.postedBalance + amount < balance.reservedBalance) return null;
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
      listLedgerEntries: async () => [...state.ledger],
    },
    audit: {
      insertAuditLog: async entry => {
        state.audit.push(entry);
        return entry;
      },
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
    trialRequests: {
      findTrialRequestByUserId: async userId =>
        [...state.trialRequests.values()].find(item => item.userId === userId) || null,
      findTrialRequestById: async id => state.trialRequests.get(id) || null,
      insertTrialRequest: async ({ userId }) => {
        const id = `request-${state.trialRequests.size + 1}`;
        const row = { id, userId, status: 'pending', requestedAt: new Date(), reviewedAt: null, reviewedByUserId: null };
        state.trialRequests.set(id, row);
        return row;
      },
      listPendingTrialRequests: async () =>
        [...state.trialRequests.values()].filter(item => item.status === 'pending'),
      approveTrialRequest: async ({ id, reviewerId }) => {
        const row = state.trialRequests.get(id);
        if (!row || row.status !== 'pending') return null;
        const updated = { ...row, status: 'approved', reviewedAt: new Date(), reviewedByUserId: reviewerId };
        state.trialRequests.set(id, updated);
        return updated;
      },
    },
    billing: {
      findTrialGrant: async userId => state.trialGrants.get(userId) || null,
      insertTrialGrant: async grant => {
        const row = {
          id: `grant-${state.trialGrants.size + 1}`, user_id: grant.userId,
          credit_amount: String(grant.creditAmount), expires_at: grant.expiresAt, expired_at: null,
        };
        state.trialGrants.set(grant.userId, row);
        return row;
      },
      markTrialGrantExpired: async userId => {
        const row = state.trialGrants.get(userId);
        if (!row || row.expired_at) return null;
        row.expired_at = new Date();
        return row;
      },
      replaceCurrentAssignment: async ({ userId, planId, source }) => {
        const assignment = { id: `assignment-${userId}-${planId}`, userId, planId, source, status: 'active' };
        state.assignments.set(userId, assignment);
        return assignment;
      },
      findPurchase: async id => state.purchase?.id === id ? state.purchase : null,
      approvePurchase: async ({ id }) => ({ ...state.purchase, id, status: 'approved' }),
      findPromotionRedemption: async () => null,
    },
    hasByok: () => true,
  };

  if (ownerRole) state.roles.set('owner-id', { userId: 'owner-id', role: ownerRole });

  return { state, deps };
};

const requester = { uid: 'requester-uid', role: 'user' };
const owner = { uid: 'owner-uid', role: 'super_admin' };

test('requestTrial creates a pending request and is idempotent on replay', async () => {
  const { state, deps } = createHarness();
  const first = await requestTrial(requester, { env, deps, idempotencyKey: 'req-1' });
  assert.equal(first.body.request.status, 'pending');
  assert.equal(state.audit.some(entry => entry.eventType === 'trial.requested'), true);
  const second = await requestTrial(requester, { env, deps, idempotencyKey: 'req-1' });
  assert.equal(second.replayed, true);
});

test('requestTrial refuses a second request once Trial was already granted once', async () => {
  const { state, deps } = createHarness();
  state.trialGrants.set('requester-id', { id: 'grant-1', user_id: 'requester-id', expires_at: null, expired_at: null });
  await assert.rejects(
    requestTrial(requester, { env, deps, idempotencyKey: 'req-2' }),
    error => error instanceof BillingError && error.code === 'TRIAL_ALREADY_GRANTED',
  );
});

test('approveTrialRequest grants exactly 12 credits, sets a 120-hour expiry, and assigns the Trial plan', async () => {
  const { state, deps } = createHarness();
  const { body } = await requestTrial(requester, { env, deps, idempotencyKey: 'req-3' });
  const before = Date.now();
  const result = await approveTrialRequest(owner, body.request.id, { env, deps, idempotencyKey: 'approve-1' });
  assert.equal(result.body.grant.credit_amount, '12');
  const expiresAt = new Date(result.body.grant.expires_at).getTime();
  assert.ok(expiresAt - before >= 120 * 60 * 60 * 1000 - 1000);
  assert.ok(expiresAt - before <= 120 * 60 * 60 * 1000 + 5000);
  assert.equal(result.body.assignment.planId, 'trial-plan-id');
  const balance = state.balances.get('requester-id');
  assert.equal(balance.postedBalance, 12n);
  assert.equal(state.audit.some(entry => entry.eventType === 'trial.approved'), true);
});

test('repeated approval of the same Trial request never double-grants credits: identical idempotency key replays, a different key on an already-reviewed request is rejected', async () => {
  const { state, deps } = createHarness();
  const { body } = await requestTrial(requester, { env, deps, idempotencyKey: 'req-repeat' });

  const first = await approveTrialRequest(owner, body.request.id, { env, deps, idempotencyKey: 'approve-repeat' });
  assert.equal(first.replayed, false);
  assert.equal(state.balances.get('requester-id').postedBalance, 12n);

  // Exact idempotency replay: same key, same request -- no new grant.
  const replay = await approveTrialRequest(owner, body.request.id, { env, deps, idempotencyKey: 'approve-repeat' });
  assert.equal(replay.replayed, true);
  assert.equal(state.balances.get('requester-id').postedBalance, 12n);

  // A second, non-idempotent attempt (different key) on the now-reviewed
  // request must be rejected outright, never grant a second time.
  await assert.rejects(
    approveTrialRequest(owner, body.request.id, { env, deps, idempotencyKey: 'approve-repeat-2' }),
    error => error instanceof BillingError && error.code === 'INVALID_STATE',
  );
  assert.equal(state.balances.get('requester-id').postedBalance, 12n);
  assert.equal(state.trialGrants.size, 1, 'exactly one grant must ever exist for this user');
});

test('a granted Trial can never be requested or granted again', async () => {
  const { deps } = createHarness();
  const { body } = await requestTrial(requester, { env, deps, idempotencyKey: 'req-4' });
  await approveTrialRequest(owner, body.request.id, { env, deps, idempotencyKey: 'approve-2' });
  await assert.rejects(
    requestTrial(requester, { env, deps, idempotencyKey: 'req-5' }),
    error => error instanceof BillingError && error.code === 'TRIAL_ALREADY_GRANTED',
  );
});

test('checkAndExpireTrial forfeits remaining balance with a durable, distinct audit record once past 120 hours', async () => {
  const { state, deps } = createHarness();
  state.trialGrants.set('requester-id', {
    id: 'grant-1', user_id: 'requester-id', credit_amount: '9',
    expires_at: new Date(Date.now() - 1000), expired_at: null,
  });
  state.balances.set('requester-id', { postedBalance: 9n, reservedBalance: 0n });
  const result = await checkAndExpireTrial('requester-id', { client: {}, deps });
  assert.equal(result.forfeitedCredits, 9n);
  assert.equal(state.balances.get('requester-id').postedBalance, 0n);
  assert.equal(
    state.ledger.some(entry => entry.correlationKey === 'trial-expired:requester-id' && entry.amount === -9n),
    true,
  );
  assert.equal(state.audit.some(entry => entry.eventType === 'trial.expired'), true);
});

test('checkAndExpireTrial preserves manually-granted/purchased credits: forfeiture never exceeds the original Trial grant amount', async () => {
  const { state, deps } = createHarness();
  // 9 credits from the Trial grant itself, plus a 1000-credit manual grant
  // (e.g. Owner goodwill credit) sitting in the same undifferentiated balance.
  state.trialGrants.set('requester-id', {
    id: 'grant-1', user_id: 'requester-id', credit_amount: '9',
    expires_at: new Date(Date.now() - 1000), expired_at: null,
  });
  state.balances.set('requester-id', { postedBalance: 1009n, reservedBalance: 0n });
  state.ledger.push({
    id: 'ledger-manual-1', userId: 'requester-id', amount: 1000n,
    entryType: 'manual_grant', correlationKey: 'manual:grant-1',
    reason: 'Goodwill credit', createdByUserId: 'owner-id',
  });
  const result = await checkAndExpireTrial('requester-id', { client: {}, deps });
  // Only the Trial grant's own face value (9) is forfeited -- the manually
  // granted 1000 credits must survive Trial expiry untouched.
  assert.equal(result.forfeitedCredits, 9n);
  assert.equal(state.balances.get('requester-id').postedBalance, 1000n);
  assert.equal(
    state.ledger.some(entry => entry.correlationKey === 'trial-expired:requester-id' && entry.amount === -9n),
    true,
  );
});

test('checkAndExpireTrial forfeits only the remaining (already-partially-spent) balance when it is less than the original Trial grant', async () => {
  const { state, deps } = createHarness();
  state.trialGrants.set('requester-id', {
    id: 'grant-1', user_id: 'requester-id', credit_amount: '12',
    expires_at: new Date(Date.now() - 1000), expired_at: null,
  });
  // User already spent most of the Trial grant; only 3 credits remain.
  state.balances.set('requester-id', { postedBalance: 3n, reservedBalance: 0n });
  const result = await checkAndExpireTrial('requester-id', { client: {}, deps });
  assert.equal(result.forfeitedCredits, 3n);
  assert.equal(state.balances.get('requester-id').postedBalance, 0n);
});

test('checkAndExpireTrial is a no-op before expiry and a no-op on a second call', async () => {
  const { state, deps } = createHarness();
  state.trialGrants.set('requester-id', {
    id: 'grant-1', user_id: 'requester-id',
    expires_at: new Date(Date.now() + 1000 * 60), expired_at: null,
  });
  state.balances.set('requester-id', { postedBalance: 9n, reservedBalance: 0n });
  assert.equal(await checkAndExpireTrial('requester-id', { client: {}, deps }), null);
  state.trialGrants.get('requester-id').expired_at = new Date();
  assert.equal(await checkAndExpireTrial('requester-id', { client: {}, deps }), null);
});

test('selectPlan (self-service) is permanently removed', async () => {
  const { deps } = createHarness();
  await assert.rejects(
    selectPlan(requester, { planCode: 'pro' }, { env, deps }),
    error => error instanceof BillingError && error.code === 'PLAN_SELF_SELECTION_REMOVED' && error.status === 410,
  );
});

test('reviewPurchase approval automatically assigns Pro independent of resulting balance', async () => {
  const { state, deps } = createHarness();
  state.purchase = {
    id: 'purchase-1', userId: 'requester-id', status: 'pending', credits: 5n,
    bonusPolicySnapshot: null,
  };
  const result = await reviewPurchase(owner, 'purchase-1', { decision: 'approved' }, {
    env, deps, idempotencyKey: 'purchase-approve-1',
  });
  assert.equal(result.body.proAssignment.planId, 'pro-plan-id');
  assert.equal(
    state.audit.some(entry => entry.eventType === 'plan.pro_assigned_via_purchase'),
    true,
  );
});

test('requireSuperAdmin denies a Firebase role that is not super_admin even with a stale Postgres row', async () => {
  const { state, deps } = createHarness();
  state.roles.set('requester-id', { userId: 'requester-id', role: 'super_admin' });
  const { body } = await requestTrial(requester, { env, deps, idempotencyKey: 'req-owner-check' });
  await assert.rejects(
    approveTrialRequest(requester, body.request.id, { env, deps, idempotencyKey: 'approve-owner-check' }),
    error => error instanceof BillingError && error.code === 'SUPER_ADMIN_REQUIRED',
  );
});

test('listTrialRequests is Owner-only and lists only pending requests', async () => {
  const { deps } = createHarness();
  await requestTrial(requester, { env, deps, idempotencyKey: 'req-list' });
  await assert.rejects(
    listTrialRequests(requester, { env, deps }),
    error => error instanceof BillingError && error.code === 'SUPER_ADMIN_REQUIRED',
  );
  const pending = await listTrialRequests(owner, { env, deps });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].status, 'pending');
});

test('requireSuperAdmin syncs Postgres from the Firebase claim and records a durable audit event', async () => {
  const { state, deps } = createHarness({ ownerRole: null });
  const { body } = await requestTrial(requester, { env, deps, idempotencyKey: 'req-sync' });
  assert.equal(state.roles.get('owner-id'), undefined);
  await approveTrialRequest(owner, body.request.id, { env, deps, idempotencyKey: 'approve-sync' });
  assert.equal(state.roles.get('owner-id').role, 'super_admin');
  assert.equal(state.audit.some(entry => entry.eventType === 'owner.authority_synced'), true);
});
