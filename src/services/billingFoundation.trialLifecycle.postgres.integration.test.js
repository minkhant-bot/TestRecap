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
import * as trialRequests from '../db/repositories/trialRequests.js';
import * as users from '../db/repositories/users.js';
import {
  approveTrialRequest,
  checkAndExpireTrial,
  configureCreditPlan,
  createScreenshotIntent,
  completeScreenshotUpload,
  getProcessingQuotaTier,
  requestTrial,
  reviewPurchase,
  submitPurchase,
} from './billingFoundation.js';
import { reserveLiveJob } from './liveJobBilling.js';

const testUrl = process.env.TEST_DATABASE_URL;
const integration = testUrl ? test : test.skip;
const env = {
  P2_BILLING_ENABLED: 'true',
  P2_LIVE_JOB_BILLING_ENABLED: 'true',
  DATABASE_URL: testUrl || 'postgresql://disabled.invalid/blink',
  PAYMENT_PROOF_MAX_SIZE_MB: '10',
  GEMINI_API_KEY: 'integration-platform-key',
};
const ownerIdentity = { uid: 'owner-uid', email: 'owner@example.test', displayName: 'Owner', role: 'super_admin' };
const userIdentity = { uid: 'trial-user-uid', email: 'user@example.test', displayName: 'Trial User', role: 'user' };
const headers = sequence => ({ idempotencyKey: `trial-e2e-${sequence}` });

