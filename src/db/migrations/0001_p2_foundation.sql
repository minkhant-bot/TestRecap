CREATE TABLE users (
  id UUID PRIMARY KEY,
  firebase_uid TEXT NOT NULL UNIQUE,
  email TEXT,
  display_name TEXT NOT NULL DEFAULT '',
  photo_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  last_login_at TIMESTAMPTZ
);
CREATE INDEX users_status_idx ON users (status);
CREATE INDEX users_last_login_idx ON users (last_login_at);
CREATE INDEX users_email_lower_idx ON users (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID REFERENCES users(id),
  actor_service TEXT,
  subject_user_id UUID REFERENCES users(id),
  request_id TEXT,
  event_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  network_risk_hash TEXT,
  device_risk_hash TEXT,
  CHECK (actor_user_id IS NOT NULL OR actor_service IS NOT NULL)
);
CREATE INDEX audit_logs_occurred_idx ON audit_logs (occurred_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, occurred_at DESC);
CREATE INDEX audit_logs_subject_idx ON audit_logs (subject_user_id, occurred_at DESC);
CREATE INDEX audit_logs_resource_idx ON audit_logs (resource_type, resource_id, occurred_at DESC);

CREATE TABLE user_roles (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'admin', 'super_admin')),
  source TEXT NOT NULL CHECK (source IN ('bootstrap', 'manual', 'migration')),
  assigned_by_user_id UUID REFERENCES users(id),
  protected_bootstrap BOOLEAN NOT NULL DEFAULT false,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_roles_role_idx ON user_roles (role);
CREATE INDEX user_roles_protected_super_admin_idx
  ON user_roles (user_id)
  WHERE role = 'super_admin' AND protected_bootstrap;

CREATE TABLE role_bootstrap_state (
  bootstrap_name TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'disabled')),
  bootstrap_user_id UUID REFERENCES users(id),
  completed_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  audit_log_id UUID UNIQUE REFERENCES audit_logs(id),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (
    (status = 'pending' AND completed_at IS NULL AND disabled_at IS NULL)
    OR (status = 'completed' AND bootstrap_user_id IS NOT NULL AND completed_at IS NOT NULL AND disabled_at IS NULL)
    OR (status = 'disabled' AND bootstrap_user_id IS NOT NULL AND completed_at IS NOT NULL AND disabled_at IS NOT NULL)
  )
);

