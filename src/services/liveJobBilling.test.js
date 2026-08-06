import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleLiveJobFailure,
  markLiveJobReviewRequired,
  reserveLiveJob,
  settleLiveJob,
} from './liveJobBilling.js';

const env = {
  P2_BILLING_ENABLED: 'true',
  P2_LIVE_JOB_BILLING_ENABLED: 'true',
  DATABASE_URL: 'postgres://unit-test',
};

const createHarness = ({
  balance = 20n, planCode = 'normal', mode = 'byok',
} = {}) => {
  const state = {
    user: { id: '00000000-0000-4000-8000-000000000001' },
    balance: { postedBalance: balance, reservedBalance: 0n },
    job: null,
    reservation: null,
    ledger: [],
    audit: [],
  };
  let lock = Promise.resolve();
  const transaction = work => {
    const result = lock.then(() => work({}));
    lock = result.catch(() => {});
    return result;
  };
  const mapJob = () => state.job && { ...state.job };
  const repositories = {
    transaction,
    users: {
      ensureUser: async () => state.user,
    },
    assignments: {
      findCurrentPlanAssignment: async () => ({
        userId: state.user.id, planId: 'plan-1', planCode,
      }),
    },
    plans: {
      findPlanByCode: async code => code === planCode
        ? { id: 'plan-1', code, active: true } : null,
      findEffectivePlanPolicy: async () => ({
        id: 'policy-1', version: 4, billingBlockSeconds: 30,
        creditsPerBlock: mode === 'blink_funded' ? 3n : 2n,
        billingMode: mode, effectiveFrom: new Date('2026-01-01'),
      }),
      listPlanEntitlements: async () => [
        { key: 'blur', enabled: mode === 'blink_funded', integerLimit: null, textValue: null },
        { key: 'flip', enabled: mode === 'blink_funded', integerLimit: null, textValue: null },
      ],
    },
    balances: {
      ensureBalanceAccountForUpdate: async () => state.balance,
      reserveCredits: async (_userId, amount) => {
        if (state.balance.postedBalance - state.balance.reservedBalance < amount) return null;
        state.balance.reservedBalance += amount;
        return state.balance;
      },
      releaseReservedCredits: async (_userId, amount) => {
        state.balance.reservedBalance -= amount;
        return state.balance;
      },
      settleReservedCredits: async (_userId, amount) => {
        state.balance.postedBalance -= amount;
        state.balance.reservedBalance -= amount;
        return state.balance;
      },
      addPostedCredits: async (_userId, amount) => {
        state.balance.postedBalance += amount;
        return state.balance;
      },
    },
    jobs: {
      findBillingJob: async () => mapJob(),
      insertBillingJob: async job => {
        state.job = {
          ...job, status: 'pending', stage: 'pending', progress: 0,
          billingStatus: 'not_reserved',
        };
        return state.job;
      },
      attachBillingSnapshot: async job => {
        state.job = {
          ...state.job,
          selectedPlanId: job.planId,
          planCodeSnapshot: job.planCode,
          billingMode: job.billingMode,
          sourceDurationMs: job.sourceDurationMs,
          billingBlockSeconds: 30,
          billingBlocks: job.blocks,
          creditsPerBlock: job.creditsPerBlock,
          totalRequiredCredits: job.totalCredits,
          pricingPolicyVersionId: job.policyId,
          pricingPolicySnapshot: job.policySnapshot,
          entitlementSnapshot: job.entitlementSnapshot,
          creditReservationId: job.reservationId,
          billingStatus: 'reserved',
        };
        return mapJob();
      },
      updateBillingJob: async (_jobId, update) => {
        Object.assign(state.job, {
          ...(update.billingStatus ? { billingStatus: update.billingStatus } : {}),
          ...(update.status ? { status: update.status } : {}),
        });
        return state.job;
      },
    },
    reservations: {
      insertReservation: async reservation => {
        state.reservation = {
          id: 'reservation-1', ...reservation, status: 'reserved',
        };
        return state.reservation;
      },
      findReservationByJobId: async () => state.reservation && { ...state.reservation },
      updateReservationStatus: async update => {
        state.reservation.status = update.status;
        return state.reservation;
      },
      reactivateReservation: async ({ amount, idempotencyKey }) => {
        if (!state.reservation || state.reservation.status !== 'released') return null;
        state.reservation = {
          ...state.reservation, amount, idempotencyKey, status: 'reserved',
        };
        return state.reservation;
      },
    },
    ledger: {
      insertLedgerEntry: async entry => {
        const stored = { id: `ledger-${state.ledger.length + 1}`, ...entry };
        state.ledger.push(stored);
        return stored;
      },
      listLedgerEntries: async () => [...state.ledger],
    },
    audit: {
      insertAuditLog: async entry => {
        state.audit.push(entry);
        return entry;
      },
    },
  };
  return { state, repositories };
};

