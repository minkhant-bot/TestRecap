import { randomUUID } from 'node:crypto';
import { databaseExecutor, firstRow } from './shared.js';

export const findIdempotencyKey = async ({
  actorScope,
  operation,
  idempotencyKey,
}, { client = null, forUpdate = false } = {}) => {
  const result = await databaseExecutor(client).query(
    `SELECT id, actor_scope, operation, idempotency_key, request_hash, state,
            resource_type, resource_id, response_status, response_body,
            created_at, updated_at, expires_at
     FROM idempotency_keys
     WHERE actor_scope = $1 AND operation = $2 AND idempotency_key = $3
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [actorScope, operation, idempotencyKey],
  );
  return firstRow(result);
};

export const insertIdempotencyKey = async (record, { client, id = randomUUID() }) => {
  if (!client) throw new Error('Idempotency mutations require an existing transaction client.');
  const result = await client.query(
    `INSERT INTO idempotency_keys
      (id, actor_scope, operation, idempotency_key, request_hash, state, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'in_progress', $6)
     RETURNING id, actor_scope, operation, idempotency_key, request_hash, state,
               resource_type, resource_id, response_status, response_body,
               created_at, updated_at, expires_at`,
    [
      id,
      record.actorScope,
      record.operation,
      record.idempotencyKey,
      record.requestHash,
      record.expiresAt || null,
    ],
  );
  return firstRow(result);
};

export const claimIdempotencyKey = async (record, { client, id = randomUUID() }) => {
  if (!client) throw new Error('Idempotency mutations require an existing transaction client.');
  await client.query(
    `INSERT INTO idempotency_keys
      (id, actor_scope, operation, idempotency_key, request_hash, state, expires_at)
     VALUES ($1,$2,$3,$4,$5,'in_progress',$6)
     ON CONFLICT (actor_scope,operation,idempotency_key) DO NOTHING`,
    [id, record.actorScope, record.operation, record.idempotencyKey,
      record.requestHash, record.expiresAt || null],
  );
  return findIdempotencyKey(record, { client, forUpdate: true });
};

export const completeIdempotencyKey = async ({
  actorScope, operation, idempotencyKey, resourceType = null, resourceId = null,
  responseStatus, responseBody,
}, { client }) => firstRow(await client.query(
  `UPDATE idempotency_keys SET state='completed',resource_type=$4,resource_id=$5,
     response_status=$6,response_body=$7,updated_at=now()
   WHERE actor_scope=$1 AND operation=$2 AND idempotency_key=$3
   RETURNING *`,
  [actorScope, operation, idempotencyKey, resourceType, resourceId, responseStatus, responseBody],
));