CREATE TABLE plans (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (code IN ('trial', 'normal', 'pro')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_by_user_id UUID REFERENCES users(id),
  updated_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  CHECK (archived_at IS NULL OR active = false)
);
CREATE INDEX plans_active_order_idx ON plans (active, display_order);

CREATE TABLE plan_policy_versions (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES plans(id),
  version BIGINT NOT NULL CHECK (version > 0),
  billing_block_seconds INTEGER NOT NULL CHECK (billing_block_seconds = 30),
  credits_per_block BIGINT NOT NULL CHECK (credits_per_block > 0),
  trial_allowance_credits BIGINT NOT NULL DEFAULT 0 CHECK (trial_allowance_credits >= 0),
  billing_mode TEXT NOT NULL CHECK (billing_mode IN ('byok', 'blink_funded')),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX plan_policy_effective_idx
  ON plan_policy_versions (plan_id, active, effective_from DESC);

CREATE TABLE plan_entitlements (
  id UUID PRIMARY KEY,
  policy_version_id UUID NOT NULL REFERENCES plan_policy_versions(id),
  entitlement_key TEXT NOT NULL CHECK (entitlement_key IN (
    'blur', 'flip', 'byok_mode', 'blink_funded_mode',
    'active_job_limit', 'storage_limit_bytes', 'retention_hours'
  )),
  enabled BOOLEAN NOT NULL,
  integer_limit BIGINT CHECK (integer_limit IS NULL OR integer_limit >= 0),
  text_value TEXT,
  UNIQUE (policy_version_id, entitlement_key)
);
CREATE INDEX plan_entitlements_policy_idx ON plan_entitlements (policy_version_id);

CREATE TABLE user_plan_assignments (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  plan_id UUID NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'suspended')),
  source TEXT NOT NULL CHECK (source IN ('trial', 'user_selection', 'admin', 'migration')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE UNIQUE INDEX user_plan_one_active_idx
  ON user_plan_assignments (user_id) WHERE status = 'active';
CREATE INDEX user_plan_history_idx ON user_plan_assignments (user_id, starts_at DESC);

CREATE TABLE trial_eligibility_assessments (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('eligible', 'ineligible', 'review_required')),
  policy_version BIGINT NOT NULL CHECK (policy_version > 0),
  risk_reasons JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(risk_reasons) = 'array'),
  decided_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX trial_assessment_user_idx
  ON trial_eligibility_assessments (user_id, created_at DESC);
CREATE INDEX trial_assessment_decision_idx
  ON trial_eligibility_assessments (decision, created_at);

CREATE TABLE promotion_versions (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL,
  version BIGINT NOT NULL CHECK (version > 0),
  promotion_type TEXT NOT NULL CHECK (promotion_type = 'first_purchase_bonus'),
  bonus_credits BIGINT NOT NULL CHECK (bonus_credits > 0),
  active BOOLEAN NOT NULL DEFAULT false,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_until TIMESTAMPTZ,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, version),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE INDEX promotion_effective_idx
  ON promotion_versions (promotion_type, active, effective_from DESC);

CREATE TABLE credit_plans (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  credit_amount BIGINT NOT NULL CHECK (credit_amount > 0),
  price_minor BIGINT NOT NULL CHECK (price_minor > 0),
  currency CHAR(3) NOT NULL CHECK (currency = upper(currency)),
  active BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  updated_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  CHECK (archived_at IS NULL OR active = false)
);
CREATE INDEX credit_plans_public_idx
  ON credit_plans (currency, active, display_order);

CREATE TABLE bank_accounts (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  bank_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  branch TEXT,
  currency CHAR(3) NOT NULL CHECK (currency = upper(currency)),
  instructions TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  updated_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  CHECK (archived_at IS NULL OR active = false)
);
CREATE INDEX bank_accounts_public_idx
  ON bank_accounts (currency, active, display_order);

CREATE TABLE credit_plan_bank_accounts (
  credit_plan_id UUID NOT NULL REFERENCES credit_plans(id),
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id),
  active BOOLEAN NOT NULL DEFAULT true,
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (credit_plan_id, bank_account_id)
);
CREATE INDEX credit_plan_bank_active_idx
  ON credit_plan_bank_accounts (credit_plan_id, active);

CREATE TABLE uploaded_files (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL CHECK (purpose = 'payment_screenshot'),
  storage_provider TEXT NOT NULL,
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'quarantined', 'archived')),
  uploaded_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ
);
CREATE INDEX uploaded_files_owner_idx ON uploaded_files (owner_user_id, uploaded_at DESC);
CREATE INDEX uploaded_files_hash_idx ON uploaded_files (sha256);
CREATE INDEX uploaded_files_status_idx ON uploaded_files (status, uploaded_at);

