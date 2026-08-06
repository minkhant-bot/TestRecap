import { createHash, randomUUID } from 'node:crypto';
import { getBillingConfiguration } from '../config/billing.js';
import { withTransaction } from '../db/client.js';
import {
  auditLogsRepository,
  balancesRepository,
  billingRepository,
  idempotencyKeysRepository,
  ledgerRepository,
  planAssignmentsRepository,
  plansRepository,
  rolesRepository,
  trialRequestsRepository,
  usersRepository,
} from '../db/repositories/index.js';
import { getFirebaseAdminAuth, toUserProfile } from './firebaseAdmin.js';

// Rule #2 (frozen): Trial is always exactly 12 credits (1 credit = 30s of
// uploaded/source video, existing block system unchanged) and always expires
// exactly 120 hours after Owner approval, whichever comes first with
// exhaustion. Fixed by product decision, not admin-configurable.
export const TRIAL_GRANT_CREDITS = 12n;
const TRIAL_DURATION_MS = 120 * 60 * 60 * 1000;
// 1 credit = one 30-second processing block (system-wide, backend-owned
// rate) => 12 credits = 360 seconds = 6 minutes of processing.
export const CREDITS_PER_BLOCK_DEFAULT = 1n;
export const TRIAL_GRANT_MINUTES = Number(TRIAL_GRANT_CREDITS * 30n) / 60;

// Rule #4 (frozen): Normal plan removed. Only Trial (request/approve only,
// never self-selected) and Pro (assigned automatically on purchase approval,
// never self-selected) remain.
const PLAN_CODES = new Set(['trial', 'pro']);
const ENTITLEMENT_KEYS = new Set([
  'blur', 'flip', 'byok_mode', 'blink_funded_mode',
  'active_job_limit', 'storage_limit_bytes', 'retention_hours',
]);

// Backend-owned plan defaults (new authoritative product rules supersede
// the former BYOK-Trial/Blink-funded-Pro split): the Owner configures only
// name/description/active from the UI. Every technical value below is
// fixed here and never accepted from client input -- Trial is no longer
// BYOK-only and gets every current recap feature, identically to Pro.
export const PLAN_POLICY_DEFAULTS = Object.freeze({
  creditsPerBlock: CREDITS_PER_BLOCK_DEFAULT,
  billingMode: 'blink_funded',
  // integerLimit/textValue are explicit here (not omitted) so this shape
  // matches what insertPlanPolicy expects verbatim -- omitting them relies
  // on repository-level normalization rather than documenting the intent.
  entitlements: Object.freeze([
    Object.freeze({ key: 'blur', enabled: true, integerLimit: null, textValue: null }),
    Object.freeze({ key: 'flip', enabled: true, integerLimit: null, textValue: null }),
    Object.freeze({ key: 'byok_mode', enabled: false, integerLimit: null, textValue: null }),
    Object.freeze({ key: 'blink_funded_mode', enabled: true, integerLimit: null, textValue: null }),
  ]),
});
const PLAN_DISPLAY_ORDER = Object.freeze({ trial: 0, pro: 1 });
const PURCHASE_STATES = new Set(['pending', 'approved', 'rejected']);
const TRIAL_DECISIONS = new Set(['eligible', 'ineligible', 'review_required']);
const PAYMENT_PROOF_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

export class BillingError extends Error {
  constructor(message, { code = 'BILLING_ERROR', status = 400 } = {}) {
    super(message);
    this.name = 'BillingError';
    this.code = code;
    this.status = status;
  }
}

const fail = (message, code, status = 400) => {
  throw new BillingError(message, { code, status });
};
const integer = (value, name, { min = 0 } = {}) => {
  let normalized;
  try {
    normalized = typeof value === 'bigint' ? value : BigInt(String(value));
  } catch {
    fail(`${name} must be an integer of at least ${min}.`, 'INVALID_INPUT');
  }
  if (normalized < BigInt(min)) fail(`${name} must be an integer of at least ${min}.`, 'INVALID_INPUT');
  return normalized;
};
const text = (value, name, { max = 500, optional = false } = {}) => {
  const normalized = String(value ?? '').trim();
  if (!normalized && !optional) fail(`${name} is required.`, 'INVALID_INPUT');
  if (normalized.length > max) fail(`${name} is too long.`, 'INVALID_INPUT');
  return normalized;
};
const displayOrder = value => {
  const normalized = Number(integer(value ?? 0, 'displayOrder'));
  if (!Number.isSafeInteger(normalized)) fail('displayOrder is too large.', 'INVALID_INPUT');
  return normalized;
};
const requireConfirmation = input => {
  if (input?.confirmed !== true) {
    fail('Package change confirmation is required.', 'CONFIRMATION_REQUIRED', 422);
  }
};
const currencyCode = value => {
  const normalized = text(value, 'currency', { max: 3 }).toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) fail('currency must be a three-letter code.', 'INVALID_INPUT');
  return normalized;
};
const packagePrice = input => integer(input?.price ?? input?.priceMinor, 'price', { min: 1 });
const isoDate = (value, name, { optional = false } = {}) => {
  if ((value === null || value === undefined || value === '') && optional) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) fail(`${name} must be a valid date.`, 'INVALID_INPUT');
  return date;
};
const publicJson = value => JSON.parse(JSON.stringify(value, (_, item) =>
  typeof item === 'bigint' ? item.toString() : item));
const canonicalize = value => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalize(value[key])]),
    );
  }
  return typeof value === 'bigint' ? value.toString() : value;
};
const stableHash = value => createHash('sha256')
  .update(JSON.stringify(canonicalize(value)))
  .digest('hex');

const dependencies = {
  transaction: withTransaction,
  audit: auditLogsRepository,
  balances: balancesRepository,
  billing: billingRepository,
  idempotency: idempotencyKeysRepository,
  ledger: ledgerRepository,
  assignments: planAssignmentsRepository,
  plans: plansRepository,
  roles: rolesRepository,
  users: usersRepository,
  trialRequests: trialRequestsRepository,
  // Firebase is the authoritative identity source; PostgreSQL's users row is
  // only ever created lazily (on someone's own first billing-touching
  // request). An admin acting on a target uid who hasn't done that yet must
  // still resolve to the real, stable Firebase identity -- never a
  // fabricated or unverified row.
  resolveFirebaseUser: async uid => {
    try {
      return toUserProfile(await getFirebaseAdminAuth().getUser(uid));
    } catch {
      return null;
    }
  },
};

// Synchronizes a Firebase-authoritative target uid into PostgreSQL on
// demand: reuses the existing row if this admin, or the target themself,
// already caused one to be created (ensureUser upserts by firebase_uid, so
// this never creates a duplicate); otherwise looks the uid up in Firebase
// and creates the row from that real profile. Returns null only when the
// uid does not exist in Firebase at all.
const ensureTargetUser = async (firebaseUid, { client, deps }) => {
  const existing = await deps.users.findUserByFirebaseUid(firebaseUid, { client });
  if (existing) return existing;
  const profile = await deps.resolveFirebaseUser(firebaseUid);
  if (!profile) return null;
  return deps.users.ensureUser({
    firebaseUid: profile.uid,
    email: profile.email || null,
    displayName: profile.displayName || '',
    photoUrl: profile.photoURL || '',
    status: profile.status === 'disabled' ? 'disabled' : 'active',
  }, { client });
};

const requireEnabled = (env = process.env) => {
  const configuration = getBillingConfiguration(env);
  if (!configuration.enabled) {
    fail('PostgreSQL billing foundation is not activated.', 'BILLING_NOT_ENABLED', 503);
  }
  return configuration;
};

const ensureActor = async (identity, { client = null, deps = dependencies } = {}) => {
  if (!identity?.uid) fail('Authentication required.', 'AUTHENTICATION_REQUIRED', 401);
  const user = await deps.users.ensureUser({
    firebaseUid: identity.uid,
    email: identity.email || null,
    displayName: identity.displayName || '',
    photoUrl: identity.photoURL || '',
    status: 'active',
  }, { client });
  if (user.status === 'disabled') {
    fail('PostgreSQL billing access is disabled for this user.', 'BILLING_USER_DISABLED', 403);
  }
  return { identity, user };
};

// Rule #6 (frozen): Owner authority source of truth is the Firebase
// super_admin claim (already present on `actor.identity.role`, set by
// requireAuth before this ever runs). PostgreSQL user_roles is kept in sync
// automatically as a side effect, purely for durable audit/query — it is
// never itself the authority. A stale/missing Postgres row never grants
// access, and a stale Postgres "super_admin" row never survives a mismatched
// Firebase claim on the next call (this function only ever syncs *up* to
// match the current claim; it does not attempt to demote other rows here —
// Firebase's own last-super-admin/self-lockout protections already keep
// exactly one live super_admin claim).
const requireSuperAdmin = async (actor, { client, deps = dependencies } = {}) => {
  if (actor.identity?.role !== 'super_admin') {
    fail('Owner (Super Admin) authority is required.', 'SUPER_ADMIN_REQUIRED', 403);
  }
  const before = await deps.roles.findRoleByUserId(actor.user.id, { client, forUpdate: true });
  if (before?.role === 'super_admin') return before;
  // 'manual' is the closest fit among the DB's fixed source enum
  // ('bootstrap' | 'manual' | 'migration') — the sync itself is recorded
  // precisely in the audit event below (afterState.source: 'firebase_sync').
  const synced = await deps.roles.assignRole({
    userId: actor.user.id, role: 'super_admin', source: 'manual', assignedByUserId: null,
  }, { client });
  await deps.audit.insertAuditLog({
    actorUserId: actor.user.id, subjectUserId: actor.user.id,
    eventType: 'owner.authority_synced', resourceType: 'user_role', resourceId: actor.user.id,
    beforeState: { role: before?.role || null },
    afterState: { role: 'super_admin', source: 'firebase_sync' },
  }, { client });
  return synced;
};

