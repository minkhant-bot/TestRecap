import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import pg from 'pg';
import { migrationsDirectory } from '../db/migrations.js';
import * as audit from '../db/repositories/auditLogs.js';
import * as balances from '../db/repositories/balances.js';
import * as billing from '../db/repositories/billing.js';
import * as idempotency from '../db/repositories/idempotencyKeys.js';
import * as ledger from '../db/repositories/ledger.js';
import * as assignments from '../db/repositories/planAssignments.js';
import * as plans from '../db/repositories/plans.js';
import * as roles from '../db/repositories/roles.js';
import * as users from '../db/repositories/users.js';
import {
  adjustCredits,
  assessTrial,
  configureBank,
  configureCreditPlan,
  configurePlan,
  configurePromotion,
  createPlanPolicy,
  createScreenshotIntent,
  grantTrial,
  linkPackageBank,
  reviewPurchase,
  submitPurchase,
  verifyScreenshot,
} from './billingFoundation.js';

const testUrl = process.env.TEST_DATABASE_URL;
const integration = testUrl ? test : test.skip;
const env = {
  P2_BILLING_ENABLED: 'true',
  DATABASE_URL: testUrl || 'postgresql://disabled.invalid/blink',
  PAYMENT_SCREENSHOT_STORAGE_PROVIDER: 'integration-private',
  PAYMENT_SCREENSHOT_STORAGE_BUCKET: 'integration-private',
  GEMINI_API_KEY: 'integration-platform-key',
};
const adminIdentity = {
  uid: 'billing-admin', email: 'admin@example.test', displayName: 'Billing Admin',
};
const userIdentity = {
  uid: 'billing-user', email: 'user@example.test', displayName: 'Billing User',
};
const headers = sequence => ({ idempotencyKey: `integration-${sequence}` });

