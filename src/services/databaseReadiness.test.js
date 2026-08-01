import assert from 'node:assert/strict';
import test from 'node:test';
import { getApplicationReadiness } from './databaseReadiness.js';

test('optional absent database preserves successful application readiness', async () => {
  const result = await getApplicationReadiness({
    configuration: { enabled: false, required: false },
  });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.database.status, 'disabled');
});
test('required unavailable database fails readiness without exposing errors', async () => {
  const result = await getApplicationReadiness({
    configuration: { enabled: true, required: true },
    healthCheck: async () => ({ configured: true, reachable: false }),
  });
  assert.equal(result.httpStatus, 503);
  assert.deepEqual(Object.keys(result.body.database).sort(), [
    'configured', 'migrationsCurrent', 'reachable', 'ready', 'required', 'status',
  ]);
});

test('reachable database with current migrations is ready', async () => {
  const result = await getApplicationReadiness({
    configuration: { enabled: true, required: true },
    healthCheck: async () => ({ configured: true, reachable: true }),
    migrationCheck: async () => ({ current: true }),
  });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.database.status, 'ready');
});