const request = overrides => ({
  identity: { uid: 'firebase-user' },
  jobId: '10000000-0000-4000-8000-000000000001',
  sourceDurationSeconds: 61,
  requestedPlanCode: 'normal',
  requestedMode: 'byok',
  idempotencyKey: 'queue-1',
  effects: {},
  ...overrides,
});

test('reservation snapshots authoritative 30-second pricing before admission', async () => {
  const harness = createHarness();
  const result = await reserveLiveJob(request(), { env, repositories: harness.repositories });
  assert.equal(result.snapshot.billingBlocks, '3');
  assert.equal(result.snapshot.totalCredits, '6');
  assert.equal(harness.state.balance.reservedBalance, 6n);
  assert.equal(harness.state.job.pricingPolicySnapshot.version, 4);
});

test('insufficient credits leaves no job or reservation', async () => {
  const harness = createHarness({ balance: 5n });
  await assert.rejects(
    reserveLiveJob(request(), { env, repositories: harness.repositories }),
    error => error.code === 'INSUFFICIENT_CREDITS',
  );
  assert.equal(harness.state.job, null);
  assert.equal(harness.state.reservation, null);
});

test('concurrent duplicate reservation is idempotent and cannot overspend', async () => {
  const harness = createHarness({ balance: 6n });
  const results = await Promise.all([
    reserveLiveJob(request(), { env, repositories: harness.repositories }),
    reserveLiveJob(request(), { env, repositories: harness.repositories }),
  ]);
  assert.equal(results.filter(item => item.replayed).length, 1);
  assert.equal(harness.state.balance.reservedBalance, 6n);
});

test('a missing Idempotency-Key is still rejected before any reservation is made -- backend enforcement is unchanged', async () => {
  const harness = createHarness();
  await assert.rejects(
    reserveLiveJob(request({ idempotencyKey: '' }), { env, repositories: harness.repositories }),
    error => error.code === 'IDEMPOTENCY_KEY_REQUIRED',
  );
  assert.equal(harness.state.job, null);
  assert.equal(harness.state.balance.reservedBalance, 0n);
});

test('an active Trial user with sufficient credits starts successfully -- the server derives the plan from the assignment, no planCode sent', async () => {
  const harness = createHarness({ planCode: 'trial', mode: 'blink_funded', balance: 12n });
  harness.repositories.billing = { findTrialGrant: async () => null };
  const result = await reserveLiveJob(
    request({ requestedPlanCode: '', requestedMode: 'blink_funded', sourceDurationSeconds: 30 }),
    { env, repositories: harness.repositories },
  );
  assert.equal(result.replayed, false);
  assert.equal(result.snapshot.planCode, 'trial');
  assert.equal(result.snapshot.totalCredits, '3');
  assert.equal(harness.state.balance.reservedBalance, 3n);
});

test('an active Pro user starts successfully using their own assignment -- no planCode sent', async () => {
  const harness = createHarness({ planCode: 'pro', mode: 'blink_funded', balance: 12n });
  const result = await reserveLiveJob(
    request({ requestedPlanCode: '', requestedMode: 'blink_funded', sourceDurationSeconds: 30 }),
    { env, repositories: harness.repositories },
  );
  assert.equal(result.replayed, false);
  assert.equal(result.snapshot.planCode, 'pro');
  assert.equal(result.snapshot.totalCredits, '3');
  assert.equal(harness.state.balance.reservedBalance, 3n);
});

