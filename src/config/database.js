const DEFAULTS = Object.freeze({
  poolMax: 10,
  idleTimeoutMs: 30_000,
  connectionTimeoutMs: 5_000,
  queryTimeoutMs: 15_000,
});
const parseBoolean = (value, name, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
};

const parseInteger = (value, name, fallback, { min = 1, max = 2_147_483_647 } = {}) => {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
};

const parseDatabaseUrl = raw => {
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql:// and include a host and database.');
  }
  return raw;
};

const resolveSsl = (env, configured) => {
  const defaultMode = configured && env.NODE_ENV === 'production' ? 'verify-full' : 'disable';
  const mode = env.DATABASE_SSL_MODE || defaultMode;
  if (!['disable', 'require', 'verify-full'].includes(mode)) {
    throw new Error('DATABASE_SSL_MODE must be disable, require, or verify-full.');
  }
  if (mode === 'disable') return false;
  return { rejectUnauthorized: mode === 'verify-full' };
};

export const getDatabaseConfiguration = (env = process.env) => {
  const required = parseBoolean(env.DATABASE_REQUIRED, 'DATABASE_REQUIRED');
  const connectionString = parseDatabaseUrl(String(env.DATABASE_URL || '').trim());
  if (required && !connectionString) {
    throw new Error('DATABASE_URL is required when DATABASE_REQUIRED=true.');
  }
  const configured = Boolean(connectionString);
  return Object.freeze({
    configured,
    required,
    enabled: configured,
    connectionString,
    ssl: resolveSsl(env, configured),
    poolMax: parseInteger(env.DATABASE_POOL_MAX, 'DATABASE_POOL_MAX', DEFAULTS.poolMax, { max: 100 }),
    idleTimeoutMs: parseInteger(
      env.DATABASE_IDLE_TIMEOUT_MS,
      'DATABASE_IDLE_TIMEOUT_MS',
      DEFAULTS.idleTimeoutMs,
      { max: 600_000 },
    ),
    connectionTimeoutMs: parseInteger(
      env.DATABASE_CONNECTION_TIMEOUT_MS,
      'DATABASE_CONNECTION_TIMEOUT_MS',
      DEFAULTS.connectionTimeoutMs,
      { max: 120_000 },
    ),
    queryTimeoutMs: parseInteger(
      env.DATABASE_QUERY_TIMEOUT_MS,
      'DATABASE_QUERY_TIMEOUT_MS',
      DEFAULTS.queryTimeoutMs,
      { max: 600_000 },
    ),
  });
};

export const getRedactedDatabaseConfiguration = (configuration = getDatabaseConfiguration()) => ({
  configured: configuration.configured,
  required: configuration.required,
  ssl: configuration.ssl === false
    ? 'disable'
    : configuration.ssl.rejectUnauthorized ? 'verify-full' : 'require',
  poolMax: configuration.poolMax,
  idleTimeoutMs: configuration.idleTimeoutMs,
  connectionTimeoutMs: configuration.connectionTimeoutMs,
  queryTimeoutMs: configuration.queryTimeoutMs,
});
