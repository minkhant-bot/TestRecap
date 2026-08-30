-- reserveLiveJob()'s retry path re-reserves a job whose prior reservation
-- was cleanly released (job.billingStatus = 'released') by mutating that
-- SAME row via UPDATE (amount, idempotency_key, released -> reserved).
-- validate_reservation_transition() (0001_p2_foundation.sql) correctly
-- rejects that: it requires user_id/job_id/amount/idempotency_key to be
-- immutable on UPDATE, and its transition matrix has no released -> reserved
-- path -- a released reservation is concluded financial history, not a
-- mutable draft. The old UNIQUE(job_id) below is what forced the app to
-- reuse/mutate one row per job in the first place, since it could never
-- INSERT a second row for a retried job.
--
-- Fix: let each reservation attempt be its own permanent, immutable row
-- (the same append-only pattern credit_ledger already uses), and allow a
-- job to accumulate multiple historical rows over successive retries. The
-- partial unique index below still guarantees at most one *active*
-- (unresolved) reservation per job at any instant -- the same protection
-- the old plain UNIQUE gave, minus the part that blocked retries.
ALTER TABLE credit_reservations DROP CONSTRAINT credit_reservations_job_id_key;

CREATE UNIQUE INDEX credit_reservations_one_active_per_job_idx
  ON credit_reservations (job_id)
  WHERE status IN ('reserved', 'settled', 'review_required');

-- The dropped UNIQUE constraint above also dropped its implicit btree index
-- on job_id. Every settle/release/refund/review-required lookup filters by
-- job_id (see findReservationByJobId); without a replacement, those become
-- sequential scans as the table grows.
CREATE INDEX credit_reservations_job_id_idx ON credit_reservations (job_id);
