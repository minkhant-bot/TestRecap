import assert from 'node:assert/strict';
import test from 'node:test';
import { closeDatabasePool, withTransaction } from './client.js';

const mockPool = ({ failCommit = false } = {}) => {
  const statements = [];
  let releases = 0;
  const client = {
    query: async sql => {
      statements.push(sql);
      if (sql === 'COMMIT' && failCommit) throw new Error('commit failed');
      return { rows: [] };
    },
    release: () => { releases += 1; },
  };
  return {
    pool: { connect: async () => client },
    statements,
    releases: () => releases,
  };
};

test('transaction commits and releases', async () => {
  const mock = mockPool();
  const value = await withTransaction(async client => {
    await client.query('SELECT 1');
    return 'ok';
  }, { pool: mock.pool });
  assert.equal(value, 'ok');
  assert.deepEqual(mock.statements, ['BEGIN', 'SELECT 1', 'COMMIT']);
  assert.equal(mock.releases(), 1);
});

test('transaction rolls back, releases, and preserves original error', async () => {
  const mock = mockPool();
  const original = new Error('operation failed');
  await assert.rejects(
    withTransaction(async () => { throw original; }, { pool: mock.pool }),
    error => error === original,
  );
  assert.deepEqual(mock.statements, ['BEGIN', 'ROLLBACK']);
  assert.equal(mock.releases(), 1);
});

test('pool shutdown waits for pool end', async () => {
  let ended = false;
  await closeDatabasePool({ end: async () => { ended = true; } });
  assert.equal(ended, true);
});
