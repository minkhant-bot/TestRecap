import { getBillingConfiguration } from '../config/billing.js';
import { withTransaction } from '../db/client.js';
import {
  auditLogsRepository,
  balancesRepository,
  billingRepository,
  jobsRepository,
  ledgerRepository,
  planAssignmentsRepository,
  plansRepository,
  reservationsRepository,
  usersRepository,
  workerLeasesRepository,
} from '../db/repositories/index.js';
import { BillingError, checkAndExpireTrial } from './billingFoundation.js';

const deps = {
  transaction: withTransaction,
  audit: auditLogsRepository,
  balances: balancesRepository,
  billing: billingRepository,
  jobs: jobsRepository,
  ledger: ledgerRepository,
  assignments: planAssignmentsRepository,
  plans: plansRepository,
  reservations: reservationsRepository,
  users: usersRepository,
  leases: workerLeasesRepository,
};

const fail = (message, code, status = 400) => {
  throw new BillingError(message, { code, status });
};

const enabled = env => getBillingConfiguration(env).liveJobBillingEnabled;

export const isLiveJobBillingEnabled = (env = process.env) => enabled(env);

const publicSnapshot = job => ({
  planCode: job.planCodeSnapshot,
  billingMode: job.billingMode,
  sourceDurationMs: String(job.sourceDurationMs),
  billingBlockSeconds: job.billingBlockSeconds,
  billingBlocks: String(job.billingBlocks),
  creditsPerBlock: String(job.creditsPerBlock),
  totalCredits: String(job.totalRequiredCredits),
  policyVersionId: job.pricingPolicyVersionId,
  policyVersion: job.pricingPolicySnapshot?.version,
  entitlements: job.entitlementSnapshot,
  billingStatus: job.billingStatus,
});

const ensureUser = (identity, client, repositories) => repositories.users.ensureUser({
  firebaseUid: identity.uid,
  email: identity.email || null,
  displayName: identity.displayName || '',
  photoUrl: identity.photoURL || '',
  status: 'active',
}, { client });

export const reserveLiveJob = async ({
  identity, jobId, sourceDurationSeconds, requestedPlanCode, requestedMode,
  idempotencyKey, effects,
}, { env = process.env, repositories = deps } = {}) => {
  if (!enabled(env)) fail('Live job billing is not activated.', 'LIVE_BILLING_NOT_ENABLED', 503);
  if (!identity?.uid) fail('Authentication required.', 'AUTHENTICATION_REQUIRED', 401);
  if (!String(idempotencyKey || '').trim()) fail('Idempotency-Key is required.', 'IDEMPOTENCY_KEY_REQUIRED');
  const seconds = Number(sourceDurationSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) fail('Authoritative source duration is invalid.', 'INVALID_DURATION', 422);
  const result = await repositories.transaction(async client => {
    const user = await ensureUser(identity, client, repositories);
    const existing = await repositories.jobs.findBillingJob(jobId, { client, forUpdate: true });
    if (existing) {
      if (existing.userId !== user.id || existing.idempotencyKey !== idempotencyKey ||
          existing.planCodeSnapshot !== requestedPlanCode ||
          existing.billingMode !== requestedMode ||
          existing.sourceDurationMs !== BigInt(Math.ceil(seconds * 1000))) {
        fail('Job reservation idempotency conflict.', 'IDEMPOTENCY_CONFLICT', 409);
      }
      if (existing.billingStatus !== 'reserved') {
        fail('The existing reservation is no longer active.', 'INVALID_BILLING_STATE', 409);
      }
      return { snapshot: publicSnapshot(existing), replayed: true };
    }
    const assignment = await repositories.assignments.findCurrentPlanAssignment(
      user.id, { client, forUpdate: true },
    );
    if (!assignment || assignment.planCode !== requestedPlanCode) {
      fail('Requested plan is not the active assigned plan.', 'PLAN_NOT_ASSIGNED', 422);
    }
    // Rule #2 (frozen): expiry blocks only new job creation, checked at the
    // one existing pre-admission checkpoint. A no-op for Pro (Pro never
    // expires) and a no-op once the user already moved past Trial.
    // The forfeiture inside checkAndExpireTrial must still be COMMITTED even
    // though this reservation attempt is ultimately denied — throwing here
    // would roll back the very forfeiture just written, so a sentinel is
    // returned instead and the failure is raised only after the transaction
    // (including the forfeiture) has committed, below.
    if (assignment.planCode === 'trial') {
      const expiry = await checkAndExpireTrial(user.id, { client, deps: repositories });
      if (expiry) return { trialExpired: true };
    }
    const plan = await repositories.plans.findPlanByCode(requestedPlanCode, { client });
    const policy = plan?.active
      ? await repositories.plans.findEffectivePlanPolicy(plan.id, new Date(), { client })
      : null;
    if (!policy) fail('Plan policy is unavailable.', 'PLAN_POLICY_UNAVAILABLE', 422);
    if (policy.billingMode !== requestedMode) {
      fail('Requested billing mode is not entitled.', 'BILLING_MODE_NOT_ENTITLED', 422);
    }
    const entitlements = await repositories.plans.listPlanEntitlements(policy.id, { client });
    const entitlementSnapshot = Object.fromEntries(entitlements.map(item => [item.key, {
      enabled: item.enabled,
      integerLimit: item.integerLimit === null ? null : String(item.integerLimit),
      textValue: item.textValue,
    }]));
    if ((effects?.blurEnabled && !entitlementSnapshot.blur?.enabled) ||
        (effects?.flipVideoEnabled && !entitlementSnapshot.flip?.enabled)) {
      fail('Selected effects are not entitled for this plan.', 'ENTITLEMENT_REQUIRED', 403);
    }
    const sourceDurationMs = BigInt(Math.ceil(seconds * 1000));
    const blocks = BigInt(Math.ceil(seconds / policy.billingBlockSeconds));
    const totalCredits = blocks * policy.creditsPerBlock;
    await repositories.balances.ensureBalanceAccountForUpdate(user.id, { client });
    const balance = await repositories.balances.reserveCredits(user.id, totalCredits, { client });
    if (!balance) fail('Available credits are insufficient.', 'INSUFFICIENT_CREDITS', 409);
    await repositories.jobs.insertBillingJob({
      id: jobId, userId: user.id, idempotencyKey,
    }, { client });
    const reservation = await repositories.reservations.insertReservation({
      userId: user.id, jobId, amount: totalCredits,
      idempotencyKey: `job:${jobId}:${idempotencyKey}`,
    }, { client });
    const job = await repositories.jobs.attachBillingSnapshot({
      id: jobId, planId: plan.id, planCode: plan.code, billingMode: policy.billingMode,
      sourceDurationMs, blocks, creditsPerBlock: policy.creditsPerBlock, totalCredits,
      policyId: policy.id,
      policySnapshot: {
        id: policy.id, version: policy.version,
        billingBlockSeconds: policy.billingBlockSeconds,
        creditsPerBlock: String(policy.creditsPerBlock),
        effectiveFrom: policy.effectiveFrom,
      },
      entitlementSnapshot, reservationId: reservation.id,
    }, { client });
    await repositories.audit.insertAuditLog({
      actorUserId: user.id, subjectUserId: user.id,
      eventType: 'job.credits_reserved', resourceType: 'job', resourceId: jobId,
      afterState: publicSnapshot(job),
    }, { client });
    return { snapshot: publicSnapshot(job), replayed: false };
  });
  if (result.trialExpired) fail('Trial expired. Purchase a package to continue.', 'TRIAL_EXPIRED', 403);
  return result;
};

