import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { ensureStoragePaths, getStoragePaths } from '../config/runtime.js';
import {
    getUploadConfiguration,
    validateSourceVideoDuration,
    VIDEO_TOO_LONG_MESSAGE
} from '../config/upload.js';
import {
    createWorkspaceJob,
    getWorkspaceJob,
    getWorkspaceJobQuota,
    getWorkspaceJobInternal,
    getWorkspaceQueue,
    listWorkspaceJobs,
    queueWorkspaceJob,
    retryFailedWorkspaceJob,
    requestWorkspaceJobCancellation,
    updateWorkspaceJobEffects,
    updateWorkspaceJobBilling
} from '../services/workspaceJobs.js';
import { deleteWorkspaceJobEverywhere } from '../services/workspaceJobDeletion.js';
import { publishWorkspaceEvent, subscribeToWorkspaceJob } from '../services/workspaceEvents.js';
import { publishQueuePositions, workspaceWorker } from '../services/workspaceWorker.js';
import { setJobKeys } from '../services/jobManager.js';
import {
    inspectWorkspaceRetry,
    requireRecoverableWorkspaceRetry,
    WorkspaceRetryError
} from '../services/workspaceRetry.js';
import { verifyGeminiApiKey } from '../services/geminiKeyVerification.js';
import { checkCreditSufficiency } from '../services/billingFoundation.js';
import { getBillingConfiguration } from '../config/billing.js';
import {
    admissionService,
    createMutationAdmissionMiddleware,
    sendAdmissionError
} from '../services/admissionControl.js';
import { getDuration } from '../ffmpeg/index.js';
import {
    isLiveJobBillingEnabled,
    releaseLiveJob,
    reserveLiveJob
} from '../services/liveJobBilling.js';

const storagePaths = ensureStoragePaths(getStoragePaths());
const incomingDirectory = path.join(storagePaths.uploads, '.incoming');
fs.mkdirSync(incomingDirectory, { recursive: true });

const removeIfPresent = target => {
    if (target && fs.existsSync(target)) fs.unlinkSync(target);
};

const removeDirectoryIfEmpty = target => {
    if (target && fs.existsSync(target) && fs.readdirSync(target).length === 0) {
        fs.rmdirSync(target);
    }
};

const isSupportedVideo = file => {
    const extension = path.extname(file.originalname).slice(1).toLowerCase();
    const type = String(file.mimetype || '').toLowerCase();
    const validType = type.startsWith('video/') ||
        ['application/octet-stream', 'application/x-matroska'].includes(type);
    return validType && getUploadConfiguration().supportedExtensions.includes(extension);
};

const sendQuotaExceeded = (res, quota) => res.status(429).json({
    error: `You can have at most ${quota.activeJobLimit} active recap projects.`,
    code: 'ACTIVE_JOB_QUOTA_EXCEEDED',
    activeJobCount: quota.activeJobCount,
    activeJobLimit: quota.activeJobLimit
});