const idempotent = async ({
  actorScope, operation, idempotencyKey, request, resourceType, work,
}, { deps = dependencies } = {}) => {
  const key = text(idempotencyKey, 'Idempotency-Key', { max: 200 });
  const requestHash = stableHash(request);
  return deps.transaction(async client => {
    const record = await deps.idempotency.claimIdempotencyKey({
      actorScope, operation, idempotencyKey: key, requestHash,
    }, { client });
    if (record.request_hash !== requestHash) {
      fail('Idempotency-Key was already used with a different request.', 'IDEMPOTENCY_CONFLICT', 409);
    }
    if (record.state === 'completed') {
      return { replayed: true, status: record.response_status, body: record.response_body };
    }
    const result = await work(client);
    const body = publicJson(result.body);
    await deps.idempotency.completeIdempotencyKey({
      actorScope, operation, idempotencyKey: key,
      resourceType, resourceId: result.resourceId || null,
      responseStatus: result.status, responseBody: body,
    }, { client });
    return { replayed: false, status: result.status, body };
  });
};

const attachEntitlements = async (plans, deps = dependencies) => {
  const entitlements = await deps.billing.listEntitlementsForPolicies(
    plans.map(plan => plan.policy.id),
  );
  return plans.map(plan => ({
    ...plan,
    entitlements: Object.fromEntries(
      entitlements.filter(item => item.policyVersionId === plan.policy.id)
        .map(item => [item.key, {
          enabled: item.enabled,
          integerLimit: item.integerLimit,
          textValue: item.textValue,
        }]),
    ),
  }));
};

export const listPlans = async (identity, { env = process.env, deps = dependencies } = {}) => {
  requireEnabled(env);
  await ensureActor(identity, { deps });
  return attachEntitlements(await deps.billing.listActivePlans(), deps);
};

export const getMyPlan = async (identity, { env = process.env, deps = dependencies } = {}) => {
  requireEnabled(env);
  const actor = await ensureActor(identity, { deps });
  return deps.assignments.findCurrentPlanAssignment(actor.user.id);
};

