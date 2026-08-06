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
