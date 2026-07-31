import express from 'express';
import {
  BillingError,
  adjustCredits,
  adminGetScreenshotMetadata,
  adminGetUserCredits,
  adminListCatalog,
  adminListAudit,
  adminListPurchases,
  assessTrial,
  configureBank,
  configureCreditPlan,
  configurePlan,
  configurePromotion,
  createPlanPolicy,
  linkPackageBank,
  publicJson,
  reviewPurchase,
  verifyScreenshot,
} from '../services/billingFoundation.js';

const idempotencyKey = req => req.get('Idempotency-Key');
const handler = operation => async (req, res) => {
  try {
    const result = await operation(req);
    if (result && typeof result.status === 'number' && 'body' in result) {
      if (result.replayed) res.setHeader('Idempotent-Replay', 'true');
      return res.status(result.status).json(publicJson(result.body));
    }
    return res.json(publicJson(result));
  } catch (error) {
    const status = error instanceof BillingError ? error.status : 500;
    return res.status(status).json({
      error: error instanceof BillingError ? error.message : 'Billing administration failed.',
      code: error instanceof BillingError ? error.code : 'BILLING_OPERATION_FAILED',
      requestId: req.requestId,
    });
  }
};

export const createAdminBillingRouter = (service = {
  adminListCatalog, adminListPurchases, reviewPurchase, configurePlan, createPlanPolicy,
  configureCreditPlan, configureBank, linkPackageBank, configurePromotion,
  adjustCredits, assessTrial, verifyScreenshot, adminGetScreenshotMetadata,
  adminGetUserCredits, adminListAudit,
}) => {
  const router = express.Router();
  router.get('/catalog', handler(req => service.adminListCatalog(req.user)));
  router.get('/purchases', handler(req => service.adminListPurchases(req.user, {
    status: req.query.status || null,
  })));
  router.post('/purchases/:id/approve', handler(req =>
    service.reviewPurchase(req.user, req.params.id, {
      decision: 'approved',
    }, { idempotencyKey: idempotencyKey(req) })));
  router.post('/purchases/:id/reject', handler(req =>
    service.reviewPurchase(req.user, req.params.id, {
      decision: 'rejected', reason: req.body?.reason,
    }, { idempotencyKey: idempotencyKey(req) })));
  router.put('/plans/:code', handler(req => service.configurePlan(req.user, {
    ...req.body, code: req.params.code,
  }, { idempotencyKey: idempotencyKey(req) })));
  router.post('/plans/:code/policies', handler(req =>
    service.createPlanPolicy(req.user, req.params.code, req.body, {
      idempotencyKey: idempotencyKey(req),
    })));
  router.put('/credit-plans/:code', handler(req => service.configureCreditPlan(req.user, {
    ...req.body, code: req.params.code,
  }, { idempotencyKey: idempotencyKey(req) })));
  router.put('/banks/:code', handler(req => service.configureBank(req.user, {
    ...req.body, code: req.params.code,
  }, { idempotencyKey: idempotencyKey(req) })));
  router.put('/credit-plans/:creditPlanId/banks/:bankAccountId', handler(req =>
    service.linkPackageBank(req.user, {
      creditPlanId: req.params.creditPlanId,
      bankAccountId: req.params.bankAccountId,
      active: req.body?.active,
    }, { idempotencyKey: idempotencyKey(req) })));
  router.post('/promotions', handler(req => service.configurePromotion(req.user, req.body, {
    idempotencyKey: idempotencyKey(req),
  })));
  router.post('/adjustments', handler(req => service.adjustCredits(req.user, req.body, {
    idempotencyKey: idempotencyKey(req),
  })));
  router.post('/trial-assessments', handler(req => service.assessTrial(req.user, req.body, {
    idempotencyKey: idempotencyKey(req),
  })));
  router.post('/screenshots/:id/verify', handler(req =>
    service.verifyScreenshot(req.user, req.params.id, {
      idempotencyKey: idempotencyKey(req),
    })));
  router.get('/screenshots/:id', handler(req =>
    service.adminGetScreenshotMetadata(req.user, req.params.id)));
  router.get('/users/:uid/credits', handler(req =>
    service.adminGetUserCredits(req.user, req.params.uid)));
  router.get('/audit', handler(req => service.adminListAudit(req.user, {
    eventType: req.query.eventType || null,
    resourceType: req.query.resourceType || null,
  })));
  return router;
};

export default createAdminBillingRouter();
