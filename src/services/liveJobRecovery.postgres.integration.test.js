import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { discoverMigrations } from '../db/migrations.js';
import * as audit from '../db/repositories/auditLogs.js';
import * as balances from '../db/repositories/balances.js';
import * as jobs from '../db/repositories/jobs.js';
import * as ledger from '../db/repositories/ledger.js';
import * as assignments from '../db/repositories/planAssignments.js';
import * as plans from '../db/repositories/plans.js';
import * as reservations from '../db/repositories/reservations.js';
import * as users from '../db/repositories/users.js';
import { reserveLiveJob, releaseLiveJob, settleLiveJob, markLiveJobReviewRequired, listRecoverableLiveJobIds, getLiveJobBillingStatus } from './liveJobBilling.js';
import { reconcileStrandedLiveJobs } from './liveJobRecovery.js';

const url = process.env.TEST_DATABASE_URL;
const integration = url ? test : test.skip;
const env = {
  P2_BILLING_ENABLED: 'true', P2_LIVE_JOB_BILLING_ENABLED: 'true',
  DATABASE_URL: url || 'postgres://disabled.invalid/blink',
};

integration(
  'reconcileStrandedLiveJobs settles/releases real crash-stranded PostgreSQL reservations idempotently, ' +
  'and never touches a genuinely active job',
  async () => {
    const schema = `blink_recovery_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const setup = new pg.Client({ connectionString: url });
    await setup.connect();
    await setup.query(`CREATE SCHEMA ${schema}`);
    await setup.query(`SET search_path TO ${schema}`);
    for (const migration of discoverMigrations()) await setup.query(migration.sql);
    await setup.end();
    const pool = new pg.Pool({ connectionString: url, max: 8, options: `-c search_path=${schema}` });
    const transaction = async work => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    };
    const scopedJobs = {
      ...jobs,
      findBillingJob: (jobId, options = {}) => jobs.findBillingJob(jobId, { ...options, client: options.client || pool }),
      listRecoverableBillingJobs: (options = {}) =>
        jobs.listRecoverableBillingJobs({ ...options, client: options.client || pool }),
    };
    const repositories = {
      transaction, audit, balances, jobs: scopedJobs, ledger, assignments, plans, reservations, users,
    };

    try {
      const identity = { uid: 'recovery-user', email: 'recovery@example.test' };
      const user = await users.ensureUser({ firebaseUid: identity.uid, email: identity.email }, { client: pool });
      const planId = '00000000-0000-4000-8000-000000000201';
      const policyId = '00000000-0000-4000-8000-000000000202';
      await pool.query(`INSERT INTO plans(id,code,name,active) VALUES($1,'pro','Pro',true)`, [planId]);
      await pool.query(
        `INSERT INTO plan_policy_versions
          (id,plan_id,version,billing_block_seconds,credits_per_block,
           trial_allowance_credits,billing_mode,effective_from,active,created_by_user_id)
         VALUES($2,$1,1,30,2,0,'blink_funded','2026-01-01',true,$3)`,
        [planId, policyId, user.id],
      );
      await pool.query(
        `INSERT INTO plan_entitlements(id,policy_version_id,entitlement_key,enabled)
         VALUES(gen_random_uuid(),$1,'blur',true),(gen_random_uuid(),$1,'flip',true)`,
        [policyId],
      );
      await pool.query(
        `INSERT INTO user_plan_assignments(id,user_id,plan_id,status,source,starts_at)
         VALUES(gen_random_uuid(),$1,$2,'active','user_selection',now())`,
        [user.id, planId],
      );
      await pool.query(
        `INSERT INTO credit_balance_accounts(user_id,posted_balance,reserved_balance) VALUES($1,100,0)`,
        [user.id],
      );
      const base = {
        identity, sourceDurationSeconds: 61, requestedPlanCode: 'pro',
        requestedMode: 'blink_funded', effects: {},
      };

      // --- Scenario 1: crash-stranded job with valid completed output -> settle ---
      const settledJobId = '00000000-0000-4000-8000-000000000211';
      const balanceBeforeSettle = await balances.findBalanceAccount(user.id, { client: pool });
      await reserveLiveJob({ ...base, jobId: settledJobId, idempotencyKey: 'recovery-settle' }, { env, repositories });
      const settledReservationBeforeSweep = await reservations.findReservationByJobId(settledJobId, { client: pool });
      const workspaceJobs = {
        [settledJobId]: { status: 'completed', videoUrl: `/output/${settledJobId}.mp4` },
      };
      const boundDeps = {
        listStranded: () => listRecoverableLiveJobIds({ repositories }),
        getBillingStatus: jobId => getLiveJobBillingStatus(jobId, { repositories }),
        settle: (jobId, options) => settleLiveJob(jobId, options, { repositories }),
        release: (jobId, reason) => releaseLiveJob(jobId, reason, { repositories }),
        reviewRequired: (jobId, reason) => markLiveJobReviewRequired(jobId, reason, { repositories }),
        getWorkspaceJob: jobId => workspaceJobs[jobId] || null,
        validateOutput: () => true, // simulates real on-disk output validation succeeding
      };

      const firstPass = await reconcileStrandedLiveJobs(boundDeps);
      assert.equal(firstPass.enabled, true);
      assert.ok(firstPass.reconciled >= 1);
      const settledReservation = await reservations.findReservationByJobId(settledJobId, { client: pool });
      assert.equal(settledReservation.status, 'settled');
      const settlementEntries = (await ledger.listLedgerEntries(user.id, { client: pool }))
        .filter(entry => entry.jobId === settledJobId && entry.entryType === 'settlement');
      assert.equal(settlementEntries.length, 1);
      const balanceAfterFirst = await balances.findBalanceAccount(user.id, { client: pool });
      // Settlement decreases both posted and reserved balance by the
      // reserved amount (see liveJobBilling.js transitionReservation
      // 'settle' branch); compute the expected delta from the real
      // reservation instead of a hardcoded credit-block calculation.
      assert.equal(
        balanceAfterFirst.postedBalance,
        balanceBeforeSettle.postedBalance - settledReservationBeforeSweep.amount,
      );
      assert.equal(balanceAfterFirst.reservedBalance, 0n);

      // Re-running the sweep must be a pure no-op: no duplicate settlement,
      // no balance change, and (per the real query) the now-completed job is
      // no longer even reported as recoverable.
      const secondPass = await reconcileStrandedLiveJobs(boundDeps);
      const settlementEntriesAfterSecondPass = (await ledger.listLedgerEntries(user.id, { client: pool }))
        .filter(entry => entry.jobId === settledJobId && entry.entryType === 'settlement');
      assert.equal(settlementEntriesAfterSecondPass.length, 1, 'must never double-settle');
      const balanceAfterSecond = await balances.findBalanceAccount(user.id, { client: pool });
      assert.equal(balanceAfterSecond.postedBalance, balanceAfterFirst.postedBalance);
      assert.equal(secondPass.total, 0, 'a correctly settled job must no longer be reported as recoverable');

      // --- Scenario 2: crash-stranded job with a failed workspace outcome -> release ---
      const releasedJobId = '00000000-0000-4000-8000-000000000212';
      await reserveLiveJob({ ...base, jobId: releasedJobId, idempotencyKey: 'recovery-release' }, { env, repositories });
      workspaceJobs[releasedJobId] = { status: 'failed' };
      const balanceBeforeRelease = await balances.findBalanceAccount(user.id, { client: pool });
      await reconcileStrandedLiveJobs(boundDeps);
      const releasedReservation = await reservations.findReservationByJobId(releasedJobId, { client: pool });
      assert.equal(releasedReservation.status, 'released');
      const balanceAfterRelease = await balances.findBalanceAccount(user.id, { client: pool });
      // Release restores reserved_balance without touching posted_balance.
      assert.equal(balanceAfterRelease.postedBalance, balanceBeforeRelease.postedBalance);
      assert.equal(balanceAfterRelease.reservedBalance, 0n);

      // --- Scenario 3: CRITICAL -- a genuinely still-active job must never be touched ---
      const activeJobId = '00000000-0000-4000-8000-000000000213';
      await reserveLiveJob({ ...base, jobId: activeJobId, idempotencyKey: 'recovery-active' }, { env, repositories });
      workspaceJobs[activeJobId] = { status: 'processing' };
      const balanceBeforeActiveSweep = await balances.findBalanceAccount(user.id, { client: pool });
      await reconcileStrandedLiveJobs(boundDeps);
      const activeReservation = await reservations.findReservationByJobId(activeJobId, { client: pool });
      assert.equal(activeReservation.status, 'reserved', 'a genuinely active reservation must never be released or settled');
      const balanceAfterActiveSweep = await balances.findBalanceAccount(user.id, { client: pool });
      assert.equal(balanceAfterActiveSweep.postedBalance, balanceBeforeActiveSweep.postedBalance);
      assert.equal(balanceAfterActiveSweep.reservedBalance, balanceBeforeActiveSweep.reservedBalance);

      // --- Scenario 4: missing workspace record -> review_required, never guessed ---
      const missingJobId = '00000000-0000-4000-8000-000000000214';
      await reserveLiveJob({ ...base, jobId: missingJobId, idempotencyKey: 'recovery-missing' }, { env, repositories });
      // Intentionally no workspaceJobs[missingJobId] entry.
      await reconcileStrandedLiveJobs(boundDeps);
      const missingReservation = await reservations.findReservationByJobId(missingJobId, { client: pool });
      assert.equal(missingReservation.status, 'review_required');
    } finally {
      await pool.end();
      const cleanup = new pg.Client({ connectionString: url });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      } finally {
        await cleanup.end();
      }
    }
  },
);