test('a stale or spoofed client-supplied plan cannot override the authoritative server assignment -- rejected as a genuine mismatch, no reservation made', async () => {
  const harness = createHarness({ planCode: 'pro', mode: 'blink_funded', balance: 12n });
  await assert.rejects(
    reserveLiveJob(
      request({ requestedPlanCode: 'trial', requestedMode: 'blink_funded' }),
      { env, repositories: harness.repositories },
    ),
    error => error.code === 'PLAN_NOT_ASSIGNED',
  );
  assert.equal(harness.state.job, null);
  assert.equal(harness.state.balance.reservedBalance, 0n);
});

test('no active plan assignment still returns a clear, stable error', async () => {
  const harness = createHarness({ planCode: 'pro', mode: 'blink_funded' });
  harness.repositories.assignments.findCurrentPlanAssignment = async () => null;
  await assert.rejects(
    reserveLiveJob(request({ requestedPlanCode: '' }), { env, repositories: harness.repositories }),
    error => error.code === 'PLAN_NOT_ASSIGNED' && error.message === 'No active plan is assigned.',
  );
});

test('an assignment change (e.g. Trial approved to Pro) is reflected on the very next reservation, with no manual refresh or caching', async () => {
  const state = {
    user: { id: '00000000-0000-4000-8000-000000000002' },
    balance: { postedBalance: 20n, reservedBalance: 0n },
    jobs: new Map(),
    reservations: new Map(),
  };
  let currentPlanCode = 'trial';
  const repositories = {
    transaction: work => work({}),
    users: { ensureUser: async () => state.user },
    assignments: {
      findCurrentPlanAssignment: async () => ({
        userId: state.user.id, planId: `plan-${currentPlanCode}`, planCode: currentPlanCode,
      }),
    },
    plans: {
      findPlanByCode: async code => ({ id: `plan-${code}`, code, active: true }),
      findEffectivePlanPolicy: async () => ({
        id: 'policy-1', version: 1, billingBlockSeconds: 30,
        creditsPerBlock: 3n, billingMode: 'blink_funded', effectiveFrom: new Date('2026-01-01'),
      }),
      listPlanEntitlements: async () => [
        { key: 'blur', enabled: true, integerLimit: null, textValue: null },
        { key: 'flip', enabled: true, integerLimit: null, textValue: null },
      ],
    },
    balances: {
      ensureBalanceAccountForUpdate: async () => state.balance,
      reserveCredits: async (_userId, amount) => {
        state.balance.reservedBalance += amount;
        return state.balance;
      },
    },
    jobs: {
      findBillingJob: async jobId => state.jobs.get(jobId) || null,
      insertBillingJob: async job => {
        const record = { ...job, status: 'pending', billingStatus: 'not_reserved' };
        state.jobs.set(job.id, record);
        return record;
      },
      attachBillingSnapshot: async job => {
        const record = {
          ...state.jobs.get(job.id), planCodeSnapshot: job.planCode,
          billingMode: job.billingMode, billingStatus: 'reserved',
        };
        state.jobs.set(job.id, record);
        return record;
      },
    },
    reservations: {
      insertReservation: async reservation => {
        const record = { id: `reservation-${reservation.jobId}`, ...reservation, status: 'reserved' };
        state.reservations.set(reservation.jobId, record);
        return record;
      },
    },
    ledger: { insertLedgerEntry: async entry => entry },
    audit: { insertAuditLog: async entry => entry },
    // Consulted by checkAndExpireTrial (Rule #2's expiry check) whenever the
    // current assignment is Trial; no grant on file means "not expired".
    billing: { findTrialGrant: async () => null },
  };

  const trialResult = await reserveLiveJob(request({
    identity: { uid: 'assignment-change-user' },
    jobId: '20000000-0000-4000-8000-000000000001',
    requestedPlanCode: '', requestedMode: 'blink_funded', idempotencyKey: 'assignment-change-1',
    sourceDurationSeconds: 30,
  }), { env, repositories });
  assert.equal(trialResult.snapshot.planCode, 'trial');

  // The user's Trial is approved to Pro server-side (e.g. via an Owner
  // purchase approval) -- no frontend refresh or new session, just the
  // next request.
  currentPlanCode = 'pro';

  const proResult = await reserveLiveJob(request({
    identity: { uid: 'assignment-change-user' },
    jobId: '20000000-0000-4000-8000-000000000002',
    requestedPlanCode: '', requestedMode: 'blink_funded', idempotencyKey: 'assignment-change-2',
    sourceDurationSeconds: 30,
  }), { env, repositories });
  assert.equal(proResult.snapshot.planCode, 'pro');
  assert.equal(state.balance.reservedBalance, 6n);
});

