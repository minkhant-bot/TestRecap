import { randomUUID } from 'node:crypto';
import { databaseExecutor, firstRow, mapUser } from './shared.js';

const USER_COLUMNS =
  'id, firebase_uid, email, display_name, photo_url, status, created_at, updated_at, last_login_at';

export const findUserByFirebaseUid = async (firebaseUid, { client = null } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT ${USER_COLUMNS} FROM users WHERE firebase_uid = $1`,
    [firebaseUid],
  );
  return mapUser(firstRow(result));
};

export const findUserById = async (id, { client = null } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return mapUser(firstRow(result));
};

export const ensureUser = async (identity, { client = null, id = randomUUID() } = {}) => {
  const result = await databaseExecutor(client).query(
    `INSERT INTO users
      (id, firebase_uid, email, display_name, photo_url, status, created_at, updated_at, last_login_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)
     ON CONFLICT (firebase_uid) DO UPDATE SET
       email = EXCLUDED.email,
       display_name = EXCLUDED.display_name,
       photo_url = EXCLUDED.photo_url,
       status = CASE
         WHEN users.status = 'disabled' THEN users.status
         ELSE EXCLUDED.status
       END,
       updated_at = EXCLUDED.updated_at,
       last_login_at = EXCLUDED.last_login_at
     RETURNING ${USER_COLUMNS}`,
    [
      id,
      identity.firebaseUid,
      identity.email || null,
      identity.displayName || '',
      identity.photoUrl || '',
      identity.status || 'active',
      identity.occurredAt || new Date(),
      identity.lastLoginAt || identity.occurredAt || new Date(),
    ],
  );
  return mapUser(firstRow(result));
};
