import assert from 'node:assert/strict';
import test from 'node:test';
import { getAdmissionConfiguration } from './admission.js';

test('uses documented admission defaults outside production', () => {
  assert.deepEqual(getAdmissionConfiguration({ NODE_ENV: 'test' }), {
    processingUsageLimit: 6,
    processingUsageWindowMs: 86_400_000,
    mutationRateLimit: 30,
    mutationRateWindowMs: 300_000,
  });
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