// Rule #1/#2/#4 (frozen) end-to-end against a real PostgreSQL instance:
// Guest requests Trial -> Owner approves (12 credits, 120h expiry, no
// questionnaire) -> Trial reserves a real job -> Trial expires and forfeits
// remaining credits and blocks new jobs -> an approved purchase
// automatically assigns Pro, independent of resulting balance.
integration('Trial request -> Owner approval -> Purchase -> Pro, full flow against real PostgreSQL', async () => {
  const schema = `blink_trial_e2e_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  const setup = new pg.Client({ connectionString: testUrl });
  await setup.connect();
  await setup.query(`CREATE SCHEMA ${schema}`);
  await setup.query(`SET search_path TO ${schema}`);
  for (const migration of discoverMigrations()) await setup.query(migration.sql);
  await setup.end();

  const pool = new pg.Pool({ connectionString: testUrl, max: 8, options: `-c search_path=${schema}` });
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
    assignments, plans, roles, trialRequests, users, hasByok: () => true,
  };
  const liveDeps = {
    transaction, audit, balances, billing, jobs: (await import('../db/repositories/jobs.js')),
    ledger, assignments, plans, reservations: (await import('../db/repositories/reservations.js')),
    users, leases: (await import('../db/repositories/workerLeases.js')),
  };

  try {
    // --- Owner user must exist before it can be referenced as created_by_user_id below ---
    const ownerUser = await users.ensureUser({
      firebaseUid: ownerIdentity.uid, email: ownerIdentity.email, displayName: ownerIdentity.displayName,
    }, { client: pool });

    // --- Catalog setup (Owner) ---
    await pool.query(`INSERT INTO plans(id,code,name,active) VALUES (gen_random_uuid(),'trial','Trial',true) RETURNING id`);
    const trialPlanRow = await pool.query(`SELECT id FROM plans WHERE code='trial'`);
    const trialPlanId = trialPlanRow.rows[0].id;
    await pool.query(
      `INSERT INTO plan_policy_versions
        (id,plan_id,version,billing_block_seconds,credits_per_block,trial_allowance_credits,billing_mode,effective_from,active,created_by_user_id)
       VALUES (gen_random_uuid(),$1,1,30,1,0,'byok','2026-01-01T00:00:00Z',true,$2)`,
      [trialPlanId, ownerUser.id],
    );
    await pool.query(`INSERT INTO plans(id,code,name,active) VALUES (gen_random_uuid(),'pro','Pro',true)`);

    // --- Rule #1: Guest requests Trial, no eligibility questionnaire ---
    const requested = await requestTrial(userIdentity, { env, deps, ...headers('request') });
    assert.equal(requested.body.request.status, 'pending');
    const user = await users.ensureUser({
      firebaseUid: userIdentity.uid, email: userIdentity.email, displayName: userIdentity.displayName,
    }, { client: pool });

    // --- Owner approves: exactly 12 credits, 120-hour expiry ---
    const approved = await approveTrialRequest(ownerIdentity, requested.body.request.id, {
      env, deps, ...headers('approve'),
    });
    assert.equal(approved.body.grant.credit_amount, '12');
    const expiresAt = new Date(approved.body.grant.expires_at).getTime();
    assert.ok(expiresAt - Date.now() >= 120 * 60 * 60 * 1000 - 5000);
    const balanceAfterGrant = await balances.findBalanceAccount(user.id, { client: pool });
    assert.equal(balanceAfterGrant.postedBalance, 12n);
    // A Trial-only balance (however large) never crosses into the credited
    // processing-usage tier -- only non-Trial credit value does.
    assert.equal(await getProcessingQuotaTier(userIdentity, { env, deps }), 'trial');

    // Re-requesting must be permanently blocked (one-time only).
    await assert.rejects(
      requestTrial(userIdentity, { env, deps, ...headers('request-again') }),
      error => error.code === 'TRIAL_ALREADY_GRANTED',
    );

    // --- Trial reserves a real job against real balances/reservations ---
    const firstReservation = await reserveLiveJob({
      identity: userIdentity, jobId: '10000000-0000-4000-8000-000000000001',
      sourceDurationSeconds: 30, requestedPlanCode: 'trial', requestedMode: 'byok',
      idempotencyKey: 'job-1', effects: {},
    }, { env, repositories: liveDeps });
    assert.equal(firstReservation.snapshot.billingStatus, 'reserved');
    const balanceAfterReserve = await balances.findBalanceAccount(user.id, { client: pool });
    assert.equal(balanceAfterReserve.reservedBalance, 1n);

    // --- Trial expires: backdate expiry directly (simulating 120h elapsed),
    // then confirm a NEW job is blocked and remaining (unreserved) credits
    // are forfeited with a durable, distinctly-labeled audit record. The
    // already-reserved job above is untouched (expiry blocks only new jobs).
    await pool.query(`UPDATE trial_grants SET expires_at = now() - interval '1 second' WHERE user_id = $1`, [user.id]);
    await assert.rejects(
      reserveLiveJob({
        identity: userIdentity, jobId: '10000000-0000-4000-8000-000000000002',
        sourceDurationSeconds: 30, requestedPlanCode: 'trial', requestedMode: 'byok',
        idempotencyKey: 'job-2', effects: {},
      }, { env, repositories: liveDeps }),
      error => error.code === 'TRIAL_EXPIRED',
    );
    const balanceAfterExpiry = await balances.findBalanceAccount(user.id, { client: pool });
    assert.equal(balanceAfterExpiry.postedBalance, 1n); // only the already-reserved credit remains
    assert.equal(balanceAfterExpiry.reservedBalance, 1n); // untouched, first job still in flight
    // No usable (available) credit remains and there was never any non-Trial
    // grant -- still Trial tier, not credited.
    assert.equal(await getProcessingQuotaTier(userIdentity, { env, deps }), 'trial');
    const expiredAudit = await pool.query(
      `SELECT * FROM audit_logs WHERE event_type = 'trial.expired' AND subject_user_id = $1`, [user.id],
    );
    assert.equal(expiredAudit.rows.length, 1);
    const firstJobStillReserved = await pool.query(
      `SELECT status FROM credit_reservations WHERE job_id = $1`, ['10000000-0000-4000-8000-000000000001'],
    );
    assert.equal(firstJobStillReserved.rows[0].status, 'reserved');

    // --- Approved purchase automatically assigns Pro, independent of credit outcome ---
    const creditPlan = await configureCreditPlan(ownerIdentity, {
      code: 'starter', name: 'Starter', description: '', creditAmount: 20, priceMinor: 500,
      currency: 'USD', active: true, displayOrder: 1, confirmed: true,
    }, { env, deps, ...headers('package') });
    await pool.query(
      `INSERT INTO bank_accounts(id,code,bank_name,account_name,account_number,currency,active,created_by_user_id,updated_by_user_id)
       SELECT gen_random_uuid(),'bank-1','Test Bank','Owner','0000','USD',true,id,id FROM users WHERE firebase_uid=$1`,
      [ownerIdentity.uid],
    );
    const bank = await pool.query(`SELECT id FROM bank_accounts WHERE code='bank-1'`);
    await pool.query(
      `INSERT INTO credit_plan_bank_accounts(credit_plan_id,bank_account_id,active,created_by_user_id)
       SELECT $1,$2,true,id FROM users WHERE firebase_uid=$3`,
      [creditPlan.body.creditPlan.id, bank.rows[0].id, ownerIdentity.uid],
    );
    const sha256 = '1'.repeat(64);
    const screenshot = await createScreenshotIntent(userIdentity, {
      originalFilename: 'proof.png', mimeType: 'image/png', sizeBytes: 100, sha256,
    }, { env, deps, ...headers('screenshot') });
    await completeScreenshotUpload(userIdentity, screenshot.body.id, {
      mimeType: 'image/png', sizeBytes: 100, sha256,
    }, { env, deps, ...headers('screenshot-complete') });
    const purchase = await submitPurchase(userIdentity, {
      creditPlanId: creditPlan.body.creditPlan.id, bankAccountId: bank.rows[0].id,
      screenshotFileId: screenshot.body.id,
    }, { env, deps, ...headers('submit') });
    const purchaseApproval = await reviewPurchase(ownerIdentity, purchase.body.purchase.id, {
      decision: 'approved',
    }, { env, deps, ...headers('purchase-approve') });
    assert.ok(purchaseApproval.body.proAssignment);
    const finalAssignment = await assignments.findCurrentPlanAssignment(user.id, { client: pool });
    assert.equal(finalAssignment.planCode, 'pro');
    // An active Pro assignment is 'credited' on its own, independent of
    // remaining credit balance.
    assert.equal(await getProcessingQuotaTier(userIdentity, { env, deps }), 'credited');
    const proAudit = await pool.query(
      `SELECT * FROM audit_logs WHERE event_type = 'plan.pro_assigned_via_purchase' AND subject_user_id = $1`, [user.id],
    );
    assert.equal(proAudit.rows.length, 1);

    // --- A second expiry check is a clean no-op (already expired once) ---
    const secondClient = await pool.connect();
    try {
      const noOpExpiry = await checkAndExpireTrial(user.id, {
        client: secondClient, deps: { billing, balances, ledger, audit },
      });
      assert.equal(noOpExpiry, null);
    } finally {
      secondClient.release();
    }
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