integration('P2 billing services preserve atomic, idempotent, one-time-credit invariants', async () => {
  const schema = `blink_billing_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const setup = new pg.Client({ connectionString: testUrl });
  await setup.connect();
  await setup.query(`CREATE SCHEMA ${schema}`);
  await setup.query(`SET search_path TO ${schema}`);
  await setup.query(fs.readFileSync(`${migrationsDirectory}/0001_p2_foundation.sql`, 'utf8'));
  await setup.end();

  const pool = new pg.Pool({
    connectionString: testUrl,
    max: 8,
    options: `-c search_path=${schema}`,
  });
  const transaction = async callback => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  const deps = {
    transaction, audit, balances, billing, idempotency, ledger,
    assignments, plans, roles, users, hasByok: () => true,
  };

  try {
    const admin = await users.ensureUser({
      firebaseUid: adminIdentity.uid,
      email: adminIdentity.email,
      displayName: adminIdentity.displayName,
    }, { client: pool });
    await pool.query(
      `INSERT INTO user_roles(user_id,role,source)
       VALUES ($1,'super_admin','migration')`,
      [admin.id],
    );
    const user = await users.ensureUser({
      firebaseUid: userIdentity.uid,
      email: userIdentity.email,
      displayName: userIdentity.displayName,
    }, { client: pool });

    await configurePlan(adminIdentity, {
      code: 'trial', name: 'Trial', description: '', active: true, displayOrder: 1,
    }, { env, deps, ...headers('plan-trial') });
    await createPlanPolicy(adminIdentity, 'trial', {
      version: 1,
      creditsPerBlock: 2,
      trialAllowanceCredits: 6,
      billingMode: 'byok',
      active: true,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      entitlements: [
        { key: 'blur', enabled: false },
        { key: 'flip', enabled: false },
        { key: 'byok_mode', enabled: true },
        { key: 'blink_funded_mode', enabled: false },
      ],
    }, { env, deps, ...headers('policy-trial') });
    await assessTrial(adminIdentity, {
      userId: userIdentity.uid,
      decision: 'eligible',
      policyVersion: 1,
      riskReasons: [],
    }, { env, deps, ...headers('trial-assessment') });
    const trial = await grantTrial(userIdentity, {}, {
      env, deps, ...headers('trial-grant'),
    });
    assert.equal(trial.body.balance.postedBalance, '6');
    const trialReplay = await grantTrial(userIdentity, {}, {
      env, deps, ...headers('trial-grant'),
    });
    assert.equal(trialReplay.replayed, true);

    await assert.rejects(
      createPlanPolicy(adminIdentity, 'trial', {
        version: 2,
        creditsPerBlock: 2,
        trialAllowanceCredits: 6,
        billingMode: 'byok',
        active: true,
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        entitlements: [
          { key: 'blur', enabled: false },
          { key: 'flip', enabled: false },
          { key: 'byok_mode', enabled: true },
          { key: 'blink_funded_mode', enabled: false },
        ],
      }, { env, deps, ...headers('policy-trial-overlap') }),
      error => error.code === 'PLAN_POLICY_OVERLAP',
    );
    for (const [code, name] of [['normal', 'Normal'], ['pro', 'Pro']]) {
      await configurePlan(adminIdentity, {
        code, name, description: '', active: true, displayOrder: code === 'normal' ? 2 : 3,
      }, { env, deps, ...headers(`plan-${code}`) });
    }
    await createPlanPolicy(adminIdentity, 'normal', {
      version: 1,
      creditsPerBlock: 3,
      trialAllowanceCredits: 0,
      billingMode: 'byok',
      active: true,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      entitlements: [
        { key: 'blur', enabled: false },
        { key: 'flip', enabled: false },
        { key: 'byok_mode', enabled: true },
        { key: 'blink_funded_mode', enabled: false },
      ],
    }, { env, deps, ...headers('policy-normal') });
    await assert.rejects(
      createPlanPolicy(adminIdentity, 'pro', {
        version: 1,
        creditsPerBlock: 3,
        trialAllowanceCredits: 0,
        billingMode: 'blink_funded',
        active: true,
        effectiveFrom: '2026-01-01T00:00:00.000Z',
        entitlements: [
          { key: 'blur', enabled: true },
          { key: 'flip', enabled: true },
          { key: 'byok_mode', enabled: false },
          { key: 'blink_funded_mode', enabled: true },
        ],
      }, { env, deps, ...headers('policy-pro-invalid-rate') }),
      error => error.code === 'INVALID_PLAN_RATE',
    );
    await createPlanPolicy(adminIdentity, 'pro', {
      version: 1,
      creditsPerBlock: 5,
      trialAllowanceCredits: 0,
      billingMode: 'blink_funded',
      active: true,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      entitlements: [
        { key: 'blur', enabled: true },
        { key: 'flip', enabled: true },
        { key: 'byok_mode', enabled: false },
        { key: 'blink_funded_mode', enabled: true },
      ],
    }, { env, deps, ...headers('policy-pro') });

    const promotionResult = await configurePromotion(adminIdentity, {
      code: 'first-real-purchase',
      version: 1,
      bonusCredits: 3,
      active: true,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    }, { env, deps, ...headers('promotion') });
    const packageResult = await configureCreditPlan(adminIdentity, {
      code: 'integration-package',
      name: 'Integration package',
      description: '',
      creditAmount: 10,
      priceMinor: 100,
      currency: 'USD',
      active: true,
      displayOrder: 1,
    }, { env, deps, ...headers('package') });
    const bankResult = await configureBank(adminIdentity, {
      code: 'integration-bank',
      bankName: 'Integration Bank',
      accountName: 'Integration',
      accountNumber: '0000',
      currency: 'USD',
      instructions: '',
      active: true,
      displayOrder: 1,
    }, { env, deps, ...headers('bank') });
    await linkPackageBank(adminIdentity, {
      creditPlanId: packageResult.body.creditPlan.id,
      bankAccountId: bankResult.body.bank.id,
      active: true,
    }, { env, deps, ...headers('link') });

    const createPendingPurchase = async sequence => {
      const screenshot = await createScreenshotIntent(userIdentity, {
        originalFilename: `payment-${sequence}.png`,
        mimeType: 'image/png',
        sizeBytes: 100,
        sha256: String(sequence).padStart(64, 'a').slice(-64).replace(/[^0-9a-f]/g, 'a'),
      }, { env, deps, ...headers(`screenshot-${sequence}`) });
      await verifyScreenshot(adminIdentity, screenshot.body.id, {
        env, deps, ...headers(`verify-${sequence}`),
      });
      return submitPurchase(userIdentity, {
        creditPlanId: packageResult.body.creditPlan.id,
        bankAccountId: bankResult.body.bank.id,
        screenshotFileId: screenshot.body.id,
      }, { env, deps, ...headers(`submit-${sequence}`) });
    };

    const first = await createPendingPurchase(1);
    const concurrent = await Promise.allSettled([
      reviewPurchase(adminIdentity, first.body.purchase.id, { decision: 'approved' }, {
        env, deps, ...headers('approve-first-a'),
      }),
      reviewPurchase(adminIdentity, first.body.purchase.id, { decision: 'approved' }, {
        env, deps, ...headers('approve-first-b'),
      }),
    ]);
    assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter(item => item.status === 'rejected').length, 1);
    const approved = concurrent.find(item => item.status === 'fulfilled').value;
    assert.equal(approved.body.purchase.status, 'approved');
    assert.equal(approved.body.purchaseLedger.amount, '10');
    assert.equal(approved.body.bonusLedger.amount, '3');

    const second = await createPendingPurchase(2);
    const secondApproved = await reviewPurchase(
      adminIdentity, second.body.purchase.id, { decision: 'approved' },
      { env, deps, ...headers('approve-second') },
    );
    assert.equal(secondApproved.body.bonusLedger, null);

    const rejected = await createPendingPurchase(3);
    const rejectedResult = await reviewPurchase(
      adminIdentity, rejected.body.purchase.id,
      { decision: 'rejected', reason: 'Payment not confirmed.' },
      { env, deps, ...headers('reject-third') },
    );
    assert.equal(rejectedResult.body.purchase.status, 'rejected');
    await assert.rejects(
      reviewPurchase(adminIdentity, rejected.body.purchase.id, { decision: 'approved' }, {
        env, deps, ...headers('approve-rejected'),
      }),
      error => error.code === 'INVALID_PURCHASE_STATE',
    );

    await adjustCredits(adminIdentity, {
      userId: userIdentity.uid,
      amount: 4,
      direction: 'grant',
      reason: 'Integration adjustment.',
    }, { env, deps, ...headers('manual-grant') });
    await adjustCredits(adminIdentity, {
      userId: userIdentity.uid,
      amount: 2,
      direction: 'deduction',
      reason: 'Integration correction.',
    }, { env, deps, ...headers('manual-deduction') });

    const counts = await pool.query(
      `SELECT entry_type,count(*)::int count,coalesce(sum(amount),0)::bigint total
       FROM credit_ledger WHERE user_id=$1 GROUP BY entry_type`,
      [user.id],
    );
    const byType = Object.fromEntries(counts.rows.map(row => [
      row.entry_type, { count: row.count, total: BigInt(row.total) },
    ]));
    assert.equal(byType.trial_grant.count, 1);
    assert.equal(byType.purchase.count, 2);
    assert.equal(byType.first_purchase_bonus.count, 1);
    assert.equal(byType.manual_grant.count, 1);
    assert.equal(byType.manual_deduction.count, 1);
    assert.equal(promotionResult.body.promotion.bonus_credits, '3');

    const projection = await balances.findBalanceAccount(user.id, { client: pool });
    const ledgerTotal = await ledger.sumPostedCredits(user.id, { client: pool });
    assert.equal(projection.postedBalance, ledgerTotal);
    assert.equal(ledgerTotal, 31n);
  } finally {
    await pool.end();
    const cleanup = new pg.Client({ connectionString: testUrl });
    await cleanup.connect();
    try {
      await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await cleanup.end();
    }
  }
});
