import express from 'express';
import multer from 'multer';
import { getPaymentProofConfiguration } from '../config/paymentProof.js';
import {
  BillingError,
  completeScreenshotUpload,
  createScreenshotIntent,
  estimateCredits,
  getBalance,
  getLedger,
  getMyPlan,
  getMyPurchase,
  getMyScreenshotMetadata,
  getMyTrialRequest,
  getTrialEligibility,
  grantTrial,
  listCreditPackages,
  listMyPurchases,
  listPackageBanks,
  listPlans,
  publicJson,
  requestTrial,
  selectPlan,
  submitPurchase,
} from '../services/billingFoundation.js';
import { paymentProofStorage, PaymentProofStorageError } from '../services/paymentProofStorage.js';

const send = (res, value, status = 200) => res.status(status).json(publicJson(value));
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
const handler = operation => async (req, res) => {
  try {
    const result = await operation(req);
    if (result && typeof result.status === 'number' && 'body' in result) {
      if (result.replayed) res.setHeader('Idempotent-Replay', 'true');
      return send(res, result.body, result.status);
    }
    return send(res, result);
  } catch (error) {
    const status = structuredError(error) ? error.status : 500;
    return res.status(status).json({
      error: structuredError(error) ? error.message : 'Billing operation failed.',
      code: structuredError(error) ? error.code : 'BILLING_OPERATION_FAILED',
      requestId: req.requestId,
    });
  }
};

export const createBillingRouter = (service = {
  listPlans, getMyPlan, selectPlan, getTrialEligibility, grantTrial,
  requestTrial, getMyTrialRequest,
  getBalance, getLedger, estimateCredits, listCreditPackages, listPackageBanks,
  createScreenshotIntent, completeScreenshotUpload, submitPurchase,
  listMyPurchases, getMyPurchase, getMyScreenshotMetadata,
}, {
  proofStorage = paymentProofStorage,
  proofConfiguration = getPaymentProofConfiguration(),
} = {}) => {
  const router = express.Router();
  const proofUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: proofConfiguration.maxBytes, files: 1, fields: 4 },
  }).single('proof');
  const acceptProofUpload = (req, res, next) => proofUpload(req, res, error => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `Payment proof exceeds the ${proofConfiguration.maxMegabytes} MB limit.`,
        code: 'PROOF_TOO_LARGE',
        requestId: req.requestId,
      });
    }
    return res.status(400).json({
      error: 'The payment-proof multipart upload is invalid.',
      code: 'PROOF_MULTIPART_INVALID',
      requestId: req.requestId,
    });
  });
  const sendProof = async (req, res, metadata) => {
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
  };
  const proofContentHandler = resolveMetadata => async (req, res) => {
    try {
      const metadata = await resolveMetadata(req);
      return await sendProof(req, res, metadata);
    } catch (error) {
      const status = structuredError(error) ? error.status : 500;
      return res.status(status).json({
        error: structuredError(error) ? error.message : 'Payment proof is unavailable.',
        code: structuredError(error) ? error.code : 'PROOF_STORAGE_ERROR',
        requestId: req.requestId,
      });
    }
  };
  router.get('/payment-proofs/config', (_req, res) => res.json({
    maxSizeBytes: proofConfiguration.maxBytes,
    maxSizeMb: proofConfiguration.maxMegabytes,
    mimeTypes: proofConfiguration.mimeTypes,
    extensions: proofConfiguration.extensions,
  }));
  router.get('/plans', handler(req => service.listPlans(req.user)));
  router.get('/plans/me', handler(req => service.getMyPlan(req.user)));
  router.post('/plans/me/select', handler(req => service.selectPlan(req.user, req.body, {
    idempotencyKey: idempotencyKey(req),
  })));
  router.get('/trial/eligibility', handler(req => service.getTrialEligibility(req.user)));
  router.post('/trial/grant', handler(req => service.grantTrial(req.user, req.body, {
    idempotencyKey: idempotencyKey(req),
  })));
  router.get('/trial/request', handler(req => service.getMyTrialRequest(req.user)));
  router.post('/trial/request', handler(req => service.requestTrial(req.user, {
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
  router.get('/credit-packages', handler(req => service.listCreditPackages(req.user, {
    currency: req.query.currency,
  })));
  router.get('/credit-plans/:id/bank-accounts', handler(req =>
    service.listPackageBanks(req.user, req.params.id)));
  router.post('/uploads/payment-screenshots/intents', handler(async req => {
    const result = await service.createScreenshotIntent(req.user, req.body, {
      idempotencyKey: idempotencyKey(req),
    });
    return {
      ...result,
      body: { id: result.body.id, status: result.body.status },
    };
  }));
  router.get('/uploads/payment-screenshots/:id', handler(async req =>
    publicProofMetadata(await service.getMyScreenshotMetadata(req.user, req.params.id))));
  router.get('/uploads/payment-screenshots/:id/content', proofContentHandler(req =>
    service.getMyScreenshotMetadata(req.user, req.params.id)));
  router.post('/credit-purchase-requests/with-proof', acceptProofUpload, handler(async req => {
    const workflowKey = String(idempotencyKey(req) || '').trim();
    if (!workflowKey || workflowKey.length > 150) {
      throw new BillingError('Idempotency-Key is required and must be at most 150 characters.', {
        code: 'INVALID_INPUT', status: 400,
      });
    }
    const inspected = proofStorage.inspect(req.file);
    const intent = await service.createScreenshotIntent(req.user, {
      originalFilename: inspected.originalFilename,
      mimeType: inspected.mimeType,
      sizeBytes: inspected.sizeBytes,
      sha256: inspected.sha256,
    }, { idempotencyKey: `${workflowKey}:intent` });
    await proofStorage.store(intent.body.objectKey, inspected);
    const completed = await service.completeScreenshotUpload(req.user, intent.body.id, {
      mimeType: inspected.mimeType,
      sizeBytes: inspected.sizeBytes,
      sha256: inspected.sha256,
    }, { idempotencyKey: `${workflowKey}:complete` });
    const purchase = await service.submitPurchase(req.user, {
      creditPlanId: req.body?.creditPlanId,
      bankAccountId: req.body?.bankAccountId,
      screenshotFileId: intent.body.id,
    }, { idempotencyKey: `${workflowKey}:purchase` });
    return {
      status: purchase.status,
      replayed: Boolean(intent.replayed && completed.replayed && purchase.replayed),
      body: {
        purchase: purchase.body.purchase,
        proof: {
          id: intent.body.id,
          originalFilename: inspected.originalFilename,
          mimeType: inspected.mimeType,
          sizeBytes: String(inspected.sizeBytes),
          status: 'verified',
        },
      },
    };
  }));
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
