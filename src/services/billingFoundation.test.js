import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BillingError,
  estimateCredits,
  listPlans,
} from './billingFoundation.js';

const enabledEnv = {
  P2_BILLING_ENABLED: 'true',
  DATABASE_URL: 'postgresql://db.example/blink',
};

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

