import pg from 'pg';
import { getDatabaseConfiguration } from '../config/database.js';

const { Pool } = pg;
let sharedPool = null;
let sharedConfiguration = null;

export class DatabaseUnavailableError extends Error {
  constructor(message = 'PostgreSQL is not configured.') {
    super(message);
    this.name = 'DatabaseUnavailableError';
    this.code = 'DATABASE_UNAVAILABLE';
  }
}

const structuredDatabaseError = (error, operation) => {
  if (error instanceof DatabaseUnavailableError) return error;
  const wrapped = new Error(`Database ${operation} failed.`);
  wrapped.name = 'DatabaseOperationError';
  wrapped.code = 'DATABASE_OPERATION_FAILED';
  wrapped.cause = error;
  return wrapped;
};

export const createDatabasePool = (configuration = getDatabaseConfiguration()) => {
  if (!configuration.enabled) return null;
  const pool = new Pool({
    connectionString: configuration.connectionString,
    ssl: configuration.ssl,
    max: configuration.poolMax,
    idleTimeoutMillis: configuration.idleTimeoutMs,
    connectionTimeoutMillis: configuration.connectionTimeoutMs,
    query_timeout: configuration.queryTimeoutMs,
    application_name: 'blink-automation',
  });
  pool.on('error', error => {
    console.error(JSON.stringify({
      event: 'database.pool.error',
      code: error?.code || 'UNKNOWN',
      message: 'An idle PostgreSQL connection failed.',
    }));
  });
  return pool;
};

export const getDatabasePool = (configuration = getDatabaseConfiguration()) => {
  if (!configuration.enabled) {
    if (configuration.required) throw new DatabaseUnavailableError();
    return null;
  }
  if (!sharedPool) {
    sharedConfiguration = configuration;
    sharedPool = createDatabasePool(configuration);
  }
  return sharedPool;
};

const requirePool = pool => {
  if (!pool) throw new DatabaseUnavailableError();
  return pool;
};

export const query = async (text, values = [], { pool = getDatabasePool() } = {}) => {
  try {
    return await requirePool(pool).query(text, values);
  } catch (error) {
    throw structuredDatabaseError(error, 'query');
  }
};

export const withDatabaseClient = async (callback, { pool = getDatabasePool() } = {}) => {
  let client;
  try {
    client = await requirePool(pool).connect();
    return await callback(client);
  } catch (error) {
    throw structuredDatabaseError(error, 'client operation');
  } finally {
    client?.release();
  }
};

const VALID_ISOLATION_LEVELS = new Set([
  'READ COMMITTED',
  'REPEATABLE READ',
  'SERIALIZABLE',
]);

export const withTransaction = async (
  callback,
  { pool = getDatabasePool(), isolationLevel = null } = {},
) => {
  let client;
  let originalError;
  try {
    client = await requirePool(pool).connect();
    await client.query('BEGIN');
    if (isolationLevel) {
      const normalized = String(isolationLevel).toUpperCase();
      if (!VALID_ISOLATION_LEVELS.has(normalized)) {
        throw new Error('Unsupported transaction isolation level.');
      }
      await client.query(`SET TRANSACTION ISOLATION LEVEL ${normalized}`);
    }
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    originalError = error;
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the operation error; rollback failure is secondary.
      }
    }
    throw originalError;
  } finally {
    client?.release();
  }
};

export const checkDatabaseHealth = async ({ pool = getDatabasePool() } = {}) => {
  if (!pool) return { configured: false, reachable: false };
  try {
    const result = await pool.query('SELECT 1 AS healthy');
    return { configured: true, reachable: result.rows?.[0]?.healthy === 1 };
  } catch {
    return { configured: true, reachable: false };
  }
};

export const closeDatabasePool = async pool => {
  if (pool) await pool.end();
};

export const shutdownDatabase = async () => {
  const pool = sharedPool;
  sharedPool = null;
  sharedConfiguration = null;
  await closeDatabasePool(pool);
};

export const getSharedDatabaseState = () => ({
  initialized: Boolean(sharedPool),
  configured: Boolean(sharedConfiguration?.configured),
});

export const resetDatabasePoolForTests = async () => shutdownDatabase();
