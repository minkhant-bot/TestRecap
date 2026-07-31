import { getDatabaseConfiguration } from '../config/database.js';
import { checkDatabaseHealth } from '../db/client.js';
import { checkMigrationsCurrent } from '../db/migrations.js';

export const getDatabaseReadiness = async ({
  configuration = getDatabaseConfiguration(),
  healthCheck = checkDatabaseHealth,
  migrationCheck = checkMigrationsCurrent,
} = {}) => {
  if (!configuration.enabled) {
    return {
      required: configuration.required,
      configured: false,
      reachable: false,
      migrationsCurrent: false,
      ready: !configuration.required,
      status: configuration.required ? 'unavailable' : 'disabled',
    };
  }

  const health = await healthCheck();
  if (!health.reachable) {
    return {
      required: configuration.required,
      configured: true,
      reachable: false,
      migrationsCurrent: false,
      ready: false,
      status: 'unavailable',
    };
  }

  try {
    const migrations = await migrationCheck();
    return {
      required: configuration.required,
      configured: true,
      reachable: true,
      migrationsCurrent: migrations.current,
      ready: migrations.current,
      status: migrations.current ? 'ready' : 'migrations_pending',
    };
  } catch {
    return {
      required: configuration.required,
      configured: true,
      reachable: true,
      migrationsCurrent: false,
      ready: false,
      status: 'migration_check_failed',
    };
  }
};

export const getApplicationHealth = async options => {
  const database = await getDatabaseReadiness(options);
  const blocking = database.required && !database.ready;
  return {
    httpStatus: blocking ? 503 : 200,
    body: {
      status: blocking ? 'unavailable' : 'ok',
      database,
    },
  };
};

