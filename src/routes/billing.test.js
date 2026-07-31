import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createRequireAuth } from '../middleware/auth.js';
import { BillingError } from '../services/billingFoundation.js';
import { createBillingRouter } from './billing.js';
import { createAdminBillingRouter } from './adminBilling.js';

const identity = { uid: 'firebase-user', role: 'user' };

const startServer = async ({ userService, adminService }) => {
  const app = express();
  app.use(express.json());
  app.use(createRequireAuth({
    verifyIdentity: async ({ sessionCookie }) => sessionCookie === 'valid' ? identity : null,
  }));
  app.use(createBillingRouter(userService));
  app.use('/admin/billing', createAdminBillingRouter(adminService));
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
  createScreenshotIntent: async () => ({}), submitPurchase: async () => ({}),
  listMyPurchases: async () => [], getMyPurchase: async () => ({}),
};
const emptyAdminService = {
  adminListPurchases: async () => [], reviewPurchase: async () => ({}),
  configurePlan: async () => ({}), createPlanPolicy: async () => ({}),
  configureCreditPlan: async () => ({}), configureBank: async () => ({}),
  linkPackageBank: async () => ({}), configurePromotion: async () => ({}),
  adjustCredits: async () => ({}), assessTrial: async () => ({}),
  verifyScreenshot: async () => ({}), adminListAudit: async () => [],
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