test('Trial with the current blink_funded policy starts successfully when the client sends no billingMode', async () => {
  const harness = createHarness({ planCode: 'trial', mode: 'blink_funded', balance: 12n });
  harness.repositories.billing = { findTrialGrant: async () => null };
  const result = await reserveLiveJob(
    request({ requestedPlanCode: '', requestedMode: '', sourceDurationSeconds: 30 }),
    { env, repositories: harness.repositories },
  );
  assert.equal(result.replayed, false);
  assert.equal(result.snapshot.planCode, 'trial');
  assert.equal(result.snapshot.billingMode, 'blink_funded');
});

test('Pro with the current blink_funded policy starts successfully when the client sends no billingMode', async () => {
  const harness = createHarness({ planCode: 'pro', mode: 'blink_funded', balance: 12n });
  const result = await reserveLiveJob(
    request({ requestedPlanCode: '', requestedMode: '', sourceDurationSeconds: 30 }),
    { env, repositories: harness.repositories },
  );
  assert.equal(result.replayed, false);
  assert.equal(result.snapshot.planCode, 'pro');
  assert.equal(result.snapshot.billingMode, 'blink_funded');
});

test('an absent client billingMode never triggers BILLING_MODE_NOT_ENTITLED, even against a legacy policy row the client cannot know about', async () => {
  // Simulates a plan whose stored policy predates the Trial/Pro
  // simplification -- production data the code must never assume has
  // already been migrated. The backend still uses whatever billingMode is
  // actually configured; it does not require the client to guess it.
  const harness = createHarness({ planCode: 'trial', mode: 'byok', balance: 12n });
  harness.repositories.billing = { findTrialGrant: async () => null };
  const result = await reserveLiveJob(
    request({ requestedPlanCode: '', requestedMode: '', sourceDurationSeconds: 30 }),
    { env, repositories: harness.repositories },
  );
  assert.equal(result.snapshot.billingMode, 'byok');
});

test('a stale BYOK billingMode sent by the client cannot override the server-derived assignment -- rejected as a genuine mismatch, no reservation made', async () => {
  const harness = createHarness({ planCode: 'trial', mode: 'blink_funded', balance: 12n });
  harness.repositories.billing = { findTrialGrant: async () => null };
  await assert.rejects(
    reserveLiveJob(
      request({ requestedPlanCode: '', requestedMode: 'byok', sourceDurationSeconds: 30 }),
      { env, repositories: harness.repositories },
    ),
    error => error.code === 'BILLING_MODE_NOT_ENTITLED',
  );
  assert.equal(harness.state.job, null);
  assert.equal(harness.state.balance.reservedBalance, 0n);
});

test('retrying the same attempt with no billingMode replays the existing reservation without conflict or duplication', async () => {
  const harness = createHarness({ planCode: 'pro', mode: 'blink_funded', balance: 12n });
  const first = await reserveLiveJob(
    request({ requestedPlanCode: '', requestedMode: '', idempotencyKey: 'replay-key-1', sourceDurationSeconds: 30 }),
    { env, repositories: harness.repositories },
  );
  assert.equal(first.replayed, false);
  const retry = await reserveLiveJob(
    request({ requestedPlanCode: '', requestedMode: '', idempotencyKey: 'replay-key-1', sourceDurationSeconds: 30 }),
    { env, repositories: harness.repositories },
  );
  assert.equal(retry.replayed, true);
  assert.equal(retry.snapshot.billingMode, 'blink_funded');
  assert.equal(harness.state.balance.reservedBalance, 3n);

  // A genuinely different attempt (new idempotency key) for the SAME job
  // while its reservation is still actively 'reserved' is a real conflict,
  // not a silent replay or duplicate reservation -- and not treated as a
  // retryable release either, since nothing was ever released.
  await assert.rejects(
    reserveLiveJob(
      request({ requestedPlanCode: '', requestedMode: '', idempotencyKey: 'replay-key-2', sourceDurationSeconds: 30 }),
      { env, repositories: harness.repositories },
    ),
    error => error.code === 'RESERVATION_ALREADY_FINALIZED',
  );
  assert.equal(harness.state.balance.reservedBalance, 3n);
});

