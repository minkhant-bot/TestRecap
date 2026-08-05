import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BillingError,
  adjustCredits,
  adminGetUserCredits,
  estimateCredits,
  getMyScreenshotMetadata,
  listPlans,
} from './billingFoundation.js';

const enabledEnv = {
  P2_BILLING_ENABLED: 'true',
  DATABASE_URL: 'postgresql://db.example/blink',
};

const superAdminIdentity = { uid: 'owner-uid', role: 'super_admin' };

// Minimal admin-mutation harness: an in-memory `users` map simulates
// PostgreSQL rows that only ever exist once someone's own ensureUser upsert
// has run -- exactly the lazy-sync gap that produced "Target user not found."
const createAdminHarness = ({ firebaseHasTarget = true } = {}) => {
  const users = new Map([
    ['owner-uid', { id: 'owner-id', firebaseUid: 'owner-uid', status: 'active' }],
  ]);
  const roles = new Map([['owner-id', { role: 'super_admin' }]]);
  const balances = new Map();
  const ledger = [];
  const audit = [];
  const idempotency = new Map();
  let firebaseLookups = 0;
  let ensureUserCalls = 0;

  const deps = {
    transaction: async work => work({}),
    resolveFirebaseUser: async uid => {
      firebaseLookups += 1;
      if (!firebaseHasTarget || uid !== 'new-target-uid') return null;
      return { uid, email: 'target@example.test', displayName: 'Target User', photoURL: '', status: 'active' };
    },
    users: {
      ensureUser: async identity => {
        ensureUserCalls += 1;
        const existing = users.get(identity.firebaseUid);
        const row = existing || { id: `id-${users.size + 1}`, firebaseUid: identity.firebaseUid };
        users.set(identity.firebaseUid, { ...row, status: identity.status });
        return users.get(identity.firebaseUid);
      },
      findUserByFirebaseUid: async uid => users.get(uid) || null,
    },
    roles: {
      findRoleByUserId: async userId => (roles.get(userId) ? { role: roles.get(userId).role } : null),
      assignRole: async ({ userId, role }) => {
        roles.set(userId, { role });
        return { role };
      },
    },
    balances: {
      ensureBalanceAccountForUpdate: async userId => {
        if (!balances.has(userId)) balances.set(userId, { postedBalance: 0n, reservedBalance: 0n });
        const balance = balances.get(userId);
        return { userId, availableBalance: balance.postedBalance - balance.reservedBalance, ...balance };
      },
      findBalanceAccount: async userId => {
        const balance = balances.get(userId);
        return balance && { userId, availableBalance: balance.postedBalance - balance.reservedBalance, ...balance };
      },
      addPostedCredits: async (userId, amount) => {
        if (!balances.has(userId)) balances.set(userId, { postedBalance: 0n, reservedBalance: 0n });
        const balance = balances.get(userId);
        balance.postedBalance += amount;
        return { userId, availableBalance: balance.postedBalance - balance.reservedBalance, ...balance };
      },
    },
    ledger: {
      insertLedgerEntry: async entry => {
        const stored = { id: `ledger-${ledger.length + 1}`, ...entry };
        ledger.push(stored);
        return stored;
      },
      listLedgerEntries: async () => [...ledger],
    },
    audit: {
      insertAuditLog: async entry => { audit.push(entry); return entry; },
    },
    idempotency: {
      claimIdempotencyKey: async ({ idempotencyKey, requestHash }) => {
        const existing = idempotency.get(idempotencyKey);
        if (existing) return existing;
        const record = { request_hash: requestHash, state: 'in_progress' };
        idempotency.set(idempotencyKey, record);
        return record;
      },
      completeIdempotencyKey: async ({ idempotencyKey, responseStatus, responseBody }) => {
        idempotency.set(idempotencyKey, {
          request_hash: idempotency.get(idempotencyKey).request_hash,
          state: 'completed', response_status: responseStatus, response_body: responseBody,
        });
      },
    },
  };
  return { deps, users, get firebaseLookups() { return firebaseLookups; }, get ensureUserCalls() { return ensureUserCalls; } };
};

test('adjustCredits syncs an unsynced-but-real Firebase target on demand instead of failing NOT_FOUND', async () => {
  const { deps, users } = createAdminHarness();
  assert.equal(users.has('new-target-uid'), false);
  const result = await adjustCredits(superAdminIdentity, {
    userId: 'new-target-uid', amount: 5, direction: 'grant', reason: 'manual grant',
  }, { env: enabledEnv, idempotencyKey: 'adjust-1', deps });
  assert.equal(result.body.balance.availableBalance, '5');
  assert.ok(users.has('new-target-uid'), 'the target must now have a synced PostgreSQL row');
  assert.equal(users.get('new-target-uid').status, 'active');
});