const transitionReservation = async (jobId, action, reason, repositories) =>
  repositories.transaction(async client => {
    const job = await repositories.jobs.findBillingJob(jobId, { client, forUpdate: true });
    if (!job) return null;
    const reservation = await repositories.reservations.findReservationByJobId(
      jobId, { client, forUpdate: true },
    );
    if (!reservation) fail('Billing reservation is missing.', 'RESERVATION_MISSING', 409);
    await repositories.balances.ensureBalanceAccountForUpdate(job.userId, { client });
    if (action === 'settle') {
      if (reservation.status === 'settled') return publicSnapshot(job);
      if (reservation.status !== 'reserved') fail('Reservation cannot be settled.', 'INVALID_BILLING_STATE', 409);
      const balance = await repositories.balances.settleReservedCredits(
        job.userId, reservation.amount, { client },
      );
      if (!balance) fail('Balance projection is inconsistent.', 'BALANCE_INCONSISTENT', 409);
      await repositories.ledger.insertLedgerEntry({
        userId: job.userId, amount: -reservation.amount, entryType: 'settlement',
        reservationId: reservation.id, jobId, correlationKey: `job-settlement:${jobId}`,
        metadata: { outputValidated: true },
      }, { client });
      await repositories.reservations.updateReservationStatus({
        reservationId: reservation.id, status: 'settled', resolutionReason: reason,
      }, { client });
      await repositories.jobs.updateBillingJob(jobId, {
        billingStatus: 'settled', status: 'completed', stage: 'completed',
        progress: 100, finalized: true,
      }, { client });
    } else if (action === 'release') {
      if (reservation.status === 'released') return publicSnapshot(job);
      if (reservation.status !== 'reserved') fail('Reservation cannot be released.', 'INVALID_BILLING_STATE', 409);
      await repositories.balances.releaseReservedCredits(job.userId, reservation.amount, { client });
      await repositories.reservations.updateReservationStatus({
        reservationId: reservation.id, status: 'released', resolutionReason: reason,
      }, { client });
      await repositories.jobs.updateBillingJob(jobId, {
        billingStatus: 'released', finalized: true,
      }, { client });
    } else if (action === 'refund') {
      if (reservation.status === 'refunded') return publicSnapshot(job);
      if (reservation.status !== 'settled') fail('Only a settled job can be refunded.', 'INVALID_BILLING_STATE', 409);
      const settlement = (await repositories.ledger.listLedgerEntries(job.userId, {
        client, limit: 500,
      })).find(entry => entry.jobId === jobId && entry.entryType === 'settlement');
      if (!settlement) fail('Settlement ledger entry is missing.', 'LEDGER_INCONSISTENT', 409);
      await repositories.ledger.insertLedgerEntry({
        userId: job.userId, amount: reservation.amount, entryType: 'refund',
        reservationId: reservation.id, jobId, reversalOfEntryId: settlement.id,
        correlationKey: `job-refund:${jobId}`, reason,
      }, { client });
      await repositories.balances.addPostedCredits(job.userId, reservation.amount, { client });
      await repositories.reservations.updateReservationStatus({
        reservationId: reservation.id, status: 'refunded', resolutionReason: reason,
      }, { client });
      await repositories.jobs.updateBillingJob(jobId, {
        billingStatus: 'refunded', finalized: true,
      }, { client });
    }
    await repositories.audit.insertAuditLog({
      actorService: 'live_job_billing',
      subjectUserId: job.userId,
      eventType: `job.credits_${action === 'refund' ? 'refunded' : `${action}d`}`,
      resourceType: 'job', resourceId: jobId, afterState: { reason },
    }, { client });
    return publicSnapshot(await repositories.jobs.findBillingJob(jobId, { client }));
  });

