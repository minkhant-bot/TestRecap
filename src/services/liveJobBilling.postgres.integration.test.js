import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import pg from 'pg';
import { migrationsDirectory } from '../db/migrations.js';
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
  releaseLiveJobLease,
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
  await setup.query(fs.readFileSync(`${migrationsDirectory}/0001_p2_foundation.sql`, 'utf8'));
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
  const repositories = {
    transaction, audit, balances, jobs, ledger,
    assignments, plans, reservations, users, leases,
  };
  const identity = { uid: 'live-user', email: 'live@example.test' };
  try {
    const user = await users.ensureUser({
      firebaseUid: identity.uid, email: identity.email,
    }, { client: pool });
    const planId = '00000000-0000-4000-8000-000000000101';
    const policyId = '00000000-0000-4000-8000-000000000102';
    await pool.query(
      `INSERT INTO plans(id,code,name,active) VALUES($1,'normal','Normal',true);
       INSERT INTO plan_policy_versions
        (id,plan_id,version,billing_block_seconds,credits_per_block,
         trial_allowance_credits,billing_mode,effective_from,active)
       VALUES($2,$1,1,30,2,0,'byok','2026-01-01',true);
       INSERT INTO plan_entitlements(policy_version_id,entitlement_key,enabled)
       VALUES($2,'blur',false),($2,'flip',false),($2,'byok_mode',true);
       INSERT INTO user_plan_assignments(user_id,plan_id,status,source)
       VALUES($3,$1,'active','user_selection');
       INSERT INTO credit_balance_accounts(user_id,posted_balance,reserved_balance)
       VALUES($3,6,0)`,
      [planId, policyId, user.id],
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
  } finally {
    await pool.end();
    const cleanup = new pg.Client({ connectionString: url });
    await cleanup.connect();
    await cleanup.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await cleanup.end();
  }
});
