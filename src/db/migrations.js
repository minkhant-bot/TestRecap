import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabasePool, withDatabaseClient } from './client.js';

const MIGRATION_PATTERN = /^(\d{4,})_([a-z0-9_]+)\.sql$/;
const MIGRATION_LOCK_ID = 7_321_904_221;
const defaultDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export const checksumMigration = sql =>
  crypto.createHash('sha256').update(sql, 'utf8').digest('hex');

export const discoverMigrations = (directory = defaultDirectory) => {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && MIGRATION_PATTERN.test(entry.name))
    .map(entry => {
      const match = entry.name.match(MIGRATION_PATTERN);
      const sql = fs.readFileSync(path.join(directory, entry.name), 'utf8');
      return {
        version: match[1],
        description: match[2],
        filename: entry.name,
        sql,
        checksum: checksumMigration(sql),
      };
    })
    .sort((left, right) => left.version.localeCompare(right.version));
  const versions = new Set();
  for (const migration of entries) {
    if (versions.has(migration.version)) {
      throw new Error(`Duplicate migration version ${migration.version}.`);
    }
    versions.add(migration.version);
  }
  return entries;
};

const ensureMigrationTable = client => client.query(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    execution_ms INTEGER NOT NULL CHECK (execution_ms >= 0)
  )
`);

export const getMigrationStatus = async ({
  pool = getDatabasePool(),
  directory = defaultDirectory,
} = {}) => withDatabaseClient(async client => {
  const available = discoverMigrations(directory);
  const tableResult = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = 'schema_migrations'
     ) AS exists`,
  );
  const appliedResult = tableResult.rows[0]?.exists
    ? await client.query(
      'SELECT version, checksum, description, applied_at, execution_ms FROM schema_migrations ORDER BY version',
    )
    : { rows: [] };
  const applied = new Map(appliedResult.rows.map(row => [row.version, row]));
  const migrations = available.map(migration => {
    const record = applied.get(migration.version);
    return {
      version: migration.version,
      description: migration.description,
      filename: migration.filename,
      state: !record ? 'pending' : record.checksum === migration.checksum ? 'applied' : 'checksum_mismatch',
      appliedAt: record?.applied_at || null,
      executionMs: record?.execution_ms ?? null,
    };
  });
  const unknownApplied = appliedResult.rows
    .filter(row => !available.some(migration => migration.version === row.version))
    .map(row => ({ version: row.version, state: 'unknown_applied' }));
  return {
    current: migrations.every(item => item.state === 'applied') && unknownApplied.length === 0,
    migrations,
    unknownApplied,
  };
}, { pool });

export const migrateUp = async ({
  pool = getDatabasePool(),
  directory = defaultDirectory,
} = {}) => withDatabaseClient(async client => {
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
  try {
    await ensureMigrationTable(client);
    const migrations = discoverMigrations(directory);
    const appliedResult = await client.query(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );
    const applied = new Map(appliedResult.rows.map(row => [row.version, row.checksum]));
    const completed = [];
    for (const migration of migrations) {
      const previousChecksum = applied.get(migration.version);
      if (previousChecksum && previousChecksum !== migration.checksum) {
        throw new Error(`Applied migration ${migration.version} checksum does not match its file.`);
      }
      if (previousChecksum) continue;
      const started = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO schema_migrations
            (version, checksum, description, execution_ms)
           VALUES ($1, $2, $3, $4)`,
          [migration.version, migration.checksum, migration.description, Date.now() - started],
        );
        await client.query('COMMIT');
        completed.push(migration.version);
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch {}
        throw error;
      }
    }
    return completed;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
  }
}, { pool });

export const checkMigrationsCurrent = async options => {
  try {
    const status = await getMigrationStatus(options);
    return { reachable: true, current: status.current };
  } catch {
    return { reachable: false, current: false };
  }
};

export { defaultDirectory as migrationsDirectory };
