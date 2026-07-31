import { databaseExecutor, firstRow } from './shared.js';

export const findBootstrapState = async (
  bootstrapName,
  { client = null, forUpdate = false } = {},
) => {
  const result = await databaseExecutor(client).query(
    `SELECT bootstrap_name, status, bootstrap_user_id, completed_at,
            disabled_at, audit_log_id, version
     FROM role_bootstrap_state
     WHERE bootstrap_name = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [bootstrapName],
  );
  return firstRow(result);
};

export const completeBootstrapState = async ({
  bootstrapName,
  userId,
  auditLogId,
}, { client }) => {
  if (!client) throw new Error('Bootstrap mutations require an existing transaction client.');
  const result = await client.query(
    `INSERT INTO role_bootstrap_state
      (bootstrap_name, status, bootstrap_user_id, completed_at, audit_log_id)
     VALUES ($1, 'completed', $2, now(), $3)
     ON CONFLICT (bootstrap_name) DO UPDATE SET
       status = CASE
         WHEN role_bootstrap_state.status = 'completed' THEN 'completed'
         ELSE EXCLUDED.status
       END,
       bootstrap_user_id = COALESCE(role_bootstrap_state.bootstrap_user_id, EXCLUDED.bootstrap_user_id),
       completed_at = COALESCE(role_bootstrap_state.completed_at, EXCLUDED.completed_at),
       audit_log_id = COALESCE(role_bootstrap_state.audit_log_id, EXCLUDED.audit_log_id),
       version = role_bootstrap_state.version + 1
     WHERE role_bootstrap_state.status <> 'disabled'
     RETURNING bootstrap_name, status, bootstrap_user_id, completed_at,
               disabled_at, audit_log_id, version`,
    [bootstrapName, userId, auditLogId],
  );
  const row = firstRow(result);
  if (!row) throw new Error('Super Admin bootstrap has been disabled.');
  return row;
};

export const disableBootstrapState = async (bootstrapName, { client }) => {
  if (!client) throw new Error('Bootstrap mutations require an existing transaction client.');
  const result = await client.query(
    `UPDATE role_bootstrap_state
     SET status = 'disabled', disabled_at = now(), version = version + 1
     WHERE bootstrap_name = $1 AND status = 'completed'
     RETURNING bootstrap_name, status, bootstrap_user_id, completed_at,
               disabled_at, audit_log_id, version`,
    [bootstrapName],
  );
  return firstRow(result);
};

