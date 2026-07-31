import { getDatabaseConfiguration, getRedactedDatabaseConfiguration } from '../src/config/database.js';
import { migrateUp, getMigrationStatus } from '../src/db/migrations.js';
import { shutdownDatabase } from '../src/db/client.js';

const command = process.argv[2];
if (!['status', 'up'].includes(command)) {
  console.error('Usage: node scripts/db-migrate.mjs <status|up>');
  process.exitCode = 2;
} else {
  const configuration = getDatabaseConfiguration();
  if (!configuration.configured) throw new Error('DATABASE_URL is required for migration commands.');
  console.info(JSON.stringify({
    event: 'database.migration.command',
    command,
    database: getRedactedDatabaseConfiguration(configuration),
  }));
  try {
    if (command === 'status') {
      const status = await getMigrationStatus();
      console.info(JSON.stringify(status, null, 2));
      if (!status.current) process.exitCode = 1;
    } else {
      const applied = await migrateUp();
      console.info(JSON.stringify({ applied }));
    }
  } finally {
    await shutdownDatabase();
  }
}

