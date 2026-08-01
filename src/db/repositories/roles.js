import { databaseExecutor, firstRow, mapRole } from './shared.js';

const ROLE_COLUMNS =
  'user_id, role, source, assigned_by_user_id, protected_bootstrap, version, created_at, updated_at';

export const findRoleByUserId = async (userId, { client = null, forUpdate = false } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT ${ROLE_COLUMNS} FROM user_roles WHERE user_id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [userId],
  );
  return mapRole(firstRow(result));
};
export const assignRole = async ({
  userId,
  role,
  source,
  assignedByUserId = null,
  protectedBootstrap = false,
}, { client }) => {
  if (!client) throw new Error('Role mutations require an existing transaction client.');
  const result = await client.query(
    `INSERT INTO user_roles
      (user_id, role, source, assigned_by_user_id, protected_bootstrap)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       role = EXCLUDED.role,
       source = EXCLUDED.source,
       assigned_by_user_id = EXCLUDED.assigned_by_user_id,
       protected_bootstrap = user_roles.protected_bootstrap OR EXCLUDED.protected_bootstrap,
       version = user_roles.version + 1,
       updated_at = now()
     WHERE NOT user_roles.protected_bootstrap
        OR (EXCLUDED.role = 'super_admin' AND EXCLUDED.protected_bootstrap)
     RETURNING ${ROLE_COLUMNS}`,
    [userId, role, source, assignedByUserId, protectedBootstrap],
  );
  const row = firstRow(result);
  if (!row) throw new Error('Protected bootstrap Super Admin role cannot be changed.');
  return mapRole(row);
};
