import { getStoragePaths } from './runtime.js';

export const PAYMENT_PROOF_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const PAYMENT_PROOF_EXTENSIONS = Object.freeze(['jpg', 'png', 'webp']);

export const getPaymentProofConfiguration = (
  env = process.env,
  projectRoot = process.cwd(),
) => {
  const rawMegabytes = String(env.PAYMENT_PROOF_MAX_SIZE_MB || '10').trim();
  const maxMegabytes = Number(rawMegabytes);
  if (!Number.isSafeInteger(maxMegabytes) || maxMegabytes < 1 || maxMegabytes > 25) {
    throw new Error('PAYMENT_PROOF_MAX_SIZE_MB must be an integer between 1 and 25.');
  }
  return Object.freeze({
    maxMegabytes,
    maxBytes: maxMegabytes * 1024 * 1024,
    mimeTypes: PAYMENT_PROOF_MIME_TYPES,
    extensions: PAYMENT_PROOF_EXTENSIONS,
    storageProvider: 'data_dir_private',
    storageBucket: 'payment-proofs',
    storageRoot: getStoragePaths(env, projectRoot).paymentProofs,
  });
};