test('a failed job\'s retry re-reserves exactly once by reopening the same reservation row, not creating a duplicate', async () => {
  const harness = createHarness({ planCode: 'pro', mode: 'blink_funded', balance: 12n });
  const first = await reserveLiveJob(
    request({ requestedPlanCode: '', requestedMode: '', idempotencyKey: 'attempt-1', sourceDurationSeconds: 30 }),
    { env, repositories: harness.repositories },
  );
  assert.equal(first.replayed, false);
  const originalReservationId = harness.state.reservation.id;

  // The job failed; the worker compensates by releasing the reservation
  // (mirrors handleLiveJobFailure, invoked from workspaceWorker.js).
  await handleLiveJobFailure(harness.state.job.id, 'no_valid_output', { repositories: harness.repositories });
  assert.equal(harness.state.reservation.status, 'released');
  assert.equal(harness.state.balance.reservedBalance, 0n);

  const retry = await reserveLiveJob(
    request({ requestedPlanCode: '', requestedMode: '', idempotencyKey: 'attempt-2', sourceDurationSeconds: 30 }),
    { env, repositories: harness.repositories },
  );
  assert.equal(retry.replayed, false);
  assert.equal(retry.snapshot.billingStatus, 'reserved');
  // Same reservation row, reactivated -- not a second, independent one.
  assert.equal(harness.state.reservation.id, originalReservationId);
  assert.equal(harness.state.reservation.status, 'reserved');
  assert.equal(harness.state.balance.reservedBalance, 3n);
});

test('re-reservation on retry still enforces insufficient credits and never reactivates a still-active or already-settled reservation', async () => {
  const lowBalanceHarness = createHarness({ planCode: 'pro', mode: 'blink_funded', balance: 3n });
  await reserveLiveJob(
    request({
      requestedPlanCode: '', requestedMode: '', idempotencyKey: 'attempt-1',
      sourceDurationSeconds: 30,
    }),
    { env, repositories: lowBalanceHarness.repositories },
  );
  await handleLiveJobFailure(lowBalanceHarness.state.job.id, 'no_valid_output', {
    repositories: lowBalanceHarness.repositories,
  });
  // Credits were returned by the release, but a longer retry duration now
  // requires more than is available.
  await assert.rejects(
    reserveLiveJob(
      request({
        requestedPlanCode: '', requestedMode: '', idempotencyKey: 'attempt-2',
        sourceDurationSeconds: 90,
      }),
      { env, repositories: lowBalanceHarness.repositories },
    ),
    error => error.code === 'INSUFFICIENT_CREDITS',
  );
  assert.equal(lowBalanceHarness.state.reservation.status, 'released');

  // A settled (already-completed) job's reservation must never be silently
  // reopened by a stray retry -- that would double-charge for a job that
  // already ran to completion once.
  const settledHarness = createHarness({ planCode: 'pro', mode: 'blink_funded', balance: 12n });
  await reserveLiveJob(
    request({ requestedPlanCode: '', requestedMode: '', idempotencyKey: 'attempt-1', sourceDurationSeconds: 30 }),
    { env, repositories: settledHarness.repositories },
  );
  await settleLiveJob(settledHarness.state.job.id, { outputValidated: true }, { repositories: settledHarness.repositories });
  await assert.rejects(
    reserveLiveJob(
      request({ requestedPlanCode: '', requestedMode: '', idempotencyKey: 'attempt-2', sourceDurationSeconds: 30 }),
      { env, repositories: settledHarness.repositories },
    ),
    error => error.code === 'RESERVATION_ALREADY_FINALIZED',
  );
});

