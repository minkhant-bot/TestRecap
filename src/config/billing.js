import { getPaymentProofConfiguration } from './paymentProof.js';

const parseBoolean = (value, name, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
};

export const getBillingConfiguration = (env = process.env) => {
  const enabled = parseBoolean(env.P2_BILLING_ENABLED, 'P2_BILLING_ENABLED');
  const liveJobBillingEnabled = parseBoolean(
    env.P2_LIVE_JOB_BILLING_ENABLED,
    'P2_LIVE_JOB_BILLING_ENABLED',
  );
  const paymentProof = getPaymentProofConfiguration(env);
  if (enabled && (!String(env.DATABASE_URL || '').trim())) {
    throw new Error('P2_BILLING_ENABLED requires DATABASE_URL.');
  }
  if (liveJobBillingEnabled && !enabled) {
    throw new Error('P2_LIVE_JOB_BILLING_ENABLED requires P2_BILLING_ENABLED.');
  }
  return Object.freeze({
    enabled,
    liveJobBillingEnabled,
    screenshotStorageConfigured: true,
    storageProvider: paymentProof.storageProvider,
    storageBucket: paymentProof.storageBucket,
    paymentProofMaxBytes: paymentProof.maxBytes,
    paymentProofMimeTypes: paymentProof.mimeTypes,
  });
};
