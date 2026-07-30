import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  AdmissionLimitError,
  JsonAdmissionStore,
  createAdmissionService,
  createMutationAdmissionMiddleware,
  sendAdmissionError,
} from './admissionControl.js';

const config = {
  processingUsageLimit: 2,
  processingUsageWindowMs: 1_000,
  mutationRateLimit: 3,
  mutationRateWindowMs: 500,
};

function fixture(clock = { value: 10_000 }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-admission-'));
  const filePath = path.join(directory, 'state.json');
  return {
    directory,
    filePath,
    clock,
    service: createAdmissionService({
      store: new JsonAdmissionStore(filePath),
      config,
      now: () => clock.value,
    }),
  };
}

test('keeps mutation and processing limits isolated by user', () => {
  const value = fixture();
  try {
    value.service.consumeMutation('user-a', 'workspace.jobs.upload');
    value.service.consumeMutation('user-a', 'workspace.jobs.upload');
    value.service.consumeMutation('user-a', 'workspace.jobs.upload');
    assert.throws(
      () => value.service.consumeMutation('user-a', 'workspace.jobs.upload'),
      error => error instanceof AdmissionLimitError && error.code === 'REQUEST_RATE_LIMIT_EXCEEDED',
    );
    assert.doesNotThrow(() => value.service.consumeMutation('user-b', 'workspace.jobs.upload'));

    value.service.consumeProcessingStart('user-a', 'job-a');
    value.service.consumeProcessingStart('user-a', 'job-b');
    assert.throws(
      () => value.service.consumeProcessingStart('user-a', 'job-c'),
      error => error.code === 'PROCESSING_USAGE_LIMIT_EXCEEDED',
    );
    assert.doesNotThrow(() => value.service.consumeProcessingStart('user-b', 'job-c'));
  } finally {
    fs.rmSync(value.directory, { recursive: true, force: true });
  }
});

test('serializes concurrent admissions without exceeding the limit', async () => {
  const value = fixture();
  try {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        Promise.resolve().then(() => value.service.consumeMutation('same-user', `endpoint-${index}`))),
    );
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 3);
    assert.equal(outcomes.filter(result => result.status === 'rejected').length, 9);
    assert.equal(value.service.getSnapshot('same-user').mutation.used, 3);
  } finally {
    fs.rmSync(value.directory, { recursive: true, force: true });
  }
});

test('recovers durable usage after service restart and reconciles missing jobs idempotently', () => {
  const value = fixture();
  try {
    value.service.consumeProcessingStart('user-a', 'persisted-job');
    const restarted = createAdmissionService({
      store: new JsonAdmissionStore(value.filePath),
      config,
      now: () => value.clock.value,
    });
    assert.equal(restarted.getSnapshot('user-a').processing.used, 1);
    assert.equal(restarted.consumeProcessingStart('user-a', 'persisted-job').idempotent, true);
    assert.equal(restarted.reconcileProcessingStarts([{
      id: 'recovered-job',
      ownerUid: 'user-a',
      queuedAt: new Date(value.clock.value).toISOString(),
    }]), 1);
    assert.equal(restarted.reconcileProcessingStarts([{
      id: 'recovered-job',
      ownerUid: 'user-a',
      queuedAt: new Date(value.clock.value).toISOString(),
    }]), 0);
  } finally {
    fs.rmSync(value.directory, { recursive: true, force: true });
  }
});

test('expires rolling-window usage at the exact boundary', () => {
  const value = fixture();
  try {
    value.service.consumeMutation('user-a', 'one');
    value.service.consumeProcessingStart('user-a', 'job-a');
    value.clock.value += 1_000;
    assert.equal(value.service.getSnapshot('user-a').mutation.used, 0);
    assert.equal(value.service.getSnapshot('user-a').processing.used, 0);
    assert.doesNotThrow(() => value.service.consumeProcessingStart('user-a', 'job-b'));
  } finally {
    fs.rmSync(value.directory, { recursive: true, force: true });
  }
});

test('compensates a newly reserved processing start when queueing fails', () => {
  const value = fixture();
  try {
    assert.throws(
      () => value.service.withProcessingAdmission('user-a', 'failed-job', () => {
        throw new Error('queue persistence failed');
      }),
      /queue persistence failed/,
    );
    assert.equal(value.service.getSnapshot('user-a').processing.used, 0);
    assert.equal(value.service.releaseProcessingStart('user-a', 'missing-job'), false);
  } finally {
    fs.rmSync(value.directory, { recursive: true, force: true });
  }
});

test('legacy endpoint names cannot bypass the per-user processing limit', () => {
  const value = fixture();
  try {
    value.service.consumeMutation('admin-user', 'legacy.jobs.create');
    value.service.consumeProcessingStart('admin-user', 'legacy-job-a');
    value.service.consumeMutation('admin-user', 'legacy.process.create');
    value.service.consumeProcessingStart('admin-user', 'legacy-job-b');
    assert.throws(
      () => value.service.consumeProcessingStart('admin-user', 'workspace-job'),
      error => error.code === 'PROCESSING_USAGE_LIMIT_EXCEEDED',
    );
  } finally {
    fs.rmSync(value.directory, { recursive: true, force: true });
  }
});

test('returns the stable 429 JSON and Retry-After contract', () => {
  const response = {
    headers: {},
    statusCode: null,
    body: null,
    set(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const error = new AdmissionLimitError({
    code: 'REQUEST_RATE_LIMIT_EXCEEDED',
    limit: 30,
    remaining: 0,
    windowSeconds: 300,
    retryAfterSeconds: 42,
  });
  assert.equal(sendAdmissionError(response, error, 'request-1'), true);
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers['Retry-After'], '42');
  assert.deepEqual(response.body, {
    error: 'Request rate limit exceeded',
    code: 'REQUEST_RATE_LIMIT_EXCEEDED',
    limit: 30,
    remaining: 0,
    windowSeconds: 300,
    retryAfterSeconds: 42,
    requestId: 'request-1',
  });
});

test('mutation middleware applies the same contract before route handlers', () => {
  let nextCalled = false;
  const service = {
    consumeMutation() {
      throw new AdmissionLimitError({
        code: 'REQUEST_RATE_LIMIT_EXCEEDED',
        limit: 1,
        remaining: 0,
        windowSeconds: 60,
        retryAfterSeconds: 10,
      });
    },
  };
  const response = {
    set() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  createMutationAdmissionMiddleware(service, 'legacy.process.create')(
    { user: { uid: 'user-a' }, requestId: 'request-2' },
    response,
    () => { nextCalled = true; },
  );
  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 429);
  assert.equal(response.body.requestId, 'request-2');
});