test('retry success settles exactly once with no double debit', async () => {
  const harness = createHarness({ planCode: 'pro', mode: 'blink_funded', balance: 12n });
  await reserveLiveJob(
    request({ requestedPlanCode: '', requestedMode: '', idempotencyKey: 'attempt-1', sourceDurationSeconds: 30 }),
    { env, repositories: harness.repositories },
  );
  await handleLiveJobFailure(harness.state.job.id, 'no_valid_output', { repositories: harness.repositories });
  await reserveLiveJob(
    request({ requestedPlanCode: '', requestedMode: '', idempotencyKey: 'attempt-2', sourceDurationSeconds: 30 }),
    { env, repositories: harness.repositories },
  );

  await settleLiveJob(harness.state.job.id, { outputValidated: true }, { repositories: harness.repositories });
  assert.equal(harness.state.reservation.status, 'settled');
  assert.equal(harness.state.balance.postedBalance, 9n);
  assert.equal(harness.state.balance.reservedBalance, 0n);
  assert.equal(harness.state.ledger.filter(entry => entry.entryType === 'settlement').length, 1);

  // Settling again (e.g. a duplicated worker completion signal) must not
  // debit a second time.
  const replaySettlement = await settleLiveJob(harness.state.job.id, { outputValidated: true }, { repositories: harness.repositories });
  assert.equal(replaySettlement.billingStatus, 'settled');
  assert.equal(harness.state.balance.postedBalance, 9n);
  assert.equal(harness.state.ledger.filter(entry => entry.entryType === 'settlement').length, 1);
});

test('a repeated retry request (same Idempotency-Key) after reopening remains idempotent -- no second reservation or credit deduction', async () => {
  const harness = createHarness({ planCode: 'pro', mode: 'blink_funded', balance: 12n });
  await reserveLiveJob(
    request({ requestedPlanCode: '', requestedMode: '', idempotencyKey: 'attempt-1', sourceDurationSeconds: 30 }),
    { env, repositories: harness.repositories },
  );
  await handleLiveJobFailure(harness.state.job.id, 'no_valid_output', { repositories: harness.repositories });

  const retry = await reserveLiveJob(
    request({ requestedPlanCode: '', requestedMode: '', idempotencyKey: 'attempt-2', sourceDurationSeconds: 30 }),
    { env, repositories: harness.repositories },
  );
  assert.equal(retry.replayed, false);
  assert.equal(harness.state.balance.reservedBalance, 3n);

  // The client's own retry of the HTTP request (e.g. a network blip)
  // reusing the SAME retry key must replay, not reactivate/reserve again.
  const replay = await reserveLiveJob(
    request({ requestedPlanCode: '', requestedMode: '', idempotencyKey: 'attempt-2', sourceDurationSeconds: 30 }),
    { env, repositories: harness.repositories },
  );
  assert.equal(replay.replayed, true);
  assert.equal(harness.state.balance.reservedBalance, 3n);
});

test('plan and explicit mode cannot be switched automatically', async () => {
  const harness = createHarness();
  await assert.rejects(
    reserveLiveJob(request({ requestedMode: 'blink_funded' }), {
      env, repositories: harness.repositories,
    }),
    error => error.code === 'BILLING_MODE_NOT_ENTITLED',
  );
});

test('Pro-only effects are rejected for BYOK plans', async () => {
  const harness = createHarness();
  await assert.rejects(
    reserveLiveJob(request({ effects: { blurEnabled: true } }), {
      env, repositories: harness.repositories,
    }),
    error => error.code === 'ENTITLEMENT_REQUIRED',
  );
});

