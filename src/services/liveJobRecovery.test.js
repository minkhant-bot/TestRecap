import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileStrandedLiveJobs } from './liveJobRecovery.js';

// Crash-window recovery tests: a hard process crash can leave a Postgres
// live-billing reservation stuck at `reserved` (or, rarely, `settled`) while
// the JSON workspace record has already reached a terminal status, or is
// missing entirely. These tests prove the reconciliation sweep resolves each
// case safely and, critically, never touches a reservation for a job that is
// genuinely still active.

const makeCalls = () => ({ settle: [], release: [], reviewRequired: [], audit: [] });

const harness = ({ billingStatuses = {}, workspaceJobs = {} } = {}) => {
  const calls = makeCalls();
  const deps = {
    isEnabled: () => true,
    listStranded: async () => Object.keys(billingStatuses),
    getBillingStatus: async jobId => (billingStatuses[jobId]
      ? { id: jobId, billingStatus: billingStatuses[jobId] }
      : null),
    getWorkspaceJob: jobId => workspaceJobs[jobId] || null,
    validateOutput: (jobId, output) => {
      const job = workspaceJobs[jobId];
      if (!job || job.hasValidOutput === false) throw new Error('invalid output');
      return output;
    },
    settle: async (jobId, options) => { calls.settle.push({ jobId, options }); return { billingStatus: 'settled' }; },
    release: async (jobId, reason) => { calls.release.push({ jobId, reason }); return { billingStatus: 'released' }; },
    reviewRequired: async (jobId, reason) => { calls.reviewRequired.push({ jobId, reason }); return true; },
    audit: async (jobId, decision, details) => { calls.audit.push({ jobId, decision, details }); },
  };
  return { deps, calls };
};

test('sweep no-ops entirely when live job billing is disabled', async () => {
  const { deps, calls } = harness({ billingStatuses: { 'job-1': 'reserved' } });
  deps.isEnabled = () => false;
  const result = await reconcileStrandedLiveJobs(deps);
  assert.deepEqual(result, { enabled: false, reconciled: 0, skipped: 0, total: 0 });
  assert.equal(calls.settle.length, 0);
  assert.equal(calls.release.length, 0);
  assert.equal(calls.reviewRequired.length, 0);
});

test('a reserved job whose JSON record completed with valid output is settled', async () => {
  const { deps, calls } = harness({
    billingStatuses: { 'job-completed': 'reserved' },
    workspaceJobs: { 'job-completed': { status: 'completed', videoUrl: '/output/job-completed.mp4', hasValidOutput: true } },
  });
  const result = await reconcileStrandedLiveJobs(deps);
  assert.equal(result.reconciled, 1);
  assert.equal(calls.settle.length, 1);
  assert.equal(calls.settle[0].jobId, 'job-completed');
  assert.equal(calls.settle[0].options.outputValidated, true);
  assert.equal(calls.release.length, 0);
  assert.equal(calls.reviewRequired.length, 0);
  assert.equal(calls.audit[0].decision, 'settled');
});

test('a reserved job whose JSON record failed is released', async () => {
  const { deps, calls } = harness({
    billingStatuses: { 'job-failed': 'reserved' },
    workspaceJobs: { 'job-failed': { status: 'failed' } },
  });
  const result = await reconcileStrandedLiveJobs(deps);
  assert.equal(result.reconciled, 1);
  assert.equal(calls.release.length, 1);
  assert.equal(calls.release[0].jobId, 'job-failed');
  assert.equal(calls.settle.length, 0);
  assert.equal(calls.audit[0].decision, 'released');
});

test('a reserved job whose JSON record was cancelled is released', async () => {
  const { deps, calls } = harness({
    billingStatuses: { 'job-cancelled': 'reserved' },
    workspaceJobs: { 'job-cancelled': { status: 'cancelled' } },
  });
  await reconcileStrandedLiveJobs(deps);
  assert.equal(calls.release.length, 1);
  assert.equal(calls.settle.length, 0);
});

test('a reserved job whose workspace record is missing entirely is escalated to review, never guessed', async () => {
  const { deps, calls } = harness({
    billingStatuses: { 'job-missing': 'reserved' },
    workspaceJobs: {},
  });
  const result = await reconcileStrandedLiveJobs(deps);
  assert.equal(result.reconciled, 1);
  assert.equal(calls.reviewRequired.length, 1);
  assert.equal(calls.reviewRequired[0].reason, 'startup_reconciliation_missing_workspace_record');
  assert.equal(calls.settle.length, 0);
  assert.equal(calls.release.length, 0);
});

test('a completed job whose output cannot be validated is escalated to review, not settled', async () => {
  const { deps, calls } = harness({
    billingStatuses: { 'job-unverifiable': 'reserved' },
    workspaceJobs: { 'job-unverifiable': { status: 'completed', hasValidOutput: false } },
  });
  await reconcileStrandedLiveJobs(deps);
  assert.equal(calls.settle.length, 0);
  assert.equal(calls.reviewRequired.length, 1);
  assert.equal(calls.reviewRequired[0].reason, 'startup_reconciliation_completed_output_unverifiable');
});

