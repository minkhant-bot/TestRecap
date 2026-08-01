import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createHealthRouter } from './health.js';

const listen = app => new Promise(resolve => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});

test('health stays live while optional or background readiness work is pending', async t => {
  let readinessCalls = 0;
  const app = express();
  app.use('/api', createHealthRouter({
    readinessCheck: () => {
      readinessCalls += 1;
      return new Promise(() => {});
    },
  }));
  const server = await listen(app);
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(readinessCalls, 0);
});

test('readiness surfaces a required database failure separately from liveness', async t => {
  const app = express();
  app.use('/api', createHealthRouter({
    readinessCheck: async () => ({
      httpStatus: 503,
      body: {
        status: 'unavailable',
        database: {
          required: true,
          configured: true,
          reachable: false,
          migrationsCurrent: false,
          ready: false,
          status: 'unavailable',
        },
      },
    }),
  }));
  const server = await listen(app);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  const health = await fetch(`${baseUrl}/health`);
  const readiness = await fetch(`${baseUrl}/ready`);

  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal(readiness.status, 503);
  assert.equal((await readiness.json()).database.status, 'unavailable');
});
