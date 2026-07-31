import express from 'express';
import {
  BillingError,
  createScreenshotIntent,
  estimateCredits,
  getBalance,
  getLedger,
  getMyPlan,
  getMyPurchase,
  getTrialEligibility,
  grantTrial,
  listCreditPackages,
  listMyPurchases,
  listPackageBanks,
  listPlans,
  publicJson,
  selectPlan,
  submitPurchase,
} from '../services/billingFoundation.js';

const send = (res, value, status = 200) => res.status(status).json(publicJson(value));
const idempotencyKey = req => req.get('Idempotency-Key');
const handler = operation => async (req, res) => {
  try {
    const result = await operation(req);
    if (result && typeof result.status === 'number' && 'body' in result) {
      if (result.replayed) res.setHeader('Idempotent-Replay', 'true');
      return send(res, result.body, result.status);
    }
    return send(res, result);
  } catch (error) {
    const status = error instanceof BillingError ? error.status : 500;
    return res.status(status).json({
      error: error instanceof BillingError ? error.message : 'Billing operation failed.',
      code: error instanceof BillingError ? error.code : 'BILLING_OPERATION_FAILED',
      requestId: req.requestId,
    });
  }
};

export const createBillingRouter = (service = {
  listPlans, getMyPlan, selectPlan, getTrialEligibility, grantTrial,
  getBalance, getLedger, estimateCredits, listCreditPackages, listPackageBanks,
  createScreenshotIntent, submitPurchase, listMyPurchases, getMyPurchase,
}) => {
  const router = express.Router();
  router.get('/plans', handler(req => service.listPlans(req.user)));
  router.get('/plans/me', handler(req => service.getMyPlan(req.user)));
  router.post('/plans/me/select', handler(req => service.selectPlan(req.user, req.body, {
    idempotencyKey: idempotencyKey(req),
  })));
  router.get('/trial/eligibility', handler(req => service.getTrialEligibility(req.user)));
  router.post('/trial/grant', handler(req => service.grantTrial(req.user, req.body, {
    idempotencyKey: idempotencyKey(req),
  })));
  router.get('/credits/balance', handler(req => service.getBalance(req.user)));
  router.get('/credits/ledger', handler(req => service.getLedger(req.user, {
    limit: req.query.limit,
  })));
  router.post('/jobs/estimate', handler(req => service.estimateCredits(req.user, req.body)));
  router.get('/credit-plans', handler(req => service.listCreditPackages(req.user, {
    currency: req.query.currency,
  })));
  router.get('/credit-plans/:id/bank-accounts', handler(req =>
    service.listPackageBanks(req.user, req.params.id)));
  router.post('/uploads/payment-screenshots/intents', handler(req =>
    service.createScreenshotIntent(req.user, req.body, {
      idempotencyKey: idempotencyKey(req),
    })));
  router.post('/credit-purchase-requests', handler(req =>
    service.submitPurchase(req.user, req.body, {
      idempotencyKey: idempotencyKey(req),
    })));
  router.get('/credit-purchase-requests', handler(req => service.listMyPurchases(req.user)));
  router.get('/credit-purchase-requests/:id', handler(req =>
    service.getMyPurchase(req.user, req.params.id)));
  return router;
};

export default createBillingRouter();

