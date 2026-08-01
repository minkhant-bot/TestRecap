import assert from 'node:assert/strict';
import test from 'node:test';
import { getBillingConfiguration } from './billing.js';

test('billing activation is explicit and requires PostgreSQL', () => {
  assert.equal(getBillingConfiguration({}).enabled, false);
  assert.throws(
    () => getBillingConfiguration({ P2_BILLING_ENABLED: 'true' }),
    /requires DATABASE_URL/,
  );
  assert.equal(getBillingConfiguration({
    P2_BILLING_ENABLED: 'true',
    DATABASE_URL: 'postgresql://db.example/blink',
  }).enabled, true);
});

test('payment proofs use bounded private DATA_DIR storage configuration', () => {
  const configuration = getBillingConfiguration({ PAYMENT_PROOF_MAX_SIZE_MB: '8' });
  assert.equal(configuration.screenshotStorageConfigured, true);
  assert.equal(configuration.storageProvider, 'data_dir_private');
  assert.equal(configuration.storageBucket, 'payment-proofs');
  assert.equal(configuration.paymentProofMaxBytes, 8 * 1024 * 1024);
  assert.deepEqual(configuration.paymentProofMimeTypes, ['image/jpeg', 'image/png', 'image/webp']);
  assert.throws(
    () => getBillingConfiguration({ PAYMENT_PROOF_MAX_SIZE_MB: '100' }),
    /between 1 and 25/,
  );
});

test('live job billing has a separate default-off activation gate', () => {
  assert.equal(getBillingConfiguration({}).liveJobBillingEnabled, false);
  assert.throws(
    () => getBillingConfiguration({ P2_LIVE_JOB_BILLING_ENABLED: 'true' }),
    /requires P2_BILLING_ENABLED/,
  );
  assert.equal(getBillingConfiguration({
    P2_BILLING_ENABLED: 'true',
    P2_LIVE_JOB_BILLING_ENABLED: 'true',
    DATABASE_URL: 'postgres://billing',
  }).liveJobBillingEnabled, true);
});
