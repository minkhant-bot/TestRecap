import assert from 'node:assert/strict';
import test from 'node:test';
import { getDatabaseConfiguration, getRedactedDatabaseConfiguration } from './database.js';

test('database is optional and disabled when DATABASE_URL is absent', () => {
  const config = getDatabaseConfiguration({});
  assert.equal(config.enabled, false);
  assert.equal(config.required, false);
});

test('required database rejects missing and invalid URLs', () => {
  assert.throws(
    () => getDatabaseConfiguration({ DATABASE_REQUIRED: 'true' }),
    /DATABASE_URL is required/,
  );
  assert.throws(
    () => getDatabaseConfiguration({ DATABASE_URL: 'https://example.test/db' }),
    /postgres:\/\/ or postgresql:\/\//,
  );
});

test('pool and TLS options validate and redaction excludes the URL', () => {
  const config = getDatabaseConfiguration({
    DATABASE_URL: 'postgresql://user:secret@db.example/blink',
    DATABASE_POOL_MAX: '20',
    DATABASE_SSL_MODE: 'require',
  });
  assert.equal(config.poolMax, 20);
  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
  assert.equal(JSON.stringify(getRedactedDatabaseConfiguration(config)).includes('secret'), false);
});
