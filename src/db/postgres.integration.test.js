import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import pg from 'pg';
import { migrationsDirectory } from './migrations.js';

const testUrl = process.env.TEST_DATABASE_URL;
const integration = testUrl ? test : test.skip;

integration('P2.1 schema constraints and append-only protections execute in PostgreSQL', async () => {
  const client = new pg.Client({ connectionString: testUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA blink_p2_integration');
    await client.query('SET LOCAL search_path TO blink_p2_integration');
    const sql = fs.readFileSync(`${migrationsDirectory}/0001_p2_foundation.sql`, 'utf8');
    await client.query(sql);

    const userId = '00000000-0000-4000-8000-000000000001';
    const ledgerId = '00000000-0000-4000-8000-000000000002';
    let savepointSequence = 0;
    const expectConstraintFailure = async (operation, pattern) => {
      const savepoint = `expected_failure_${++savepointSequence}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      await assert.rejects(operation(), pattern);
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    };
    await client.query(
      `INSERT INTO users
       (id, firebase_uid, status, created_at, updated_at)
       VALUES ($1, 'integration-user', 'active', now(), now())`,
      [userId],
    );
    await expectConstraintFailure(
      () => client.query(
        `INSERT INTO user_roles (user_id, role, source)
         VALUES ($1, 'trial', 'migration')`,
        [userId],
      ),
      /user_roles_role_check/,
    );

    const bootstrapUserId = '00000000-0000-4000-8000-000000000003';
    await client.query(
      `INSERT INTO users
       (id, firebase_uid, status, created_at, updated_at)
       VALUES ($1, 'bootstrap-user', 'active', now(), now())`,
      [bootstrapUserId],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role, source, protected_bootstrap)
       VALUES ($1, 'super_admin', 'bootstrap', true)`,
      [bootstrapUserId],
    );
    await expectConstraintFailure(
      () => client.query(
        `UPDATE user_roles SET role = 'admin', protected_bootstrap = false
         WHERE user_id = $1`,
        [bootstrapUserId],
      ),
      /approved recovery procedure/,
    );
    await expectConstraintFailure(
      () => client.query('DELETE FROM user_roles WHERE user_id = $1', [bootstrapUserId]),
      /approved recovery procedure/,
    );

    const planId = '00000000-0000-4000-8000-000000000010';
    await client.query(
      `INSERT INTO plans (id, code, name) VALUES ($1, 'normal', 'Normal')`,
      [planId],
    );
    await expectConstraintFailure(
      () => client.query(
        `INSERT INTO plans (id, code, name)
         VALUES ('00000000-0000-4000-8000-000000000011', 'enterprise', 'Enterprise')`,
      ),
      /plans_code_check/,
    );

    const creditPlanId = '00000000-0000-4000-8000-000000000020';
    const bankId = '00000000-0000-4000-8000-000000000021';
    const fileId = '00000000-0000-4000-8000-000000000022';
    await client.query(
      `INSERT INTO credit_plans
       (id, code, name, credit_amount, price_minor, currency,
        created_by_user_id, updated_by_user_id)
       VALUES ($1, 'test-credits', 'Test credits', 10, 100, 'USD', $2, $2)`,
      [creditPlanId, bootstrapUserId],
    );
    await client.query(
      `INSERT INTO bank_accounts
       (id, code, bank_name, account_name, account_number, currency,
        created_by_user_id, updated_by_user_id)
       VALUES ($1, 'test-bank', 'Test Bank', 'Test', '0000', 'USD', $2, $2)`,
      [bankId, bootstrapUserId],
    );
    await client.query(
      `INSERT INTO uploaded_files
       (id, owner_user_id, purpose, storage_provider, bucket, object_key,
        original_filename, mime_type, size_bytes, sha256, status, uploaded_at)
       VALUES ($1, $2, 'payment_screenshot', 'test', 'test', 'object',
        'payment.png', 'image/png', 1, repeat('a', 64), 'verified', now())`,
      [fileId, userId],
    );
    await expectConstraintFailure(
      () => client.query(
        `INSERT INTO credit_purchase_requests
         (id, user_id, status, credit_plan_id, bank_account_id, screenshot_file_id,
          plan_code_snapshot, plan_name_snapshot, purchase_credit_snapshot,
          price_minor_snapshot, currency_snapshot, bank_snapshot,
          submitted_at, created_at, updated_at)
         VALUES ('00000000-0000-4000-8000-000000000023', $1, 'cancelled',
          $2, $3, $4, 'test-credits', 'Test credits', 10, 100, 'USD',
          '{}'::jsonb, now(), now(), now())`,
        [userId, creditPlanId, bankId, fileId],
      ),
      /credit_purchase_requests_(status_check|check)/,
    );

    const jobId = '00000000-0000-4000-8000-000000000030';
    await client.query(
      `INSERT INTO jobs (id, user_id, status, stage, idempotency_key)
       VALUES ($1, $2, 'pending', 'pending', 'job-one')`,
      [jobId, userId],
    );
    await expectConstraintFailure(
      () => client.query(
        `INSERT INTO credit_reservations
         (id, user_id, job_id, amount, status, idempotency_key)
         VALUES ('00000000-0000-4000-8000-000000000031', $1, $2, 1,
                 'cancelled', 'invalid-reservation')`,
        [userId, jobId],
      ),
      /credit_reservations_(status_check|check)/,
    );

    await client.query(
      `INSERT INTO credit_ledger
       (id, user_id, amount, entry_type, correlation_key)
       VALUES ($1, $2, 1, 'migration', 'integration-ledger')`,
      [ledgerId, userId],
    );
    await expectConstraintFailure(
      () => client.query('UPDATE credit_ledger SET amount = 2 WHERE id = $1', [ledgerId]),
      /append-only/,
    );
    await expectConstraintFailure(
      () => client.query('DELETE FROM credit_ledger WHERE id = $1', [ledgerId]),
      /append-only/,
    );

    const auditId = '00000000-0000-4000-8000-000000000040';
    await client.query(
      `INSERT INTO audit_logs
       (id, actor_user_id, event_type, resource_type, resource_id)
       VALUES ($1, $2, 'integration.test', 'user', $2)`,
      [auditId, bootstrapUserId],
    );
    await expectConstraintFailure(
      () => client.query(
        `UPDATE audit_logs SET event_type = 'changed' WHERE id = $1`,
        [auditId],
      ),
      /append-only/,
    );
    await expectConstraintFailure(
      () => client.query('DELETE FROM audit_logs WHERE id = $1', [auditId]),
      /append-only/,
    );

    const billingJobId = '00000000-0000-4000-8000-000000000050';
    const reservationId = '00000000-0000-4000-8000-000000000051';
    await client.query(
      `INSERT INTO jobs (id, user_id, status, stage, idempotency_key)
       VALUES ($1, $2, 'pending', 'pending', 'billing-job')`,
      [billingJobId, userId],
    );
    await client.query(
      `INSERT INTO credit_reservations
       (id, user_id, job_id, amount, status, idempotency_key)
       VALUES ($1, $2, $3, 5, 'reserved', 'reservation-one')`,
      [reservationId, userId, billingJobId],
    );
    await expectConstraintFailure(
      async () => {
        await client.query(
          `UPDATE credit_reservations SET status = 'settled', settled_at = now()
           WHERE id = $1`,
          [reservationId],
        );
        return client.query('SET CONSTRAINTS ALL IMMEDIATE');
      },
      /settlement ledger debit/,
    );
    const settlementId = '00000000-0000-4000-8000-000000000052';
    await client.query(
      `INSERT INTO credit_ledger
       (id, user_id, amount, entry_type, reservation_id, job_id, correlation_key)
       VALUES ($1, $2, -5, 'settlement', $3, $4, 'settlement-one')`,
      [settlementId, userId, reservationId, billingJobId],
    );
    await client.query(
      `UPDATE credit_reservations SET status = 'settled', settled_at = now()
       WHERE id = $1`,
      [reservationId],
    );
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await expectConstraintFailure(
      async () => {
        await client.query(
          `UPDATE credit_reservations
           SET status = 'released', released_at = now(), settled_at = NULL
           WHERE id = $1`,
          [reservationId],
        );
        return client.query('SET CONSTRAINTS ALL IMMEDIATE');
      },
      /Invalid reservation transition|cannot be released/,
    );
    await expectConstraintFailure(
      () => client.query(
        `INSERT INTO credit_ledger
         (id, user_id, amount, entry_type, reservation_id, job_id,
          reversal_of_entry_id, correlation_key)
         VALUES ('00000000-0000-4000-8000-000000000053', $1, 1, 'refund',
                 $2, $3, $4, 'invalid-refund')`,
        [userId, reservationId, billingJobId, ledgerId],
      ),
      /fully offset|existing settlement debit/,
    );
    await client.query(
      `INSERT INTO credit_ledger
       (id, user_id, amount, entry_type, reservation_id, job_id,
        reversal_of_entry_id, correlation_key)
       VALUES ('00000000-0000-4000-8000-000000000054', $1, 5, 'refund',
               $2, $3, $4, 'refund-one')`,
      [userId, reservationId, billingJobId, settlementId],
    );
    await client.query(
      `UPDATE credit_reservations
       SET status = 'refunded', refunded_at = now()
       WHERE id = $1`,
      [reservationId],
    );
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  } finally {
    try { await client.query('ROLLBACK'); } finally { await client.end(); }
  }
});
