import { getDatabaseConfiguration } from '../config/database.js';
import { migrateUp } from '../db/migrations.js';

export const runStartupMigrations = async ({
  configuration = getDatabaseConfiguration(),
  production = process.env.NODE_ENV === 'production',
  migrate = migrateUp,
} = {}) => {
  if (!production || !configuration.enabled) {
    return {
      attempted: false,
      applied: [],
      reason: production ? 'database_disabled' : 'non_production',
    };
  }

  return {
    attempted: true,
    applied: await migrate(),
    reason: null,
  };
};