// Rule #4 (frozen): self-service plan selection is removed entirely. Pro is
// assigned only as an automatic side effect of an approved purchase (see
// reviewPurchase); Trial is granted only via the request/approve flow (see
// requestTrial/approveTrialRequest). This endpoint is kept only so existing
// callers get a clear, permanent rejection instead of a 404.
export const selectPlan = async (identity, input, {
  env = process.env, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  await ensureActor(identity, { deps });
  fail(
    'Self-service plan selection is no longer supported. Request a Trial or purchase a package to activate Pro.',
    'PLAN_SELF_SELECTION_REMOVED',
    410,
  );
};

export const getTrialEligibility = async (identity, {
  env = process.env, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  const actor = await ensureActor(identity, { deps });
  const [assessment, grant, trial] = await Promise.all([
    deps.billing.findLatestTrialAssessment(actor.user.id),
    deps.billing.findTrialGrant(actor.user.id),
    deps.plans.findPlanByCode('trial'),
  ]);
  const policy = trial?.active
    ? await deps.plans.findEffectivePlanPolicy(trial.id)
    : null;
  return {
    decision: assessment?.decision || 'review_required',
    riskReasons: assessment?.risk_reasons || [],
    alreadyGranted: Boolean(grant),
    allowanceCredits: policy?.trialAllowanceCredits ?? null,
  };
};

export const grantTrial = async (identity, input = {}, {
  env = process.env, idempotencyKey, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  return idempotent({
    actorScope: `firebase:${identity.uid}`,
    operation: 'trial.grant',
    idempotencyKey,
    request: {},
    resourceType: 'trial_grant',
    work: async client => {
      const actor = await ensureActor(identity, { client, deps });
      await deps.balances.ensureBalanceAccountForUpdate(actor.user.id, { client });
      const existing = await deps.billing.findTrialGrant(actor.user.id, { client });
      if (existing) return { status: 200, resourceId: existing.id, body: { grant: existing } };
      const assessment = await deps.billing.findLatestTrialAssessment(
        actor.user.id, { client, forUpdate: true },
      );
      if (assessment?.decision !== 'eligible') fail('Trial is not currently eligible.', 'TRIAL_NOT_ELIGIBLE', 403);
      const plan = await deps.plans.findPlanByCode('trial', { client });
      const policy = plan?.active
        ? await deps.plans.findEffectivePlanPolicy(plan.id, new Date(), { client })
        : null;
      if (!policy || policy.billingMode !== 'blink_funded' || policy.trialAllowanceCredits <= 0n) {
        fail('Trial policy is unavailable.', 'TRIAL_POLICY_UNAVAILABLE', 422);
      }
      const ledger = await deps.ledger.insertLedgerEntry({
        userId: actor.user.id,
        amount: policy.trialAllowanceCredits,
        entryType: 'trial_grant',
        correlationKey: `trial:${actor.user.id}`,
        metadata: { policyVersionId: policy.id },
      }, { client });
      const balance = await deps.balances.addPostedCredits(
        actor.user.id, policy.trialAllowanceCredits, { client },
      );
      const grant = await deps.billing.insertTrialGrant({
        userId: actor.user.id,
        assessmentId: assessment.id,
        creditAmount: policy.trialAllowanceCredits,
        policyVersionId: policy.id,
        ledgerEntryId: ledger.id,
        idempotencyKey,
      }, { client });
      const assignment = await deps.billing.replaceCurrentAssignment({
        userId: actor.user.id, planId: plan.id, source: 'trial',
      }, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id,
        subjectUserId: actor.user.id,
        eventType: 'trial.granted',
        resourceType: 'trial_grant',
        resourceId: grant.id,
        afterState: { creditAmount: String(policy.trialAllowanceCredits) },
      }, { client });
      return { status: 201, resourceId: grant.id, body: { grant, balance, assignment } };
    },
  }, { deps });
};

// Rule #1 (frozen): Guest taps "Request Trial" -> pending request -> Owner
// approves -> one-time Trial. No eligibility questionnaire, no application
// form, no risk-scoring. Idempotent: replays the existing request rather
// than erroring on a second call.
export const requestTrial = async (identity, {
  env = process.env, idempotencyKey, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  return idempotent({
    actorScope: `firebase:${identity.uid}`,
    operation: 'trial.request',
    idempotencyKey,
    request: {},
    resourceType: 'trial_request',
    work: async client => {
      const actor = await ensureActor(identity, { client, deps });
      const grant = await deps.billing.findTrialGrant(actor.user.id, { client });
      if (grant) fail('Trial was already granted once and cannot be requested again.', 'TRIAL_ALREADY_GRANTED', 409);
      const existing = await deps.trialRequests.findTrialRequestByUserId(actor.user.id, { client });
      if (existing) return { status: 200, resourceId: existing.id, body: { request: existing } };
      const request = await deps.trialRequests.insertTrialRequest({ userId: actor.user.id }, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, subjectUserId: actor.user.id,
        eventType: 'trial.requested', resourceType: 'trial_request', resourceId: request.id,
        afterState: { status: 'pending' },
      }, { client });
      return { status: 201, resourceId: request.id, body: { request } };
    },
  }, { deps });
};

export const getMyTrialRequest = async (identity, {
  env = process.env, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  const actor = await ensureActor(identity, { deps });
  return deps.trialRequests.findTrialRequestByUserId(actor.user.id);
};

export const listTrialRequests = async (identity, {
  env = process.env, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  return deps.transaction(async client => {
    const actor = await ensureActor(identity, { client, deps });
    await requireSuperAdmin(actor, { client, deps });
    return deps.trialRequests.listPendingTrialRequests({ client });
  });
};

// Rule #1/#2 (frozen): Owner approval grants exactly once, 12 credits,
// expiring 120 hours from now. A 'trial' plan + effective policy must
// already be configured (same requirement the live job-billing reservation
// path already has) so the granted plan can actually be used once billing
// goes live; the allowance amount itself is fixed by product decision, not
// read from that policy.
export const approveTrialRequest = async (identity, id, {
  env = process.env, idempotencyKey, deps = dependencies,
} = {}) => withSuperAdminMutation(identity, {
  env, idempotencyKey, operation: 'trial.request.approve', request: { id },
  resourceType: 'trial_request', deps,
  work: async (client, actor) => {
    const request = await deps.trialRequests.findTrialRequestById(id, { client, forUpdate: true });
    if (!request) fail('Trial request not found.', 'NOT_FOUND', 404);
    if (request.status !== 'pending') fail('Trial request is already reviewed.', 'INVALID_STATE', 409);
    const existingGrant = await deps.billing.findTrialGrant(request.userId, { client });
    if (existingGrant) fail('Trial was already granted once and cannot be granted again.', 'TRIAL_ALREADY_GRANTED', 409);
    const plan = await deps.plans.findPlanByCode('trial', { client });
    if (!plan?.active) fail('Trial plan is not configured.', 'PLAN_UNAVAILABLE', 422);
    const policy = await deps.plans.findEffectivePlanPolicy(plan.id, new Date(), { client });
    if (!policy) fail('Trial plan has no effective policy.', 'TRIAL_POLICY_UNAVAILABLE', 422);
    await deps.balances.ensureBalanceAccountForUpdate(request.userId, { client });
    const expiresAt = new Date(Date.now() + TRIAL_DURATION_MS);
    const ledger = await deps.ledger.insertLedgerEntry({
      userId: request.userId,
      amount: TRIAL_GRANT_CREDITS,
      entryType: 'trial_grant',
      correlationKey: `trial:${request.userId}`,
      createdByUserId: actor.user.id,
      metadata: { policyVersionId: policy.id, source: 'trial_request' },
    }, { client });
    const balance = await deps.balances.addPostedCredits(request.userId, TRIAL_GRANT_CREDITS, { client });
    const grant = await deps.billing.insertTrialGrant({
      userId: request.userId,
      assessmentId: null,
      creditAmount: TRIAL_GRANT_CREDITS,
      policyVersionId: policy.id,
      ledgerEntryId: ledger.id,
      idempotencyKey,
      expiresAt,
    }, { client });
    const assignment = await deps.billing.replaceCurrentAssignment({
      userId: request.userId, planId: plan.id, source: 'trial',
    }, { client });
    const approvedRequest = await deps.trialRequests.approveTrialRequest({
      id, reviewerId: actor.user.id,
    }, { client });
    await deps.audit.insertAuditLog({
      actorUserId: actor.user.id, subjectUserId: request.userId,
      eventType: 'trial.approved', resourceType: 'trial_grant', resourceId: grant.id,
      afterState: { creditAmount: String(TRIAL_GRANT_CREDITS), expiresAt: expiresAt.toISOString() },
    }, { client });
    return {
      status: 201, resourceId: grant.id,
      body: { request: approvedRequest, grant, balance, assignment },
    };
  },
});

// Rule #2 (frozen): Trial expires exactly 120 hours after grant even if
// credits remain; any remaining balance is permanently forfeited with a
// durable, distinctly-labeled audit record. Expiry blocks only NEW job
// creation — jobs already running are unaffected, which is naturally true
// here since this only runs at the reservation checkpoint (before a new job
// is admitted), never mid-processing. A no-op once the user has moved on to
// Pro (Pro never expires and is unaffected by a Trial that already ended).
export const checkAndExpireTrial = async (userId, { client, deps = dependencies }) => {
  const grant = await deps.billing.findTrialGrant(userId, { client, forUpdate: true });
  if (!grant || grant.expired_at || !grant.expires_at) return null;
  if (new Date(grant.expires_at).getTime() > Date.now()) return null;
  const marked = await deps.billing.markTrialGrantExpired(userId, { client });
  if (!marked) return null;
  const balance = await deps.balances.ensureBalanceAccountForUpdate(userId, { client });
  if (balance.availableBalance > 0n) {
    await deps.ledger.insertLedgerEntry({
      userId,
      amount: -balance.availableBalance,
      entryType: 'manual_deduction',
      correlationKey: `trial-expired:${userId}`,
      reason: 'Trial expired 120 hours after grant; remaining credits forfeited automatically.',
      createdByUserId: userId,
      metadata: { system: true, trigger: 'trial_expiry' },
    }, { client });
    await deps.balances.addPostedCredits(userId, -balance.availableBalance, { client });
  }
  await deps.audit.insertAuditLog({
    actorService: 'trial_lifecycle', subjectUserId: userId,
    eventType: 'trial.expired', resourceType: 'trial_grant', resourceId: grant.id,
    afterState: { forfeitedCredits: String(balance.availableBalance) },
  }, { client });
  return { forfeitedCredits: balance.availableBalance };
};

export const getBalance = async (identity, {
  env = process.env, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  const actor = await ensureActor(identity, { deps });
  return (await deps.balances.findBalanceAccount(actor.user.id)) || {
    userId: actor.user.id, postedBalance: 0n, reservedBalance: 0n,
    availableBalance: 0n, version: 1,
  };
};

export const getLedger = async (identity, {
  env = process.env, limit = 100, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  const actor = await ensureActor(identity, { deps });
  return deps.ledger.listLedgerEntries(actor.user.id, {
    limit: Math.min(Math.max(Number(limit) || 100, 1), 100),
  });
};

export const estimateCredits = async (identity, input, {
  env = process.env, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  const actor = await ensureActor(identity, { deps });
  const planCode = text(input?.planCode, 'planCode', { max: 20 });
  const requestedMode = text(input?.billingMode, 'billingMode', { max: 30 });
  const duration = Number(input?.sourceDurationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) fail('sourceDurationSeconds must be positive.', 'INVALID_DURATION');
  const plan = await deps.plans.findPlanByCode(planCode);
  const policy = plan?.active ? await deps.plans.findEffectivePlanPolicy(plan.id) : null;
  if (!policy) fail('Plan policy is unavailable.', 'PLAN_POLICY_UNAVAILABLE', 422);
  if (requestedMode !== policy.billingMode) fail('Requested billing mode is not entitled.', 'BILLING_MODE_NOT_ENTITLED', 422);
  const blocks = BigInt(Math.ceil(duration / 30));
  const requiredCredits = blocks * policy.creditsPerBlock;
  const balance = await deps.balances.findBalanceAccount(actor.user.id);
  const reasons = [];
  if (requestedMode === 'blink_funded' && planCode !== 'pro') reasons.push('PRO_REQUIRED');
  if (requestedMode === 'blink_funded' && !String(env.GEMINI_API_KEY || '').trim()) {
    reasons.push('PLATFORM_PROVIDER_UNAVAILABLE');
  }
  if ((balance?.availableBalance || 0n) < requiredCredits) reasons.push('INSUFFICIENT_CREDITS');
  return {
    authoritative: false,
    sourceDurationSeconds: duration,
    billingBlockSeconds: 30,
    billingBlocks: blocks,
    creditsPerBlock: policy.creditsPerBlock,
    requiredCredits,
    policyVersionId: policy.id,
    planCode,
    billingMode: requestedMode,
    eligible: reasons.length === 0,
    reasons,
  };
};

// Credit gate: a user with insufficient available credits must never reach
// job creation/queueing (see workspace.js's use of this before
// createWorkspaceJob/queueWorkspaceJob). Read-only -- reserves nothing, so
// it is safe to call for a preflight check as well as at queue time.
// Falls back to the backend-owned default rate (1 credit/30s block, see
// PLAN_POLICY_DEFAULTS) for a user with no active plan/policy yet, so an
// unassigned user is still correctly gated rather than treated as free.
export const checkCreditSufficiency = async (identity, { sourceDurationSeconds }, {
  env = process.env, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  const actor = await ensureActor(identity, { deps });
  const seconds = Number(sourceDurationSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) fail('sourceDurationSeconds must be positive.', 'INVALID_DURATION');
  const assignment = await deps.assignments.findCurrentPlanAssignment(actor.user.id);
  const policy = assignment
    ? await deps.plans.findEffectivePlanPolicy(assignment.planId)
    : null;
  const creditsPerBlock = policy?.creditsPerBlock ?? PLAN_POLICY_DEFAULTS.creditsPerBlock;
  const blocks = BigInt(Math.ceil(seconds / 30));
  const requiredCredits = blocks * creditsPerBlock;
  const balance = await deps.balances.findBalanceAccount(actor.user.id);
  const availableCredits = balance?.availableBalance ?? 0n;
  return {
    sufficient: availableCredits >= requiredCredits,
    requiredCredits, availableCredits,
  };
};

export const listCreditPackages = async (identity, {
  env = process.env, currency = null, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  await ensureActor(identity, { deps });
  return deps.billing.listCreditPlans({ currency: currency ? String(currency).toUpperCase() : null });
};

export const listPackageBanks = async (identity, creditPlanId, {
  env = process.env, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  await ensureActor(identity, { deps });
  return deps.billing.listBanksForCreditPlan(creditPlanId);
};

export const createScreenshotIntent = async (identity, input, {
  env = process.env, idempotencyKey, deps = dependencies,
} = {}) => {
  const configuration = requireEnabled(env);
  if (!configuration.screenshotStorageConfigured) {
    fail('Private screenshot object storage is not configured.', 'SCREENSHOT_STORAGE_UNAVAILABLE', 503);
  }
  const originalFilename = text(input?.originalFilename, 'originalFilename', { max: 255 });
  const mimeType = text(input?.mimeType, 'mimeType', { max: 100 });
  const sizeBytes = integer(input?.sizeBytes, 'sizeBytes', { min: 1 });
  const sha256 = text(input?.sha256, 'sha256', { max: 64 }).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) fail('sha256 must be lowercase hexadecimal.', 'INVALID_INPUT');
  if (!configuration.paymentProofMimeTypes.includes(mimeType)) {
    fail('Payment proof must be a JPEG, PNG, or WebP image.', 'PROOF_TYPE_UNSUPPORTED', 415);
  }
  if (sizeBytes > BigInt(configuration.paymentProofMaxBytes)) {
    fail('Payment proof exceeds the configured size limit.', 'PROOF_TOO_LARGE', 413);
  }
  return idempotent({
    actorScope: `firebase:${identity.uid}`,
    operation: 'screenshot.intent',
    idempotencyKey,
    request: { originalFilename, mimeType, sizeBytes, sha256 },
    resourceType: 'uploaded_file',
    work: async client => {
      const actor = await ensureActor(identity, { client, deps });
      const id = randomUUID();
      const now = new Date();
      const extension = PAYMENT_PROOF_EXTENSIONS.get(mimeType);
      const objectKey = `payment-proofs/${actor.user.id}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.${extension}`;
      const file = await deps.billing.insertScreenshotMetadata({
        id, userId: actor.user.id, storageProvider: configuration.storageProvider,
        bucket: configuration.storageBucket, objectKey, originalFilename, mimeType,
        sizeBytes, sha256,
      }, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id,
        eventType: 'payment_screenshot.intent.created',
        resourceType: 'uploaded_file',
        resourceId: id,
        metadata: { storageProvider: configuration.storageProvider, mimeType, sizeBytes: String(sizeBytes) },
      }, { client });
      return {
        status: 201,
        resourceId: id,
        body: {
          id, status: file.status, objectKey,
          storageProvider: configuration.storageProvider,
          bucket: configuration.storageBucket,
          uploadUrl: null,
        },
      };
    },
  }, { deps });
};

export const completeScreenshotUpload = async (identity, id, input, {
  env = process.env, idempotencyKey, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  const request = {
    id: text(id, 'screenshot id', { max: 50 }),
    mimeType: text(input?.mimeType, 'mimeType', { max: 100 }),
    sizeBytes: integer(input?.sizeBytes, 'sizeBytes', { min: 1 }),
    sha256: text(input?.sha256, 'sha256', { max: 64 }).toLowerCase(),
  };
  return idempotent({
    actorScope: `firebase:${identity.uid}`,
    operation: 'screenshot.upload.complete',
    idempotencyKey,
    request,
    resourceType: 'uploaded_file',
    work: async client => {
      const actor = await ensureActor(identity, { client, deps });
      const current = await deps.billing.findScreenshotMetadata(request.id, { client, forUpdate: true });
      if (!current || current.owner_user_id !== actor.user.id) {
        fail('Payment proof not found.', 'NOT_FOUND', 404);
      }
      if (current.status !== 'pending') {
        fail('Payment proof upload is already complete or unavailable.', 'PROOF_ALREADY_COMPLETED', 409);
      }
      if (current.mime_type !== request.mimeType ||
          bigint(current.size_bytes) !== request.sizeBytes ||
          current.sha256 !== request.sha256) {
        fail('Stored proof metadata does not match the validated upload.', 'PROOF_METADATA_MISMATCH', 409);
      }
      const file = await deps.billing.verifyScreenshotMetadata(request.id, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id,
        eventType: 'payment_screenshot.upload.completed',
        resourceType: 'uploaded_file',
        resourceId: request.id,
        beforeState: { status: 'pending' },
        afterState: { status: 'verified', mimeType: request.mimeType, sizeBytes: String(request.sizeBytes) },
      }, { client });
      return { status: 200, resourceId: request.id, body: { file } };
    },
  }, { deps });
};

export const submitPurchase = async (identity, input, {
  env = process.env, idempotencyKey, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  const request = {
    creditPlanId: text(input?.creditPlanId, 'creditPlanId', { max: 50 }),
    bankAccountId: text(input?.bankAccountId, 'bankAccountId', { max: 50 }),
    screenshotFileId: text(input?.screenshotFileId, 'screenshotFileId', { max: 50 }),
  };
  return idempotent({
    actorScope: `firebase:${identity.uid}`,
    operation: 'purchase.submit',
    idempotencyKey,
    request,
    resourceType: 'credit_purchase_request',
    work: async client => {
      const actor = await ensureActor(identity, { client, deps });
      const file = await deps.billing.findScreenshotMetadata(
        request.screenshotFileId, { client, forUpdate: true },
      );
      if (!file || file.owner_user_id !== actor.user.id || file.status !== 'verified') {
        fail('A verified owned screenshot metadata record is required.', 'SCREENSHOT_NOT_VERIFIED', 422);
      }
      const catalog = await deps.billing.findCreditPlanAndBank(
        request.creditPlanId, request.bankAccountId, { client, forUpdate: true },
      );
      if (!catalog) fail('Credit package and bank account are unavailable.', 'PURCHASE_OPTION_UNAVAILABLE', 422);
      const promotion = await deps.billing.findEffectivePromotion(new Date(), { client });
      const purchase = await deps.billing.insertPurchase({
        userId: actor.user.id,
        creditPlanId: catalog.id,
        bankAccountId: catalog.bank_id,
        screenshotFileId: file.id,
        planCode: catalog.code,
        planName: catalog.name,
        credits: bigint(catalog.credit_amount),
        packageBonusCredits: bigint(catalog.bonus_credits ?? 0),
        priceMinor: bigint(catalog.price_minor),
        currency: catalog.currency,
        bankSnapshot: {
          code: catalog.bank_code, bankName: catalog.bank_name,
          accountName: catalog.account_name, accountNumber: catalog.account_number,
          branch: catalog.branch, instructions: catalog.bank_instructions,
          currency: catalog.bank_currency,
        },
        bonusPolicySnapshot: promotion ? {
          id: promotion.id, code: promotion.code, version: String(promotion.version),
          bonusCredits: String(promotion.bonus_credits),
        } : null,
      }, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id,
        eventType: 'credit_purchase.submitted',
        resourceType: 'credit_purchase_request',
        resourceId: purchase.id,
        afterState: { status: 'pending' },
      }, { client });
      return { status: 201, resourceId: purchase.id, body: { purchase } };
    },
  }, { deps });
};

const bigint = value => BigInt(String(value));

export const listMyPurchases = async (identity, {
  env = process.env, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  const actor = await ensureActor(identity, { deps });
  return deps.billing.listPurchases({ userId: actor.user.id });
};

export const getMyPurchase = async (identity, id, {
  env = process.env, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  const actor = await ensureActor(identity, { deps });
  const purchase = await deps.billing.findPurchase(id);
  if (!purchase || purchase.userId !== actor.user.id) fail('Purchase not found.', 'NOT_FOUND', 404);
  return purchase;
};

export const getMyScreenshotMetadata = async (identity, id, {
  env = process.env, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  const actor = await ensureActor(identity, { deps });
  const file = await deps.billing.findScreenshotMetadata(id);
  if (!file || file.owner_user_id !== actor.user.id) {
    fail('Payment proof not found.', 'NOT_FOUND', 404);
  }
  return {
    id: file.id,
    ownerUserId: file.owner_user_id,
    objectKey: file.object_key,
    originalFilename: file.original_filename,
    mimeType: file.mime_type,
    sizeBytes: bigint(file.size_bytes),
    sha256: file.sha256,
    status: file.status,
    uploadedAt: file.uploaded_at,
    verifiedAt: file.verified_at,
  };
};

const withSuperAdminMutation = async (identity, {
  env, idempotencyKey, operation, request, resourceType, work, deps,
}) => {
  requireEnabled(env);
  return idempotent({
    actorScope: `firebase:${identity.uid}`,
    operation,
    idempotencyKey,
    request,
    resourceType,
    work: async client => {
      const actor = await ensureActor(identity, { client, deps });
      await requireSuperAdmin(actor, { client, deps });
      return work(client, actor);
    },
  }, { deps });
};

export const reviewPurchase = async (identity, id, input, {
  env = process.env, idempotencyKey, deps = dependencies,
} = {}) => {
  const decision = text(input?.decision, 'decision', { max: 20 });
  if (!['approved', 'rejected'].includes(decision)) fail('decision must be approved or rejected.', 'INVALID_STATE');
  const reason = decision === 'rejected'
    ? text(input?.reason, 'reason', { max: 1000 })
    : null;
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: `purchase.${decision}`,
    request: { id, decision, reason }, resourceType: 'credit_purchase_request', deps,
    work: async (client, actor) => {
      const purchase = await deps.billing.findPurchase(id, { client, forUpdate: true });
      if (!purchase) fail('Purchase not found.', 'NOT_FOUND', 404);
      if (!PURCHASE_STATES.has(purchase.status) || purchase.status !== 'pending') {
        fail('Purchase is already terminal.', 'INVALID_PURCHASE_STATE', 409);
      }
      if (decision === 'rejected') {
        const rejected = await deps.billing.rejectPurchase({
          id, reviewerId: actor.user.id, reason,
        }, { client });
        await deps.audit.insertAuditLog({
          actorUserId: actor.user.id, subjectUserId: purchase.userId,
          eventType: 'credit_purchase.rejected', resourceType: 'credit_purchase_request',
          resourceId: id, beforeState: { status: 'pending' },
          afterState: { status: 'rejected', reason },
        }, { client });
        return { status: 200, resourceId: id, body: { purchase: rejected } };
      }
      await deps.balances.ensureBalanceAccountForUpdate(purchase.userId, { client });
      // The package's own configured bonus_credits (Super Admin package
      // management, migration 0002) is distinct from the unrelated one-time
      // first-purchase promotion bonus below. Both are granted as part of
      // this single approval, atomically, but the package bonus is folded
      // into the one 'purchase' ledger entry (base + package bonus) so the
      // balance and every display reflect one consistent total; base and
      // package-bonus stay separately auditable via the immutable
      // purchase_credit_snapshot/package_bonus_credit_snapshot columns on
      // this purchase request (added in migration 0004).
      const packageBonusCredits = purchase.packageBonusCredits ?? 0n;
      const purchaseLedger = await deps.ledger.insertLedgerEntry({
        userId: purchase.userId, amount: purchase.credits + packageBonusCredits,
        entryType: 'purchase',
        purchaseRequestId: id, correlationKey: `purchase:${id}`,
        createdByUserId: actor.user.id,
        metadata: {
          baseCredits: String(purchase.credits),
          packageBonusCredits: String(packageBonusCredits),
        },
      }, { client });
      let bonusLedger = null;
      const existingRedemption = await deps.billing.findPromotionRedemption(
        purchase.userId, { client, forUpdate: true },
      );
      const snapshot = purchase.bonusPolicySnapshot;
      if (!existingRedemption && snapshot?.id && bigint(snapshot.bonusCredits) > 0n) {
        bonusLedger = await deps.ledger.insertLedgerEntry({
          userId: purchase.userId, amount: bigint(snapshot.bonusCredits),
          entryType: 'first_purchase_bonus', purchaseRequestId: id,
          correlationKey: `first-purchase-bonus:${purchase.userId}`,
          createdByUserId: actor.user.id,
          metadata: { promotionVersionId: snapshot.id },
        }, { client });
        const redemption = await deps.billing.insertPromotionRedemption({
          userId: purchase.userId, promotionVersionId: snapshot.id,
          purchaseRequestId: id, bonusLedgerEntryId: bonusLedger.id,
        }, { client });
        if (!redemption) fail('First-purchase bonus was concurrently consumed.', 'BONUS_CONFLICT', 409);
      }
      const total = purchase.credits + packageBonusCredits + (bonusLedger?.amount || 0n);
      const balance = await deps.balances.addPostedCredits(purchase.userId, total, { client });
      const approved = await deps.billing.approvePurchase({
        id, reviewerId: actor.user.id, purchaseLedgerEntryId: purchaseLedger.id,
        bonusLedgerEntryId: bonusLedger?.id || null,
      }, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, subjectUserId: purchase.userId,
        eventType: 'credit_purchase.approved', resourceType: 'credit_purchase_request',
        resourceId: id, beforeState: { status: 'pending' },
        afterState: {
          status: 'approved', baseCredits: String(purchase.credits),
          packageBonusCredits: String(packageBonusCredits),
          firstPurchaseBonusCredits: String(bonusLedger?.amount || 0n),
          totalCreditsGranted: String(total),
        },
      }, { client });
      // Rule #4 (frozen): any approved purchase automatically assigns Pro —
      // both Guest->Purchase->Pro and Guest->Trial->Purchase->Pro. Credits
      // and Pro are separate concepts, so this never checks balance; it
      // simply reuses the same plan-replacement mechanism Trial already uses
      // (correctly no-ops/updates whether or not the user was on Trial).
      const proPlan = await deps.plans.findPlanByCode('pro', { client });
      let proAssignment = null;
      if (proPlan?.active) {
        proAssignment = await deps.billing.replaceCurrentAssignment({
          userId: purchase.userId, planId: proPlan.id, source: 'admin',
        }, { client });
        await deps.audit.insertAuditLog({
          actorUserId: actor.user.id, subjectUserId: purchase.userId,
          eventType: 'plan.pro_assigned_via_purchase', resourceType: 'plan_assignment',
          resourceId: proAssignment.id,
          afterState: { planCode: 'pro', purchaseRequestId: id },
        }, { client });
      }
      return {
        status: 200, resourceId: id,
        body: { purchase: approved, balance, purchaseLedger, bonusLedger, proAssignment },
      };
    },
  });
};

export const adjustCredits = async (identity, input, {
  env = process.env, idempotencyKey, deps = dependencies,
} = {}) => {
  const userId = text(input?.userId, 'userId', { max: 50 });
  const amount = integer(input?.amount, 'amount');
  if (amount === 0n) fail('amount must not be zero.', 'INVALID_INPUT');
  const direction = text(input?.direction, 'direction', { max: 20 });
  if (!['grant', 'deduction'].includes(direction)) fail('direction must be grant or deduction.', 'INVALID_INPUT');
  const reason = text(input?.reason, 'reason', { max: 1000 });
  const signed = direction === 'grant' ? amount : -amount;
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: `credits.manual_${direction}`,
    request: { userId, amount, direction, reason }, resourceType: 'credit_ledger', deps,
    work: async (client, actor) => {
      const target = await ensureTargetUser(userId, { client, deps });
      if (!target) fail('Target user not found.', 'NOT_FOUND', 404);
      const targetUser = target;
      await deps.balances.ensureBalanceAccountForUpdate(targetUser.id, { client });
      const ledger = await deps.ledger.insertLedgerEntry({
        userId: targetUser.id, amount: signed,
        entryType: direction === 'grant' ? 'manual_grant' : 'manual_deduction',
        correlationKey: `manual:${idempotencyKey}`, reason,
        createdByUserId: actor.user.id,
      }, { client });
      const balance = await deps.balances.addPostedCredits(targetUser.id, signed, { client });
      if (!balance) fail('Deduction exceeds available balance.', 'INSUFFICIENT_CREDITS', 409);
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, subjectUserId: targetUser.id,
        eventType: `credits.manual_${direction}`, resourceType: 'credit_ledger',
        resourceId: ledger.id, afterState: { amount: String(signed), reason },
      }, { client });
      return { status: 200, resourceId: ledger.id, body: { ledger, balance } };
    },
  });
};

export const configurePlan = async (identity, input, options = {}) => {
  const { env = process.env, idempotencyKey, deps = dependencies } = options;
  const code = text(input?.code, 'code', { max: 20 });
  if (!PLAN_CODES.has(code)) fail('code must be trial or pro.', 'INVALID_INPUT');
  const request = {
    code, name: text(input?.name, 'name', { max: 100 }),
    description: text(input?.description, 'description', { max: 1000, optional: true }),
    active: Boolean(input?.active),
    displayOrder: Number(input?.displayOrder || 0),
  };
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: 'plan.configure', request,
    resourceType: 'plan', deps,
    work: async (client, actor) => {
      const plan = await deps.billing.upsertPlan({ ...request, actorUserId: actor.user.id }, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, eventType: 'plan.configured',
        resourceType: 'plan', resourceId: plan.id, afterState: request,
      }, { client });
      return { status: 200, resourceId: plan.id, body: { plan } };
    },
  });
};

export const createPlanPolicy = async (identity, planCode, input, options = {}) => {
  const { env = process.env, idempotencyKey, deps = dependencies } = options;
  if (!PLAN_CODES.has(planCode)) fail('Plan not found.', 'NOT_FOUND', 404);
  const version = Number(integer(input?.version, 'version', { min: 1 }));
  const creditsPerBlock = integer(input?.creditsPerBlock, 'creditsPerBlock', { min: 1 });
  const trialAllowanceCredits = integer(input?.trialAllowanceCredits ?? 0, 'trialAllowanceCredits');
  const billingMode = text(input?.billingMode, 'billingMode', { max: 30 });
  // New authoritative product rule (supersedes the former frozen Rule #4):
  // Trial is no longer BYOK-only -- every authorized user, Trial or Pro,
  // processes through the server-managed Gemini key and gets every current
  // recap feature. Both plans require blink_funded; BYOK mode is retired.
  if (billingMode !== 'blink_funded') fail(`${planCode} requires blink_funded.`, 'INVALID_PLAN_POLICY', 422);
  if (planCode !== 'trial' && trialAllowanceCredits !== 0n) fail('Only Trial may have an allowance.', 'INVALID_PLAN_POLICY', 422);
  const entitlements = Array.isArray(input?.entitlements) ? input.entitlements.map(item => ({
    key: text(item?.key, 'entitlement key', { max: 50 }),
    enabled: Boolean(item?.enabled),
    integerLimit: item?.integerLimit === null || item?.integerLimit === undefined
      ? null : integer(item.integerLimit, 'integerLimit'),
    textValue: item?.textValue === null || item?.textValue === undefined
      ? null : text(item.textValue, 'textValue', { max: 200, optional: true }),
  })) : [];
  if (entitlements.some(item => !ENTITLEMENT_KEYS.has(item.key))) fail('Unsupported entitlement.', 'INVALID_ENTITLEMENT');
  const flags = Object.fromEntries(entitlements.map(item => [item.key, item.enabled]));
  if (!flags.blur || !flags.flip || flags.byok_mode || !flags.blink_funded_mode) {
    fail('Entitlements must enable Blur, Flip, and Blink-funded mode for every plan; BYOK mode is no longer supported.', 'INVALID_PLAN_POLICY', 422);
  }
  const request = {
    planCode, version, creditsPerBlock, trialAllowanceCredits, billingMode,
    active: Boolean(input?.active), effectiveFrom: isoDate(input?.effectiveFrom, 'effectiveFrom'),
    effectiveUntil: isoDate(input?.effectiveUntil, 'effectiveUntil', { optional: true }),
    entitlements,
  };
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: 'plan.policy.create', request,
    resourceType: 'plan_policy_version', deps,
    work: async (client, actor) => {
      const plan = await deps.plans.findPlanByCode(planCode, { client });
      if (!plan) fail('Plan not found.', 'NOT_FOUND', 404);
      if (request.active && await deps.billing.findOverlappingPlanPolicy({
        planId: plan.id,
        effectiveFrom: request.effectiveFrom,
        effectiveUntil: request.effectiveUntil,
      }, { client })) {
        fail('An active policy already overlaps this effective window.', 'PLAN_POLICY_OVERLAP', 409);
      }
      const policy = await deps.billing.insertPlanPolicy({
        ...request, planId: plan.id, actorUserId: actor.user.id,
      }, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, eventType: 'plan_policy.created',
        resourceType: 'plan_policy_version', resourceId: policy.id,
        afterState: publicJson(request),
      }, { client });
      return { status: 201, resourceId: policy.id, body: { policy, entitlements } };
    },
  });
};