test('CRITICAL: a job that is still genuinely active (pending/queued/processing) is never touched', async () => {
  for (const status of ['pending', 'queued', 'processing']) {
    const { deps, calls } = harness({
      billingStatuses: { 'job-active': 'reserved' },
      workspaceJobs: { 'job-active': { status } },
    });
    const result = await reconcileStrandedLiveJobs(deps);
    assert.equal(result.skipped, 1, `status=${status} should be skipped`);
    assert.equal(result.reconciled, 0, `status=${status} must not be reconciled`);
    assert.equal(calls.settle.length, 0, `status=${status} must never be settled`);
    assert.equal(calls.release.length, 0, `status=${status} must never be released`);
    assert.equal(calls.reviewRequired.length, 0, `status=${status} must never be marked review_required`);
  }
});

test('a job already review_required is left for Super Admin, never auto-resolved', async () => {
  const { deps, calls } = harness({
    billingStatuses: { 'job-review': 'review_required' },
    workspaceJobs: { 'job-review': { status: 'failed' } },
  });
  const result = await reconcileStrandedLiveJobs(deps);
  assert.equal(result.skipped, 1);
  assert.equal(result.reconciled, 0);
  assert.equal(calls.settle.length, 0);
  assert.equal(calls.release.length, 0);
  assert.equal(calls.reviewRequired.length, 0);
});

test('a job already released or refunded is left alone', async () => {
  for (const billingStatus of ['released', 'refunded']) {
    const { deps, calls } = harness({
      billingStatuses: { 'job-terminal': billingStatus },
      workspaceJobs: { 'job-terminal': { status: 'failed' } },
    });
    const result = await reconcileStrandedLiveJobs(deps);
    assert.equal(result.skipped, 1, `billingStatus=${billingStatus}`);
    assert.equal(calls.settle.length, 0);
    assert.equal(calls.release.length, 0);
  }
});

test('an anomalous settled-but-failed combination is escalated to review, never blindly refunded', async () => {
  const { deps, calls } = harness({
    billingStatuses: { 'job-anomaly': 'settled' },
    workspaceJobs: { 'job-anomaly': { status: 'failed' } },
  });
  await reconcileStrandedLiveJobs(deps);
  assert.equal(calls.reviewRequired.length, 1);
  assert.equal(calls.reviewRequired[0].reason, 'startup_reconciliation_state_mismatch');
  assert.equal(calls.settle.length, 0);
  assert.equal(calls.release.length, 0);
});

test('a job already settled with a matching completed workspace record is a clean no-op, not an anomaly', async () => {
  const { deps, calls } = harness({
    billingStatuses: { 'job-already-settled': 'settled' },
    workspaceJobs: { 'job-already-settled': { status: 'completed', hasValidOutput: true } },
  });
  const result = await reconcileStrandedLiveJobs(deps);
  assert.equal(result.skipped, 1);
  assert.equal(result.reconciled, 0);
  assert.equal(calls.settle.length, 0);
  assert.equal(calls.release.length, 0);
  assert.equal(calls.reviewRequired.length, 0, 'must never escalate an already-correctly-settled job');
});

test('IDEMPOTENCY: running the sweep twice on the same stranded job settles it once and is a no-op the second time', async () => {
  const billingStatuses = { 'job-1': 'reserved' };
  const workspaceJobs = { 'job-1': { status: 'completed', hasValidOutput: true } };
  const { deps, calls } = harness({ billingStatuses, workspaceJobs });
  // Simulate settle() actually transitioning Postgres state, the way the
  // real liveJobBilling.js implementation does in the same transaction.
  deps.settle = async jobId => {
    calls.settle.push({ jobId });
    billingStatuses[jobId] = 'settled';
    return { billingStatus: 'settled' };
  };
  const first = await reconcileStrandedLiveJobs(deps);
  assert.equal(first.reconciled, 1);
  assert.equal(calls.settle.length, 1);
  const second = await reconcileStrandedLiveJobs(deps);
  assert.equal(second.skipped, 1);
  assert.equal(second.reconciled, 0);
  assert.equal(calls.settle.length, 1, 'settle must not be called a second time');
});

test('a job missing from listStranded is never visited at all', async () => {
  const { deps, calls } = harness({ billingStatuses: {} });
  const result = await reconcileStrandedLiveJobs(deps);
  assert.deepEqual(result, { enabled: true, reconciled: 0, skipped: 0, total: 0 });
  assert.equal(calls.settle.length + calls.release.length + calls.reviewRequired.length, 0);
});

test('a single failure in one job does not stop reconciliation of the remaining stranded jobs', async () => {
  const { deps, calls } = harness({
    billingStatuses: { 'job-throws': 'reserved', 'job-ok': 'reserved' },
    workspaceJobs: { 'job-throws': { status: 'failed' }, 'job-ok': { status: 'failed' } },
  });
  const originalRelease = deps.release;
  deps.release = async (jobId, reason) => {
    if (jobId === 'job-throws') throw new Error('simulated transient failure');
    return originalRelease(jobId, reason);
  };
  const result = await reconcileStrandedLiveJobs(deps);
  assert.equal(result.skipped, 1);
  assert.equal(result.reconciled, 1);
  assert.equal(calls.release.length, 1);
  assert.equal(calls.release[0].jobId, 'job-ok');
});
