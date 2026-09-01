import assert from 'node:assert/strict';
import test from 'node:test';
import { getAdmissionConfiguration } from './admission.js';

test('uses documented admission defaults outside production', () => {
  assert.deepEqual(getAdmissionConfiguration({ NODE_ENV: 'test' }), {
    processingUsageLimit: 6,
    processingUsageWindowMs: 86_400_000,
    mutationRateLimit: 30,
    mutationRateWindowMs: 300_000,
    processingUsageLimitCredited: 50,
    processingFailureRefundLimit: 3,
  });
});

test('processing-usage-credited and failure-refund-limit are never required in production, unlike the four original limits', () => {
  // These two were introduced after some deployments already run with
  // NODE_ENV=production; requiring them would crash startup for any
  // deployment that hasn't set the new variables yet.
  const base = {
    NODE_ENV: 'production',
    PROCESSING_USAGE_LIMIT: '6',
    PROCESSING_USAGE_WINDOW_MS: '86400000',
    MUTATION_RATE_LIMIT: '30',
    MUTATION_RATE_WINDOW_MS: '300000',
  };
  const config = getAdmissionConfiguration(base);
  assert.equal(config.processingUsageLimitCredited, 50);
  assert.equal(config.processingFailureRefundLimit, 3);
  const overridden = getAdmissionConfiguration({
    ...base, PROCESSING_USAGE_LIMIT_CREDITED: '75', PROCESSING_FAILURE_REFUND_LIMIT: '5',
  });
  assert.equal(overridden.processingUsageLimitCredited, 75);
  assert.equal(overridden.processingFailureRefundLimit, 5);
});

test('requires explicit admission limits in production', () => {
  assert.throws(
    () => getAdmissionConfiguration({ NODE_ENV: 'production' }),
    /PROCESSING_USAGE_LIMIT is required in production/,
  );
});

test('validates admission limits as bounded positive integers', () => {
  const base = {
    NODE_ENV: 'production',
    PROCESSING_USAGE_LIMIT: '6',
    PROCESSING_USAGE_WINDOW_MS: '86400000',
    MUTATION_RATE_LIMIT: '30',
    MUTATION_RATE_WINDOW_MS: '300000',
  };
  assert.equal(getAdmissionConfiguration(base).mutationRateLimit, 30);
  assert.throws(
    () => getAdmissionConfiguration({ ...base, MUTATION_RATE_LIMIT: '0' }),
    /MUTATION_RATE_LIMIT must be a positive integer/,
  );
  assert.throws(
    () => getAdmissionConfiguration({ ...base, PROCESSING_USAGE_WINDOW_MS: '999999999999' }),
    /PROCESSING_USAGE_WINDOW_MS must be a positive integer/,
  );
});
