import express from 'express';
import os from 'node:os';
import { requireAdmin } from '../middleware/auth.js';
import { getAuditEvents, recordAuditEvent } from '../services/auditLog.js';
import { listFirebaseUsers, toUserProfile, updateFirebaseUserAccess } from '../services/firebaseAdmin.js';
import { listJobs } from '../services/jobManager.js';
import { getQueueSnapshot } from '../services/queue.js';

export const createAdminRouter = ({
    listUsers = listFirebaseUsers,
    updateAccess = updateFirebaseUserAccess,
    serializeUser = toUserProfile
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
        recordAuditEvent('admin.user.updated', {
            actorUid: req.user.uid, targetUid: req.params.uid,
            role: req.body?.role, status: req.body?.status
        });
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
