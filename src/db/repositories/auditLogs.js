import { randomUUID } from 'node:crypto';
import { databaseExecutor } from './shared.js';

export const insertAuditLog = async (event, { client, id = randomUUID() } = {}) => {
  if (!client) throw new Error('Audit mutations require an existing transaction client.');
  const result = await client.query(
    `INSERT INTO audit_logs
      (id, actor_user_id, actor_service, subject_user_id, request_id,
       event_type, resource_type, resource_id, before_state, after_state, metadata,
       network_risk_hash, device_risk_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, occurred_at, actor_user_id, actor_service, subject_user_id,
               request_id, event_type, resource_type, resource_id,
               before_state, after_state, metadata`,
    [
      id,
      event.actorUserId || null,
      event.actorService || null,
      event.subjectUserId || null,
      event.requestId || null,
      event.eventType,
      event.resourceType,
      event.resourceId || null,
      event.beforeState || null,
      event.afterState || null,
      event.metadata || {},
      event.networkRiskHash || null,
      event.deviceRiskHash || null,
    ],
  );
  const row = result.rows[0];
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    actorUserId: row.actor_user_id,
    actorService: row.actor_service,
    subjectUserId: row.subject_user_id,
    requestId: row.request_id,
    eventType: row.event_type,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    beforeState: row.before_state,
    afterState: row.after_state,
    metadata: row.metadata,
  };
};

export const listAuditLogs = async ({
  eventType = null, resourceType = null, limit = 100, client = null,
} = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT id,occurred_at,actor_user_id,actor_service,subject_user_id,request_id,
            event_type,resource_type,resource_id,before_state,after_state,metadata
     FROM audit_logs
     WHERE ($1::text IS NULL OR event_type=$1)
       AND ($2::text IS NULL OR resource_type=$2)
     ORDER BY occurred_at DESC,id DESC LIMIT $3`,
    [eventType, resourceType, limit],
  );
  return result.rows;
};
