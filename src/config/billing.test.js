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

test('screenshot object metadata requires provider and bucket together', () => {
  assert.equal(getBillingConfiguration({
    PAYMENT_SCREENSHOT_STORAGE_PROVIDER: 'private-provider',
  }).screenshotStorageConfigured, false);
  assert.equal(getBillingConfiguration({
    PAYMENT_SCREENSHOT_STORAGE_PROVIDER: 'private-provider',
    PAYMENT_SCREENSHOT_STORAGE_BUCKET: 'private-bucket',
  }).screenshotStorageConfigured, true);
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
