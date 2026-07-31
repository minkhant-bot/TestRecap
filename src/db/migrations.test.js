import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverMigrations, getMigrationStatus, migrateUp } from './migrations.js';

const fixtureDirectory = files => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-migrations-'));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), sql);
  return directory;
};

test('migration discovery is deterministic and checksummed', t => {
  const directory = fixtureDirectory({
    '0002_second.sql': 'SELECT 2;\n',
    '0001_first.sql': 'SELECT 1;\n',
  });
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const migrations = discoverMigrations(directory);
  assert.deepEqual(migrations.map(item => item.version), ['0001', '0002']);
  assert.match(migrations[0].checksum, /^[0-9a-f]{64}$/);
});

test('applied checksum mismatch is reported and rejected', async t => {
  const directory = fixtureDirectory({ '0001_first.sql': 'SELECT 1;\n' });
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const client = {
    release() {},
    async query(sql) {
      if (String(sql).includes('information_schema.tables')) {
        return { rows: [{ exists: true }] };
      }
      if (String(sql).includes('FROM schema_migrations')) {
        return { rows: [{ version: '0001', checksum: 'wrong' }] };
      }
      return { rows: [] };
    },
  };
  const pool = { connect: async () => client };
  const status = await getMigrationStatus({ pool, directory });
  assert.equal(status.migrations[0].state, 'checksum_mismatch');
  await assert.rejects(
    migrateUp({ pool, directory }),
    error => /checksum does not match/.test(error.cause?.message || error.message),
  );
});
