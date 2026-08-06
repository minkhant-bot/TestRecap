import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BillingError,
  adjustCredits,
  adminGetUserCredits,
  backfillLegacyPlanEntitlements,
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

// Minimal admin-mutation harness for backfillLegacyPlanEntitlements: an
// in-memory plan_policy_versions/plan_entitlements model, keyed exactly like
// the real schema (one array of policy versions per plan, windows closed by
// effectiveUntil rather than deleted, entitlements keyed by policy id).
const createBackfillHarness = ({
  trial = { billingMode: 'byok', entitlements: { blur: false, flip: false, byok_mode: true, blink_funded_mode: false } },
  pro = { billingMode: 'blink_funded', entitlements: { blur: true, flip: true, byok_mode: false, blink_funded_mode: true } },
} = {}) => {
  const users = new Map([['owner-uid', { id: 'owner-id', firebaseUid: 'owner-uid', status: 'active' }]]);
  const audit = [];
  const idempotency = new Map();
  const plans = new Map([
    ['trial', { id: 'plan-trial', code: 'trial', active: true }],
    ['pro', { id: 'plan-pro', code: 'pro', active: true }],
  ]);
  const policies = new Map();
  const entitlementsByPolicyId = new Map();
  const seed = (planId, code, config) => {
    const policyId = `policy-${code}-1`;
    policies.set(planId, [{
      id: policyId, planId, version: 1, billingMode: config.billingMode,
      creditsPerBlock: 5n, trialAllowanceCredits: code === 'trial' ? 12n : 0n,
      effectiveFrom: new Date('2026-01-01'), effectiveUntil: null, active: true,
    }]);
    entitlementsByPolicyId.set(policyId, Object.entries(config.entitlements).map(
      ([key, enabled]) => ({ key, enabled, integerLimit: null, textValue: null }),
    ));
  };
  seed('plan-trial', 'trial', trial);
  seed('plan-pro', 'pro', pro);

  const deps = {
    transaction: async work => work({}),
    users: { ensureUser: async identity => users.get(identity.firebaseUid) },
    roles: {
      findRoleByUserId: async () => ({ role: 'super_admin' }),
      assignRole: async ({ role }) => ({ role }),
    },
    audit: { insertAuditLog: async entry => { audit.push(entry); return entry; } },
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
    plans: {
      findPlanByCode: async code => plans.get(code) || null,
      findEffectivePlanPolicy: async planId =>
        (policies.get(planId) || []).find(policy => policy.active && policy.effectiveUntil === null) || null,
      listPlanEntitlements: async policyId => entitlementsByPolicyId.get(policyId) || [],
    },
    billing: {
      closePlanPolicyWindow: async (policyId, until) => {
        for (const list of policies.values()) {
          const found = list.find(policy => policy.id === policyId);
          if (found) found.effectiveUntil = until;
        }
      },
      insertPlanPolicy: async policy => {
        const id = `policy-${policy.planCode}-${policy.version}`;
        const record = { ...policy, id, effectiveUntil: null, active: true };
        policies.get(policy.planId).push(record);
        entitlementsByPolicyId.set(id, policy.entitlements);
        return record;
      },
    },
  };
  return { deps, plans, policies, entitlementsByPolicyId, audit };
};
const superAdmin = { uid: 'owner-uid', role: 'super_admin' };