// Owner-facing simplification of configurePlan + createPlanPolicy: accepts
// only name/description/active. Every technical field (credits per block,
// billing mode, entitlements, display order, policy version) is applied
// from PLAN_POLICY_DEFAULTS/PLAN_DISPLAY_ORDER, never from client input.
// Auto-versions and closes the previous open-ended policy window so
// re-saving an already-configured plan never hits PLAN_POLICY_OVERLAP.
export const configurePlanDefaults = async (identity, planCode, input, options = {}) => {
  const { env = process.env, idempotencyKey, deps = dependencies } = options;
  if (!PLAN_CODES.has(planCode)) fail('code must be trial or pro.', 'INVALID_INPUT');
  const request = {
    code: planCode,
    name: text(input?.name, 'name', { max: 100 }),
    description: text(input?.description, 'description', { max: 1000, optional: true }),
    active: Boolean(input?.active),
  };
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: 'plan.configure_defaults', request,
    resourceType: 'plan', deps,
    work: async (client, actor) => {
      const plan = await deps.billing.upsertPlan({
        ...request, displayOrder: PLAN_DISPLAY_ORDER[planCode], actorUserId: actor.user.id,
      }, { client });
      const now = new Date();
      const latest = await deps.plans.findEffectivePlanPolicy(plan.id, now, { client });
      if (latest) await deps.billing.closePlanPolicyWindow(latest.id, now, { client });
      const policyRequest = {
        planCode, version: (latest?.version || 0) + 1,
        creditsPerBlock: PLAN_POLICY_DEFAULTS.creditsPerBlock,
        trialAllowanceCredits: planCode === 'trial' ? TRIAL_GRANT_CREDITS : 0n,
        billingMode: PLAN_POLICY_DEFAULTS.billingMode,
        active: true, effectiveFrom: now, effectiveUntil: null,
        entitlements: PLAN_POLICY_DEFAULTS.entitlements,
      };
      const policy = await deps.billing.insertPlanPolicy({
        ...policyRequest, planId: plan.id, actorUserId: actor.user.id,
      }, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, eventType: 'plan.configured_with_defaults',
        resourceType: 'plan', resourceId: plan.id,
        afterState: publicJson({ ...request, policy: policyRequest }),
      }, { client });
      return { status: 200, resourceId: plan.id, body: { plan, policy } };
    },
  });
};