test('adjustCredits still fails NOT_FOUND for a uid that does not exist in Firebase either', async () => {
  const { deps } = createAdminHarness({ firebaseHasTarget: false });
  await assert.rejects(
    adjustCredits(superAdminIdentity, {
      userId: 'nonexistent-uid', amount: 5, direction: 'grant', reason: 'manual grant',
    }, { env: enabledEnv, idempotencyKey: 'adjust-2', deps }),
    error => error instanceof BillingError && error.code === 'NOT_FOUND' && error.status === 404,
  );
});

test('adjustCredits reuses the same synced row on repeat calls instead of creating a duplicate', async () => {
  const { deps, users } = createAdminHarness();
  await adjustCredits(superAdminIdentity, {
    userId: 'new-target-uid', amount: 5, direction: 'grant', reason: 'first',
  }, { env: enabledEnv, idempotencyKey: 'adjust-3', deps });
  const firstId = users.get('new-target-uid').id;
  await adjustCredits(superAdminIdentity, {
    userId: 'new-target-uid', amount: 2, direction: 'grant', reason: 'second',
  }, { env: enabledEnv, idempotencyKey: 'adjust-4', deps });
  assert.equal(users.get('new-target-uid').id, firstId, 'a second sync must reuse the existing row, not create a new one');
  assert.equal([...users.values()].filter(user => user.firebaseUid === 'new-target-uid').length, 1);
});

test('adminGetUserCredits syncs an unsynced-but-real Firebase target instead of failing NOT_FOUND', async () => {
  const { deps } = createAdminHarness();
  const result = await adminGetUserCredits(superAdminIdentity, 'new-target-uid', { env: enabledEnv, deps });
  assert.equal(result.user.firebaseUid, 'new-target-uid');
  assert.equal(result.balance.availableBalance, 0n);
});

test('adminGetUserCredits still fails NOT_FOUND for a uid that does not exist in Firebase either', async () => {
  const { deps } = createAdminHarness({ firebaseHasTarget: false });
  await assert.rejects(
    adminGetUserCredits(superAdminIdentity, 'nonexistent-uid', { env: enabledEnv, deps }),
    error => error instanceof BillingError && error.code === 'NOT_FOUND' && error.status === 404,
  );
});

test('billing services fail closed unless explicitly activated', async () => {
  await assert.rejects(
    listPlans({ uid: 'user' }, { env: {}, deps: {} }),
    error => error instanceof BillingError && error.code === 'BILLING_NOT_ENABLED',
  );
});

test('credit estimate uses exact 30-second integer blocks without reserving', async () => {
  const deps = {
    users: {
      ensureUser: async () => ({ id: 'user-id' }),
    },
    plans: {
      findPlanByCode: async () => ({ id: 'normal-id', active: true }),
      findEffectivePlanPolicy: async () => ({
        id: 'policy-id',
        billingMode: 'byok',
        creditsPerBlock: 7n,
      }),
    },
    balances: {
      findBalanceAccount: async () => ({ availableBalance: 100n }),
    },
    hasByok: () => true,
  };
  const result = await estimateCredits({
    uid: 'user',
  }, {
    planCode: 'normal',
    billingMode: 'byok',
    sourceDurationSeconds: 60.001,
  }, { env: enabledEnv, deps });
  assert.equal(result.authoritative, false);
  assert.equal(result.billingBlocks, 3n);
  assert.equal(result.requiredCredits, 21n);
  assert.equal(result.eligible, true);
});

test('credit estimate never silently changes BYOK to Blink-funded mode', async () => {
  const deps = {
    users: { ensureUser: async () => ({ id: 'user-id' }) },
    plans: {
      findPlanByCode: async () => ({ id: 'normal-id', active: true }),
      findEffectivePlanPolicy: async () => ({
        id: 'policy-id', billingMode: 'byok', creditsPerBlock: 1n,
      }),
    },
  };
  await assert.rejects(
    estimateCredits({ uid: 'user' }, {
      planCode: 'normal',
      billingMode: 'blink_funded',
      sourceDurationSeconds: 30,
    }, { env: enabledEnv, deps }),
    error => error.code === 'BILLING_MODE_NOT_ENTITLED',
  );
});

test('payment proof metadata is concealed from a different normal user', async () => {
  const deps = {
    users: { ensureUser: async () => ({ id: 'requesting-user-id' }) },
    billing: {
      findScreenshotMetadata: async () => ({
        id: 'proof-id', owner_user_id: 'different-user-id', object_key: 'private-key',
      }),
    },
  };
  await assert.rejects(
    getMyScreenshotMetadata({ uid: 'requesting-user' }, 'proof-id', { env: enabledEnv, deps }),
    error => error instanceof BillingError && error.code === 'NOT_FOUND' && error.status === 404,
  );
});