CREATE TABLE credit_purchase_requests (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  credit_plan_id UUID NOT NULL REFERENCES credit_plans(id),
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id),
  screenshot_file_id UUID NOT NULL UNIQUE REFERENCES uploaded_files(id),
  plan_code_snapshot TEXT NOT NULL,
  plan_name_snapshot TEXT NOT NULL,
  purchase_credit_snapshot BIGINT NOT NULL CHECK (purchase_credit_snapshot > 0),
  price_minor_snapshot BIGINT NOT NULL CHECK (price_minor_snapshot > 0),
  currency_snapshot CHAR(3) NOT NULL CHECK (currency_snapshot = upper(currency_snapshot)),
  bank_snapshot JSONB NOT NULL CHECK (jsonb_typeof(bank_snapshot) = 'object'),
  bonus_policy_snapshot JSONB CHECK (bonus_policy_snapshot IS NULL OR jsonb_typeof(bonus_policy_snapshot) = 'object'),
  submitted_at TIMESTAMPTZ NOT NULL,
  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id UUID REFERENCES users(id),
  rejection_reason TEXT,
  purchase_ledger_entry_id UUID UNIQUE,
  bonus_ledger_entry_id UUID UNIQUE,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (
    (status = 'pending' AND reviewed_at IS NULL AND reviewed_by_user_id IS NULL AND rejection_reason IS NULL)
    OR (status = 'approved' AND reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL AND rejection_reason IS NULL)
    OR (status = 'rejected' AND reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL AND length(trim(rejection_reason)) > 0)
  )
);
CREATE INDEX purchase_status_idx ON credit_purchase_requests (status, submitted_at);
CREATE INDEX purchase_user_idx ON credit_purchase_requests (user_id, submitted_at DESC);
CREATE INDEX purchase_reviewer_idx ON credit_purchase_requests (reviewed_by_user_id, reviewed_at);

CREATE TABLE credit_balance_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  posted_balance BIGINT NOT NULL DEFAULT 0 CHECK (posted_balance >= 0),
  reserved_balance BIGINT NOT NULL DEFAULT 0 CHECK (reserved_balance >= 0),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (posted_balance >= reserved_balance)
);

CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed', 'cancelled')),
  stage TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  selected_plan_id UUID REFERENCES plans(id),
  plan_code_snapshot TEXT CHECK (plan_code_snapshot IS NULL OR plan_code_snapshot IN ('trial', 'normal', 'pro')),
  billing_mode TEXT CHECK (billing_mode IS NULL OR billing_mode IN ('byok', 'blink_funded')),
  source_duration_ms BIGINT CHECK (source_duration_ms IS NULL OR source_duration_ms > 0),
  billing_block_seconds INTEGER CHECK (billing_block_seconds IS NULL OR billing_block_seconds = 30),
  billing_blocks BIGINT CHECK (billing_blocks IS NULL OR billing_blocks > 0),
  credits_per_block BIGINT CHECK (credits_per_block IS NULL OR credits_per_block > 0),
  total_required_credits BIGINT CHECK (total_required_credits IS NULL OR total_required_credits > 0),
  pricing_policy_version_id UUID REFERENCES plan_policy_versions(id),
  pricing_policy_snapshot JSONB,
  entitlement_snapshot JSONB,
  credit_reservation_id UUID UNIQUE,
  billing_status TEXT NOT NULL DEFAULT 'not_reserved'
    CHECK (billing_status IN ('not_reserved', 'reserved', 'settled', 'released', 'refunded', 'review_required')),
  paid_provider_started_at TIMESTAMPTZ,
  billing_finalized_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    billing_status = 'not_reserved'
    OR (
      selected_plan_id IS NOT NULL
      AND plan_code_snapshot IS NOT NULL
      AND billing_mode IS NOT NULL
      AND source_duration_ms IS NOT NULL
      AND billing_block_seconds = 30
      AND billing_blocks IS NOT NULL
      AND credits_per_block IS NOT NULL
      AND total_required_credits = billing_blocks * credits_per_block
      AND pricing_policy_version_id IS NOT NULL
      AND pricing_policy_snapshot IS NOT NULL
      AND entitlement_snapshot IS NOT NULL
    )
  )
);
CREATE INDEX jobs_user_created_idx ON jobs (user_id, created_at DESC);
CREATE INDEX jobs_status_created_idx ON jobs (status, created_at);
CREATE INDEX jobs_billing_status_idx ON jobs (billing_status, updated_at);

