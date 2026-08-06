import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureUser, findUserByFirebaseUid } from './users.js';
import { assignRole } from './roles.js';
import { insertLedgerEntry } from './ledger.js';
import { insertPlanPolicy, listCreditPlans } from './billing.js';
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

// Reproduces the exact production payload shape configurePlanDefaults sends
// for Trial and Pro (see PLAN_POLICY_DEFAULTS in billingFoundation.js):
// entitlement objects that OMIT integerLimit/textValue entirely, rather than
// setting them to null. Before the fix, String(undefined) === 'undefined'
// was sent to plan_entitlements.integer_limit (BIGINT), producing Postgres
// 22P02 "invalid input syntax for type bigint: \"undefined\"" and surfacing
// as the generic "Billing administration failed." on PUT
// /api/admin/billing/plans/trial|pro/defaults.
const capturingClient = () => {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      if (/INSERT INTO plan_policy_versions/.test(sql)) {
        return { rows: [{
          id: 'policy-id', plan_id: values[1], version: values[2],
          billing_block_seconds: 30, credits_per_block: values[3],
          trial_allowance_credits: values[4], billing_mode: values[5],
          effective_from: values[6], effective_until: values[7], active: values[8],
        }] };
      }
      return { rows: [] };
    },
  };
};
const assertNoUndefinedStringPersisted = calls => {
  for (const call of calls) {
    for (const value of call.values) {
      assert.notEqual(value, 'undefined', `bind param must never be the literal string "undefined": ${call.sql}`);
    }
  }
};

test('Trial\'s configurePlanDefaults entitlement payload (integerLimit/textValue omitted) never persists the string "undefined" to a bigint column', async () => {
  const client = capturingClient();
  await insertPlanPolicy({
    planCode: 'trial', planId: 'plan-trial-id', version: 1,
    creditsPerBlock: 1n, trialAllowanceCredits: 12n, billingMode: 'blink_funded',
    active: true, effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveUntil: null,
    actorUserId: 'actor-id',
    entitlements: [
      { key: 'blur', enabled: true },
      { key: 'flip', enabled: true },
      { key: 'byok_mode', enabled: false },
      { key: 'blink_funded_mode', enabled: true },
    ],
  }, { client });
  assertNoUndefinedStringPersisted(client.calls);
  const entitlementInserts = client.calls.filter(call => /INSERT INTO plan_entitlements/.test(call.sql));
  assert.equal(entitlementInserts.length, 4);
  for (const call of entitlementInserts) {
    assert.equal(call.values[4], null, 'integer_limit must be null, not the string "undefined"');
    assert.equal(call.values[5], null, 'text_value must be null, not undefined');
  }
});

test('Pro\'s configurePlanDefaults entitlement payload (integerLimit/textValue omitted) never persists the string "undefined" to a bigint column', async () => {
  const client = capturingClient();
  await insertPlanPolicy({
    planCode: 'pro', planId: 'plan-pro-id', version: 1,
    creditsPerBlock: 1n, trialAllowanceCredits: 0n, billingMode: 'blink_funded',
    active: true, effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveUntil: null,
    actorUserId: 'actor-id',
    entitlements: [
      { key: 'blur', enabled: true },
      { key: 'flip', enabled: true },
      { key: 'byok_mode', enabled: false },
      { key: 'blink_funded_mode', enabled: true },
    ],
  }, { client });
  assertNoUndefinedStringPersisted(client.calls);
  const entitlementInserts = client.calls.filter(call => /INSERT INTO plan_entitlements/.test(call.sql));
  assert.equal(entitlementInserts.length, 4);
  for (const call of entitlementInserts) {
    assert.equal(call.values[4], null, 'integer_limit must be null, not the string "undefined"');
    assert.equal(call.values[5], null, 'text_value must be null, not undefined');
  }
});

test('an entitlement with an explicit numeric integerLimit is still normalized to a proper bigint string, not blocked by the undefined-guard', async () => {
  const client = capturingClient();
  await insertPlanPolicy({
    planCode: 'pro', planId: 'plan-pro-id', version: 2,
    creditsPerBlock: 1n, trialAllowanceCredits: 0n, billingMode: 'blink_funded',
    active: true, effectiveFrom: new Date('2026-01-01T00:00:00Z'), effectiveUntil: null,
    actorUserId: 'actor-id',
    entitlements: [{ key: 'active_job_limit', enabled: true, integerLimit: 5, textValue: null }],
  }, { client });
  const [entitlementInsert] = client.calls.filter(call => /INSERT INTO plan_entitlements/.test(call.sql));
  assert.equal(entitlementInsert.values[4], '5');
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