test('legacy Trial/Pro policy backfill repairs a stale billingMode/entitlement row and is idempotent on replay', async () => {
  const harness = createBackfillHarness();
  const trialPolicyBefore = harness.policies.get('plan-trial')[0];

  const first = await backfillLegacyPlanEntitlements(superAdmin, {
    env: enabledEnv, deps: harness.deps, idempotencyKey: 'backfill-1',
  });
  assert.equal(first.body.updated.length, 1);
  assert.equal(first.body.updated[0].planCode, 'trial');

  const trialPolicies = harness.policies.get('plan-trial');
  assert.equal(trialPolicies.length, 2, 'a new policy version must be created, not overwritten');
  assert.equal(trialPolicyBefore.effectiveUntil.getTime() <= Date.now(), true, 'the old window must be closed, not deleted');
  const trialLatest = trialPolicies[1];
  assert.equal(trialLatest.billingMode, 'blink_funded');
  assert.equal(trialLatest.version, 2);
  const trialEntitlements = harness.entitlementsByPolicyId.get(trialLatest.id);
  assert.equal(trialEntitlements.find(item => item.key === 'blur').enabled, true);
  assert.equal(trialEntitlements.find(item => item.key === 'flip').enabled, true);
  assert.equal(trialEntitlements.find(item => item.key === 'byok_mode').enabled, false);
  // Pricing/allowance must be preserved exactly, never reset.
  assert.equal(trialLatest.creditsPerBlock, 5n);
  assert.equal(trialLatest.trialAllowanceCredits, 12n);

  // Running it again is a genuine no-op: Trial is already migrated, and Pro
  // was already current from the start.
  const replay = await backfillLegacyPlanEntitlements(superAdmin, {
    env: enabledEnv, deps: harness.deps, idempotencyKey: 'backfill-2',
  });
  assert.equal(replay.body.updated.length, 0);
  assert.equal(harness.policies.get('plan-trial').length, 2, 'no additional policy version was created');
});

test('the already-current Pro policy row is left completely unchanged by the backfill', async () => {
  const harness = createBackfillHarness();
  const proPolicyBefore = harness.policies.get('plan-pro')[0];
  await backfillLegacyPlanEntitlements(superAdmin, {
    env: enabledEnv, deps: harness.deps, idempotencyKey: 'backfill-1',
  });
  const proPolicies = harness.policies.get('plan-pro');
  assert.equal(proPolicies.length, 1, 'Pro must not receive a new policy version');
  assert.deepEqual(proPolicies[0], proPolicyBefore);
});

test('a plan whose policy is already fully current in both billingMode and entitlements is never touched', async () => {
  const harness = createBackfillHarness({
    trial: { billingMode: 'blink_funded', entitlements: { blur: true, flip: true, byok_mode: false, blink_funded_mode: true } },
  });
  const result = await backfillLegacyPlanEntitlements(superAdmin, {
    env: enabledEnv, deps: harness.deps, idempotencyKey: 'backfill-1',
  });
  assert.equal(result.body.updated.length, 0);
  assert.equal(harness.policies.get('plan-trial').length, 1);
  assert.equal(harness.policies.get('plan-pro').length, 1);
});

test('after backfill, a default (no-effects) job and a Blur/Flip-enabled job both pass the live-billing entitlement check for the repaired plan', async () => {
  const harness = createBackfillHarness();
  await backfillLegacyPlanEntitlements(superAdmin, {
    env: enabledEnv, deps: harness.deps, idempotencyKey: 'backfill-1',
  });
  const trialLatest = harness.policies.get('plan-trial')[1];
  const entitlementSnapshot = Object.fromEntries(
    harness.entitlementsByPolicyId.get(trialLatest.id).map(item => [item.key, { enabled: item.enabled }]),
  );
  const violatesEntitlement = effects => Boolean(
    (effects?.blurEnabled && !entitlementSnapshot.blur?.enabled) ||
    (effects?.flipVideoEnabled && !entitlementSnapshot.flip?.enabled),
  );
  assert.equal(violatesEntitlement(undefined), false, 'a default job with no effects must never be blocked');
  assert.equal(violatesEntitlement({ blurEnabled: false, flipVideoEnabled: false }), false);
  assert.equal(violatesEntitlement({ blurEnabled: true, flipVideoEnabled: false }), false, 'Trial now has Blur entitled');
  assert.equal(violatesEntitlement({ blurEnabled: false, flipVideoEnabled: true }), false, 'Trial now has Flip entitled');
});
