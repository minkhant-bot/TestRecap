import PQueue from 'p-queue';
import { processRecapPipeline } from '../workers/processor.js';
import { getJob, getQueuedJobs, updateJob } from './jobManager.js';
import { recordAuditEvent } from './auditLog.js';

const queue = new PQueue({ concurrency: 1 });
const scheduled = new Set();

export const addJobToQueue = (jobId, { preserveQueuedAt = false } = {}) => {
    const job = getJob(jobId);
    if (!job || scheduled.has(jobId) || ['complete', 'cancelled'].includes(job.status)) return false;
    if (!preserveQueuedAt) {
        updateJob(jobId, { status: 'queued', queuedAt: Date.now() });
    }
    scheduled.add(jobId);
    queue.add(async () => {
        scheduled.delete(jobId);
        const current = getJob(jobId);
        if (!current || current.status === 'cancelled') return;
        try {
            updateJob(jobId, { status: 'processing', startedAt: Date.now() });
            recordAuditEvent('queue.job.started', { jobId, ownerUid: current.ownerUid });
            await processRecapPipeline(jobId);
        } catch (error) {
            console.error(`[Queue] Job ${jobId} failed:`, error);
            updateJob(jobId, { status: 'error', error: error.message });
        }
    }).catch(error => {
        console.error(`[Queue] Unhandled job ${jobId} failure:`, error);
    });
    return true;
};

export const restoreQueuedJobs = () => {
    const restored = [];
    for (const job of getQueuedJobs()) {
        if (addJobToQueue(job.id, { preserveQueuedAt: true })) restored.push(job.id);
    }
    return restored;
};

export const cancelQueuedJob = jobId => {
    const job = getJob(jobId);
    if (!job) return { cancelled: false, reason: 'missing' };
    if (job.status !== 'queued') return { cancelled: false, reason: 'not_queued' };
    updateJob(jobId, {
        status: 'cancelled',
        cancelledAt: Date.now(),
        stageMessage: 'Cancelled before processing.'
    });
    scheduled.delete(jobId);
    recordAuditEvent('queue.job.cancelled', { jobId, ownerUid: job.ownerUid });
    return { cancelled: true };
};

export const getQueueSnapshot = () => ({
    concurrency: 1,
    pending: queue.pending,
    queued: getQueuedJobs().map((job, position) => ({
        position: position + 1,
        jobId: job.id,
        ownerUid: job.ownerUid,
        originalFilename: job.originalFilename,
        queuedAt: job.queuedAt,
        status: job.status
    }))
});
