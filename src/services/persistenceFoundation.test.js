import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapSuperAdmin } from './persistenceFoundation.js';

const transaction = callback => callback({ query: async () => ({ rows: [] }) });

test('bootstrap requires a pre-resolved Firebase UID and makes no external lookup', async () => {
  await assert.rejects(
    bootstrapSuperAdmin({ resolvedFirebaseIdentity: { email: 'configured@example.test' } }, {
      transaction,
    }),
    /Firebase UID before bootstrap/,
  );
});

test('completed bootstrap is idempotent and performs no mutation', async () => {
  let mutationCount = 0;
  const result = await bootstrapSuperAdmin({
    resolvedFirebaseIdentity: { uid: 'firebase-uid' },
  }, {
    transaction,
    repositories: {
      bootstrap: {
        findBootstrapState: async () => ({
          status: 'completed',
          bootstrap_user_id: 'user-id',
        }),
        completeBootstrapState: async () => { mutationCount += 1; },
      },
      roles: {
        findRoleByUserId: async () => ({
          userId: 'user-id',
          role: 'super_admin',
          protectedBootstrap: true,
        }),
        assignRole: async () => { mutationCount += 1; },
      },
      users: { ensureUser: async () => { mutationCount += 1; } },
      audit: { insertAuditLog: async () => { mutationCount += 1; } },
    },
  });
  assert.equal(result.alreadyCompleted, true);
  assert.equal(result.role.protectedBootstrap, true);
  assert.equal(mutationCount, 0);
});

test('new bootstrap assigns protected super_admin and records audit in one transaction', async () => {
  const observations = {};
  const result = await bootstrapSuperAdmin({
    bootstrapName: 'initial',
    resolvedFirebaseIdentity: { uid: 'firebase-uid', email: 'configured@example.test' },
  }, {
    transaction,
    repositories: {
      bootstrap: {
        findBootstrapState: async () => null,
        completeBootstrapState: async value => { observations.state = value; },
      },
      roles: {
        assignRole: async value => {
          observations.assignment = value;
          return value;
        },
      },
      users: {
        ensureUser: async identity => {
          observations.identity = identity;
          return { id: 'user-id' };
        },
      },
      audit: {
        insertAuditLog: async event => {
          observations.audit = event;
          return { id: 'audit-id' };
        },
      },
    },
  });
  assert.equal(observations.assignment.role, 'super_admin');
  assert.equal(observations.assignment.protectedBootstrap, true);
  assert.equal(observations.audit.eventType, 'role.bootstrap.super_admin');
  assert.deepEqual(observations.state, {
    bootstrapName: 'initial',
    userId: 'user-id',
    auditLogId: 'audit-id',
  });
  assert.equal(result.alreadyCompleted, false);
});
