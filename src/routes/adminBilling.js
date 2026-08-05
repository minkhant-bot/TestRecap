import express from 'express';
import {
  BillingError,
  adjustCredits,
  archiveCreditPackage,
  adminGetScreenshotMetadata,
  adminGetUserCredits,
  adminListCatalog,
  adminListAudit,
  adminListPurchases,
  approveTrialRequest,
  assessTrial,
  configureBank,
  configureCreditPlan,
  configurePlan,
  configurePromotion,
  createCreditPackage,
  createPlanPolicy,
  editCreditPackage,
  linkPackageBank,
  listTrialRequests,
  publicJson,
  reviewPurchase,
  reorderCreditPackages,
  setCreditPackageStatus,
  verifyScreenshot,
} from '../services/billingFoundation.js';
import { paymentProofStorage, PaymentProofStorageError } from '../services/paymentProofStorage.js';

const idempotencyKey = req => req.get('Idempotency-Key');
const publicProofMetadata = proof => ({
  id: proof.id,
  originalFilename: proof.originalFilename,
  mimeType: proof.mimeType,
  sizeBytes: String(proof.sizeBytes),
  status: proof.status,
  uploadedAt: proof.uploadedAt,
  verifiedAt: proof.verifiedAt,
});
const structuredError = error => error instanceof BillingError || error instanceof PaymentProofStorageError;
// Structured (BillingError/PaymentProofStorageError) failures are expected
// business responses already carried in the JSON body -- only the generic
// branch below (an unrecognized exception, e.g. a raw PostgreSQL error) is
// logged here, since that's the case where the client-facing message is
// deliberately flattened to a generic string and the real cause would
// otherwise never reach Railway logs. Never logged to the client response.
const logUnstructuredError = (req, error) => console.error(JSON.stringify({
  event: 'billing.admin.request_failed',
  requestId: req.requestId,
  method: req.method,
  route: req.originalUrl,
  code: error?.code || null,
  message: error?.message || String(error),
  stack: error?.stack || null,
}));
const handler = operation => async (req, res) => {
  try {
    const result = await operation(req);
    if (result && typeof result.status === 'number' && 'body' in result) {
      if (result.replayed) res.setHeader('Idempotent-Replay', 'true');
      return res.status(result.status).json(publicJson(result.body));
    }
    return res.json(publicJson(result));
  } catch (error) {
    if (!structuredError(error)) logUnstructuredError(req, error);
    const status = structuredError(error) ? error.status : 500;
    return res.status(status).json({
      error: structuredError(error) ? error.message : 'Billing administration failed.',
      code: structuredError(error) ? error.code : 'BILLING_OPERATION_FAILED',
      requestId: req.requestId,
    });
  }
};

export const createAdminBillingRouter = (service = {
  adminListCatalog, adminListPurchases, reviewPurchase, configurePlan, createPlanPolicy,
  configureCreditPlan, configureBank, linkPackageBank, configurePromotion,
  createCreditPackage, editCreditPackage, setCreditPackageStatus,
  archiveCreditPackage, reorderCreditPackages,
  adjustCredits, assessTrial, verifyScreenshot, adminGetScreenshotMetadata,
  adminGetUserCredits, adminListAudit, listTrialRequests, approveTrialRequest,
}, { proofStorage = paymentProofStorage } = {}) => {
  const router = express.Router();
  const proofContentHandler = async (req, res) => {
    try {
      const metadata = await service.adminGetScreenshotMetadata(req.user, req.params.id);
      if (metadata?.status !== 'verified') {
        throw new PaymentProofStorageError('Payment proof upload is not complete.', {
          code: 'PROOF_NOT_READY', status: 409,
        });
      }
      const proof = await proofStorage.read(metadata);
      res.set({
        'Cache-Control': 'private, no-store',
        'Content-Type': proof.mimeType,
        'Content-Length': String(proof.sizeBytes),
        'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="payment-proof.${proof.extension}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      });
      return res.send(proof.buffer);
    } catch (error) {
      if (!structuredError(error)) logUnstructuredError(req, error);
      const status = structuredError(error) ? error.status : 500;
      return res.status(status).json({
        error: structuredError(error) ? error.message : 'Payment proof is unavailable.',
        code: structuredError(error) ? error.code : 'PROOF_STORAGE_ERROR',
        requestId: req.requestId,
      });
    }
  };
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
  router.post('/credit-packages', handler(req => service.createCreditPackage(
    req.user, req.body, { idempotencyKey: idempotencyKey(req) },
  )));
  router.patch('/credit-packages/:id', handler(req => service.editCreditPackage(
    req.user, req.params.id, req.body, { idempotencyKey: idempotencyKey(req) },
  )));
  router.post('/credit-packages/:id/activate', handler(req => service.setCreditPackageStatus(
    req.user, req.params.id, true, req.body, { idempotencyKey: idempotencyKey(req) },
  )));
  router.post('/credit-packages/:id/deactivate', handler(req => service.setCreditPackageStatus(
    req.user, req.params.id, false, req.body, { idempotencyKey: idempotencyKey(req) },
  )));
  router.post('/credit-packages/:id/archive', handler(req => service.archiveCreditPackage(
    req.user, req.params.id, req.body, { idempotencyKey: idempotencyKey(req) },
  )));
  router.post('/credit-packages/reorder', handler(req => service.reorderCreditPackages(
    req.user, req.body, { idempotencyKey: idempotencyKey(req) },
  )));
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
  router.get('/trial-requests', handler(req => service.listTrialRequests(req.user)));
  router.post('/trial-requests/:id/approve', handler(req =>
    service.approveTrialRequest(req.user, req.params.id, {
      idempotencyKey: idempotencyKey(req),
    })));
  router.post('/screenshots/:id/verify', handler(req =>
    service.verifyScreenshot(req.user, req.params.id, {
      idempotencyKey: idempotencyKey(req),
    })));
  router.get('/screenshots/:id', handler(async req =>
    publicProofMetadata(await service.adminGetScreenshotMetadata(req.user, req.params.id))));
  router.get('/screenshots/:id/content', proofContentHandler);
  router.get('/users/:uid/credits', handler(req =>
    service.adminGetUserCredits(req.user, req.params.uid)));
  router.get('/audit', handler(req => service.adminListAudit(req.user, {
    eventType: req.query.eventType || null,
    resourceType: req.query.resourceType || null,
  })));
  return router;
};

export default createAdminBillingRouter();
