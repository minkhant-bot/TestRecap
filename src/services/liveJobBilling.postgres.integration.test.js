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
import * as leases from '../db/repositories/workerLeases.js';
import {
  acquireLiveJobLease,
  handleLiveJobFailure,
  listRecoverableLiveJobIds,
  releaseLiveJobLease,
  releaseLiveJob,
  reserveLiveJob,
  settleLiveJob,
} from './liveJobBilling.js';

const url = process.env.TEST_DATABASE_URL;
const integration = url ? test : test.skip;
const env = {
  P2_BILLING_ENABLED: 'true',
  P2_LIVE_JOB_BILLING_ENABLED: 'true',
  DATABASE_URL: url || 'postgres://disabled.invalid/blink',
};

integration('live billing uses real PostgreSQL locks, ledger compensation, and worker leases', async () => {
  const schema = `blink_live_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const setup = new pg.Client({ connectionString: url });
  await setup.connect();
  await setup.query(`CREATE SCHEMA ${schema}`);
  await setup.query(`SET search_path TO ${schema}`);
  for (const migration of discoverMigrations()) await setup.query(migration.sql);
  await setup.end();
  const pool = new pg.Pool({
    connectionString: url, max: 8, options: `-c search_path=${schema}`,
  });
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
    findBillingJob: (jobId, options = {}) => jobs.findBillingJob(jobId, {
      ...options, client: options.client || pool,
    }),
    listRecoverableBillingJobs: (options = {}) => jobs.listRecoverableBillingJobs({
      ...options, client: options.client || pool,
    }),
  };
  const scopedLeases = {
    ...leases,
    heartbeatLease: (lease, options = {}) => leases.heartbeatLease(lease, {
      ...options, client: options.client || pool,
    }),
    releaseLease: (lease, options = {}) => leases.releaseLease(lease, {
      ...options, client: options.client || pool,
    }),
  };
  const repositories = {
    transaction, audit, balances, jobs: scopedJobs, ledger,
    assignments, plans, reservations, users, leases: scopedLeases,
  };
  const identity = { uid: 'live-user', email: 'live@example.test' };
  try {
    const user = await users.ensureUser({
      firebaseUid: identity.uid, email: identity.email,
    }, { client: pool });
    const planId = '00000000-0000-4000-8000-000000000101';
    const policyId = '00000000-0000-4000-8000-000000000102';
    const entitlementIds = [
      '00000000-0000-4000-8000-000000000103',
      '00000000-0000-4000-8000-000000000104',
      '00000000-0000-4000-8000-000000000105',
    ];
    const assignmentId = '00000000-0000-4000-8000-000000000106';
    await pool.query(
      `INSERT INTO plans(id,code,name,active) VALUES($1,'normal','Normal',true)`,
      [planId],
    );
    await pool.query(
      `INSERT INTO plan_policy_versions
        (id,plan_id,version,billing_block_seconds,credits_per_block,
         trial_allowance_credits,billing_mode,effective_from,active,created_by_user_id)
       VALUES($2,$1,1,30,2,0,'byok','2026-01-01',true,$3)`,
      [planId, policyId, user.id],
    );
    await pool.query(
      `INSERT INTO plan_entitlements(id,policy_version_id,entitlement_key,enabled)
       VALUES($2,$1,'blur',false),($3,$1,'flip',false),($4,$1,'byok_mode',true)`,
      [policyId, ...entitlementIds],
    );
    await pool.query(
      `INSERT INTO user_plan_assignments(id,user_id,plan_id,status,source,starts_at)
       VALUES($1,$2,$3,'active','user_selection',now())`,
      [assignmentId, user.id, planId],
    );
    await pool.query(
      `INSERT INTO credit_balance_accounts(user_id,posted_balance,reserved_balance)
       VALUES($1,6,0)`,
      [user.id],
    );
    const base = {
      identity, sourceDurationSeconds: 61, requestedPlanCode: 'normal',
      requestedMode: 'byok', effects: {},
    };
    const concurrent = await Promise.allSettled([
      reserveLiveJob({
        ...base, jobId: '00000000-0000-4000-8000-000000000111',
        idempotencyKey: 'live-a',
      }, { env, repositories }),
      reserveLiveJob({
        ...base, jobId: '00000000-0000-4000-8000-000000000112',
        idempotencyKey: 'live-b',
      }, { env, repositories }),
    ]);
    assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter(item => item.status === 'rejected').length, 1);
    const jobId = concurrent.find(item => item.status === 'fulfilled').value.snapshot
      ? (concurrent[0].status === 'fulfilled'
        ? '00000000-0000-4000-8000-000000000111'
        : '00000000-0000-4000-8000-000000000112')
      : null;
    const firstLease = await acquireLiveJobLease(jobId, 'worker-a', {
      repositories, ttlSeconds: 90,
    });
    const duplicateLease = await acquireLiveJobLease(jobId, 'worker-b', {
      repositories, ttlSeconds: 90,
    });
    assert.ok(firstLease);
    assert.equal(duplicateLease, null);
    assert.ok((await listRecoverableLiveJobIds({ repositories })).includes(jobId));
    await releaseLiveJobLease(firstLease, { repositories });
    await settleLiveJob(jobId, { outputValidated: true }, { repositories });
    await handleLiveJobFailure(jobId, 'post_settlement_system_failure', { repositories });
    await handleLiveJobFailure(jobId, 'duplicate_delivery', { repositories });
    const projection = await balances.findBalanceAccount(user.id, { client: pool });
    assert.equal(projection.postedBalance, 6n);
    assert.equal(projection.reservedBalance, 0n);
    const entries = await ledger.listLedgerEntries(user.id, { client: pool });
    assert.equal(entries.filter(item => item.entryType === 'settlement').length, 1);
    assert.equal(entries.filter(item => item.entryType === 'refund').length, 1);

    const releasedJobId = '00000000-0000-4000-8000-000000000113';
    await reserveLiveJob({
      ...base, sourceDurationSeconds: 31, jobId: releasedJobId,
      idempotencyKey: 'live-release',
    }, { env, repositories });
    await releaseLiveJob(releasedJobId, 'pre_provider_failure', { repositories });
    await releaseLiveJob(releasedJobId, 'duplicate_delivery', { repositories });
    const releasedReservation = await reservations.findReservationByJobId(
      releasedJobId, { client: pool },
    );
    assert.equal(releasedReservation.status, 'released');
    const afterRelease = await balances.findBalanceAccount(user.id, { client: pool });
    assert.equal(afterRelease.postedBalance, 6n);
    assert.equal(afterRelease.reservedBalance, 0n);

    // Retrying a released job against the REAL validate_reservation_transition
    // trigger (0001_p2_foundation.sql) and credit_reservations_one_active_per_job_idx
    // (0005_retryable_reservations.sql) -- this is the exact production path
    // that used to raise "Reservation identity and amount are immutable".
    const retryIdempotencyKey = 'live-release-retry';
    const retryResult = await reserveLiveJob({
      ...base, sourceDurationSeconds: 31, jobId: releasedJobId,
      idempotencyKey: retryIdempotencyKey,
    }, { env, repositories });
    assert.equal(retryResult.replayed, false);
    const retriedReservation = await reservations.findReservationByJobId(
      releasedJobId, { client: pool },
    );
    assert.equal(retriedReservation.status, 'reserved');
    // A brand-new row -- the released row is immutable financial history,
    // never resurrected in place.
    assert.notEqual(retriedReservation.id, releasedReservation.id);
    const afterRetryReserve = await balances.findBalanceAccount(user.id, { client: pool });
    assert.equal(afterRetryReserve.reservedBalance, retriedReservation.amount);
    assert.equal(afterRetryReserve.postedBalance, 6n);

    // The client's own retry of the HTTP request (same Idempotency-Key)
    // must replay, never insert a second reservation for the job.
    const retryReplay = await reserveLiveJob({
      ...base, sourceDurationSeconds: 31, jobId: releasedJobId,
      idempotencyKey: retryIdempotencyKey,
    }, { env, repositories });
    assert.equal(retryReplay.replayed, true);
    const afterRetryReplay = await balances.findBalanceAccount(user.id, { client: pool });
    assert.equal(afterRetryReplay.reservedBalance, retriedReservation.amount);

    // Settling the retried reservation must never touch the original,
    // already-released row -- confirms real, permanent immutable history.
    await settleLiveJob(releasedJobId, { outputValidated: true }, { repositories });
    const originalRowAfterSettle = await pool.query(
      `SELECT status, amount, idempotency_key FROM credit_reservations WHERE id = $1`,
      [releasedReservation.id],
    );
    assert.equal(originalRowAfterSettle.rows[0].status, 'released');
    assert.equal(BigInt(originalRowAfterSettle.rows[0].amount), releasedReservation.amount);
    assert.equal(originalRowAfterSettle.rows[0].idempotency_key, releasedReservation.idempotencyKey);
    const afterSettle = await balances.findBalanceAccount(user.id, { client: pool });
    assert.equal(afterSettle.reservedBalance, 0n);
    assert.equal(afterSettle.postedBalance, 6n - retriedReservation.amount);

    // A settled reservation must never be reopened by a stray retry --
    // enforced by the app (RESERVATION_ALREADY_FINALIZED) since the DB
    // partial unique index only blocks a second row while one is ACTIVE,
    // and a settled row still counts as active by that index.
    await assert.rejects(
      reserveLiveJob({
        ...base, sourceDurationSeconds: 31, jobId: releasedJobId,
        idempotencyKey: 'live-release-retry-2',
      }, { env, repositories }),
      error => error.code === 'RESERVATION_ALREADY_FINALIZED',
    );
    const afterRejectedRetry = await balances.findBalanceAccount(user.id, { client: pool });
    assert.equal(afterRejectedRetry.reservedBalance, 0n);
    assert.equal(afterRejectedRetry.postedBalance, 6n - retriedReservation.amount);
  } finally {
    await pool.end();
    const cleanup = new pg.Client({ connectionString: url });
    await cleanup.connect();
    await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await cleanup.end();
  }
});
