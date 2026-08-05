import { randomUUID } from 'node:crypto';
import { databaseExecutor, firstRow } from './shared.js';

const mapTrialRequest = row => row && ({
  id: row.id,
  userId: row.user_id,
  status: row.status,
  requestedAt: row.requested_at,
  reviewedAt: row.reviewed_at,
  reviewedByUserId: row.reviewed_by_user_id,
});

export const findTrialRequestByUserId = async (userId, { client = null, forUpdate = false } = {}) =>
  mapTrialRequest(firstRow(await databaseExecutor(client).query(
    `SELECT id, user_id, status, requested_at, reviewed_at, reviewed_by_user_id
     FROM trial_requests WHERE user_id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [userId],
  )));

export const findTrialRequestById = async (id, { client = null, forUpdate = false } = {}) =>
  mapTrialRequest(firstRow(await databaseExecutor(client).query(
    `SELECT id, user_id, status, requested_at, reviewed_at, reviewed_by_user_id
     FROM trial_requests WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  )));

export const insertTrialRequest = async ({ userId }, { client }) =>
  mapTrialRequest(firstRow(await client.query(
    `INSERT INTO trial_requests (id, user_id, status)
     VALUES ($1, $2, 'pending') RETURNING id, user_id, status, requested_at, reviewed_at, reviewed_by_user_id`,
    [randomUUID(), userId],
  )));

// Joins the requesting user's email/display name so the Owner review list
// is human-readable without a separate lookup round-trip.
export const listPendingTrialRequests = async ({ client = null } = {}) =>
  (await databaseExecutor(client).query(
    `SELECT r.id, r.user_id, r.status, r.requested_at, r.reviewed_at, r.reviewed_by_user_id,
            u.email AS user_email, u.display_name AS user_display_name
     FROM trial_requests r JOIN users u ON u.id = r.user_id
     WHERE r.status = 'pending' ORDER BY r.requested_at ASC`,
  )).rows.map(row => ({
    ...mapTrialRequest(row),
    userEmail: row.user_email,
    userDisplayName: row.user_display_name,
  }));

export const approveTrialRequest = async ({ id, reviewerId }, { client }) =>
  mapTrialRequest(firstRow(await client.query(
    `UPDATE trial_requests SET status = 'approved', reviewed_at = now(), reviewed_by_user_id = $2
     WHERE id = $1 AND status = 'pending'
     RETURNING id, user_id, status, requested_at, reviewed_at, reviewed_by_user_id`,
    [id, reviewerId],
  )));