export const createWorkspaceRouter = ({
    verifyKey = verifyGeminiApiKey,
    admission = admissionService,
    readSourceDuration = getDuration,
    liveBillingEnabled = isLiveJobBillingEnabled,
    reserveBilling = reserveLiveJob,
    releaseBilling = releaseLiveJob,
    worker = workspaceWorker,
    publishQueue = publishQueuePositions,
    // All authorized users process through the server-managed Gemini key;
    // there is no personal-key fallback here (Product rule: users are never
    // asked to provide/save/manage a personal Gemini key). Kept injectable
    // so tests can stub it without touching process.env.
    resolveServerGeminiKey = () => String(process.env.GEMINI_API_KEY || '').trim(),
    // Credit gate: a user with insufficient credits must never reach job
    // creation/queueing. Only invoked outside live billing (which already
    // enforces its own reservation-based gate via reserveBilling above).
    checkCredits = checkCreditSufficiency,
    // Whether the credit gate applies at all -- false when the PostgreSQL
    // billing foundation itself isn't configured/enabled, preserving
    // existing behavior for deployments that never activated it. Injectable
    // so tests can exercise the gate without a real DATABASE_URL.
    billingConfigured = () => getBillingConfiguration().enabled
} = {}) => {
    const router = express.Router();
    const admitMutation = endpoint => createMutationAdmissionMiddleware(admission, endpoint);

    router.get('/config', (req, res) => {
        const config = getUploadConfiguration();
        if (!config.configured) {
            return res.status(503).json({ error: 'Upload size configuration is unavailable.' });
        }
        return res.json({
            configured: true,
            maxUploadSizeMb: config.maxMegabytes,
            maxUploadSizeBytes: config.maxBytes,
            maxSourceDurationSeconds: config.maxSourceDurationSeconds,
            supportedExtensions: config.supportedExtensions
        });
    });

    router.get('/jobs', (req, res) => {
        res.json(listWorkspaceJobs(req.user.uid));
    });

    router.get('/jobs/:jobId', (req, res) => {
        const job = getWorkspaceJob(req.params.jobId, req.user.uid);
        if (!job) return res.status(404).json({ error: 'Project not found.' });
        return res.json(job);
    });

    router.get('/jobs/:jobId/source', (req, res) => {
        const job = getWorkspaceJob(req.params.jobId, req.user.uid);
        if (!job) return res.status(404).json({ error: 'Project not found.' });
        if (job.expired) return res.status(410).json({ error: 'This recap has expired.', code: 'JOB_EXPIRED' });
        const internal = getWorkspaceJobInternal(req.params.jobId);
        return res.sendFile(internal.storedPath);
    });

    router.get('/queue', (req, res) => {
        const workerSnapshot = worker.snapshot();
        res.json({
            concurrency: 1,
            worker: {
                ...workerSnapshot,
                activeJobId: workerSnapshot.activeJobId &&
                    getWorkspaceJob(workerSnapshot.activeJobId, req.user.uid)
                    ? workerSnapshot.activeJobId
                    : null
            },
            jobs: getWorkspaceQueue(req.user.uid)
        });
    });

    router.get('/jobs/:jobId/status', (req, res) => {
        const job = getWorkspaceJob(req.params.jobId, req.user.uid);
        if (!job) return res.status(404).json({ error: 'Project not found.' });
        const queued = getWorkspaceQueue(req.user.uid).find(item => item.id === job.id);
        return res.json({ ...job, queuePosition: queued?.position ?? null });
    });

    router.get('/jobs/:jobId/retry', (req, res) => {
        const job = getWorkspaceJob(req.params.jobId, req.user.uid);
        if (!job) return res.status(404).json({
            error: 'Project not found.', code: 'NOT_FOUND'
        });
        return res.json(inspectWorkspaceRetry(getWorkspaceJobInternal(req.params.jobId)));
    });

    router.post('/jobs/:jobId/retry', admitMutation('workspace.jobs.retry'), async (req, res) => {
        const idempotencyKey = String(req.get('Idempotency-Key') || '').trim();
        try {
            const job = getWorkspaceJob(req.params.jobId, req.user.uid);
            if (!job) return res.status(404).json({
                error: 'Project not found.', code: 'NOT_FOUND'
            });
            if (['queued', 'processing'].includes(job.status)) {
                const duplicate = retryFailedWorkspaceJob(req.params.jobId, req.user.uid, {
                    idempotencyKey,
                    resumeStage: job.retry?.resumeStage || 'queued',
                    resumeProgress: job.progress
                });
                return res.status(duplicate.replayed ? 200 : 409).json({
                    status: duplicate.replayed ? 'duplicate' : 'already_active',
                    replayed: duplicate.replayed,
                    code: duplicate.replayed ? 'RETRY_IDEMPOTENT_REPLAY' : 'JOB_ALREADY_ACTIVE',
                    resumeStage: duplicate.job.retry?.resumeStage || null,
                    job: duplicate.job
                });
            }
            if (job.status !== 'failed') {
                retryFailedWorkspaceJob(req.params.jobId, req.user.uid, {
                    idempotencyKey, resumeStage: 'none'
                });
            }
            const internal = getWorkspaceJobInternal(req.params.jobId);
            const eligibility = requireRecoverableWorkspaceRetry(internal);
            validateSourceVideoDuration(await readSourceDuration(internal.storedPath));
            const geminiApiKey = resolveServerGeminiKey();
            if (!geminiApiKey) {
                return res.status(503).json({
                    error: 'Recap processing is temporarily unavailable due to a service configuration issue. Please try again later.',
                    code: 'GEMINI_KEY_NOT_CONFIGURED'
                });
            }
            const result = admission.withProcessingAdmission(
                req.user.uid,
                req.params.jobId,
                () => retryFailedWorkspaceJob(req.params.jobId, req.user.uid, {
                    idempotencyKey,
                    resumeStage: eligibility.resumeStage,
                    resumeProgress: eligibility.resumeProgress
                })
            );
            setJobKeys(req.params.jobId, { geminiApiKey });
            publishWorkspaceEvent(req.params.jobId, 'job.retry_accepted', {
                ...result.job,
                resumeStage: eligibility.resumeStage,
                replayed: result.replayed
            });
            publishQueue();
            worker.wake();
            return res.status(result.replayed ? 200 : 202).json({
                status: result.replayed ? 'duplicate' : 'accepted',
                replayed: result.replayed,
                code: result.replayed ? 'RETRY_IDEMPOTENT_REPLAY' : 'RETRY_ACCEPTED',
                resumeStage: eligibility.resumeStage,
                job: result.job
            });
        } catch (error) {
            if (sendAdmissionError(res, error, req.requestId)) return;
            if (error instanceof WorkspaceRetryError) {
                return res.status(error.status).json({ error: error.message, code: error.code });
            }
            if (error?.code === 'ACTIVE_JOB_QUOTA_EXCEEDED') {
                return sendQuotaExceeded(res, error.quota);
            }
            const statusByCode = {
                IDEMPOTENCY_KEY_REQUIRED: 400,
                JOB_ALREADY_ACTIVE: 409,
                JOB_NOT_FAILED: 409
            };
            if (statusByCode[error?.code]) {
                return res.status(statusByCode[error.code]).json({
                    error: error.message, code: error.code
                });
            }
            if (error?.code === 'SOURCE_VIDEO_TOO_LONG') {
                return res.status(422).json({ error: VIDEO_TOO_LONG_MESSAGE, code: error.code });
            }
            if (error?.code === 'INVALID_SOURCE_VIDEO_DURATION') {
                return res.status(422).json({ error: error.message, code: error.code });
            }
            console.error('[Workspace retry] request failed', {
                requestId: req.requestId,
                jobId: req.params.jobId,
                message: error?.message
            });
            return res.status(500).json({
                error: 'Project retry could not be requested.', code: 'RETRY_FAILED'
            });
        }
    });

    router.post('/jobs/:jobId/queue', admitMutation('workspace.jobs.queue'), async (req, res) => {
        let reserved = false;
        try {
            const existing = getWorkspaceJob(req.params.jobId, req.user.uid);
            if (!existing) return res.status(404).json({ error: 'Project not found.' });
            const internal = getWorkspaceJobInternal(req.params.jobId);
            const sourceDurationSeconds = validateSourceVideoDuration(
                await readSourceDuration(internal.storedPath)
            );
            console.info('[Blink effects]', JSON.stringify({
                boundary: 'queue.received',
                jobId: req.params.jobId,
                effects: req.body?.effects || null
            }));
            const liveBilling = liveBillingEnabled();
            const requestedPlanCode = String(req.body?.planCode || '').trim();
            // Every plan (Trial and Pro) is blink_funded-only now -- there is no
            // BYOK mode and no personal Gemini key to resolve or verify. Every
            // authorized user, live billing or not, processes through the single
            // server-managed key; a missing/invalid key is always a generic
            // service configuration issue, never something the user is asked to
            // fix.
            const requestedMode = 'blink_funded';
            const geminiApiKey = resolveServerGeminiKey();
            if (!geminiApiKey) {
                return res.status(503).json({
                    error: 'Recap processing is temporarily unavailable due to a service configuration issue. Please try again later.',
                    code: 'GEMINI_KEY_NOT_CONFIGURED'
                });
            }
            // Credit gate: outside live billing (which reserves credits itself
            // below), a user must never be able to queue a job they cannot
            // afford. No job mutation happens above this point on failure.
            // Skipped entirely when the PostgreSQL billing foundation itself
            // isn't configured/enabled, preserving existing behavior for
            // deployments that never activated it.
            if (!liveBilling && billingConfigured()) {
                const sufficiency = await checkCredits(req.user, { sourceDurationSeconds });
                if (!sufficiency.sufficient) {
                    return res.status(402).json({
                        error: 'You do not have enough credits to process this recap.',
                        code: 'INSUFFICIENT_CREDITS',
                        requiredCredits: String(sufficiency.requiredCredits),
                        availableCredits: String(sufficiency.availableCredits)
                    });
                }
            }
            const configured = updateWorkspaceJobEffects(req.params.jobId, req.user.uid, req.body?.effects);
            if (!configured) return res.status(404).json({ error: 'Project not found.' });
            console.info('[Blink effects]', JSON.stringify({
                boundary: 'queue.persisted',
                jobId: req.params.jobId,
                effects: configured.effects
            }));
            if (liveBilling) {
                const result = await reserveBilling({
                    identity: req.user, jobId: internal.id, sourceDurationSeconds,
                    requestedPlanCode, requestedMode,
                    idempotencyKey: req.headers['idempotency-key'],
                    effects: configured.effects
                });
                reserved = true;
                updateWorkspaceJobBilling(internal.id, req.user.uid, result.snapshot);
            }
            const job = admission.withProcessingAdmission(
                req.user.uid,
                req.params.jobId,
                () => queueWorkspaceJob(req.params.jobId, req.user.uid)
            );
            if (!job) return res.status(404).json({ error: 'Project not found.' });
            setJobKeys(job.id, { geminiApiKey });
            publishWorkspaceEvent(job.id, 'job.queued', job);
            publishQueue();
            worker.wake();
            const queued = getWorkspaceQueue(req.user.uid).find(item => item.id === job.id);
            return res.status(202).json({ ...job, queuePosition: queued?.position ?? null });
        } catch (error) {
            if (reserved) {
                try {
                    await releaseBilling(req.params.jobId, 'queue_admission_failed');
                } catch (releaseError) {
                    console.error('[Workspace queue] reservation compensation failed', {
                        jobId: req.params.jobId,
                        message: releaseError?.message
                    });
                }
            }
            if (sendAdmissionError(res, error, req.requestId)) return;
            console.error('[Workspace queue] request failed', {
                requestId: req.requestId,
                jobId: req.params.jobId,
                message: error?.message,
                stack: error?.stack
            });
            if (error?.code === 'INVALID_JOB_STATE') {
                return res.status(409).json({ error: error.message });
            }
            if (error?.code === 'SOURCE_VIDEO_TOO_LONG') {
                return res.status(422).json({ error: VIDEO_TOO_LONG_MESSAGE, code: error.code });
            }
            if (error?.code === 'INVALID_SOURCE_VIDEO_DURATION') {
                return res.status(422).json({ error: error.message, code: error.code });
            }
            if (error?.name === 'BillingError') {
                return res.status(error.status).json({ error: error.message, code: error.code });
            }
            return res.status(500).json({ error: 'Project could not enter the queue.' });
        }
    });

    router.post('/jobs/:jobId/cancel', admitMutation('workspace.jobs.cancel'), async (req, res) => {
        try {
            const result = requestWorkspaceJobCancellation(req.params.jobId, req.user.uid);
            if (!result) return res.status(404).json({ error: 'Project not found.' });
            if (result.interruptWorker) worker.cancel(req.params.jobId);
            if (!result.interruptWorker && liveBillingEnabled() && result.job.billing) {
                const billing = await releaseBilling(req.params.jobId, 'job_cancelled_before_start');
                result.job = updateWorkspaceJobBilling(
                    req.params.jobId, req.user.uid, billing
                );
            }
            publishWorkspaceEvent(
                req.params.jobId,
                result.interruptWorker ? 'job.cancellation_requested' : 'job.cancelled',
                result.job
            );
            publishQueue();
            return res.status(202).json(result.job);
        } catch (error) {
            if (error?.code === 'INVALID_JOB_STATE') {
                return res.status(409).json({ error: error.message });
            }
            return res.status(500).json({ error: 'Cancellation could not be requested.' });
        }
    });

    router.get('/jobs/:jobId/events', (req, res) => {
        const job = getWorkspaceJob(req.params.jobId, req.user.uid);
        if (!job) return res.status(404).json({ error: 'Project not found.' });

        res.set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive'
        });
        res.flushHeaders();
        const send = event => {
            res.write(`id: ${event.eventId}\n`);
            res.write(`event: ${event.eventType}\n`);
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        res.write(`event: job.snapshot\n`);
        res.write(`data: ${JSON.stringify({
            eventType: 'job.snapshot',
            jobId: job.id,
            occurredAt: new Date().toISOString(),
            payload: {
                ...job,
                queuePosition: getWorkspaceQueue(req.user.uid).find(item => item.id === job.id)?.position ?? null
            }
        })}\n\n`);

        const unsubscribe = subscribeToWorkspaceJob(job.id, send);
        const heartbeat = setInterval(() => {
            res.write(`event: heartbeat\ndata: ${JSON.stringify({ occurredAt: new Date().toISOString() })}\n\n`);
        }, 15000);
        heartbeat.unref?.();
        req.on('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
        });
    });

    router.delete('/jobs/:jobId', admitMutation('workspace.jobs.delete'), (req, res) => {
        try {
            const deleted = deleteWorkspaceJobEverywhere(req.params.jobId, req.user.uid);
            if (!deleted) return res.status(404).json({ error: 'Project not found.' });
            return res.json({ deleted: true, jobId: req.params.jobId });
        } catch (error) {
            if (['ACTIVE_JOB', 'ACTIVE_CORE_JOB', 'JOB_OWNERSHIP_MISMATCH'].includes(error?.code)) {
                if (error.code === 'JOB_OWNERSHIP_MISMATCH') {
                    console.warn('[Workspace delete] ownership mismatch', {
                        requestId: req.requestId || null,
                        jobId: req.params.jobId,
                        ownerUid: req.user.uid
                    });
                }
                return res.status(409).json({ error: error.message });
            }
            console.error('[Workspace delete] request failed', {
                requestId: req.requestId || null,
                jobId: req.params.jobId,
                code: error?.code,
                message: error?.message,
                stack: error?.stack
            });
            return res.status(500).json({ error: 'Project files could not be removed safely.' });
        }
    });

    router.post('/jobs', admitMutation('workspace.jobs.upload'), (req, res) => {
        const config = getUploadConfiguration();
        if (!config.configured) {
            return res.status(503).json({ error: 'Upload size configuration is unavailable.' });
        }
        const initialQuota = getWorkspaceJobQuota(req.user.uid);
        if (!initialQuota.available) return sendQuotaExceeded(res, initialQuota);

        const upload = multer({
            storage: multer.diskStorage({
                destination: incomingDirectory,
                filename: (request, file, callback) => {
                    const temporaryName = `${randomUUID()}.upload`;
                    request.workspaceTempPath = path.join(incomingDirectory, temporaryName);
                    callback(null, temporaryName);
                }
            }),
            limits: { fileSize: config.maxBytes, files: 1 }
        }).single('video');

        let completed = false;
        req.once('aborted', () => {
            if (!completed) removeIfPresent(req.workspaceTempPath);
        });

        upload(req, res, async error => {
            completed = true;
            if (error) {
                removeIfPresent(req.workspaceTempPath);
                if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
                    return res.status(413).json({ error: 'The selected video exceeds the configured upload limit.' });
                }
                return res.status(400).json({ error: 'The video could not be uploaded.' });
            }

            const file = req.file;
            if (!file) return res.status(400).json({ error: 'Select a video to upload.' });
            if (!isSupportedVideo(file)) {
                removeIfPresent(file.path);
                return res.status(415).json({ error: 'This video format is not supported.' });
            }

            let sourceDurationSeconds;
            try {
                sourceDurationSeconds = validateSourceVideoDuration(await readSourceDuration(file.path));
            } catch (durationError) {
                removeIfPresent(file.path);
                if (durationError?.code === 'SOURCE_VIDEO_TOO_LONG') {
                    return res.status(422).json({
                        error: VIDEO_TOO_LONG_MESSAGE,
                        code: durationError.code
                    });
                }
                return res.status(422).json({
                    error: 'Video duration could not be verified.',
                    code: 'INVALID_SOURCE_VIDEO_DURATION'
                });
            }

            // All authorized users process through the server-managed key -- there
            // is no personal-key fallback. A missing or invalid server key is a
            // service configuration issue, blocked here safely and reported
            // without exposing the key or blaming the user.
            const liveBilling = liveBillingEnabled();
            const geminiApiKey = liveBilling ? null : resolveServerGeminiKey();
            if (!liveBilling) {
                if (!geminiApiKey) {
                    removeIfPresent(file.path);
                    return res.status(503).json({
                        error: 'Recap creation is temporarily unavailable due to a service configuration issue. Please try again later.',
                        code: 'GEMINI_KEY_NOT_CONFIGURED'
                    });
                }
                const verification = await verifyKey(geminiApiKey);
                if (!verification.valid) {
                    removeIfPresent(file.path);
                    const status = verification.retryable ? 503 : 500;
                    return res.status(status).json({
                        error: 'Recap creation is temporarily unavailable due to a service configuration issue. Please try again later.',
                        code: 'GEMINI_KEY_INVALID'
                    });
                }
            }

            const jobId = randomUUID();
            const extension = path.extname(file.originalname).slice(1).toLowerCase();
            const jobDirectory = path.join(storagePaths.uploads, 'workspace', jobId);
            const storedPath = path.join(jobDirectory, `source.${extension}`);
            try {
                fs.mkdirSync(jobDirectory, { recursive: true });
                fs.renameSync(file.path, storedPath);
                const job = createWorkspaceJob({
                    id: jobId,
                    ownerUid: req.user.uid,
                    filename: file.originalname,
                    fileSize: file.size,
                    duration: sourceDurationSeconds,
                    storedPath
                });
                if (geminiApiKey) setJobKeys(job.id, { geminiApiKey });
                return res.status(201).json(job);
            } catch (error) {
                removeIfPresent(file.path);
                removeIfPresent(storedPath);
                removeDirectoryIfEmpty(jobDirectory);
                if (error?.code === 'ACTIVE_JOB_QUOTA_EXCEEDED') {
                    return sendQuotaExceeded(res, error.quota);
                }
                return res.status(500).json({ error: 'The uploaded project could not be saved.' });
            }
        });
    });

    return router;
};

export default createWorkspaceRouter();
