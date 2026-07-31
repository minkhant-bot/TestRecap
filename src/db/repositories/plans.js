import { databaseExecutor, firstRow } from './shared.js';

export const findPlanByCode = async (code, { client = null } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT id, code, name, description, active, display_order, created_at, updated_at, archived_at
     FROM plans WHERE code = $1`,
    [code],
  );
  const row = firstRow(result);
  return row && {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    active: row.active,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
};

export const findEffectivePlanPolicy = async (planId, at = new Date(), { client = null } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT id, plan_id, version, billing_block_seconds, credits_per_block,
            trial_allowance_credits, billing_mode, effective_from, effective_until, active, created_at
     FROM plan_policy_versions
     WHERE plan_id = $1
       AND active = true
       AND effective_from <= $2
       AND (effective_until IS NULL OR effective_until > $2)
     ORDER BY version DESC
     LIMIT 1`,
    [planId, at],
  );
  const row = firstRow(result);
  return row && {
    id: row.id,
    planId: row.plan_id,
    version: Number(row.version),
    billingBlockSeconds: row.billing_block_seconds,
    creditsPerBlock: BigInt(row.credits_per_block),
    trialAllowanceCredits: BigInt(row.trial_allowance_credits),
    billingMode: row.billing_mode,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    active: row.active,
  };
};

export const findPlanPolicyVersionById = async (id, { client = null } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT id, plan_id, version, billing_block_seconds, credits_per_block,
            trial_allowance_credits, billing_mode, effective_from, effective_until, active, created_at
     FROM plan_policy_versions
     WHERE id = $1`,
    [id],
  );
  const row = firstRow(result);
  return row && {
    id: row.id,
    planId: row.plan_id,
    version: Number(row.version),
    billingBlockSeconds: row.billing_block_seconds,
    creditsPerBlock: BigInt(row.credits_per_block),
    trialAllowanceCredits: BigInt(row.trial_allowance_credits),
    billingMode: row.billing_mode,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    active: row.active,
  };
};

export const listPlanEntitlements = async (policyVersionId, { client = null } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT id, policy_version_id, entitlement_key, enabled, integer_limit, text_value
     FROM plan_entitlements
     WHERE policy_version_id = $1
     ORDER BY entitlement_key`,
    [policyVersionId],
  );
  return result.rows.map(row => ({
    id: row.id,
    policyVersionId: row.policy_version_id,
    key: row.entitlement_key,
    enabled: row.enabled,
    integerLimit: row.integer_limit === null ? null : BigInt(row.integer_limit),
    textValue: row.text_value,
  }));
};
