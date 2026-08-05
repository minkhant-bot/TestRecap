-- Package-level bonus_credits (credit_plans.bonus_credits, added in
-- 0002_credit_package_management.sql) was configurable by Super Admin but
-- never actually granted on purchase approval: submitPurchase snapshotted
-- only credit_plans.credit_amount, silently dropping credit_plans.bonus_credits.
-- This column preserves the package bonus amount separately and immutably at
-- submission time so approval can grant base + bonus as one ledger total
-- while remaining auditable by component via this purchase request row.
ALTER TABLE credit_purchase_requests
  ADD COLUMN package_bonus_credit_snapshot BIGINT NOT NULL DEFAULT 0
    CHECK (package_bonus_credit_snapshot >= 0);
