ALTER TABLE credit_plans
  ADD COLUMN bonus_credits BIGINT NOT NULL DEFAULT 0 CHECK (bonus_credits >= 0),
  ADD COLUMN note TEXT;

CREATE TRIGGER credit_plans_no_delete
  BEFORE DELETE ON credit_plans
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_delete();
