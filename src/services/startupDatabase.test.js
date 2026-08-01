import assert from 'node:assert/strict';
import test from 'node:test';
import { runStartupMigrations } from './startupDatabase.js';

test('production startup applies configured database migrations', async () => {
  let calls = 0;
  const result = await runStartupMigrations({
    configuration: { enabled: true },
    production: true,
    migrate: async () => {
      calls += 1;
      return ['0001', '0002'];
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    attempted: true,
    applied: ['0001', '0002'],
    reason: null,
  });
});

test('startup does not auto-migrate outside production or without a database', async () => {
  let calls = 0;
  const migrate = async () => {
    calls += 1;
    return [];
  };

  const development = await runStartupMigrations({
    configuration: { enabled: true },
    production: false,
    migrate,
  });
  const disabled = await runStartupMigrations({
    configuration: { enabled: false },
    production: true,
    migrate,
  });

  assert.equal(calls, 0);
  assert.equal(development.reason, 'non_production');
  assert.equal(disabled.reason, 'database_disabled');
});

test('startup surfaces migration failures to the server lifecycle', async () => {
  const failure = new Error('migration failed');
  await assert.rejects(
    runStartupMigrations({
      configuration: { enabled: true },
      production: true,
      migrate: async () => { throw failure; },
    }),
    error => error === failure,
  );
});
