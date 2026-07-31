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
  usersRepository,
} from '../db/repositories/index.js';
import { hasUserGeminiApiKey } from './userGeminiKeys.js';

const PLAN_CODES = new Set(['trial', 'normal', 'pro']);
const ENTITLEMENT_KEYS = new Set([
  'blur', 'flip', 'byok_mode', 'blink_funded_mode',
  'active_job_limit', 'storage_limit_bytes', 'retention_hours',
]);
const PURCHASE_STATES = new Set(['pending', 'approved', 'rejected']);
const TRIAL_DECISIONS = new Set(['eligible', 'ineligible', 'review_required']);

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
  hasByok: hasUserGeminiApiKey,
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

const requireSuperAdmin = async (actor, { client, deps = dependencies } = {}) => {
  const role = await deps.roles.findRoleByUserId(actor.user.id, { client, forUpdate: true });
  if (role?.role !== 'super_admin') {
    fail('PostgreSQL Super Admin authority is required.', 'SUPER_ADMIN_REQUIRED', 403);
  }
  return role;
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

export const selectPlan = async (identity, input, {
  env = process.env, idempotencyKey, deps = dependencies,
} = {}) => {
  requireEnabled(env);
  const code = text(input?.planCode, 'planCode', { max: 20 });
  if (!['normal', 'pro'].includes(code)) fail('Only Normal or Pro may be explicitly selected.', 'PLAN_NOT_SELECTABLE', 422);
  return idempotent({
    actorScope: `firebase:${identity.uid}`,
    operation: 'plan.select',
    idempotencyKey,
    request: { code },
    resourceType: 'plan_assignment',
    work: async client => {
      const actor = await ensureActor(identity, { client, deps });
      const plan = await deps.plans.findPlanByCode(code, { client });
      if (!plan?.active || plan.archivedAt) fail('Plan is unavailable.', 'PLAN_UNAVAILABLE', 422);
      const policy = await deps.plans.findEffectivePlanPolicy(plan.id, new Date(), { client });
      if (!policy) fail('Plan has no effective policy.', 'PLAN_POLICY_UNAVAILABLE', 422);
      if (code === 'normal' && !deps.hasByok(identity.uid)) {
        fail('Normal requires a verified user Gemini key.', 'BYOK_REQUIRED', 422);
      }
      if (code === 'pro') {
        const balance = await deps.balances.findBalanceAccount(actor.user.id, { client });
        if (!String(env.GEMINI_API_KEY || '').trim()) {
          fail('Blink-funded Gemini processing is unavailable.', 'PLATFORM_PROVIDER_UNAVAILABLE', 503);
        }
        if (!balance || balance.availableBalance <= 0n) {
          fail('Pro requires an available purchased credit balance.', 'INSUFFICIENT_CREDITS', 409);
        }
      }
      const assignment = await deps.billing.replaceCurrentAssignment({
        userId: actor.user.id, planId: plan.id, source: 'user_selection',
      }, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id,
        eventType: 'plan.assignment.selected',
        resourceType: 'plan_assignment',
        resourceId: assignment.id,
        afterState: { planCode: code },
      }, { client });
      return { status: 200, resourceId: assignment.id, body: { assignment, policy } };
    },
  }, { deps });
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
    byokPresent: deps.hasByok(identity.uid),
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
      if (!deps.hasByok(identity.uid)) fail('Trial requires a verified user Gemini key.', 'BYOK_REQUIRED', 422);
      const plan = await deps.plans.findPlanByCode('trial', { client });
      const policy = plan?.active
        ? await deps.plans.findEffectivePlanPolicy(plan.id, new Date(), { client })
        : null;
      if (!policy || policy.billingMode !== 'byok' || policy.trialAllowanceCredits <= 0n) {
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
  if (requestedMode === 'byok' && !deps.hasByok(identity.uid)) reasons.push('BYOK_REQUIRED');
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
      const objectKey = `payment-screenshots/${actor.user.id}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
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
      const purchaseLedger = await deps.ledger.insertLedgerEntry({
        userId: purchase.userId, amount: purchase.credits, entryType: 'purchase',
        purchaseRequestId: id, correlationKey: `purchase:${id}`,
        createdByUserId: actor.user.id,
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
      const total = purchase.credits + (bonusLedger?.amount || 0n);
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
          status: 'approved', purchaseCredits: String(purchase.credits),
          bonusCredits: String(bonusLedger?.amount || 0n),
        },
      }, { client });
      return {
        status: 200, resourceId: id,
        body: { purchase: approved, balance, purchaseLedger, bonusLedger },
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
      const target = await deps.users.findUserByFirebaseUid(userId, { client });
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
  if (!PLAN_CODES.has(code)) fail('code must be trial, normal, or pro.', 'INVALID_INPUT');
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
  const expectedMode = planCode === 'pro' ? 'blink_funded' : 'byok';
  if (billingMode !== expectedMode) fail(`${planCode} requires ${expectedMode}.`, 'INVALID_PLAN_POLICY', 422);
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
  const pro = planCode === 'pro';
  if (Boolean(flags.blur) !== pro || Boolean(flags.flip) !== pro ||
      Boolean(flags.byok_mode) === pro || Boolean(flags.blink_funded_mode) !== pro) {
    fail('Entitlements must enforce BYOK Trial/Normal and Pro-only Blur/Flip/funded mode.', 'INVALID_PLAN_POLICY', 422);
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
      if (['normal', 'pro'].includes(planCode)) {
        const counterpartCode = planCode === 'pro' ? 'normal' : 'pro';
        const counterpart = await deps.plans.findPlanByCode(counterpartCode, { client });
        const counterpartPolicy = counterpart
          ? await deps.plans.findEffectivePlanPolicy(
            counterpart.id, request.effectiveFrom, { client },
          )
          : null;
        if (counterpartPolicy) {
          const invalidRate = planCode === 'pro'
            ? request.creditsPerBlock <= counterpartPolicy.creditsPerBlock
            : request.creditsPerBlock >= counterpartPolicy.creditsPerBlock;
          if (invalidRate) {
            fail('Pro credits-per-block must be higher than Normal.', 'INVALID_PLAN_RATE', 422);
          }
        }
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

export const configureCreditPlan = async (identity, input, options = {}) => {
  const { env = process.env, idempotencyKey, deps = dependencies } = options;
  const request = {
    code: text(input?.code, 'code', { max: 50 }),
    name: text(input?.name, 'name', { max: 100 }),
    description: text(input?.description, 'description', { max: 1000, optional: true }),
    creditAmount: integer(input?.creditAmount, 'creditAmount', { min: 1 }),
    priceMinor: integer(input?.priceMinor, 'priceMinor', { min: 1 }),
    currency: text(input?.currency, 'currency', { max: 3 }).toUpperCase(),
    active: Boolean(input?.active), displayOrder: Number(input?.displayOrder || 0),
  };
  if (!/^[A-Z]{3}$/.test(request.currency)) fail('currency must be a three-letter code.', 'INVALID_INPUT');
  return withSuperAdminMutation(identity, {
    env, idempotencyKey, operation: 'credit_plan.configure', request,
    resourceType: 'credit_plan', deps,
    work: async (client, actor) => {
      const plan = await deps.billing.upsertCreditPlan({ ...request, actorUserId: actor.user.id }, { client });
      await deps.audit.insertAuditLog({
        actorUserId: actor.user.id, eventType: 'credit_plan.configured',
        resourceType: 'credit_plan', resourceId: plan.id, afterState: publicJson(request),
      }, { client });
      return { status: 200, resourceId: plan.id, body: { creditPlan: plan } };
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
    const target = await deps.users.findUserByFirebaseUid(firebaseUid, { client });
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