CREATE TABLE credit_reservations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  job_id UUID NOT NULL UNIQUE REFERENCES jobs(id) DEFERRABLE INITIALLY DEFERRED,
  amount BIGINT NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'released', 'refunded', 'review_required')),
  idempotency_key TEXT NOT NULL UNIQUE,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  review_required_at TIMESTAMPTZ,
  review_origin_status TEXT CHECK (review_origin_status IN ('reserved', 'settled')),
  resolution_reason TEXT,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (
    (status = 'reserved' AND settled_at IS NULL AND released_at IS NULL AND refunded_at IS NULL AND review_required_at IS NULL)
    OR (status = 'settled' AND settled_at IS NOT NULL AND released_at IS NULL AND refunded_at IS NULL)
    OR (status = 'released' AND released_at IS NOT NULL AND settled_at IS NULL AND refunded_at IS NULL)
    OR (status = 'refunded' AND settled_at IS NOT NULL AND refunded_at IS NOT NULL AND released_at IS NULL)
    OR (status = 'review_required' AND review_required_at IS NOT NULL AND review_origin_status IS NOT NULL)
  )
);
CREATE INDEX reservations_user_status_idx ON credit_reservations (user_id, status);
CREATE INDEX reservations_status_age_idx ON credit_reservations (status, reserved_at);

