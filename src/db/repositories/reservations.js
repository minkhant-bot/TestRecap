import { randomUUID } from 'node:crypto';
import { databaseExecutor, firstRow } from './shared.js';

const COLUMNS = `id, user_id, job_id, amount, status, idempotency_key, reserved_at,
  settled_at, released_at, refunded_at, review_required_at, review_origin_status,
  resolution_reason, version`;

const mapReservation = row => row && ({
  id: row.id,
  userId: row.user_id,
  jobId: row.job_id,
  amount: BigInt(row.amount),
  status: row.status,
  idempotencyKey: row.idempotency_key,
  reservedAt: row.reserved_at,
  settledAt: row.settled_at,
  releasedAt: row.released_at,
  refundedAt: row.refunded_at,
  reviewRequiredAt: row.review_required_at,
  reviewOriginStatus: row.review_origin_status,
  resolutionReason: row.resolution_reason,
  version: Number(row.version),
});

// A job can accumulate multiple historical reservation rows across retries
// (see insertReservation), but credit_reservations_one_active_per_job_idx
// (0005_retryable_reservations.sql) guarantees at most one row per job is
// ever in an active status ('reserved', 'settled', 'review_required') at a
// time. Ordering active status first -- rather than by reserved_at alone --
// makes that row an unambiguous, timestamp-independent pick: reserved_at is
// Postgres' transaction-start time, not commit time, so under lock
// contention a later attempt's reserved_at is not guaranteed to sort after
// an earlier one's. Falling back to reserved_at DESC only matters when no
// active row exists (e.g. inspecting a fully released/refunded job).
export const findReservationByJobId = async (jobId, { client = null, forUpdate = false } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT ${COLUMNS} FROM credit_reservations
     WHERE job_id = $1
     ORDER BY (status IN ('reserved', 'settled', 'review_required')) DESC, reserved_at DESC
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [jobId],
  );
  return mapReservation(firstRow(result));
};

export const insertReservation = async (reservation, { client, id = randomUUID() }) => {
  if (!client) throw new Error('Reservation mutations require an existing transaction client.');
  const result = await client.query(
    `INSERT INTO credit_reservations
      (id, user_id, job_id, amount, status, idempotency_key)
     VALUES ($1, $2, $3, $4, 'reserved', $5)
     RETURNING ${COLUMNS}`,
    [id, reservation.userId, reservation.jobId, String(reservation.amount), reservation.idempotencyKey],
  );
  return mapReservation(firstRow(result));
};

export const updateReservationStatus = async ({
  reservationId,
  status,
  resolutionReason = null,
  reviewOriginStatus = null,
}, { client }) => {
  if (!client) throw new Error('Reservation mutations require an existing transaction client.');
  const result = await client.query(
    `UPDATE credit_reservations SET
       status = $2,
       settled_at = CASE WHEN $2 = 'settled' THEN now() ELSE settled_at END,
       released_at = CASE WHEN $2 = 'released' THEN now() ELSE released_at END,
       refunded_at = CASE WHEN $2 = 'refunded' THEN now() ELSE refunded_at END,
       review_required_at = CASE WHEN $2 = 'review_required' THEN now() ELSE review_required_at END,
       review_origin_status = CASE WHEN $2 = 'review_required' THEN $3 ELSE review_origin_status END,
       resolution_reason = $4,
       version = version + 1
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [reservationId, status, reviewOriginStatus, resolutionReason],
  );
  return mapReservation(firstRow(result));
};
