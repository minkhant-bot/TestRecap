import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureUser, findUserByFirebaseUid } from './users.js';
import { assignRole } from './roles.js';
import { insertLedgerEntry } from './ledger.js';
import { listCreditPlans } from './billing.js';
import { insertAuditLog } from './auditLogs.js';

test('user lookup uses a parameterized query and stable mapping', async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{
        id: 'user-id',
        firebase_uid: 'firebase-id',
        email: 'redacted@example.test',
        display_name: 'Name',
        photo_url: '',
        status: 'active',
        created_at: new Date(0),
        updated_at: new Date(0),
        last_login_at: null,
      }] };
    },
  };
  const user = await findUserByFirebaseUid('firebase-id', { client });
  assert.deepEqual(calls[0].values, ['firebase-id']);
  assert.match(calls[0].sql, /firebase_uid = \$1/);
  assert.equal(user.firebaseUid, 'firebase-id');
});

test('financial and role mutations require transaction clients', async () => {
  await assert.rejects(
    assignRole({ userId: 'id', role: 'user', source: 'manual' }, {}),
    /transaction client/,
  );
  await assert.rejects(
    insertLedgerEntry({
      userId: 'id',
      amount: 1n,
      entryType: 'manual_grant',
      correlationKey: 'key',
    }, {}),
    /transaction client/,
  );
});

test('protected role SQL cannot demote a bootstrap Super Admin', async () => {
  const client = {
    async query(sql) {
      assert.match(sql, /WHERE NOT user_roles\.protected_bootstrap/);
      return { rows: [] };
    },
  };
  await assert.rejects(
    assignRole({
      userId: 'id',
      role: 'admin',
      source: 'manual',
    }, { client }),
    /cannot be changed/,
  );
});

test('identity synchronization never silently reactivates a disabled PostgreSQL user', async () => {
  const client = {
    async query(sql) {
      assert.match(sql, /WHEN users\.status = 'disabled' THEN users\.status/);
      return { rows: [{
        id: 'user-id',
        firebase_uid: 'firebase-id',
        email: null,
        display_name: '',
        photo_url: '',
        status: 'disabled',
        created_at: new Date(0),
        updated_at: new Date(0),
        last_login_at: null,
      }] };
    },
  };
  const user = await ensureUser({ firebaseUid: 'firebase-id' }, { client });
  assert.equal(user.status, 'disabled');
});

test('normal package reads query only active non-archived packages in display order', async () => {
  const client = {
    async query(sql, values) {
      assert.match(sql, /active=true AND archived_at IS NULL/);
      assert.match(sql, /ORDER BY display_order,code/);
      assert.deepEqual(values, [null, false]);
      return { rows: [] };
    },
  };
  assert.deepEqual(await listCreditPlans({ client }), []);
});

test('audit JSON parameters serialize objects and arrays explicitly for PostgreSQL jsonb', async () => {
  const client = {
    async query(_sql, values) {
      assert.equal(values[8], JSON.stringify([{ id: 'before' }]));
      assert.equal(values[9], JSON.stringify({ id: 'after' }));
      assert.equal(values[10], JSON.stringify({ source: 'test' }));
      return { rows: [{
        id: values[0], occurred_at: new Date(0), actor_service: 'test',
        event_type: 'package.reordered', resource_type: 'credit_plan',
        before_state: [{ id: 'before' }], after_state: { id: 'after' },
        metadata: { source: 'test' },
      }] };
    },
  };
  const event = await insertAuditLog({
    actorService: 'test', eventType: 'package.reordered', resourceType: 'credit_plan',
    beforeState: [{ id: 'before' }], afterState: { id: 'after' }, metadata: { source: 'test' },
  }, { client, id: 'audit-id' });
  assert.deepEqual(event.beforeState, [{ id: 'before' }]);
});
