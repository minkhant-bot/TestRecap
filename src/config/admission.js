const DEFAULTS = Object.freeze({
  processingUsageLimit: 6,
  processingUsageWindowMs: 86_400_000,
  mutationRateLimit: 30,
  mutationRateWindowMs: 300_000,
  // Ceiling for users classified as 'credited' (a paid 'pro' plan, or a
  // ledger history containing a manual grant or purchase) -- see
  // getProcessingQuotaTier in billingFoundation.js. This is deliberately a
  // bounded abuse-only circuit breaker, not the real quota: for a credited
  // user, remaining credit balance is the real ceiling on how much they can
  // queue, enforced separately by checkCreditSufficiency/reserveLiveJob.
  processingUsageLimitCredited: 50,
  // Bounds how many failed/cancelled processing attempts per rolling window
  // are refunded back into the processing-usage quota (see
  // refundProcessingStartOnFailure). Beyond this, further failures behave
  // like today: they permanently consume a slot, so repeated deliberately
  // broken uploads cannot be replayed indefinitely for free.
  processingFailureRefundLimit: 3,
});

function parsePositiveInteger(value, name, { defaultValue, maximum }) {
  const resolved = value === undefined || value === '' ? defaultValue : Number(value);
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
  }
  return resolved;
}
export function getAdmissionConfiguration(env = process.env) {
  const requireExplicit = env.NODE_ENV === 'production';

  const value = (name, defaultValue) => {
    if (requireExplicit && (env[name] === undefined || env[name] === '')) {
      throw new Error(`${name} is required in production`);
    }
    return env[name] === undefined || env[name] === '' ? defaultValue : env[name];
  };
  // Unlike the four pre-existing settings above, these two are intentionally
  // NOT required-in-production: they were introduced after some deployments
  // already run with NODE_ENV=production and no way to set new variables
  // atomically with a code deploy. Requiring them via `value()` would crash
  // the entire server at startup for any such deployment the moment this
  // change ships. Silently defaulting keeps existing deployments working
  // unchanged; an operator can still override either at any time.
  const optionalValue = (name, defaultValue) =>
    env[name] === undefined || env[name] === '' ? defaultValue : env[name];

  return Object.freeze({
    processingUsageLimit: parsePositiveInteger(
      value('PROCESSING_USAGE_LIMIT', DEFAULTS.processingUsageLimit),
      'PROCESSING_USAGE_LIMIT',
      { maximum: 10_000 },
    ),
    processingUsageWindowMs: parsePositiveInteger(
      value('PROCESSING_USAGE_WINDOW_MS', DEFAULTS.processingUsageWindowMs),
      'PROCESSING_USAGE_WINDOW_MS',
      { maximum: 31 * 24 * 60 * 60 * 1000 },
    ),
    mutationRateLimit: parsePositiveInteger(
      value('MUTATION_RATE_LIMIT', DEFAULTS.mutationRateLimit),
      'MUTATION_RATE_LIMIT',
      { maximum: 100_000 },
    ),
    mutationRateWindowMs: parsePositiveInteger(
      value('MUTATION_RATE_WINDOW_MS', DEFAULTS.mutationRateWindowMs),
      'MUTATION_RATE_WINDOW_MS',
      { maximum: 24 * 60 * 60 * 1000 },
    ),
    processingUsageLimitCredited: parsePositiveInteger(
      optionalValue('PROCESSING_USAGE_LIMIT_CREDITED', DEFAULTS.processingUsageLimitCredited),
      'PROCESSING_USAGE_LIMIT_CREDITED',
      { maximum: 10_000 },
    ),
    processingFailureRefundLimit: parsePositiveInteger(
      optionalValue('PROCESSING_FAILURE_REFUND_LIMIT', DEFAULTS.processingFailureRefundLimit),
      'PROCESSING_FAILURE_REFUND_LIMIT',
      { maximum: 1_000 },
    ),
  });
}
