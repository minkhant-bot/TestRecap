import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { discoverMigrations } from '../db/migrations.js';
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
  completeScreenshotUpload,
  createCreditPackage,
  createPlanPolicy,
  createScreenshotIntent,
  editCreditPackage,
  grantTrial,
  linkPackageBank,
  archiveCreditPackage,
  reorderCreditPackages,
  reviewPurchase,
  setCreditPackageStatus,
  submitPurchase,
} from './billingFoundation.js';

const testUrl = process.env.TEST_DATABASE_URL;
const integration = testUrl ? test : test.skip;
const env = {
  P2_BILLING_ENABLED: 'true',
  DATABASE_URL: testUrl || 'postgresql://disabled.invalid/blink',
  PAYMENT_PROOF_MAX_SIZE_MB: '10',
  GEMINI_API_KEY: 'integration-platform-key',
};
const adminIdentity = {
  uid: 'billing-admin', email: 'admin@example.test', displayName: 'Billing Admin', role: 'super_admin',
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
  for (const migration of discoverMigrations()) await setup.query(migration.sql);
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
      billingMode: 'blink_funded',
      active: true,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      entitlements: [
        { key: 'blur', enabled: true },
        { key: 'flip', enabled: true },
        { key: 'byok_mode', enabled: false },
        { key: 'blink_funded_mode', enabled: true },
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
        billingMode: 'blink_funded',
        active: true,
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        entitlements: [
          { key: 'blur', enabled: true },
          { key: 'flip', enabled: true },
          { key: 'byok_mode', enabled: false },
          { key: 'blink_funded_mode', enabled: true },
        ],
      }, { env, deps, ...headers('policy-trial-overlap') }),
      error => error.code === 'PLAN_POLICY_OVERLAP',
    );
    // Rule #4 (frozen): Normal plan removed entirely — only Trial and Pro exist.
    await configurePlan(adminIdentity, {
      code: 'pro', name: 'Pro', description: '', active: true, displayOrder: 2,
    }, { env, deps, ...headers('plan-pro') });
    await assert.rejects(
      configurePlan(adminIdentity, {
        code: 'normal', name: 'Normal', description: '', active: true, displayOrder: 3,
      }, { env, deps, ...headers('plan-normal-removed') }),
      error => error.code === 'INVALID_INPUT',
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
      confirmed: true,
    }, { env, deps, ...headers('package') });
    const managedPackage = await createCreditPackage(adminIdentity, {
      name: 'Managed package', price: 250, creditAmount: 25, bonusCredits: 5,
      currency: 'USD', active: true, displayOrder: 2, note: 'Native PostgreSQL',
      confirmed: true,
    }, { env, deps, ...headers('managed-package-create') });
    const managedPackageId = managedPackage.body.creditPackage.id;
    await editCreditPackage(adminIdentity, managedPackageId, {
      name: 'Managed package edited', price: 275, creditAmount: 27,
      bonusCredits: 6, currency: 'USD', active: true, displayOrder: 2,
      note: 'Edited in native PostgreSQL', confirmed: true,
    }, { env, deps, ...headers('managed-package-edit') });
    await setCreditPackageStatus(adminIdentity, managedPackageId, false, {
      confirmed: true,
    }, { env, deps, ...headers('managed-package-deactivate') });
    await setCreditPackageStatus(adminIdentity, managedPackageId, true, {
      confirmed: true,
    }, { env, deps, ...headers('managed-package-activate') });
    await reorderCreditPackages(adminIdentity, {
      confirmed: true,
      items: [
        { id: packageResult.body.creditPlan.id, displayOrder: 2 },
        { id: managedPackageId, displayOrder: 1 },
      ],
    }, { env, deps, ...headers('managed-package-reorder') });
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
      const sha256 = String(sequence).padStart(64, 'a').slice(-64).replace(/[^0-9a-f]/g, 'a');
      const screenshot = await createScreenshotIntent(userIdentity, {
        originalFilename: `payment-${sequence}.png`,
        mimeType: 'image/png',
        sizeBytes: 100,
        sha256,
      }, { env, deps, ...headers(`screenshot-${sequence}`) });
      await completeScreenshotUpload(userIdentity, screenshot.body.id, {
        mimeType: 'image/png', sizeBytes: 100, sha256,
      }, { env, deps, ...headers(`complete-${sequence}`) });
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
    const purchaseSnapshotBeforePackageEdit = await pool.query(
      `SELECT plan_name_snapshot,purchase_credit_snapshot,price_minor_snapshot,currency_snapshot
       FROM credit_purchase_requests WHERE id=$1`,
      [first.body.purchase.id],
    );
    await editCreditPackage(adminIdentity, packageResult.body.creditPlan.id, {
      name: 'Changed after purchase', price: 999, creditAmount: 99,
      bonusCredits: 0, currency: 'USD', active: true, displayOrder: 2,
      note: null, confirmed: true,
    }, { env, deps, ...headers('purchased-package-edit') });
    const purchaseSnapshotAfterPackageEdit = await pool.query(
      `SELECT plan_name_snapshot,purchase_credit_snapshot,price_minor_snapshot,currency_snapshot
       FROM credit_purchase_requests WHERE id=$1`,
      [first.body.purchase.id],
    );
    assert.deepEqual(purchaseSnapshotAfterPackageEdit.rows, purchaseSnapshotBeforePackageEdit.rows);
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

    // Package-level bonus_credits (Super Admin package management) must
    // actually be granted on purchase approval as one combined total, not
    // just configured and silently dropped. Uses a separate identity so this
    // never disturbs the ledgerTotal=31n assertion above.
    await linkPackageBank(adminIdentity, {
      creditPlanId: managedPackageId,
      bankAccountId: bankResult.body.bank.id,
      active: true,
    }, { env, deps, ...headers('managed-package-bank-link') });
    const bonusBuyerIdentity = {
      uid: 'billing-bonus-buyer', email: 'bonus-buyer@example.test', displayName: 'Bonus Buyer',
    };
    const bonusBuyer = await users.ensureUser({
      firebaseUid: bonusBuyerIdentity.uid,
      email: bonusBuyerIdentity.email,
      displayName: bonusBuyerIdentity.displayName,
    }, { client: pool });
    const bonusScreenshot = await createScreenshotIntent(bonusBuyerIdentity, {
      originalFilename: 'bonus-payment.png', mimeType: 'image/png', sizeBytes: 100,
      sha256: 'b'.repeat(64),
    }, { env, deps, ...headers('bonus-screenshot') });
    await completeScreenshotUpload(bonusBuyerIdentity, bonusScreenshot.body.id, {
      mimeType: 'image/png', sizeBytes: 100, sha256: 'b'.repeat(64),
    }, { env, deps, ...headers('bonus-screenshot-complete') });
    // managedPackageId is currently active with creditAmount=27, bonusCredits=6
    // (edited above): 27 base + 6 bonus must grant exactly 33 credits.
    const bonusPurchase = await submitPurchase(bonusBuyerIdentity, {
      creditPlanId: managedPackageId,
      bankAccountId: bankResult.body.bank.id,
      screenshotFileId: bonusScreenshot.body.id,
    }, { env, deps, ...headers('bonus-submit') });
    const bonusApproved = await reviewPurchase(
      adminIdentity, bonusPurchase.body.purchase.id, { decision: 'approved' },
      { env, deps, ...headers('bonus-approve') },
    );
    assert.equal(bonusApproved.body.purchase.credits, '27');
    assert.equal(bonusApproved.body.purchase.packageBonusCredits, '6');
    assert.equal(bonusApproved.body.purchaseLedger.amount, '33');
    const bonusBalance = await balances.findBalanceAccount(bonusBuyer.id, { client: pool });
    assert.equal(bonusBalance.postedBalance, 33n);
    // Repeated approval of the same purchase must never double-grant credits.
    await assert.rejects(
      reviewPurchase(adminIdentity, bonusPurchase.body.purchase.id, { decision: 'approved' }, {
        env, deps, ...headers('bonus-approve-again'),
      }),
      error => error.code === 'INVALID_PURCHASE_STATE',
    );
    const bonusBalanceAfterRetry = await balances.findBalanceAccount(bonusBuyer.id, { client: pool });
    assert.equal(bonusBalanceAfterRetry.postedBalance, 33n);

    await archiveCreditPackage(adminIdentity, managedPackageId, { confirmed: true }, {
      env, deps, ...headers('managed-package-archive'),
    });
    const archivedPackage = await billing.findCreditPackageById(managedPackageId, { client: pool });
    assert.equal(archivedPackage.active, false);
    assert.ok(archivedPackage.archivedAt);
    await assert.rejects(
      editCreditPackage(adminIdentity, managedPackageId, {
        name: 'Cannot rewrite archived package', confirmed: true,
      }, { env, deps, ...headers('managed-package-edit-archived') }),
      error => error.code === 'PACKAGE_ARCHIVED',
    );
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
