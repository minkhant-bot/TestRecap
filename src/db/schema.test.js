import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { migrationsDirectory } from './migrations.js';

const schema = fs.readFileSync(`${migrationsDirectory}/0001_p2_foundation.sql`, 'utf8');

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