export const settleLiveJob = (jobId, {
  outputValidated = false, reason = 'valid_usable_output',
} = {}, { repositories = deps } = {}) => {
  if (!outputValidated) fail('Usable output validation is required before settlement.', 'OUTPUT_NOT_VALIDATED', 409);
  return transitionReservation(jobId, 'settle', reason, repositories);
};

export const releaseLiveJob = (jobId, reason = 'no_valid_output', { repositories = deps } = {}) =>
  transitionReservation(jobId, 'release', reason, repositories);

export const refundLiveJob = (jobId, reason = 'qualifying_system_failure', { repositories = deps } = {}) =>
  transitionReservation(jobId, 'refund', reason, repositories);

export const handleLiveJobFailure = async (jobId, reason, { repositories = deps } = {}) => {
  const job = await repositories.jobs.findBillingJob(jobId);
  if (!job) return null;
  if (job.billingStatus === 'reserved') return releaseLiveJob(jobId, reason, { repositories });
  if (job.billingStatus === 'settled') return refundLiveJob(jobId, reason, { repositories });
  return publicSnapshot(job);
};

export const markPaidProviderStarted = (jobId, { repositories = deps } = {}) =>
  repositories.transaction(async client => {
    const job = await repositories.jobs.findBillingJob(jobId, { client, forUpdate: true });
    if (!job || job.billingStatus !== 'reserved') {
      fail('Paid work requires a committed reservation.', 'RESERVATION_REQUIRED', 409);
    }
    await repositories.jobs.updateBillingJob(jobId, {
      status: 'processing', stage: 'preparing', providerStarted: true,
    }, { client });
    return true;
  });

export const acquireLiveJobLease = (jobId, workerId, {
  ttlSeconds = 90, repositories = deps,
} = {}) => repositories.transaction(client =>
  repositories.leases.acquireLease({ jobId, workerId, ttlSeconds }, { client }));

export const heartbeatLiveJobLease = (lease, {
  ttlSeconds = 90, repositories = deps,
} = {}) => repositories.leases.heartbeatLease({ ...lease, ttlSeconds });

export const releaseLiveJobLease = (lease, { repositories = deps } = {}) =>
  repositories.leases.releaseLease(lease);

export const markLiveJobReviewRequired = (jobId, reason, { repositories = deps } = {}) =>
  repositories.transaction(async client => {
    const job = await repositories.jobs.findBillingJob(jobId, { client, forUpdate: true });
    const reservation = await repositories.reservations.findReservationByJobId(
      jobId, { client, forUpdate: true },
    );
    if (!job || !reservation || !['reserved', 'settled'].includes(reservation.status)) return null;
    await repositories.reservations.updateReservationStatus({
      reservationId: reservation.id, status: 'review_required',
      reviewOriginStatus: reservation.status, resolutionReason: reason,
    }, { client });
    await repositories.jobs.updateBillingJob(jobId, {
      billingStatus: 'review_required',
    }, { client });
    return true;
  });

export const listRecoverableLiveJobIds = ({ repositories = deps } = {}) =>
  repositories.jobs.listRecoverableBillingJobs();

export const getLiveJobBillingStatus = (jobId, { repositories = deps } = {}) =>
  repositories.jobs.findBillingJob(jobId);