const currentPolicyIsMigrated = (billingMode, entitlementRows) => {
  if (billingMode !== PLAN_POLICY_DEFAULTS.billingMode) return false;
  const enabledByKey = Object.fromEntries(entitlementRows.map(item => [item.key, item.enabled]));
  return PLAN_POLICY_DEFAULTS.entitlements.every(item => enabledByKey[item.key] === item.enabled);
};

// One-time, idempotent Admin-triggered repair for plan_policy_versions rows
// that predate the Trial/Pro simplification and still carry the retired
// shape (billingMode 'byok', or Blur/Flip disabled for Trial) -- the exact
// condition that produced the "Requested billing mode is not entitled." /
// entitlement-mismatch production failures. Versions each affected plan's
// policy forward with the current billingMode/entitlements, exactly like an
// Owner re-saving the plan via configurePlanDefaults, but as a single bulk
// action covering every legacy Trial/Pro policy at once. A genuine no-op
// (skips the plan entirely) once its policy already matches the current
// defaults, so running this repeatedly or against an already-migrated
// deployment changes nothing. Never touches creditsPerBlock,
// trialAllowanceCredits, prices, credit balances, plan assignments, plans
// with no existing policy, or any plan code other than trial/pro -- only
// billingMode and entitlements are ever changed, and the prior policy
// window is closed (not deleted), preserving policy history.
export const backfillLegacyPlanEntitlements = async (identity, options = {}) => {
  const { env = process.env, idempotencyKey, deps = dependencies } = options;
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: 'plan.backfill_legacy_entitlements', request: {},
    resourceType: 'plan', deps,
    work: async (client, actor) => {
      const now = new Date();
      const updated = [];
      for (const planCode of PLAN_CODES) {
        const plan = await deps.plans.findPlanByCode(planCode, { client });
        if (!plan?.active) continue;
        const latest = await deps.plans.findEffectivePlanPolicy(plan.id, now, { client });
        if (!latest) continue;
        const entitlementRows = await deps.plans.listPlanEntitlements(latest.id, { client });
        if (currentPolicyIsMigrated(latest.billingMode, entitlementRows)) continue;
        await deps.billing.closePlanPolicyWindow(latest.id, now, { client });
        const policyRequest = {
          planCode, version: latest.version + 1,
          // Pricing/allowance are preserved exactly as configured -- this
          // repair only ever touches billingMode and entitlements.
          creditsPerBlock: latest.creditsPerBlock,
          trialAllowanceCredits: latest.trialAllowanceCredits,
          billingMode: PLAN_POLICY_DEFAULTS.billingMode,
          active: true, effectiveFrom: now, effectiveUntil: null,
          entitlements: PLAN_POLICY_DEFAULTS.entitlements,
        };
        const policy = await deps.billing.insertPlanPolicy({
          ...policyRequest, planId: plan.id, actorUserId: actor.user.id,
        }, { client });
        await deps.audit.insertAuditLog({
          actorUserId: actor.user.id, eventType: 'plan.legacy_entitlements_backfilled',
          resourceType: 'plan', resourceId: plan.id,
          afterState: publicJson({ planCode, policy: policyRequest }),
        }, { client });
        updated.push({ planCode, policy });
      }
      return { status: 200, resourceId: null, body: { updated } };
    },
  });
};

