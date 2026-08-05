import { randomUUID } from 'node:crypto';
import { databaseExecutor, firstRow } from './shared.js';

const bigint = value => value === null || value === undefined ? null : BigInt(value);
const mapPlan = row => row && ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description,
  active: row.active,
  displayOrder: row.display_order,
  archivedAt: row.archived_at,
});
const mapPolicy = row => row && ({
  id: row.id,
  planId: row.plan_id,
  planCode: row.plan_code,
  version: Number(row.version),
  billingBlockSeconds: row.billing_block_seconds,
  creditsPerBlock: bigint(row.credits_per_block),
  trialAllowanceCredits: bigint(row.trial_allowance_credits),
  billingMode: row.billing_mode,
  effectiveFrom: row.effective_from,
  effectiveUntil: row.effective_until,
  active: row.active,
});
const mapPurchase = row => row && ({
  id: row.id,
  userId: row.user_id,
  status: row.status,
  creditPlanId: row.credit_plan_id,
  bankAccountId: row.bank_account_id,
  screenshotFileId: row.screenshot_file_id,
  planCode: row.plan_code_snapshot,
  planName: row.plan_name_snapshot,
  credits: bigint(row.purchase_credit_snapshot),
  packageBonusCredits: bigint(row.package_bonus_credit_snapshot ?? 0),
  priceMinor: bigint(row.price_minor_snapshot),
  currency: row.currency_snapshot,
  bankSnapshot: row.bank_snapshot,
  bonusPolicySnapshot: row.bonus_policy_snapshot,
  submittedAt: row.submitted_at,
  reviewedAt: row.reviewed_at,
  reviewedByUserId: row.reviewed_by_user_id,
  rejectionReason: row.rejection_reason,
  purchaseLedgerEntryId: row.purchase_ledger_entry_id,
  bonusLedgerEntryId: row.bonus_ledger_entry_id,
  version: Number(row.version),
});
const mapCreditPackage = row => row && ({
  id: row.id,
  code: row.code,
  name: row.name,
  price: bigint(row.price_minor),
  priceMinor: bigint(row.price_minor),
  currency: row.currency,
  creditAmount: bigint(row.credit_amount),
  bonusCredits: bigint(row.bonus_credits ?? 0),
  active: row.active,
  displayOrder: row.display_order,
  note: row.note ?? null,
  archivedAt: row.archived_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const listActivePlans = async ({ client = null, at = new Date() } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT p.id, p.code, p.name, p.description, p.active, p.display_order, p.archived_at,
            pp.id policy_id, pp.plan_id, pp.version, pp.billing_block_seconds,
            pp.credits_per_block, pp.trial_allowance_credits, pp.billing_mode,
            pp.effective_from, pp.effective_until, pp.active policy_active
     FROM plans p
     JOIN LATERAL (
       SELECT * FROM plan_policy_versions
       WHERE plan_id = p.id AND active = true AND effective_from <= $1
         AND (effective_until IS NULL OR effective_until > $1)
       ORDER BY version DESC LIMIT 1
     ) pp ON true
     WHERE p.active = true AND p.archived_at IS NULL
     ORDER BY p.display_order, p.code`,
    [at],
  );
  return result.rows.map(row => ({
    ...mapPlan(row),
    policy: mapPolicy({
      id: row.policy_id,
      plan_id: row.plan_id,
      plan_code: row.code,
      version: row.version,
      billing_block_seconds: row.billing_block_seconds,
      credits_per_block: row.credits_per_block,
      trial_allowance_credits: row.trial_allowance_credits,
      billing_mode: row.billing_mode,
      effective_from: row.effective_from,
      effective_until: row.effective_until,
      active: row.policy_active,
    }),
  }));
};

export const listPlansForAdministration = async ({ client = null } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT id,code,name,description,active,display_order,archived_at
     FROM plans ORDER BY display_order,code`,
  );
  return result.rows.map(mapPlan);
};

export const listEntitlementsForPolicies = async (policyIds, { client = null } = {}) => {
  if (!policyIds.length) return [];
  const result = await databaseExecutor(client).query(
    `SELECT id, policy_version_id, entitlement_key, enabled, integer_limit, text_value
     FROM plan_entitlements WHERE policy_version_id = ANY($1::uuid[])
     ORDER BY entitlement_key`,
    [policyIds],
  );
  return result.rows.map(row => ({
    id: row.id,
    policyVersionId: row.policy_version_id,
    key: row.entitlement_key,
    enabled: row.enabled,
    integerLimit: bigint(row.integer_limit),
    textValue: row.text_value,
  }));
};

export const upsertPlan = async (plan, { client }) => {
  const result = await client.query(
    `INSERT INTO plans
      (id, code, name, description, active, display_order, created_by_user_id, updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
       active=EXCLUDED.active, display_order=EXCLUDED.display_order,
       updated_by_user_id=EXCLUDED.updated_by_user_id, updated_at=now(),
       archived_at=CASE WHEN EXCLUDED.active THEN NULL ELSE plans.archived_at END
     RETURNING id, code, name, description, active, display_order, archived_at`,
    [randomUUID(), plan.code, plan.name, plan.description, plan.active, plan.displayOrder, plan.actorUserId],
  );
  return mapPlan(firstRow(result));
};

export const insertPlanPolicy = async (policy, { client }) => {
  const id = randomUUID();
  const result = await client.query(
    `INSERT INTO plan_policy_versions
      (id, plan_id, version, billing_block_seconds, credits_per_block,
       trial_allowance_credits, billing_mode, effective_from, effective_until,
       active, created_by_user_id)
     VALUES ($1,$2,$3,30,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, plan_id, version, billing_block_seconds, credits_per_block,
       trial_allowance_credits, billing_mode, effective_from, effective_until, active`,
    [id, policy.planId, policy.version, String(policy.creditsPerBlock),
      String(policy.trialAllowanceCredits), policy.billingMode, policy.effectiveFrom,
      policy.effectiveUntil, policy.active, policy.actorUserId],
  );
  for (const entitlement of policy.entitlements) {
    await client.query(
      `INSERT INTO plan_entitlements
        (id, policy_version_id, entitlement_key, enabled, integer_limit, text_value)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), id, entitlement.key, entitlement.enabled,
        entitlement.integerLimit === null ? null : String(entitlement.integerLimit),
        entitlement.textValue],
    );
  }
  return mapPolicy(firstRow(result));
};

export const findOverlappingPlanPolicy = async ({
  planId, effectiveFrom, effectiveUntil,
}, { client }) => firstRow(await client.query(
  `SELECT id FROM plan_policy_versions
   WHERE plan_id=$1 AND active=true
     AND effective_from < COALESCE($3::timestamptz, 'infinity'::timestamptz)
     AND COALESCE(effective_until, 'infinity'::timestamptz) > $2
   LIMIT 1 FOR UPDATE`,
  [planId, effectiveFrom, effectiveUntil],
));

export const replaceCurrentAssignment = async ({
  userId, planId, source, actorUserId = null,
}, { client }) => {
  await client.query(
    `UPDATE user_plan_assignments SET status='inactive', ends_at=now(), updated_at=now()
     WHERE user_id=$1 AND status='active'`,
    [userId],
  );
  const result = await client.query(
    `INSERT INTO user_plan_assignments
      (id,user_id,plan_id,status,source,starts_at,created_by_user_id)
     VALUES ($1,$2,$3,'active',$4,now(),$5)
     RETURNING id,user_id,plan_id,status,source,starts_at,ends_at`,
    [randomUUID(), userId, planId, source, actorUserId],
  );
  return firstRow(result);
};

export const findLatestTrialAssessment = async (userId, { client = null, forUpdate = false } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT id,user_id,decision,policy_version,risk_reasons,decided_by_user_id,created_at
     FROM trial_eligibility_assessments WHERE user_id=$1
     ORDER BY created_at DESC LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [userId],
  );
  return firstRow(result);
};

export const insertTrialAssessment = async (assessment, { client }) => {
  const result = await client.query(
    `INSERT INTO trial_eligibility_assessments
      (id,user_id,decision,policy_version,risk_reasons,decided_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [randomUUID(), assessment.userId, assessment.decision, assessment.policyVersion,
      JSON.stringify(assessment.riskReasons), assessment.actorUserId],
  );
  return firstRow(result);
};

export const findTrialGrant = async (userId, { client = null, forUpdate = false } = {}) =>
  firstRow(await databaseExecutor(client).query(
    `SELECT id,user_id,assessment_id,credit_amount,policy_version_id,ledger_entry_id,
            idempotency_key,granted_at,expires_at,expired_at FROM trial_grants WHERE user_id=$1
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [userId],
  ));

export const insertTrialGrant = async (grant, { client }) =>
  firstRow(await client.query(
    `INSERT INTO trial_grants
      (id,user_id,assessment_id,credit_amount,policy_version_id,ledger_entry_id,idempotency_key,expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [randomUUID(), grant.userId, grant.assessmentId ?? null, String(grant.creditAmount),
      grant.policyVersionId ?? null, grant.ledgerEntryId, grant.idempotencyKey, grant.expiresAt ?? null],
  ));

export const markTrialGrantExpired = async (userId, { client }) =>
  firstRow(await client.query(
    `UPDATE trial_grants SET expired_at = now()
     WHERE user_id = $1 AND expired_at IS NULL
     RETURNING id,user_id,assessment_id,credit_amount,policy_version_id,ledger_entry_id,
               idempotency_key,granted_at,expires_at,expired_at`,
    [userId],
  ));

export const findEffectivePromotion = async (at = new Date(), { client = null } = {}) =>
  firstRow(await databaseExecutor(client).query(
    `SELECT * FROM promotion_versions
     WHERE promotion_type='first_purchase_bonus' AND active=true AND effective_from <= $1
       AND (effective_until IS NULL OR effective_until > $1)
     ORDER BY version DESC LIMIT 1`,
    [at],
  ));

export const insertPromotion = async (promotion, { client }) =>
  firstRow(await client.query(
    `INSERT INTO promotion_versions
      (id,code,version,promotion_type,bonus_credits,active,effective_from,effective_until,created_by_user_id)
     VALUES ($1,$2,$3,'first_purchase_bonus',$4,$5,$6,$7,$8) RETURNING *`,
    [randomUUID(), promotion.code, promotion.version, String(promotion.bonusCredits),
      promotion.active, promotion.effectiveFrom, promotion.effectiveUntil, promotion.actorUserId],
  ));

export const upsertCreditPlan = async (plan, { client }) =>
  mapCreditPackage(firstRow(await client.query(
    `INSERT INTO credit_plans
      (id,code,name,description,credit_amount,bonus_credits,price_minor,currency,active,display_order,note,
       created_by_user_id,updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
     ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,
       credit_amount=EXCLUDED.credit_amount,bonus_credits=EXCLUDED.bonus_credits,
       price_minor=EXCLUDED.price_minor,note=EXCLUDED.note,
       currency=EXCLUDED.currency,active=EXCLUDED.active,display_order=EXCLUDED.display_order,
       updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()
     WHERE credit_plans.archived_at IS NULL
     RETURNING *`,
    [randomUUID(), plan.code, plan.name, plan.description, String(plan.creditAmount),
      String(plan.bonusCredits ?? 0), String(plan.priceMinor), plan.currency, plan.active,
      plan.displayOrder, plan.note ?? null, plan.actorUserId],
  )));

export const insertCreditPackage = async (item, { client }) =>
  mapCreditPackage(firstRow(await client.query(
    `INSERT INTO credit_plans
      (id,code,name,description,credit_amount,bonus_credits,price_minor,currency,
       active,display_order,note,created_by_user_id,updated_by_user_id)
     VALUES ($1,$2,$3,'',$4,$5,$6,$7,$8,$9,$10,$11,$11)
     RETURNING *`,
    [randomUUID(), item.code || `package-${randomUUID()}`, item.name,
      String(item.creditAmount), String(item.bonusCredits), String(item.price),
      item.currency, item.active, item.displayOrder, item.note, item.actorUserId],
  )));

export const findCreditPackageById = async (id, { client = null, forUpdate = false } = {}) =>
  mapCreditPackage(firstRow(await databaseExecutor(client).query(
    `SELECT * FROM credit_plans WHERE id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  )));

export const updateCreditPackage = async (id, item, { client }) =>
  mapCreditPackage(firstRow(await client.query(
    `UPDATE credit_plans SET name=$2,price_minor=$3,credit_amount=$4,
       bonus_credits=$5,active=$6,display_order=$7,note=$8,currency=$9,
       updated_by_user_id=$10,updated_at=now()
     WHERE id=$1 AND archived_at IS NULL RETURNING *`,
    [id, item.name, String(item.price), String(item.creditAmount),
      String(item.bonusCredits), item.active, item.displayOrder, item.note,
      item.currency, item.actorUserId],
  )));

export const setCreditPackageActive = async (id, active, actorUserId, { client }) =>
  mapCreditPackage(firstRow(await client.query(
    `UPDATE credit_plans SET active=$2,updated_by_user_id=$3,updated_at=now()
     WHERE id=$1 AND archived_at IS NULL RETURNING *`,
    [id, active, actorUserId],
  )));

export const archiveCreditPackage = async (id, actorUserId, { client }) =>
  mapCreditPackage(firstRow(await client.query(
    `UPDATE credit_plans SET active=false,archived_at=now(),updated_by_user_id=$2,
       updated_at=now() WHERE id=$1 AND archived_at IS NULL RETURNING *`,
    [id, actorUserId],
  )));

export const reorderCreditPackage = async (id, displayOrder, actorUserId, { client }) =>
  mapCreditPackage(firstRow(await client.query(
    `UPDATE credit_plans SET display_order=$2,updated_by_user_id=$3,updated_at=now()
     WHERE id=$1 AND archived_at IS NULL RETURNING *`,
    [id, displayOrder, actorUserId],
  )));

export const listCreditPlans = async ({ currency = null, includeInactive = false, client = null } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT * FROM credit_plans
     WHERE ($1::text IS NULL OR currency=$1)
       AND ($2::boolean OR (active=true AND archived_at IS NULL))
     ORDER BY display_order,code`,
    [currency, includeInactive],
  );
  return result.rows.map(mapCreditPackage);
};

export const findCreditPlanById = async (id, { client = null } = {}) =>
  mapCreditPackage(firstRow(await databaseExecutor(client).query(
    `SELECT * FROM credit_plans WHERE id=$1`, [id],
  )));

export const findBankAccountById = async (id, { client = null } = {}) =>
  firstRow(await databaseExecutor(client).query(
    `SELECT * FROM bank_accounts WHERE id=$1`, [id],
  ));

export const upsertBankAccount = async (bank, { client }) =>
  firstRow(await client.query(
    `INSERT INTO bank_accounts
      (id,code,bank_name,account_name,account_number,branch,currency,instructions,
       active,display_order,created_by_user_id,updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
     ON CONFLICT(code) DO UPDATE SET bank_name=EXCLUDED.bank_name,
       account_name=EXCLUDED.account_name,account_number=EXCLUDED.account_number,
       branch=EXCLUDED.branch,currency=EXCLUDED.currency,instructions=EXCLUDED.instructions,
       active=EXCLUDED.active,display_order=EXCLUDED.display_order,
       updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=now()
     RETURNING *`,
    [randomUUID(), bank.code, bank.bankName, bank.accountName, bank.accountNumber,
      bank.branch, bank.currency, bank.instructions, bank.active, bank.displayOrder, bank.actorUserId],
  ));

export const linkCreditPlanBank = async ({ creditPlanId, bankAccountId, active, actorUserId }, { client }) =>
  firstRow(await client.query(
    `INSERT INTO credit_plan_bank_accounts
      (credit_plan_id,bank_account_id,active,created_by_user_id)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT(credit_plan_id,bank_account_id) DO UPDATE SET active=EXCLUDED.active
     RETURNING *`,
    [creditPlanId, bankAccountId, active, actorUserId],
  ));

export const listBanksForCreditPlan = async (creditPlanId, { client = null, includeInactive = false } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT b.* FROM bank_accounts b
     JOIN credit_plan_bank_accounts l ON l.bank_account_id=b.id
     WHERE l.credit_plan_id=$1 AND ($2::boolean OR (l.active=true AND b.active=true AND b.archived_at IS NULL))
     ORDER BY b.display_order,b.code`,
    [creditPlanId, includeInactive],
  );
  return result.rows;
};

export const listBankAccounts = async ({ client = null, includeInactive = false } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT * FROM bank_accounts
     WHERE ($1::boolean OR (active=true AND archived_at IS NULL))
     ORDER BY display_order,code`,
    [includeInactive],
  );
  return result.rows;
};

export const findCreditPlanAndBank = async (creditPlanId, bankAccountId, { client, forUpdate = false } = {}) =>
  firstRow(await client.query(
    `SELECT cp.*, b.id bank_id,b.code bank_code,b.bank_name,b.account_name,b.account_number,
            b.branch,b.instructions bank_instructions,b.currency bank_currency
     FROM credit_plans cp
     JOIN credit_plan_bank_accounts l ON l.credit_plan_id=cp.id AND l.active=true
     JOIN bank_accounts b ON b.id=l.bank_account_id AND b.active=true
     WHERE cp.id=$1 AND b.id=$2 AND cp.active=true
       AND cp.archived_at IS NULL AND b.archived_at IS NULL
       AND cp.currency=b.currency${forUpdate ? ' FOR UPDATE OF cp,b,l' : ''}`,
    [creditPlanId, bankAccountId],
  ));

export const insertScreenshotMetadata = async (file, { client }) =>
  firstRow(await client.query(
    `INSERT INTO uploaded_files
      (id,owner_user_id,purpose,storage_provider,bucket,object_key,original_filename,
       mime_type,size_bytes,sha256,status,uploaded_at)
     VALUES ($1,$2,'payment_screenshot',$3,$4,$5,$6,$7,$8,$9,'pending',now())
     RETURNING *`,
    [file.id, file.userId, file.storageProvider, file.bucket, file.objectKey,
      file.originalFilename, file.mimeType, String(file.sizeBytes), file.sha256],
  ));

export const verifyScreenshotMetadata = async (id, { client }) =>
  firstRow(await client.query(
    `UPDATE uploaded_files SET status='verified',verified_at=now()
     WHERE id=$1 AND status='pending' RETURNING *`,
    [id],
  ));

export const findScreenshotMetadata = async (id, { client = null, forUpdate = false } = {}) =>
  firstRow(await databaseExecutor(client).query(
    `SELECT * FROM uploaded_files WHERE id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  ));

export const insertPurchase = async (purchase, { client }) => {
  const result = await client.query(
    `INSERT INTO credit_purchase_requests
      (id,user_id,status,credit_plan_id,bank_account_id,screenshot_file_id,
       plan_code_snapshot,plan_name_snapshot,purchase_credit_snapshot,
       package_bonus_credit_snapshot,price_minor_snapshot,
       currency_snapshot,bank_snapshot,bonus_policy_snapshot,submitted_at,created_at,updated_at)
     VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now(),now())
     RETURNING *`,
    [randomUUID(), purchase.userId, purchase.creditPlanId, purchase.bankAccountId,
      purchase.screenshotFileId, purchase.planCode, purchase.planName,
      String(purchase.credits), String(purchase.packageBonusCredits ?? 0n),
      String(purchase.priceMinor), purchase.currency,
      purchase.bankSnapshot, purchase.bonusPolicySnapshot],
  );
  return mapPurchase(firstRow(result));
};

export const findPurchase = async (id, { client = null, forUpdate = false } = {}) =>
  mapPurchase(firstRow(await databaseExecutor(client).query(
    `SELECT * FROM credit_purchase_requests WHERE id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  )));

export const listPurchases = async ({
  userId = null, status = null, client = null, limit = 100,
} = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT * FROM credit_purchase_requests
     WHERE ($1::uuid IS NULL OR user_id=$1) AND ($2::text IS NULL OR status=$2)
     ORDER BY submitted_at DESC,id DESC LIMIT $3`,
    [userId, status, limit],
  );
  return result.rows.map(mapPurchase);
};

export const approvePurchase = async ({
  id, reviewerId, purchaseLedgerEntryId, bonusLedgerEntryId,
}, { client }) =>
  mapPurchase(firstRow(await client.query(
    `UPDATE credit_purchase_requests SET status='approved',reviewed_at=now(),
       reviewed_by_user_id=$2,purchase_ledger_entry_id=$3,bonus_ledger_entry_id=$4,
       version=version+1,updated_at=now()
     WHERE id=$1 AND status='pending' RETURNING *`,
    [id, reviewerId, purchaseLedgerEntryId, bonusLedgerEntryId],
  )));

export const rejectPurchase = async ({ id, reviewerId, reason }, { client }) =>
  mapPurchase(firstRow(await client.query(
    `UPDATE credit_purchase_requests SET status='rejected',reviewed_at=now(),
       reviewed_by_user_id=$2,rejection_reason=$3,version=version+1,updated_at=now()
     WHERE id=$1 AND status='pending' RETURNING *`,
    [id, reviewerId, reason],
  )));

export const insertPromotionRedemption = async (redemption, { client }) =>
  firstRow(await client.query(
    `INSERT INTO user_promotion_redemptions
      (id,user_id,promotion_type,promotion_version_id,purchase_request_id,bonus_ledger_entry_id)
     VALUES ($1,$2,'first_purchase_bonus',$3,$4,$5)
     ON CONFLICT(user_id,promotion_type) DO NOTHING RETURNING *`,
    [randomUUID(), redemption.userId, redemption.promotionVersionId,
      redemption.purchaseRequestId, redemption.bonusLedgerEntryId],
  ));

export const findPromotionRedemption = async (userId, { client = null, forUpdate = false } = {}) =>
  firstRow(await databaseExecutor(client).query(
    `SELECT * FROM user_promotion_redemptions
     WHERE user_id=$1 AND promotion_type='first_purchase_bonus'
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [userId],
  ));
