import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequireAuth } from '../middleware/auth.js';
import { BillingError } from '../services/billingFoundation.js';
import { createPaymentProofStorage, PaymentProofStorageError } from '../services/paymentProofStorage.js';
import { createBillingRouter } from './billing.js';
import { createAdminBillingRouter } from './adminBilling.js';

const identity = { uid: 'firebase-user', role: 'user' };

const startServer = async ({ userService, adminService, proofStorage, proofConfiguration, authenticatedIdentity = identity }) => {
  const app = express();
  app.use(express.json());
  app.use(createRequireAuth({
    verifyIdentity: async ({ sessionCookie }) => sessionCookie === 'valid' ? authenticatedIdentity : null,
  }));
  app.use(createBillingRouter(userService, { proofStorage, proofConfiguration }));
  app.use('/admin/billing', createAdminBillingRouter(adminService, { proofStorage }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
};

const emptyUserService = {
  listPlans: async () => [], getMyPlan: async () => null, selectPlan: async () => ({}),
  getTrialEligibility: async () => ({}), grantTrial: async () => ({}),
  getBalance: async () => ({}), getLedger: async () => [], estimateCredits: async () => ({}),
  listCreditPackages: async () => [], listPackageBanks: async () => [],
  createScreenshotIntent: async () => ({}), completeScreenshotUpload: async () => ({}),
  submitPurchase: async () => ({}), listMyPurchases: async () => [],
  getMyPurchase: async () => ({}), getMyScreenshotMetadata: async () => ({}),
};
const emptyAdminService = {
  adminListPurchases: async () => [], reviewPurchase: async () => ({}),
  configurePlan: async () => ({}), createPlanPolicy: async () => ({}),
  configureCreditPlan: async () => ({}), configureBank: async () => ({}),
  linkPackageBank: async () => ({}), configurePromotion: async () => ({}),
  adjustCredits: async () => ({}), assessTrial: async () => ({}),
  verifyScreenshot: async () => ({}), adminListAudit: async () => [],
  adminListCatalog: async () => ({}), adminGetScreenshotMetadata: async () => ({}),
  adminGetUserCredits: async () => ({}), createCreditPackage: async () => ({}),
  editCreditPackage: async () => ({}), setCreditPackageStatus: async () => ({}),
  archiveCreditPackage: async () => ({}), reorderCreditPackages: async () => ({}),
};

test('billing routes require authentication and pass idempotency to financial mutations', async () => {
  const calls = [];
  const { server, baseUrl } = await startServer({
    userService: {
      ...emptyUserService,
      submitPurchase: async (actor, body, options) => {
        calls.push({ actor, body, options });
        return { status: 201, body: { purchase: { status: 'pending' } } };
      },
    },
    adminService: emptyAdminService,
  });
  try {
    assert.equal((await fetch(`${baseUrl}/plans`)).status, 401);
    const response = await fetch(`${baseUrl}/credit-purchase-requests`, {
      method: 'POST',
      headers: {
        Cookie: '__session=valid',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'purchase-one',
      },
      body: JSON.stringify({ creditPlanId: 'plan', bankAccountId: 'bank', screenshotFileId: 'file' }),
    });
    assert.equal(response.status, 201);
    assert.equal(calls[0].actor, identity);
    assert.equal(calls[0].options.idempotencyKey, 'purchase-one');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

const proofPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const proofId = '22222222-2222-4222-8222-222222222222';
const proofObjectKey = `payment-proofs/11111111-1111-4111-8111-111111111111/2026/08/${proofId}.png`;

test('multipart proof upload stores validated binary, associates purchase, and supports idempotent retry', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blink-proof-route-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const proofConfiguration = {
    maxMegabytes: 1, maxBytes: 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    extensions: ['jpg', 'png', 'webp'],
    storageProvider: 'data_dir_private', storageBucket: 'payment-proofs', storageRoot: root,
  };
  const proofStorage = createPaymentProofStorage({ configuration: proofConfiguration });
  const calls = [];
  let metadata;
  const userService = {
    ...emptyUserService,
    createScreenshotIntent: async (_actor, body, options) => {
      calls.push(['intent', options.idempotencyKey]);
      metadata = {
        id: proofId, objectKey: proofObjectKey, originalFilename: body.originalFilename,
        mimeType: body.mimeType, sizeBytes: body.sizeBytes, sha256: body.sha256,
        status: 'verified', uploadedAt: new Date().toISOString(), verifiedAt: new Date().toISOString(),
      };
      return { status: 201, body: { id: proofId, status: 'pending', objectKey: proofObjectKey } };
    },
    completeScreenshotUpload: async (_actor, _id, _body, options) => {
      calls.push(['complete', options.idempotencyKey]);
      return { status: 200, body: { file: { status: 'verified' } } };
    },
    submitPurchase: async (_actor, body, options) => {
      calls.push(['purchase', options.idempotencyKey, body]);
      return { status: 201, body: { purchase: { id: 'purchase-id', status: 'pending', screenshotFileId: body.screenshotFileId } } };
    },
    getMyScreenshotMetadata: async (_actor, id) => {
      if (id !== proofId) throw new BillingError('Payment proof not found.', { code: 'NOT_FOUND', status: 404 });
      return metadata;
    },
  };
  const { server, baseUrl } = await startServer({ userService, adminService: emptyAdminService, proofStorage, proofConfiguration });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const submit = () => {
    const form = new FormData();
    form.append('creditPlanId', 'plan-id');
    form.append('bankAccountId', 'bank-id');
    form.append('proof', new Blob([proofPng], { type: 'image/png' }), 'bank-transfer.png');
    return fetch(`${baseUrl}/credit-purchase-requests/with-proof`, {
      method: 'POST', headers: { Cookie: '__session=valid', 'Idempotency-Key': 'proof-workflow' }, body: form,
    });
  };
  assert.equal((await submit()).status, 201);
  assert.equal((await submit()).status, 201);
  assert.deepEqual(calls.slice(0, 3).map(item => item[1]), [
    'proof-workflow:intent', 'proof-workflow:complete', 'proof-workflow:purchase',
  ]);
  assert.equal(calls[2][2].screenshotFileId, proofId);
  const content = await fetch(`${baseUrl}/uploads/payment-screenshots/${proofId}/content`, {
    headers: { Cookie: '__session=valid' },
  });
  assert.equal(content.status, 200);
  assert.equal(content.headers.get('content-type'), 'image/png');
  assert.equal(content.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await content.arrayBuffer()), proofPng);
});

test('proof upload rejects missing, empty, oversized, malformed, and mismatched files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blink-proof-route-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const proofConfiguration = {
    maxMegabytes: 1, maxBytes: 100,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    extensions: ['jpg', 'png', 'webp'],
    storageProvider: 'data_dir_private', storageBucket: 'payment-proofs', storageRoot: root,
  };
  const proofStorage = createPaymentProofStorage({ configuration: proofConfiguration });
  const { server, baseUrl } = await startServer({ userService: emptyUserService, adminService: emptyAdminService, proofStorage, proofConfiguration });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const send = async (data, type, name = 'proof.png') => {
    const form = new FormData();
    form.append('creditPlanId', 'plan');
    form.append('bankAccountId', 'bank');
    if (data !== null) form.append('proof', new Blob([data], { type }), name);
    const response = await fetch(`${baseUrl}/credit-purchase-requests/with-proof`, {
      method: 'POST', headers: { Cookie: '__session=valid', 'Idempotency-Key': randomKey() }, body: form,
    });
    return { status: response.status, body: await response.json() };
  };
  const randomKey = () => `proof-${Math.random()}`;
  const expectFailure = async (data, type, status, code, name) => {
    const result = await send(data, type, name);
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
  };
  await expectFailure(null, 'image/png', 400, 'PROOF_EMPTY');
  await expectFailure(Buffer.alloc(0), 'image/png', 400, 'PROOF_EMPTY');
  await expectFailure(Buffer.alloc(101, 1), 'image/png', 413, 'PROOF_TOO_LARGE');
  await expectFailure(Buffer.from('not-an-image'), 'image/png', 415, 'PROOF_MALFORMED');
  await expectFailure(proofPng, 'image/jpeg', 415, 'PROOF_TYPE_MISMATCH');
  await expectFailure(Buffer.from('GIF89a-proof'), 'image/gif', 415, 'PROOF_TYPE_UNSUPPORTED', 'proof.gif');
});

test('normal users cannot read another user payment proof', async t => {
  let storageReads = 0;
  const { server, baseUrl } = await startServer({
    userService: {
      ...emptyUserService,
      getMyScreenshotMetadata: async () => {
        throw new BillingError('Payment proof not found.', { code: 'NOT_FOUND', status: 404 });
      },
    },
    adminService: emptyAdminService,
    proofStorage: { read: async () => { storageReads += 1; } },
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`${baseUrl}/uploads/payment-screenshots/${proofId}/content`, {
    headers: { Cookie: '__session=valid' },
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, 'NOT_FOUND');
  assert.equal(storageReads, 0);
});

test('private proof streaming reports a missing stored binary without deleting metadata', async t => {
  const { server, baseUrl } = await startServer({
    userService: {
      ...emptyUserService,
      getMyScreenshotMetadata: async () => ({ id: proofId, objectKey: proofObjectKey, status: 'verified' }),
    },
    adminService: emptyAdminService,
    proofStorage: {
      read: async () => { throw new PaymentProofStorageError('Payment proof file is missing.', { code: 'PROOF_FILE_MISSING', status: 410 }); },
    },
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`${baseUrl}/uploads/payment-screenshots/${proofId}/content`, {
    headers: { Cookie: '__session=valid' },
  });
  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, 'PROOF_FILE_MISSING');
});

test('admin proof preview authorizes through PostgreSQL Super Admin authority before storage access', async t => {
  let reads = 0;
  const denied = await startServer({
    userService: emptyUserService,
    adminService: {
      ...emptyAdminService,
      adminGetScreenshotMetadata: async () => {
        throw new BillingError('PostgreSQL Super Admin authority is required.', { code: 'SUPER_ADMIN_REQUIRED', status: 403 });
      },
    },
    proofStorage: { read: async () => { reads += 1; } },
  });
  t.after(() => new Promise(resolve => denied.server.close(resolve)));
  const deniedResponse = await fetch(`${denied.baseUrl}/admin/billing/screenshots/${proofId}/content`, {
    headers: { Cookie: '__session=valid' },
  });
  assert.equal(deniedResponse.status, 403);
  assert.equal((await deniedResponse.json()).code, 'SUPER_ADMIN_REQUIRED');
  assert.equal(reads, 0);

  const allowed = await startServer({
    userService: emptyUserService,
    adminService: {
      ...emptyAdminService,
      adminGetScreenshotMetadata: async () => ({ id: proofId, objectKey: proofObjectKey, status: 'verified' }),
    },
    proofStorage: {
      read: async () => ({ buffer: proofPng, mimeType: 'image/png', sizeBytes: proofPng.length, extension: 'png' }),
    },
    authenticatedIdentity: { uid: 'owner', role: 'super_admin' },
  });
  t.after(() => new Promise(resolve => allowed.server.close(resolve)));
  const allowedResponse = await fetch(`${allowed.baseUrl}/admin/billing/screenshots/${proofId}/content`, {
    headers: { Cookie: '__session=valid' },
  });
  assert.equal(allowedResponse.status, 200);
  assert.deepEqual(Buffer.from(await allowedResponse.arrayBuffer()), proofPng);
});

test('admin billing surface delegates PostgreSQL authority and preserves structured denial', async () => {
  const { server, baseUrl } = await startServer({
    userService: emptyUserService,
    adminService: {
      ...emptyAdminService,
      adjustCredits: async () => {
        throw new BillingError('PostgreSQL Super Admin authority is required.', {
          code: 'SUPER_ADMIN_REQUIRED', status: 403,
        });
      },
    },
  });
  try {
    const response = await fetch(`${baseUrl}/admin/billing/adjustments`, {
      method: 'POST',
      headers: {
        Cookie: '__session=valid',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'adjust-one',
      },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'SUPER_ADMIN_REQUIRED');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('purchase review API exposes only approved and rejected transitions', async () => {
  const decisions = [];
  const { server, baseUrl } = await startServer({
    userService: emptyUserService,
    adminService: {
      ...emptyAdminService,
      reviewPurchase: async (_actor, id, body) => {
        decisions.push({ id, body });
        return { status: 200, body: { purchase: { id, status: body.decision } } };
      },
    },
  });
  try {
    for (const decision of ['approve', 'reject']) {
      const response = await fetch(`${baseUrl}/admin/billing/purchases/purchase-id/${decision}`, {
        method: 'POST',
        headers: {
          Cookie: '__session=valid',
          'Content-Type': 'application/json',
          'Idempotency-Key': decision,
        },
        body: JSON.stringify({ reason: 'review reason' }),
      });
      assert.equal(response.status, 200);
    }
    assert.deepEqual(decisions.map(item => item.body.decision), ['approved', 'rejected']);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('credit-package administration routes delegate every supported action', async () => {
  const calls = [];
  const adminService = {
    ...emptyAdminService,
    createCreditPackage: async (...args) => { calls.push(['create', ...args]); return { status: 201, body: {} }; },
    editCreditPackage: async (...args) => { calls.push(['edit', ...args]); return {}; },
    setCreditPackageStatus: async (...args) => { calls.push(['status', ...args]); return {}; },
    archiveCreditPackage: async (...args) => { calls.push(['archive', ...args]); return {}; },
    reorderCreditPackages: async (...args) => { calls.push(['reorder', ...args]); return {}; },
  };
  const { server, baseUrl } = await startServer({ userService: emptyUserService, adminService });
  const send = (path, method, body, key) => fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Cookie: '__session=valid', 'Content-Type': 'application/json', 'Idempotency-Key': key,
    },
    body: JSON.stringify(body),
  });
  try {
    assert.equal((await send('/admin/billing/credit-packages', 'POST', {
      name: 'Starter', price: 1000, creditAmount: 100, bonusCredits: 10,
      active: true, displayOrder: 1, note: null, currency: 'MMK', confirmed: true,
    }, 'create-package')).status, 201);
    await send('/admin/billing/credit-packages/package-id', 'PATCH',
      { name: 'Starter Plus', confirmed: true }, 'edit-package');
    await send('/admin/billing/credit-packages/package-id/activate', 'POST',
      { confirmed: true }, 'activate-package');
    await send('/admin/billing/credit-packages/package-id/deactivate', 'POST',
      { confirmed: true }, 'deactivate-package');
    await send('/admin/billing/credit-packages/package-id/archive', 'POST',
      { confirmed: true }, 'archive-package');
    await send('/admin/billing/credit-packages/reorder', 'POST',
      { items: [{ id: 'package-id', displayOrder: 2 }], confirmed: true }, 'reorder-package');
    assert.deepEqual(calls.map(call => call[0]),
      ['create', 'edit', 'status', 'status', 'archive', 'reorder']);
    assert.equal(calls[0][2].confirmed, true);
    assert.equal(calls[0][3].idempotencyKey, 'create-package');
    assert.deepEqual(calls.slice(2, 4).map(call => call[3]), [true, false]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('normal-user package route delegates active-package listing', async () => {
  const calls = [];
  const { server, baseUrl } = await startServer({
    userService: {
      ...emptyUserService,
      listCreditPackages: async (_actor, options) => {
        calls.push(options);
        return [{ id: 'active-package', active: true, archivedAt: null }];
      },
    },
    adminService: emptyAdminService,
  });
  try {
    const response = await fetch(`${baseUrl}/credit-packages?currency=MMK`, {
      headers: { Cookie: '__session=valid' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{ id: 'active-package', active: true, archivedAt: null }]);
    assert.deepEqual(calls, [{ currency: 'MMK' }]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