export const configureCreditPlan = async (identity, input, options = {}) => {
  const { env = process.env, idempotencyKey, deps = dependencies } = options;
  requireConfirmation(input);
  const request = {
    code: text(input?.code, 'code', { max: 50 }),
    name: text(input?.name, 'name', { max: 100 }),
    description: text(input?.description, 'description', { max: 1000, optional: true }),
    creditAmount: integer(input?.creditAmount, 'creditAmount', { min: 1 }),
    priceMinor: integer(input?.priceMinor, 'priceMinor', { min: 1 }),
    bonusCredits: integer(input?.bonusCredits ?? 0, 'bonusCredits'),
    note: text(input?.note, 'note', { max: 1000, optional: true }) || null,
    currency: currencyCode(input?.currency),
    active: Boolean(input?.active), displayOrder: displayOrder(input?.displayOrder),
  };
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: 'credit_plan.configure', request,
    resourceType: 'credit_plan', deps,
    work: async (client, actor) => {
      const plan = await deps.billing.upsertCreditPlan({ ...request, actorUserId: actor.user.id }, { client });
      if (!plan) fail('Archived credit packages cannot be edited.', 'PACKAGE_ARCHIVED', 409);
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, eventType: 'credit_plan.configured',
        resourceType: 'credit_plan', resourceId: plan.id, afterState: publicJson(request),
      }, { client });
      return { status: 200, resourceId: plan.id, body: { creditPlan: plan } };
    },
  });
};

export const createCreditPackage = async (identity, input, options = {}) => {
  const { env = process.env, idempotencyKey, deps = dependencies } = options;
  requireConfirmation(input);
  const request = {
    code: input?.code ? text(input.code, 'code', { max: 50 }) : null,
    name: text(input?.name, 'name', { max: 100 }),
    price: packagePrice(input),
    creditAmount: integer(input?.creditAmount, 'creditAmount', { min: 1 }),
    bonusCredits: integer(input?.bonusCredits ?? 0, 'bonusCredits'),
    active: input?.active === true,
    displayOrder: displayOrder(input?.displayOrder),
    note: text(input?.note, 'note', { max: 1000, optional: true }) || null,
    currency: currencyCode(input?.currency),
  };
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: 'credit_package.create', request,
    resourceType: 'credit_plan', deps,
    work: async (client, actor) => {
      const creditPackage = await deps.billing.insertCreditPackage({
        ...request, actorUserId: actor.user.id,
      }, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, eventType: 'credit_package.created',
        resourceType: 'credit_plan', resourceId: creditPackage.id,
        afterState: publicJson(creditPackage),
      }, { client });
      return { status: 201, resourceId: creditPackage.id, body: { creditPackage } };
    },
  });
};

