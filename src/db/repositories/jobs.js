import { databaseExecutor, firstRow } from './shared.js';

export const findBillingJob = async (jobId, { client = null, forUpdate = false } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT id, user_id, status, stage, progress, selected_plan_id,
            plan_code_snapshot, billing_mode, source_duration_ms,
            billing_block_seconds, billing_blocks, credits_per_block,
            total_required_credits, pricing_policy_version_id,
            pricing_policy_snapshot, entitlement_snapshot,
            credit_reservation_id, billing_status, paid_provider_started_at,
            billing_finalized_at, idempotency_key, created_at, updated_at
     FROM jobs WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [jobId],
  );
  const row = firstRow(result);
  return row && {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    selectedPlanId: row.selected_plan_id,
    planCodeSnapshot: row.plan_code_snapshot,
    billingMode: row.billing_mode,
    sourceDurationMs: row.source_duration_ms === null ? null : BigInt(row.source_duration_ms),
    billingBlockSeconds: row.billing_block_seconds,
    billingBlocks: row.billing_blocks === null ? null : BigInt(row.billing_blocks),
    creditsPerBlock: row.credits_per_block === null ? null : BigInt(row.credits_per_block),
    totalRequiredCredits: row.total_required_credits === null ? null : BigInt(row.total_required_credits),
    pricingPolicyVersionId: row.pricing_policy_version_id,
    pricingPolicySnapshot: row.pricing_policy_snapshot,
    entitlementSnapshot: row.entitlement_snapshot,
    creditReservationId: row.credit_reservation_id,
    billingStatus: row.billing_status,
    paidProviderStartedAt: row.paid_provider_started_at,
    billingFinalizedAt: row.billing_finalized_at,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export const insertBillingJob = async (job, { client }) => {
  const result = await client.query(
    `INSERT INTO jobs
      (id,user_id,status,stage,progress,idempotency_key)
     VALUES ($1,$2,'pending','pending',0,$3)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [job.id, job.userId, job.idempotencyKey],
  );
  return firstRow(result);
};

export const attachBillingSnapshot = async (job, { client }) => {
  await client.query(
    `UPDATE jobs SET
       selected_plan_id=$2,plan_code_snapshot=$3,billing_mode=$4,
       source_duration_ms=$5,billing_block_seconds=30,billing_blocks=$6,
       credits_per_block=$7,total_required_credits=$8,
       pricing_policy_version_id=$9,pricing_policy_snapshot=$10,
       entitlement_snapshot=$11,credit_reservation_id=$12,
       idempotency_key=COALESCE($13,idempotency_key),
       billing_status='reserved',status='queued',stage='queued',
       billing_finalized_at=NULL,updated_at=now()
     WHERE id=$1`,
    [
      job.id, job.planId, job.planCode, job.billingMode,
      String(job.sourceDurationMs), String(job.blocks), String(job.creditsPerBlock),
      String(job.totalCredits), job.policyId, job.policySnapshot,
      job.entitlementSnapshot, job.reservationId, job.idempotencyKey || null,
    ],
  );
  return findBillingJob(job.id, { client });
};

export const updateBillingJob = async (jobId, {
  billingStatus = null, status = null, stage = null, progress = null,
  providerStarted = false, finalized = false,
}, { client }) => {
  const result = await client.query(
    `UPDATE jobs SET
       billing_status=COALESCE($2,billing_status),
       status=COALESCE($3,status),stage=COALESCE($4,stage),
       progress=COALESCE($5,progress),
       paid_provider_started_at=CASE WHEN $6 THEN COALESCE(paid_provider_started_at,now())
                                    ELSE paid_provider_started_at END,
       billing_finalized_at=CASE WHEN $7 THEN COALESCE(billing_finalized_at,now())
                                 ELSE billing_finalized_at END,
       updated_at=now()
     WHERE id=$1 RETURNING id`,
    [jobId, billingStatus, status, stage, progress, providerStarted, finalized],
  );
  return firstRow(result);
};

export const listRecoverableBillingJobs = async ({ client = null } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT id FROM jobs
     WHERE billing_status IN ('reserved','settled','review_required')
       AND status IN ('queued','processing','failed','cancelled')
     ORDER BY updated_at`,
  );
  return result.rows.map(row => row.id);
};
