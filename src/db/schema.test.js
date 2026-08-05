import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { migrationsDirectory } from './migrations.js';

const schema = fs.readFileSync(`${migrationsDirectory}/0001_p2_foundation.sql`, 'utf8');
const packageMigration = fs.readFileSync(
  `${migrationsDirectory}/0002_credit_package_management.sql`, 'utf8',
);
const trialLifecycleMigration = fs.readFileSync(
  `${migrationsDirectory}/0003_trial_lifecycle.sql`, 'utf8',
);

test('schema separates roles from commercial plans', () => {
  assert.match(schema, /role IN \('user', 'admin', 'super_admin'\)/);
  assert.match(schema, /code IN \('trial', 'normal', 'pro'\)/);
});

test('purchase and reservation states match approved P2.1 constraints', () => {
  const purchaseTable = schema.match(
    /CREATE TABLE credit_purchase_requests \([\s\S]+?\n\);/,
  )[0];
  assert.match(purchaseTable, /status IN \('pending', 'approved', 'rejected'\)/);
  assert.doesNotMatch(purchaseTable, /'cancelled'/);
  assert.match(schema, /status IN \('reserved', 'settled', 'released', 'refunded', 'review_required'\)/);
});

test('ledger and audit records have append-only database triggers', () => {
  assert.match(schema, /CREATE TRIGGER credit_ledger_append_only/);
  assert.match(schema, /CREATE TRIGGER audit_logs_append_only/);
  assert.match(schema, /Refund requires an existing settlement debit/);
});

test('bootstrap Super Admin and retained financial history have database protections', () => {
  assert.match(schema, /CREATE TRIGGER user_roles_protect_bootstrap/);
  assert.match(schema, /CREATE TRIGGER credit_purchase_requests_no_delete/);
  assert.match(schema, /CREATE TRIGGER credit_reservations_no_delete/);
});

test('trial lifecycle migration adds a request/approve flow and expiry without narrowing existing constraints', () => {
  assert.match(trialLifecycleMigration, /CREATE TABLE trial_requests/);
  assert.match(trialLifecycleMigration, /status TEXT NOT NULL CHECK \(status IN \('pending', 'approved'\)\)/);
  assert.match(trialLifecycleMigration, /ALTER COLUMN assessment_id DROP NOT NULL/);
  assert.match(trialLifecycleMigration, /ADD COLUMN expires_at TIMESTAMPTZ/);
  assert.match(trialLifecycleMigration, /ADD COLUMN expired_at TIMESTAMPTZ/);
  assert.match(trialLifecycleMigration, /CREATE TRIGGER trial_requests_no_delete/);
  // Additive-only: no existing table's CHECK constraints are dropped/redefined.
  assert.doesNotMatch(trialLifecycleMigration, /DROP CONSTRAINT/);
});

test('credit packages retain historical references and support bonus, note, and archival', () => {
  assert.match(packageMigration, /ADD COLUMN bonus_credits BIGINT NOT NULL DEFAULT 0/);
  assert.match(packageMigration, /ADD COLUMN note TEXT/);
  assert.match(packageMigration, /CREATE TRIGGER credit_plans_no_delete/);
  assert.match(schema, /credit_plan_id UUID NOT NULL REFERENCES credit_plans\(id\)/);
  assert.match(schema, /plan_name_snapshot/);
  assert.match(schema, /purchase_credit_snapshot/);
  assert.match(schema, /price_minor_snapshot/);
});
