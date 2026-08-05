import assert from 'node:assert/strict';
import test from 'node:test';
import {
  archiveCreditPackage,
  createCreditPackage,
  editCreditPackage,
  reorderCreditPackages,
  setCreditPackageStatus,
} from './billingFoundation.js';

const enabledEnv = {
  P2_BILLING_ENABLED: 'true',
  DATABASE_URL: 'postgresql://db.example/blink',
};

const fixture = ({ role = 'super_admin' } = {}) => {
  const packages = new Map();
  const audits = [];
  let sequence = 0;
  const deps = {
    transaction: work => work({}),
    users: { ensureUser: async () => ({ id: 'actor-id', status: 'active' }) },
    roles: { findRoleByUserId: async () => ({ role }) },
    idempotency: {
      claimIdempotencyKey: async record => ({
        request_hash: record.requestHash, state: 'in_progress',
      }),
      completeIdempotencyKey: async () => ({}),
    },
    audit: { insertAuditLog: async event => { audits.push(event); return event; } },
    billing: {
      insertCreditPackage: async item => {
        const value = {
          ...item, id: `package-${++sequence}`, archivedAt: null,
          createdAt: new Date(0), updatedAt: new Date(0),
        };
        packages.set(value.id, value);
        return value;
      },
      findCreditPackageById: async id => packages.get(id) || null,
      updateCreditPackage: async (id, item) => {
        const value = { ...packages.get(id), ...item };
        packages.set(id, value);
        return value;
      },
      setCreditPackageActive: async (id, active) => {
        const value = { ...packages.get(id), active };
        packages.set(id, value);
        return value;
      },
      archiveCreditPackage: async id => {
        const value = { ...packages.get(id), active: false, archivedAt: new Date() };
        packages.set(id, value);
        return value;
      },
      reorderCreditPackage: async (id, order) => {
        const value = { ...packages.get(id), displayOrder: order };
        packages.set(id, value);
        return value;
      },
    },
  };
  return { deps, packages, audits };
};

const identity = { uid: 'firebase-owner', role: 'super_admin' };
const options = (deps, key) => ({ env: enabledEnv, deps, idempotencyKey: key });

test('Super Admin can create, edit, activate, deactivate, archive, and reorder packages with audit', async () => {
  const { deps, packages, audits } = fixture();
  const created = await createCreditPackage(identity, {
    name: 'Starter', price: 10000, creditAmount: 100, bonusCredits: 10,
    active: true, displayOrder: 1, note: 'Launch package', currency: 'MMK', confirmed: true,
  }, options(deps, 'create'));
  const id = created.body.creditPackage.id;
  assert.equal(created.status, 201);
  assert.equal(created.body.creditPackage.price, '10000');
  assert.equal(created.body.creditPackage.currency, 'MMK');

  await editCreditPackage(identity, id, {
    name: 'Starter Plus', price: 12000, creditAmount: 120, bonusCredits: 20,
    note: null, confirmed: true,
  }, options(deps, 'edit'));
  assert.equal(packages.get(id).name, 'Starter Plus');
  assert.equal(packages.get(id).bonusCredits, 20n);

  await setCreditPackageStatus(identity, id, false, { confirmed: true }, options(deps, 'off'));
  assert.equal(packages.get(id).active, false);
  await setCreditPackageStatus(identity, id, true, { confirmed: true }, options(deps, 'on'));
  assert.equal(packages.get(id).active, true);

  const second = await createCreditPackage(identity, {
    name: 'Value', price: 20000, creditAmount: 250, bonusCredits: 25,
    active: true, displayOrder: 2, currency: 'MMK', confirmed: true,
  }, options(deps, 'create-second'));
  const secondId = second.body.creditPackage.id;
  await reorderCreditPackages(identity, {
    confirmed: true,
    items: [{ id, displayOrder: 2 }, { id: secondId, displayOrder: 1 }],
  }, options(deps, 'reorder'));
  assert.equal(packages.get(id).displayOrder, 2);
  assert.equal(packages.get(secondId).displayOrder, 1);

  await archiveCreditPackage(identity, id, { confirmed: true }, options(deps, 'archive'));
  assert.equal(packages.get(id).active, false);
  assert.ok(packages.get(id).archivedAt);
  assert.deepEqual(audits.map(event => event.eventType), [
    'credit_package.created', 'credit_package.updated', 'credit_package.deactivated',
    'credit_package.activated', 'credit_package.created', 'credit_package.reordered',
    'credit_package.archived',
  ]);
  assert.ok(audits.every(event => event.resourceType === 'credit_plan'));
});

test('package changes require explicit confirmation and PostgreSQL Super Admin role', async () => {
  const { deps } = fixture();
  await assert.rejects(
    createCreditPackage(identity, {
      name: 'Unconfirmed', price: 1, creditAmount: 1, bonusCredits: 0,
      active: false, displayOrder: 0, currency: 'MMK',
    }, options(deps, 'missing-confirmation')),
    error => error.code === 'CONFIRMATION_REQUIRED',
  );
  const adminFixture = fixture({ role: 'admin' });
  const adminIdentity = { uid: 'firebase-admin', role: 'admin' };
  await assert.rejects(
    createCreditPackage(adminIdentity, {
      name: 'Forbidden', price: 1, creditAmount: 1, bonusCredits: 0,
      active: false, displayOrder: 0, currency: 'MMK', confirmed: true,
    }, options(adminFixture.deps, 'admin-create')),
    error => error.code === 'SUPER_ADMIN_REQUIRED',
  );
});

test('archive is non-destructive and terminal for later package mutation', async () => {
  const { deps, packages } = fixture();
  const created = await createCreditPackage(identity, {
    name: 'Historical', price: 5000, creditAmount: 50, bonusCredits: 0,
    active: true, displayOrder: 1, currency: 'MMK', confirmed: true,
  }, options(deps, 'historical-create'));
  const id = created.body.creditPackage.id;
  await archiveCreditPackage(identity, id, { confirmed: true }, options(deps, 'historical-archive'));
  const retained = packages.get(id);
  await assert.rejects(
    editCreditPackage(identity, id, { name: 'Rewrite', confirmed: true }, options(deps, 'rewrite')),
    error => error.code === 'PACKAGE_ARCHIVED',
  );
  assert.equal(packages.get(id), retained);
});
