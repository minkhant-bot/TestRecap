import assert from 'node:assert/strict';
import test from 'node:test';
import { clearDedupeCache, dedupeRequest } from './requestCache.js';

test('two concurrent calls for the same key collapse into a single underlying request', async () => {
  clearDedupeCache();
  let calls = 0;
  const run = () => { calls += 1; return Promise.resolve(`result-${calls}`); };

  const [first, second] = await Promise.all([
    dedupeRequest('/api/credits/balance', 4000, run),
    dedupeRequest('/api/credits/balance', 4000, run),
  ]);

  assert.equal(calls, 1, 'the second caller must reuse the first call\'s in-flight promise');
  assert.equal(first, 'result-1');
  assert.equal(second, 'result-1');
});

test('different keys are never coalesced together', async () => {
  clearDedupeCache();
  let calls = 0;
  const run = () => { calls += 1; return Promise.resolve(calls); };

  await Promise.all([
    dedupeRequest('/api/credits/balance', 4000, run),
    dedupeRequest('/api/plans/me', 4000, run),
  ]);

  assert.equal(calls, 2);
});

test('a call after the TTL window fires a fresh request instead of reusing stale data', async () => {
  clearDedupeCache();
  let calls = 0;
  const run = () => { calls += 1; return Promise.resolve(calls); };

  await dedupeRequest('/api/credits/balance', 5, run);
  await new Promise(resolve => setTimeout(resolve, 15));
  await dedupeRequest('/api/credits/balance', 5, run);

  assert.equal(calls, 2, 'expired entries must not be reused, so this can never make data look staler than before');
});

test('a failed request is never cached, so the very next call can retry immediately', async () => {
  clearDedupeCache();
  let calls = 0;
  const run = () => {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error('network error')) : Promise.resolve('ok');
  };

  await assert.rejects(dedupeRequest('/api/credits/balance', 4000, run));
  const result = await dedupeRequest('/api/credits/balance', 4000, run);

  assert.equal(calls, 2, 'a failure must not poison the cache for subsequent callers');
  assert.equal(result, 'ok');
});
