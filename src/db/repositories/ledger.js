import { randomUUID } from 'node:crypto';
import { databaseExecutor } from './shared.js';

export const insertLedgerEntry = async (entry, { client, id = randomUUID() }) => {
  if (!client) throw new Error('Ledger mutations require an existing transaction client.');
  const result = await client.query(
    `INSERT INTO credit_ledger
      (id, user_id, amount, entry_type, purchase_request_id, reservation_id,
       job_id, reversal_of_entry_id, correlation_key, reason, created_by_user_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, user_id, amount, entry_type, purchase_request_id, reservation_id,
               job_id, reversal_of_entry_id, correlation_key, reason,
               created_by_user_id, metadata, created_at`,
    [
      id,
      entry.userId,
      String(entry.amount),
      entry.entryType,
      entry.purchaseRequestId || null,
      entry.reservationId || null,
      entry.jobId || null,
      entry.reversalOfEntryId || null,
      entry.correlationKey,
      entry.reason || null,
      entry.createdByUserId || null,
      entry.metadata || {},
    ],
  );
  return mapLedgerEntry(result.rows[0]);
};

export const listLedgerEntries = async (userId, { client = null, limit = 100 } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT id, user_id, amount, entry_type, purchase_request_id, reservation_id,
            job_id, reversal_of_entry_id, correlation_key, reason,
            created_by_user_id, metadata, created_at
     FROM credit_ledger
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [userId, limit],
  );
  return result.rows.map(mapLedgerEntry);
};

export const sumPostedCredits = async (userId, { client = null } = {}) => {
  const result = await databaseExecutor(client).query(
    'SELECT COALESCE(sum(amount), 0)::BIGINT AS total FROM credit_ledger WHERE user_id = $1',
    [userId],
  );
  return BigInt(result.rows[0].total);
};

export const sumReservedCredits = async (userId, { client = null } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT COALESCE(sum(amount), 0)::BIGINT AS total
     FROM credit_reservations
     WHERE user_id = $1 AND status IN ('reserved', 'review_required')`,
    [userId],
  );
  return BigInt(result.rows[0].total);
};

const mapLedgerEntry = row => ({
  id: row.id,
  userId: row.user_id,
  amount: BigInt(row.amount),
  entryType: row.entry_type,
  purchaseRequestId: row.purchase_request_id,
  reservationId: row.reservation_id,
  jobId: row.job_id,
  reversalOfEntryId: row.reversal_of_entry_id,
  correlationKey: row.correlation_key,
  reason: row.reason,
  createdByUserId: row.created_by_user_id,
  metadata: row.metadata,
  createdAt: row.created_at,
});