export const editCreditPackage = async (identity, id, input, options = {}) => {
  const { env = process.env, idempotencyKey, deps = dependencies } = options;
  requireConfirmation(input);
  const patch = {};
  if (Object.hasOwn(input || {}, 'name')) patch.name = text(input.name, 'name', { max: 100 });
  if (Object.hasOwn(input || {}, 'price') || Object.hasOwn(input || {}, 'priceMinor')) {
    patch.price = packagePrice(input);
  }
  if (Object.hasOwn(input || {}, 'creditAmount')) {
    patch.creditAmount = integer(input.creditAmount, 'creditAmount', { min: 1 });
  }
  if (Object.hasOwn(input || {}, 'bonusCredits')) {
    patch.bonusCredits = integer(input.bonusCredits, 'bonusCredits');
  }
  if (Object.hasOwn(input || {}, 'active')) {
    if (typeof input.active !== 'boolean') fail('active must be boolean.', 'INVALID_INPUT');
    patch.active = input.active;
  }
  if (Object.hasOwn(input || {}, 'displayOrder')) patch.displayOrder = displayOrder(input.displayOrder);
  if (Object.hasOwn(input || {}, 'note')) {
    patch.note = text(input.note, 'note', { max: 1000, optional: true }) || null;
  }
  if (Object.hasOwn(input || {}, 'currency')) patch.currency = currencyCode(input.currency);
  if (!Object.keys(patch).length) fail('At least one package field is required.', 'INVALID_INPUT');
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: 'credit_package.edit', request: { id, patch },
    resourceType: 'credit_plan', deps,
    work: async (client, actor) => {
      const before = await deps.billing.findCreditPackageById(id, { client, forUpdate: true });
      if (!before) fail('Credit package not found.', 'NOT_FOUND', 404);
      if (before.archivedAt) fail('Archived credit packages cannot be edited.', 'PACKAGE_ARCHIVED', 409);
      const creditPackage = await deps.billing.updateCreditPackage(id, {
        ...before, ...patch, actorUserId: actor.user.id,
      }, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, eventType: 'credit_package.updated',
        resourceType: 'credit_plan', resourceId: id,
        beforeState: publicJson(before), afterState: publicJson(creditPackage),
      }, { client });
      return { status: 200, resourceId: id, body: { creditPackage } };
    },
  });
};

export const setCreditPackageStatus = async (identity, id, active, input, options = {}) => {
  const { env = process.env, idempotencyKey, deps = dependencies } = options;
  requireConfirmation(input);
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: `credit_package.${active ? 'activate' : 'deactivate'}`,
    request: { id, active }, resourceType: 'credit_plan', deps,
    work: async (client, actor) => {
      const before = await deps.billing.findCreditPackageById(id, { client, forUpdate: true });
      if (!before) fail('Credit package not found.', 'NOT_FOUND', 404);
      if (before.archivedAt) fail('Archived credit packages cannot be activated or deactivated.', 'PACKAGE_ARCHIVED', 409);
      const creditPackage = await deps.billing.setCreditPackageActive(
        id, active, actor.user.id, { client },
      );
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id,
        eventType: `credit_package.${active ? 'activated' : 'deactivated'}`,
        resourceType: 'credit_plan', resourceId: id,
        beforeState: publicJson(before), afterState: publicJson(creditPackage),
      }, { client });
      return { status: 200, resourceId: id, body: { creditPackage } };
    },
  });
};

export const archiveCreditPackage = async (identity, id, input, options = {}) => {
  const { env = process.env, idempotencyKey, deps = dependencies } = options;
  requireConfirmation(input);
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: 'credit_package.archive', request: { id },
    resourceType: 'credit_plan', deps,
    work: async (client, actor) => {
      const before = await deps.billing.findCreditPackageById(id, { client, forUpdate: true });
      if (!before) fail('Credit package not found.', 'NOT_FOUND', 404);
      if (before.archivedAt) fail('Credit package is already archived.', 'PACKAGE_ARCHIVED', 409);
      const creditPackage = await deps.billing.archiveCreditPackage(id, actor.user.id, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, eventType: 'credit_package.archived',
        resourceType: 'credit_plan', resourceId: id,
        beforeState: publicJson(before), afterState: publicJson(creditPackage),
      }, { client });
      return { status: 200, resourceId: id, body: { creditPackage } };
    },
  });
};

export const reorderCreditPackages = async (identity, input, options = {}) => {
  const { env = process.env, idempotencyKey, deps = dependencies } = options;
  requireConfirmation(input);
  if (!Array.isArray(input?.items) || !input.items.length) {
    fail('items must contain at least one package order.', 'INVALID_INPUT');
  }
  const items = input.items.map(item => ({
    id: text(item?.id, 'package id', { max: 50 }),
    displayOrder: displayOrder(item?.displayOrder),
  }));
  if (new Set(items.map(item => item.id)).size !== items.length) {
    fail('Package ids must be unique.', 'INVALID_INPUT');
  }
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: 'credit_package.reorder', request: { items },
    resourceType: 'credit_plan', deps,
    work: async (client, actor) => {
      const currentById = new Map();
      for (const item of [...items].sort((left, right) => left.id.localeCompare(right.id))) {
        const current = await deps.billing.findCreditPackageById(item.id, { client, forUpdate: true });
        if (!current) fail('Credit package not found.', 'NOT_FOUND', 404);
        if (current.archivedAt) fail('Archived credit packages cannot be reordered.', 'PACKAGE_ARCHIVED', 409);
        currentById.set(item.id, current);
      }
      const before = items.map(item => currentById.get(item.id));
      const packages = [];
      for (const item of items) {
        packages.push(await deps.billing.reorderCreditPackage(
          item.id, item.displayOrder, actor.user.id, { client },
        ));
      }
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, eventType: 'credit_package.reordered',
        resourceType: 'credit_plan',
        beforeState: publicJson(before.map(item => ({ id: item.id, displayOrder: item.displayOrder }))),
        afterState: publicJson(packages.map(item => ({ id: item.id, displayOrder: item.displayOrder }))),
      }, { client });
      return { status: 200, body: { creditPackages: packages } };
    },
  });
};

export const configureBank = async (identity, input, options = {}) => {
  const { env = process.env, idempotencyKey, deps = dependencies } = options;
  const request = {
    code: text(input?.code, 'code', { max: 50 }),
    bankName: text(input?.bankName, 'bankName', { max: 100 }),
    accountName: text(input?.accountName, 'accountName', { max: 100 }),
    accountNumber: text(input?.accountNumber, 'accountNumber', { max: 100 }),
    branch: text(input?.branch, 'branch', { max: 100, optional: true }) || null,
    currency: text(input?.currency, 'currency', { max: 3 }).toUpperCase(),
    instructions: text(input?.instructions, 'instructions', { max: 1000, optional: true }),
    active: Boolean(input?.active), displayOrder: Number(input?.displayOrder || 0),
  };
  if (!/^[A-Z]{3}$/.test(request.currency)) fail('currency must be a three-letter code.', 'INVALID_INPUT');
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: 'bank.configure', request,
    resourceType: 'bank_account', deps,
    work: async (client, actor) => {
      const bank = await deps.billing.upsertBankAccount({ ...request, actorUserId: actor.user.id }, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, eventType: 'bank_account.configured',
        resourceType: 'bank_account', resourceId: bank.id,
        afterState: { ...request, accountNumber: '[REDACTED]' },
      }, { client });
      return { status: 200, resourceId: bank.id, body: { bank } };
    },
  });
};

const SUPPORTED_BANK_CURRENCIES = new Set(['MMK', 'THB']);
const slugify = value => value
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Generates a stable, unique bank code from bank name + currency + the last
// 4 digits of the account number -- the same real-world bank identity
// always yields the same code (so re-saving an existing bank account
// updates it instead of creating a duplicate), while a genuine collision
// between two different accounts is disambiguated with a numeric suffix
// rather than silently overwritten.
const generateBankCode = async (request, { client, deps }) => {
  const base = slugify(
    `${request.bankName} ${request.currency} ${request.accountNumber.slice(-4)}`,
  ).slice(0, 40) || 'bank';
  let candidate = base;
  for (let suffix = 1; ; suffix += 1) {
    const existing = await deps.billing.findBankAccountByCode(candidate, { client });
    if (!existing || existing.account_number === request.accountNumber) return candidate;
    candidate = `${base}-${suffix}`;
  }
};

