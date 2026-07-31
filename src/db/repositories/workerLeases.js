import { randomUUID } from 'node:crypto';
import { databaseExecutor, firstRow } from './shared.js';

const mapLease = row => row && ({
  jobId: row.job_id,
  workerId: row.worker_id,
  leaseToken: row.lease_token,
  leasedAt: row.leased_at,
  heartbeatAt: row.heartbeat_at,
  expiresAt: row.expires_at,
  attempt: Number(row.attempt),
});

export const acquireLease = async ({
  jobId, workerId, ttlSeconds, leaseToken = randomUUID(),
}, { client }) => {
  const result = await client.query(
    `INSERT INTO worker_leases
      (job_id,worker_id,lease_token,leased_at,heartbeat_at,expires_at,attempt)
     VALUES ($1,$2,$3,now(),now(),now()+($4 * interval '1 second'),1)
     ON CONFLICT (job_id) DO UPDATE SET
       worker_id=EXCLUDED.worker_id,lease_token=EXCLUDED.lease_token,
       leased_at=now(),heartbeat_at=now(),
       expires_at=now()+($4 * interval '1 second'),
       attempt=worker_leases.attempt+1
     WHERE worker_leases.expires_at <= now()
     RETURNING job_id,worker_id,lease_token,leased_at,heartbeat_at,expires_at,attempt`,
    [jobId, workerId, leaseToken, ttlSeconds],
  );
  return mapLease(firstRow(result));
};

export const heartbeatLease = async ({
  jobId, workerId, leaseToken, ttlSeconds,
}, { client = null } = {}) => {
  const result = await databaseExecutor(client).query(
    `UPDATE worker_leases SET heartbeat_at=now(),
       expires_at=now()+($4 * interval '1 second')
     WHERE job_id=$1 AND worker_id=$2 AND lease_token=$3 AND expires_at > now()
     RETURNING job_id,worker_id,lease_token,leased_at,heartbeat_at,expires_at,attempt`,
    [jobId, workerId, leaseToken, ttlSeconds],
  );
  return mapLease(firstRow(result));
};

export const releaseLease = async ({
  jobId, workerId, leaseToken,
}, { client = null } = {}) => {
  const result = await databaseExecutor(client).query(
    `DELETE FROM worker_leases
     WHERE job_id=$1 AND worker_id=$2 AND lease_token=$3
     RETURNING job_id`,
    [jobId, workerId, leaseToken],
  );
  return Boolean(firstRow(result));
};