ALTER TABLE jobs
  ADD CONSTRAINT jobs_credit_reservation_fk
  FOREIGN KEY (credit_reservation_id) REFERENCES credit_reservations(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE credit_ledger (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  amount BIGINT NOT NULL CHECK (amount <> 0),
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'trial_grant', 'purchase', 'first_purchase_bonus', 'settlement',
    'refund', 'reversal', 'manual_grant', 'manual_deduction', 'migration'
  )),
  purchase_request_id UUID REFERENCES credit_purchase_requests(id),
  reservation_id UUID REFERENCES credit_reservations(id),
  job_id UUID REFERENCES jobs(id),
  reversal_of_entry_id UUID REFERENCES credit_ledger(id),
  correlation_key TEXT NOT NULL UNIQUE,
  reason TEXT,
  created_by_user_id UUID REFERENCES users(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (entry_type IN ('trial_grant', 'purchase', 'first_purchase_bonus', 'refund', 'manual_grant') AND amount > 0)
    OR (entry_type IN ('settlement', 'manual_deduction') AND amount < 0)
    OR (entry_type IN ('reversal', 'migration'))
  ),
  CHECK (entry_type <> 'settlement' OR (reservation_id IS NOT NULL AND job_id IS NOT NULL)),
  CHECK (entry_type <> 'refund' OR (reservation_id IS NOT NULL AND reversal_of_entry_id IS NOT NULL)),
  CHECK (entry_type <> 'reversal' OR reversal_of_entry_id IS NOT NULL),
  CHECK (entry_type NOT IN ('manual_grant', 'manual_deduction') OR (created_by_user_id IS NOT NULL AND length(trim(reason)) > 0))
);
CREATE INDEX ledger_user_idx ON credit_ledger (user_id, created_at DESC, id);
CREATE INDEX ledger_type_idx ON credit_ledger (entry_type, created_at);
CREATE INDEX ledger_purchase_idx ON credit_ledger (purchase_request_id) WHERE purchase_request_id IS NOT NULL;
CREATE INDEX ledger_reservation_idx ON credit_ledger (reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX ledger_job_idx ON credit_ledger (job_id) WHERE job_id IS NOT NULL;
CREATE UNIQUE INDEX ledger_one_settlement_per_reservation_idx
  ON credit_ledger (reservation_id) WHERE entry_type = 'settlement';
CREATE UNIQUE INDEX ledger_one_refund_per_settlement_idx
  ON credit_ledger (reversal_of_entry_id) WHERE entry_type = 'refund';

ALTER TABLE credit_purchase_requests
  ADD CONSTRAINT purchase_ledger_entry_fk
    FOREIGN KEY (purchase_ledger_entry_id) REFERENCES credit_ledger(id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT purchase_bonus_ledger_entry_fk
    FOREIGN KEY (bonus_ledger_entry_id) REFERENCES credit_ledger(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE trial_grants (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  assessment_id UUID NOT NULL REFERENCES trial_eligibility_assessments(id),
  credit_amount BIGINT NOT NULL CHECK (credit_amount > 0),
  policy_version_id UUID NOT NULL REFERENCES plan_policy_versions(id),
  ledger_entry_id UUID NOT NULL UNIQUE REFERENCES credit_ledger(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_promotion_redemptions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  promotion_type TEXT NOT NULL CHECK (promotion_type = 'first_purchase_bonus'),
  promotion_version_id UUID NOT NULL REFERENCES promotion_versions(id),
  purchase_request_id UUID NOT NULL UNIQUE REFERENCES credit_purchase_requests(id),
  bonus_ledger_entry_id UUID NOT NULL UNIQUE REFERENCES credit_ledger(id),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reversed_at TIMESTAMPTZ,
  reversal_ledger_entry_id UUID UNIQUE REFERENCES credit_ledger(id),
  UNIQUE (user_id, promotion_type),
  CHECK (
    (reversed_at IS NULL AND reversal_ledger_entry_id IS NULL)
    OR (reversed_at IS NOT NULL AND reversal_ledger_entry_id IS NOT NULL)
  )
);

CREATE TABLE user_provider_credentials (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK (provider = 'gemini'),
  encrypted_payload BYTEA NOT NULL,
  encryption_key_version TEXT NOT NULL,
  risk_fingerprint TEXT,
  verification_status TEXT NOT NULL
    CHECK (verification_status IN ('unverified', 'valid', 'invalid', 'unavailable')),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX user_provider_one_active_idx
  ON user_provider_credentials (user_id, provider) WHERE revoked_at IS NULL;

CREATE TABLE job_provider_usage (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id),
  user_id UUID NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  model_identifier TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  provider_correlation_id TEXT,
  input_units BIGINT CHECK (input_units IS NULL OR input_units >= 0),
  output_units BIGINT CHECK (output_units IS NULL OR output_units >= 0),
  audio_duration_ms BIGINT CHECK (audio_duration_ms IS NULL OR audio_duration_ms >= 0),
  estimated_cost_minor BIGINT CHECK (estimated_cost_minor IS NULL OR estimated_cost_minor >= 0),
  cost_currency CHAR(3),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX provider_usage_job_idx ON job_provider_usage (job_id, recorded_at);
CREATE INDEX provider_usage_provider_idx ON job_provider_usage (provider, recorded_at);
CREATE INDEX provider_usage_user_idx ON job_provider_usage (user_id, recorded_at);

CREATE TABLE system_settings (
  key TEXT PRIMARY KEY CHECK (key !~* '(secret|token|password|api[_-]?key|credential)'),
  value_json JSONB NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('public', 'internal')),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  id UUID PRIMARY KEY,
  actor_scope TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  state TEXT NOT NULL CHECK (state IN ('in_progress', 'completed', 'failed')),
  resource_type TEXT,
  resource_id UUID,
  response_status INTEGER CHECK (response_status BETWEEN 100 AND 599),
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  UNIQUE (actor_scope, operation, idempotency_key),
  CHECK (state <> 'completed' OR response_status IS NOT NULL)
);
CREATE INDEX idempotency_expiry_idx ON idempotency_keys (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE worker_leases (
  job_id UUID PRIMARY KEY REFERENCES jobs(id),
  worker_id TEXT NOT NULL,
  lease_token UUID NOT NULL UNIQUE,
  leased_at TIMESTAMPTZ NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  CHECK (heartbeat_at >= leased_at AND expires_at > heartbeat_at)
);
CREATE INDEX worker_leases_expiry_idx ON worker_leases (expires_at);
CREATE INDEX worker_leases_worker_idx ON worker_leases (worker_id, heartbeat_at);

CREATE OR REPLACE FUNCTION prevent_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; create a compensating record instead', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER credit_ledger_append_only
  BEFORE UPDATE OR DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();

CREATE OR REPLACE FUNCTION protect_bootstrap_super_admin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.protected_bootstrap
     AND (TG_OP = 'DELETE' OR NEW.role <> 'super_admin' OR NOT NEW.protected_bootstrap) THEN
    RAISE EXCEPTION 'Protected bootstrap Super Admin requires the approved recovery procedure'
      USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER user_roles_protect_bootstrap
  BEFORE UPDATE OR DELETE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION protect_bootstrap_super_admin();

CREATE OR REPLACE FUNCTION prevent_financial_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is retained financial history and cannot be deleted', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER credit_purchase_requests_no_delete
  BEFORE DELETE ON credit_purchase_requests
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_delete();
CREATE TRIGGER credit_reservations_no_delete
  BEFORE DELETE ON credit_reservations
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_delete();
CREATE TRIGGER trial_grants_no_delete
  BEFORE DELETE ON trial_grants
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_delete();
CREATE TRIGGER promotion_redemptions_no_delete
  BEFORE DELETE ON user_promotion_redemptions
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_delete();

CREATE OR REPLACE FUNCTION validate_credit_ledger_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  original credit_ledger%ROWTYPE;
BEGIN
  IF NEW.entry_type IN ('refund', 'reversal') THEN
    SELECT * INTO original FROM credit_ledger WHERE id = NEW.reversal_of_entry_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Referenced ledger entry does not exist' USING ERRCODE = '23514';
    END IF;
    IF original.user_id <> NEW.user_id OR NEW.amount <> -original.amount THEN
      RAISE EXCEPTION 'Compensating ledger entry must fully offset the same user entry'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.entry_type = 'refund' AND original.entry_type <> 'settlement' THEN
      RAISE EXCEPTION 'Refund requires an existing settlement debit'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER credit_ledger_validate_insert
  BEFORE INSERT ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION validate_credit_ledger_insert();

CREATE OR REPLACE FUNCTION validate_reservation_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  has_settlement BOOLEAN;
  has_refund BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'reserved' THEN
    RAISE EXCEPTION 'New reservations must begin reserved' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.user_id <> NEW.user_id OR OLD.job_id <> NEW.job_id OR OLD.amount <> NEW.amount
       OR OLD.idempotency_key <> NEW.idempotency_key THEN
      RAISE EXCEPTION 'Reservation identity and amount are immutable' USING ERRCODE = '23514';
    END IF;
    IF NOT (
      (OLD.status = 'reserved' AND NEW.status IN ('reserved', 'settled', 'released', 'review_required'))
      OR (OLD.status = 'review_required' AND NEW.status IN ('review_required', 'settled', 'released', 'refunded'))
      OR (OLD.status = 'settled' AND NEW.status IN ('settled', 'refunded', 'review_required'))
      OR (OLD.status = NEW.status)
    ) THEN
      RAISE EXCEPTION 'Invalid reservation transition from % to %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM credit_ledger
    WHERE reservation_id = NEW.id AND entry_type = 'settlement'
  ) INTO has_settlement;
  SELECT EXISTS (
    SELECT 1 FROM credit_ledger
    WHERE reservation_id = NEW.id AND entry_type = 'refund'
  ) INTO has_refund;

  IF NEW.status = 'released' AND has_settlement THEN
    RAISE EXCEPTION 'A settled reservation cannot be released; refund it instead'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'settled' AND NOT has_settlement THEN
    RAISE EXCEPTION 'Settlement status requires a settlement ledger debit'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'refunded' AND (NOT has_settlement OR NOT has_refund) THEN
    RAISE EXCEPTION 'Refund status requires settlement and compensating refund entries'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER credit_reservation_transition
  AFTER INSERT OR UPDATE ON credit_reservations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_reservation_transition();
