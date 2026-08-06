import { randomUUID } from 'node:crypto';
import { databaseExecutor } from './shared.js';

const jsonParameter = value => value === null || value === undefined
  ? null
  : JSON.stringify(value);

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
      jsonParameter(event.beforeState),
      jsonParameter(event.afterState),
      jsonParameter(event.metadata || {}),
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

// User-scoped job-credit lifecycle events (reservation created / released) --
// read-only, metadata-only rows that never touch credit_ledger or any
// balance projection. Used only to surface reservation/release visibility in
// the user-facing ledger view (see getLedger); settlement and refund already
// have their own real credit_ledger rows and are not queried here.
export const listJobCreditAuditEventsForUser = async (subjectUserId, {
  eventTypes = ['job.credits_reserved', 'job.credits_reserved_retry', 'job.credits_released'],
  limit = 100, client = null,
} = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT id,occurred_at,subject_user_id,event_type,resource_id,after_state
     FROM audit_logs
     WHERE subject_user_id=$1 AND resource_type='job' AND event_type = ANY($2::text[])
     ORDER BY occurred_at DESC,id DESC LIMIT $3`,
    [subjectUserId, eventTypes, limit],
  );
  return result.rows.map(row => ({
    id: row.id,
    occurredAt: row.occurred_at,
    eventType: row.event_type,
    jobId: row.resource_id,
    afterState: row.after_state,
  }));
};
