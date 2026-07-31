import { databaseExecutor, firstRow } from './shared.js';

export const findCurrentPlanAssignment = async (userId, { client = null, forUpdate = false } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT upa.id, upa.user_id, upa.plan_id, upa.status, upa.source,
            upa.starts_at, upa.ends_at, upa.created_at, upa.updated_at,
            p.code AS plan_code, p.name AS plan_name
     FROM user_plan_assignments upa
     JOIN plans p ON p.id = upa.plan_id
     WHERE upa.user_id = $1 AND upa.status = 'active'
     LIMIT 1${forUpdate ? ' FOR UPDATE OF upa' : ''}`,
    [userId],
  );
  const row = firstRow(result);
  return row && {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    planCode: row.plan_code,
    planName: row.plan_name,
    status: row.status,
    source: row.source,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

