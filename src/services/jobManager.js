import { WORKFLOW_VERSION, isJobStatus, isLegacyJob, isWorkflowStageId } from '../domain/workflow.js';

const jobsStore = new Map();
const jobKeys = new Map();

export const setJobKeys = (id, keys) => {
    jobKeys.set(id, keys);
};

export const getJobKeys = (id) => {
    return jobKeys.get(id) || {};
};

export const clearJobKeys = (id) => {
    jobKeys.delete(id);
};

export const createJob = (id, data) => {
    const job = {
        id,
        videoPath: data.videoPath,
        audioPath: data.audioPath,
        status: 'queued',
        progress: 0,
        stageId: 'upload',
        stageOutcome: null,
        workflowVersion: WORKFLOW_VERSION,
        created_at: Date.now(),
        originalFilename: data.originalFilename || null

    };
    if (data.mode !== undefined) job.mode = data.mode;
    jobsStore.set(id, job);
    return getJob(id);
};

export const getJob = (id) => {
    const row = jobsStore.get(id);
    if (!row) return null;
    const cloned = { ...row };
    if (typeof cloned.result === 'string') {
        try { cloned.result = JSON.parse(cloned.result); } catch (e) {}
    }
    return cloned;
};

export const updateJob = (id, updates) => {
    const existing = jobsStore.get(id);
    if (!existing) return;
    
    if (updates.status !== undefined && !isJobStatus(updates.status)) {
        throw new Error('Invalid job lifecycle status: ' + updates.status);
    }
    if (updates.stageId !== undefined && !isWorkflowStageId(updates.stageId)) {
        throw new Error('Invalid workflow stage ID: ' + updates.stageId);
    }
    const updated = { ...existing };
    for (const [k, v] of Object.entries(updates)) {
        if (k === 'result' && typeof v !== 'string') {
            updated[k] = JSON.stringify(v);
        } else {
            updated[k] = v;
        }
    }
    jobsStore.set(id, updated);
};

export const getExpiredJobs = (timeLimit) => {
    const expired = [];
    for (const [id, job] of jobsStore.entries()) {
        if (job.status === 'complete' && job.completed_at != null && job.completed_at < timeLimit) {
            expired.push({ id });
        }
    }
    return expired;
};

export const deleteJob = (id) => {
    jobsStore.delete(id);
};

export const recoverStuckJobs = () => {
    for (const [id, job] of jobsStore.entries()) {
        if (isLegacyJob(job)) {
            job.status = 'error';
            job.error = 'Legacy workflow job cannot resume under workflow version ' + WORKFLOW_VERSION + '. Start a new job.';
            jobsStore.set(id, job);
        } else if (['processing', 'queued'].includes(job.status)) {
            job.status = 'error';
            job.error = 'Job interrupted due to server restart.';
            jobsStore.set(id, job);
        }
    }
};