// Owner-facing simplification of configureBank: the Owner never types a
// bank code (generateBankCode derives one automatically and safely), and
// display order is backend-managed (new banks are appended last).
export const configureBankAutoCode = async (identity, input, options = {}) => {
  const { env = process.env, idempotencyKey, deps = dependencies } = options;
  const request = {
    bankName: text(input?.bankName, 'bankName', { max: 100 }),
    accountName: text(input?.accountName, 'accountName', { max: 100 }),
    accountNumber: text(input?.accountNumber, 'accountNumber', { max: 100 }),
    branch: text(input?.branch, 'branch', { max: 100, optional: true }) || null,
    currency: text(input?.currency, 'currency', { max: 3 }).toUpperCase(),
    instructions: text(input?.instructions, 'instructions', { max: 1000, optional: true }),
    active: Boolean(input?.active),
  };
  if (!SUPPORTED_BANK_CURRENCIES.has(request.currency)) fail('currency must be MMK or THB.', 'INVALID_INPUT');
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: 'bank.configure_auto_code', request,
    resourceType: 'bank_account', deps,
    work: async (client, actor) => {
      const code = await generateBankCode(request, { client, deps });
      const existingBanks = await deps.billing.listBankAccounts({ client, includeInactive: true });
      const displayOrder = existingBanks.length;
      const bank = await deps.billing.upsertBankAccount({
        ...request, code, displayOrder, actorUserId: actor.user.id,
      }, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, eventType: 'bank_account.configured',
        resourceType: 'bank_account', resourceId: bank.id,
        afterState: { ...request, code, accountNumber: '[REDACTED]' },
      }, { client });
      return { status: 200, resourceId: bank.id, body: { bank } };
    },
  });
};

export const linkPackageBank = async (identity, input, options = {}) => {
  const { env = process.env, idempotencyKey, deps = dependencies } = options;
  const request = {
    creditPlanId: text(input?.creditPlanId, 'creditPlanId', { max: 50 }),
    bankAccountId: text(input?.bankAccountId, 'bankAccountId', { max: 50 }),
    active: input?.active !== false,
  };
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: 'credit_plan.bank.link', request,
    resourceType: 'credit_plan_bank_account', deps,
    work: async (client, actor) => {
      const [creditPlan, bank] = await Promise.all([
        deps.billing.findCreditPlanById(request.creditPlanId, { client }),
        deps.billing.findBankAccountById(request.bankAccountId, { client }),
      ]);
      if (!creditPlan) fail('Credit package not found.', 'NOT_FOUND', 404);
      if (!bank) fail('Bank account not found.', 'NOT_FOUND', 404);
      if (creditPlan.currency !== bank.currency) {
        fail(
          `Bank account currency (${bank.currency}) must match the package currency (${creditPlan.currency}).`,
          'BANK_CURRENCY_MISMATCH', 422,
        );
      }
      const link = await deps.billing.linkCreditPlanBank({
        ...request, actorUserId: actor.user.id,
      }, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, eventType: 'credit_plan.bank_linked',
        resourceType: 'credit_plan', resourceId: request.creditPlanId,
        afterState: request,
      }, { client });
      return { status: 200, resourceId: request.creditPlanId, body: { link } };
    },
  });
};

export const configurePromotion = async (identity, input, options = {}) => {
  const { env = process.env, idempotencyKey, deps = dependencies } = options;
  const request = {
    code: text(input?.code, 'code', { max: 50 }),
    version: Number(integer(input?.version, 'version', { min: 1 })),
    bonusCredits: integer(input?.bonusCredits, 'bonusCredits', { min: 1 }),
    active: Boolean(input?.active),
    effectiveFrom: isoDate(input?.effectiveFrom, 'effectiveFrom'),
    effectiveUntil: isoDate(input?.effectiveUntil, 'effectiveUntil', { optional: true }),
  };
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: 'promotion.configure', request,
    resourceType: 'promotion_version', deps,
    work: async (client, actor) => {
      const promotion = await deps.billing.insertPromotion({
        ...request, actorUserId: actor.user.id,
      }, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, eventType: 'promotion.created',
        resourceType: 'promotion_version', resourceId: promotion.id,
        afterState: publicJson(request),
      }, { client });
      return { status: 201, resourceId: promotion.id, body: { promotion } };
    },
  });
};

export const assessTrial = async (identity, input, options = {}) => {
  const { env = process.env, idempotencyKey, deps = dependencies } = options;
  const decision = text(input?.decision, 'decision', { max: 30 });
  if (!TRIAL_DECISIONS.has(decision)) fail('Invalid trial decision.', 'INVALID_INPUT');
  const request = {
    userId: text(input?.userId, 'userId', { max: 50 }),
    decision,
    policyVersion: Number(integer(input?.policyVersion, 'policyVersion', { min: 1 })),
    riskReasons: Array.isArray(input?.riskReasons)
      ? input.riskReasons.map(reason => text(reason, 'risk reason', { max: 100 }))
      : [],
  };
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: 'trial.assess', request,
    resourceType: 'trial_eligibility_assessment', deps,
    work: async (client, actor) => {
      const target = await deps.users.findUserByFirebaseUid(request.userId, { client });
      if (!target) fail('Target user not found.', 'NOT_FOUND', 404);
      const assessment = await deps.billing.insertTrialAssessment({
        ...request, userId: target.id, actorUserId: actor.user.id,
      }, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, subjectUserId: target.id,
        eventType: 'trial.assessed', resourceType: 'trial_eligibility_assessment',
        resourceId: assessment.id, afterState: request,
      }, { client });
      return { status: 201, resourceId: assessment.id, body: { assessment } };
    },
  });
};

export const verifyScreenshot = async (identity, id, options = {}) => {
  const { env = process.env, idempotencyKey, deps = dependencies } = options;
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: 'screenshot.verify', request: { id },
    resourceType: 'uploaded_file', deps,
    work: async (client, actor) => {
      const current = await deps.billing.findScreenshotMetadata(id, { client, forUpdate: true });
      if (!current) fail('Screenshot metadata not found.', 'NOT_FOUND', 404);
      if (current.status !== 'pending') fail('Screenshot metadata is not pending.', 'INVALID_STATE', 409);
      const file = await deps.billing.verifyScreenshotMetadata(id, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, subjectUserId: current.owner_user_id,
        eventType: 'payment_screenshot.verified', resourceType: 'uploaded_file',
        resourceId: id, beforeState: { status: 'pending' }, afterState: { status: 'verified' },
      }, { client });
      return { status: 200, resourceId: id, body: { file } };
    },
  });
};

export const adminListPurchases = async (identity, {
  env = process.env, status = null, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  return deps.transaction(async client => {
    const actor = await ensureActor(identity, { client, deps });
    await requireSuperAdmin(actor, { client, deps });
    return deps.billing.listPurchases({ status, client });
  });
};

export const adminListCatalog = async (identity, {
  env = process.env, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  return deps.transaction(async client => {
    const actor = await ensureActor(identity, { client, deps });
    await requireSuperAdmin(actor, { client, deps });
    const [commercialPlans, creditPlans, banks] = await Promise.all([
      deps.billing.listPlansForAdministration({ client }),
      deps.billing.listCreditPlans({ includeInactive: true, client }),
      deps.billing.listBankAccounts({ includeInactive: true, client }),
    ]);
    return { commercialPlans, creditPlans, banks };
  });
};

export const adminGetUserCredits = async (identity, firebaseUid, {
  env = process.env, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  return deps.transaction(async client => {
    const actor = await ensureActor(identity, { client, deps });
    await requireSuperAdmin(actor, { client, deps });
    const target = await ensureTargetUser(firebaseUid, { client, deps });
    if (!target) fail('Target user not found.', 'NOT_FOUND', 404);
    const [balance, entries] = await Promise.all([
      deps.balances.findBalanceAccount(target.id, { client }),
      deps.ledger.listLedgerEntries(target.id, { client, limit: 100 }),
    ]);
    return {
      user: { id: target.id, firebaseUid: target.firebaseUid },
      balance: balance || {
        userId: target.id, postedBalance: 0n, reservedBalance: 0n,
        availableBalance: 0n, version: 1,
      },
      ledger: entries,
    };
  });
};

export const adminGetScreenshotMetadata = async (identity, id, {
  env = process.env, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  return deps.transaction(async client => {
    const actor = await ensureActor(identity, { client, deps });
    await requireSuperAdmin(actor, { client, deps });
    const file = await deps.billing.findScreenshotMetadata(id, { client });
    if (!file) fail('Screenshot metadata not found.', 'NOT_FOUND', 404);
    return {
      id: file.id,
      ownerUserId: file.owner_user_id,
      purpose: file.purpose,
      storageProvider: file.storage_provider,
      bucket: file.bucket,
      objectKey: file.object_key,
      originalFilename: file.original_filename,
      mimeType: file.mime_type,
      sizeBytes: bigint(file.size_bytes),
      sha256: file.sha256,
      status: file.status,
      uploadedAt: file.uploaded_at,
      verifiedAt: file.verified_at,
    };
  });
};

export const adminListAudit = async (identity, {
  env = process.env, eventType = null, resourceType = null, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  return deps.transaction(async client => {
    const actor = await ensureActor(identity, { client, deps });
    await requireSuperAdmin(actor, { client, deps });
    return deps.audit.listAuditLogs({ eventType, resourceType, client });
  });
};

export const billingServiceDependencies = dependencies;
export { publicJson };
