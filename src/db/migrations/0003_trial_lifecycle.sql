-- Rule #1/#2 (frozen): Trial is granted only via a simple user-request ->
-- Owner-approval flow (no eligibility questionnaire/risk-scoring). The old
-- trial_eligibility_assessments table/columns are left in place untouched
-- (additive-only) but are no longer required for a grant.
ALTER TABLE trial_grants
  ALTER COLUMN assessment_id DROP NOT NULL,
  ADD COLUMN expires_at TIMESTAMPTZ,
  ADD COLUMN expired_at TIMESTAMPTZ;

CREATE TABLE trial_requests (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id UUID REFERENCES users(id),
  CHECK (
    (status = 'pending' AND reviewed_at IS NULL AND reviewed_by_user_id IS NULL)
    OR (status = 'approved' AND reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL)
  )
);
CREATE INDEX trial_requests_status_idx ON trial_requests (status, requested_at);

CREATE TRIGGER trial_requests_no_delete
  BEFORE DELETE ON trial_requests
  FOR EACH ROW EXECUTE FUNCTION prevent_financial_delete();
