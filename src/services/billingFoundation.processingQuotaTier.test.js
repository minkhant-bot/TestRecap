import assert from 'node:assert/strict';
import test from 'node:test';
import { getProcessingQuotaTier } from './billingFoundation.js';

const env = { P2_BILLING_ENABLED: 'true', DATABASE_URL: 'postgresql://db.example/blink' };
const identity = { uid: 'user-uid', email: 'user@example.test', displayName: 'User' };

// grantAmount: the Trial grant's own face value (0n/undefined = user never
// had a Trial grant at all). availableBalance: current spendable balance,
// which may include Trial + non-Trial money mixed together (mirrors the
// real credit_balance_accounts pool -- there is no per-source column).
const createDeps = ({
  planCode = 'trial', grantAmount, availableBalance = 0n,
  throwOnAssignment, throwOnBilling, throwOnBalances,
} = {}) => ({
  users: {
    ensureUser: async firebaseUser => ({ id: 'user-id', firebaseUid: firebaseUser.firebaseUid, status: 'active' }),
  },
  assignments: {
    findCurrentPlanAssignment: async () => {
      if (throwOnAssignment) throw new Error('assignment lookup failed');
      return planCode ? { planId: 'plan-id', planCode } : null;
    },
  },
  billing: {
    findTrialGrant: async () => {
      if (throwOnBilling) throw new Error('trial grant lookup failed');
      return grantAmount === undefined ? null : { id: 'grant-1', credit_amount: String(grantAmount) };
    },
  },
  balances: {
    findBalanceAccount: async () => {
      if (throwOnBalances) throw new Error('balance lookup failed');
      return { availableBalance };
    },
  },
});

test('getProcessingQuotaTier returns trial without consulting billing when P2_BILLING_ENABLED is off', async () => {
  const brokenDeps = {
    users: { ensureUser: async () => { throw new Error('must not be called'); } },
    assignments: { findCurrentPlanAssignment: async () => { throw new Error('must not be called'); } },
    billing: { findTrialGrant: async () => { throw new Error('must not be called'); } },
    balances: { findBalanceAccount: async () => { throw new Error('must not be called'); } },
  };
  const tier = await getProcessingQuotaTier(identity, { env: {}, deps: brokenDeps });
  assert.equal(tier, 'trial');
});

test('pure Trial: only an unspent Trial allowance -- stays trial tier', async () => {
  const deps = createDeps({ planCode: 'trial', grantAmount: 12n, availableBalance: 12n });
  assert.equal(await getProcessingQuotaTier(identity, { env, deps }), 'trial');
});

test('pure Trial with no grant at all and zero balance -- stays trial tier', async () => {
  const deps = createDeps({ planCode: 'trial', availableBalance: 0n });
  assert.equal(await getProcessingQuotaTier(identity, { env, deps }), 'trial');
});

test('Trial + active manual grant: balance exceeds the Trial face value -- credited', async () => {
  // 12 Trial credits untouched, plus a 1000-credit manual grant.
  const deps = createDeps({ planCode: 'trial', grantAmount: 12n, availableBalance: 1012n });
  assert.equal(await getProcessingQuotaTier(identity, { env, deps }), 'credited');
});

test('Trial + manual grant fully exhausted: balance back down to exactly the Trial face value -- falls back to trial', async () => {
  // The 1000-credit manual grant has been entirely spent; only the original
  // 12 Trial credits' worth of balance remains -- historical provenance
  // (the old manual_grant ledger entry) must not keep this credited forever.
  const deps = createDeps({ planCode: 'trial', grantAmount: 12n, availableBalance: 12n });
  assert.equal(await getProcessingQuotaTier(identity, { env, deps }), 'trial');
});

test('Trial + partially remaining manual grant: still credited while any non-Trial value remains', async () => {
  const deps = createDeps({ planCode: 'trial', grantAmount: 12n, availableBalance: 15n });
  assert.equal(await getProcessingQuotaTier(identity, { env, deps }), 'credited');
});

test('active Pro is credited regardless of remaining credit balance', async () => {
  const deps = createDeps({ planCode: 'pro', availableBalance: 0n, throwOnBilling: true, throwOnBalances: true });
  assert.equal(await getProcessingQuotaTier(identity, { env, deps }), 'credited');
});

test('expired/lapsed Pro (no active plan assignment) with no usable purchased/granted credits falls back to trial', async () => {
  // findCurrentPlanAssignment only ever returns an 'active' row -- a lapsed
  // Pro assignment surfaces here as no assignment at all (planCode: null).
  const deps = createDeps({ planCode: null, availableBalance: 0n });
  assert.equal(await getProcessingQuotaTier(identity, { env, deps }), 'trial');
});

test('purchase credits remaining (no Trial grant ever existed): credited', async () => {
  const deps = createDeps({ planCode: null, availableBalance: 20n });
  assert.equal(await getProcessingQuotaTier(identity, { env, deps }), 'credited');
});

test('purchase credits exhausted (no Trial grant ever existed, balance now zero): trial', async () => {
  const deps = createDeps({ planCode: null, availableBalance: 0n });
  assert.equal(await getProcessingQuotaTier(identity, { env, deps }), 'trial');
});

test('never classifies purely on a positive balance -- a large unspent Trial allowance alone stays trial-tier', async () => {
  const deps = createDeps({ planCode: 'trial', grantAmount: 500n, availableBalance: 500n });
  assert.equal(await getProcessingQuotaTier(identity, { env, deps }), 'trial');
});

test('fails safe to trial when the plan-assignment lookup throws', async () => {
  const deps = createDeps({ throwOnAssignment: true });
  assert.equal(await getProcessingQuotaTier(identity, { env, deps }), 'trial');
});

test('fails safe to trial when the trial-grant lookup throws', async () => {
  const deps = createDeps({ planCode: 'trial', throwOnBilling: true });
  assert.equal(await getProcessingQuotaTier(identity, { env, deps }), 'trial');
});

test('fails safe to trial when the balance lookup throws', async () => {
  const deps = createDeps({ planCode: 'trial', throwOnBalances: true });
  assert.equal(await getProcessingQuotaTier(identity, { env, deps }), 'trial');
});

test('fails safe to trial when identity is missing/invalid', async () => {
  const deps = createDeps({ planCode: 'pro' });
  assert.equal(await getProcessingQuotaTier({}, { env, deps }), 'trial');
});
