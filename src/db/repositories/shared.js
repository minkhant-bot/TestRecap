import { query } from '../client.js';

export const databaseExecutor = client => client || { query };

export const firstRow = result => result.rows[0] || null;

export const mapUser = row => row && ({
  id: row.id,
  firebaseUid: row.firebase_uid,
  email: row.email,
  displayName: row.display_name,
  photoUrl: row.photo_url,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastLoginAt: row.last_login_at,
});
export const mapRole = row => row && ({
  userId: row.user_id,
  role: row.role,
  source: row.source,
  assignedByUserId: row.assigned_by_user_id,
  protectedBootstrap: row.protected_bootstrap,
  version: Number(row.version),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
