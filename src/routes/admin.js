import express from 'express';
import os from 'node:os';
import { requireAdmin } from '../middleware/auth.js';
import { getAuditEvents, recordAuditEvent } from '../services/auditLog.js';
import { listFirebaseUsers, toUserProfile, updateFirebaseUserAccess } from '../services/firebaseAdmin.js';
import { listJobs } from '../services/jobManager.js';
import { getQueueSnapshot } from '../services/queue.js';
import { getDatabaseConfiguration } from '../config/database.js';
import { withTransaction } from '../db/client.js';
import { insertAuditLog } from '../db/repositories/auditLogs.js';

// Role/ban changes are Firebase-authoritative (no PostgreSQL user sync
// required for the actor or target), but must still be durably audited --
// the in-memory recordAuditEvent below is capped and lost on restart.
// actor_service (not actor_user_id) is used since the Firebase admin acting
// here may not have a PostgreSQL users row; audit_logs allows either.
const recordDurableAdminAudit = async event => {
    if (!getDatabaseConfiguration().configured) return;
    try {
        await withTransaction(client => insertAuditLog({
            actorService: 'firebase-admin',
            eventType: event.type,
            resourceType: 'firebase_user',
            resourceId: null,
            metadata: event.details,
        }, { client }));
    } catch (error) {
        console.error(JSON.stringify({
            event: 'admin.audit.durable_write_failed',
            message: error?.message || String(error),
        }));
    }
};

export const createAdminRouter = ({
    listUsers = listFirebaseUsers,
    updateAccess = updateFirebaseUserAccess,
    serializeUser = toUserProfile,
    recordDurableAudit = recordDurableAdminAudit
} = {}) => {
const router = express.Router();
router.use(requireAdmin);

router.get('/users', async (req, res) => {
    try {
        res.json(await listUsers());
    } catch (error) {
        res.status(503).json({ error: error?.message || 'Unable to list users.' });
    }
});

router.patch('/users/:uid', async (req, res) => {
    try {
        const updated = await updateAccess({
            uid: req.params.uid,
            role: req.body?.role,
            status: req.body?.status,
            actor: req.user
        });
        const auditDetails = {
            actorUid: req.user.uid, targetUid: req.params.uid,
            role: req.body?.role, status: req.body?.status
        };
        recordAuditEvent('admin.user.updated', auditDetails);
        await recordDurableAudit({ type: 'admin.user.updated', details: auditDetails });
        return res.json(serializeUser(updated));
    } catch (error) {
        return res.status(error?.status || 400).json({
            error: error?.message || 'Unable to update user.',
            ...(error?.code ? { code: error.code } : {})
        });
    }
});

router.get('/queue', (req, res) => res.json(getQueueSnapshot()));
router.get('/jobs', (req, res) => res.json(listJobs()));
router.get('/logs', (req, res) => res.json(getAuditEvents(req.query.limit)));
router.get('/system', (req, res) => res.json({
    status: 'operational',
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    platform: process.platform,
    cpuCount: os.cpus().length,
    memory: { rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed },
    queue: getQueueSnapshot()
}));

return router;
};

export default createAdminRouter();
