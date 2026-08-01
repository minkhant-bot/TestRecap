const DEFAULTS = Object.freeze({
  processingUsageLimit: 6,
  processingUsageWindowMs: 86_400_000,
  mutationRateLimit: 30,
  mutationRateWindowMs: 300_000,
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
  });
}