test('Rule #2: an expired Trial blocks a new reservation and forfeits remaining credits', async () => {
  const harness = createHarness({ planCode: 'trial', balance: 12n });
  harness.repositories.billing = {
    findTrialGrant: async () => ({
      id: 'grant-1', user_id: harness.state.user.id,
      expires_at: new Date(Date.now() - 1000), expired_at: null,
    }),
    markTrialGrantExpired: async () => ({ id: 'grant-1', expired_at: new Date() }),
  };
  harness.repositories.balances.ensureBalanceAccountForUpdate = async () => ({
    ...harness.state.balance,
    availableBalance: harness.state.balance.postedBalance - harness.state.balance.reservedBalance,
  });
  await assert.rejects(
    reserveLiveJob(request({ requestedPlanCode: 'trial' }), { env, repositories: harness.repositories }),
    error => error.code === 'TRIAL_EXPIRED',
  );
  assert.equal(harness.state.balance.postedBalance, 0n);
  assert.equal(harness.state.job, null);
  assert.equal(harness.state.audit.some(entry => entry.eventType === 'trial.expired'), true);
});

test('Rule #2: an active (non-expired) Trial reserves normally', async () => {
  const harness = createHarness({ planCode: 'trial', balance: 12n });
  harness.repositories.billing = {
    findTrialGrant: async () => ({
      id: 'grant-1', user_id: harness.state.user.id,
      expires_at: new Date(Date.now() + 1000 * 60 * 60), expired_at: null,
    }),
    markTrialGrantExpired: async () => null,
  };
  harness.repositories.balances.ensureBalanceAccountForUpdate = async () => ({
    ...harness.state.balance,
    availableBalance: harness.state.balance.postedBalance - harness.state.balance.reservedBalance,
  });
  const result = await reserveLiveJob(request({ requestedPlanCode: 'trial' }), {
    env, repositories: harness.repositories,
  });
  assert.equal(result.snapshot.planCode, 'trial');
});

test('validated success settles once with one debit', async () => {
  const harness = createHarness();
  await reserveLiveJob(request(), { env, repositories: harness.repositories });
  await settleLiveJob(request().jobId, { outputValidated: true }, {
    repositories: harness.repositories,
  });
  await settleLiveJob(request().jobId, { outputValidated: true }, {
    repositories: harness.repositories,
  });
  assert.equal(harness.state.balance.postedBalance, 14n);
  assert.equal(harness.state.balance.reservedBalance, 0n);
  assert.equal(harness.state.ledger.filter(item => item.entryType === 'settlement').length, 1);
});

test('failure before valid output releases without a debit', async () => {
  const harness = createHarness();
  await reserveLiveJob(request(), { env, repositories: harness.repositories });
  await handleLiveJobFailure(request().jobId, 'provider_failure', {
    repositories: harness.repositories,
  });
  assert.equal(harness.state.balance.postedBalance, 20n);
  assert.equal(harness.state.balance.reservedBalance, 0n);
  assert.equal(harness.state.ledger.length, 0);
});

test('qualifying post-settlement failure creates one full compensating refund', async () => {
  const harness = createHarness();
  await reserveLiveJob(request(), { env, repositories: harness.repositories });
  await settleLiveJob(request().jobId, { outputValidated: true }, {
    repositories: harness.repositories,
  });
  await handleLiveJobFailure(request().jobId, 'system_persistence_failure', {
    repositories: harness.repositories,
  });
  await handleLiveJobFailure(request().jobId, 'duplicate_failure_delivery', {
    repositories: harness.repositories,
  });
  assert.equal(harness.state.balance.postedBalance, 20n);
  assert.equal(harness.state.ledger.filter(item => item.entryType === 'refund').length, 1);
  assert.equal(harness.state.ledger.at(-1).reversalOfEntryId, 'ledger-1');
});

test('settlement refuses an unvalidated output fact', async () => {
  const harness = createHarness();
  await reserveLiveJob(request(), { env, repositories: harness.repositories });
  assert.throws(
    () => settleLiveJob(request().jobId, {}, { repositories: harness.repositories }),
    error => error.code === 'OUTPUT_NOT_VALIDATED',
  );
  assert.equal(harness.state.reservation.status, 'reserved');
});

test('review_required preserves the known origin only for an uncertain recovery', async () => {
  const harness = createHarness();
  await reserveLiveJob(request(), { env, repositories: harness.repositories });
  await markLiveJobReviewRequired(request().jobId, 'output_fact_uncertain', {
    repositories: harness.repositories,
  });
  assert.equal(harness.state.reservation.status, 'review_required');
  assert.equal(harness.state.job.billingStatus, 'review_required');
});
