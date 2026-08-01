import assert from 'node:assert/strict';
import test from 'node:test';
import {
  archiveCreditPackage,
  createCreditPackage,
  editCreditPackage,
  listActiveCreditPackages,
  listCreditPackageAudit,
  listManagedCreditPackages,
  reorderCreditPackages,
  setCreditPackageActive,
} from './api.ts';

const withFetch = async (handler, work) => {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { await work(); } finally { globalThis.fetch = original; }
};

test('normal and Super Admin package reads use their permission-scoped APIs', async () => {
  const calls = [];
  await withFetch(async (url, options = {}) => {
    calls.push([url, options]);
    if (url === '/api/credit-packages') return Response.json([{ id: 'active' }]);
    if (url === '/api/admin/billing/catalog') return Response.json({ creditPlans: [{ id: 'all' }] });
    return Response.json([{ id: 'audit' }]);
  }, async () => {
    assert.equal((await listActiveCreditPackages())[0].id, 'active');
    assert.equal((await listManagedCreditPackages())[0].id, 'all');
    assert.equal((await listCreditPackageAudit())[0].id, 'audit');
  });
  assert.deepEqual(calls.map(call => call[0]), [
    '/api/credit-packages',
    '/api/admin/billing/catalog',
    '/api/admin/billing/audit?resourceType=credit_plan',
  ]);
  assert.ok(calls.every(([, options]) => options.credentials === 'include'));
});

test('all package mutations bind the backend contract with confirmation and idempotency', async () => {
  const calls = [];
  await withFetch(async (url, options) => {
    calls.push([url, options]);
    return Response.json({ creditPackage: { id: 'package-id' } });
  }, async () => {
    const input = {
      name: 'Starter', price: 10000, currency: 'MMK', creditAmount: 100,
      bonusCredits: 10, active: true, displayOrder: 1, note: null,
    };
    await createCreditPackage(input);
    await editCreditPackage('package/id', input);
    await setCreditPackageActive('package/id', true);
    await setCreditPackageActive('package/id', false);
    await archiveCreditPackage('package/id');
    await reorderCreditPackages([{ id: 'package/id', displayOrder: 2 }]);
  });

  assert.deepEqual(calls.map(([url]) => url), [
    '/api/admin/billing/credit-packages',
    '/api/admin/billing/credit-packages/package%2Fid',
    '/api/admin/billing/credit-packages/package%2Fid/activate',
    '/api/admin/billing/credit-packages/package%2Fid/deactivate',
    '/api/admin/billing/credit-packages/package%2Fid/archive',
    '/api/admin/billing/credit-packages/reorder',
  ]);
  for (const [, options] of calls) {
    assert.equal(options.credentials, 'include');
    assert.ok(options.headers['Idempotency-Key']);
    assert.equal(JSON.parse(options.body).confirmed, true);
  }
  assert.equal(calls[1][1].method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[5][1].body).items, [{ id: 'package/id', displayOrder: 2 }]);
});

test('API errors preserve the backend billing-gate code for accurate unavailable UI', async () => {
  await withFetch(async () => Response.json({
    error: 'P2 billing is disabled.', code: 'BILLING_NOT_ENABLED',
  }, { status: 503 }), async () => {
    await assert.rejects(listActiveCreditPackages(), error =>
      error.message === 'P2 billing is disabled.' && error.code === 'BILLING_NOT_ENABLED');
  });
});
