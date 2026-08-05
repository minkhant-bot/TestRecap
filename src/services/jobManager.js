import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ensureStoragePaths, getStoragePaths } from '../config/runtime.js';
import { WORKFLOW_VERSION, isJobStatus, isLegacyJob, isWorkflowStageId } from '../domain/workflow.js';

const storagePaths = ensureStoragePaths(getStoragePaths());
const statePath = process.env.JOB_STORE_PATH ||
    (process.env.NODE_TEST_CONTEXT
        ? path.join(process.env.TMPDIR || '/tmp', `testrecap-saas-state-${process.pid}.json`)
        : path.join(storagePaths.settings, 'saas-state.json'));
const keyPath = process.env.JOB_STORE_PATH
    ? statePath + '.key'
    : process.env.NODE_TEST_CONTEXT
        ? path.join(process.env.TMPDIR || '/tmp', `testrecap-encryption-${process.pid}.key`)
        : path.join(storagePaths.settings, 'encryption.key');
const jobsStore = new Map();
const encryptedJobKeys = new Map();

const encryptionKey = (() => {
    if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath);
    const generated = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, generated, { mode: 0o600 });
    return generated;
})();

const encryptJson = value => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return {
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: encrypted.toString('base64')
    };
};

const decryptJson = value => {
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm', encryptionKey, Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return JSON.parse(Buffer.concat([
        decipher.update(Buffer.from(value.data, 'base64')),
        decipher.final()
    ]).toString('utf8'));
};

const persist = () => {
    const temporaryPath = statePath + '.tmp';
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(temporaryPath, JSON.stringify({
        schemaVersion: 1,
        jobs: [...jobsStore.values()],
        credentials: Object.fromEntries(encryptedJobKeys)
    }, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryPath, statePath);
};

const load = () => {
    if (!fs.existsSync(statePath)) return;
    try {
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.jobs)) {
            throw new Error('unsupported persistent job schema');
        }
        for (const job of parsed.jobs) {
            if (job?.id) jobsStore.set(job.id, job);
        }
        for (const [id, value] of Object.entries(parsed.credentials || {})) {
            encryptedJobKeys.set(id, value);
        }
    } catch (error) {
        throw new Error(`Persistent job state could not be loaded: ${error.message}`);
    }
};

load();

export const setJobKeys = (id, keys) => {
    const existing = getJobKeys(id);
    encryptedJobKeys.set(id, encryptJson({ ...existing, ...keys }));
    persist();
};

export const getJobKeys = id => {
    const encrypted = encryptedJobKeys.get(id);
    if (!encrypted) return {};
    try {
        return decryptJson(encrypted);
    } catch {
        return {};
    }
};

export const clearJobKeys = id => {
    encryptedJobKeys.delete(id);
    persist();
};

export const createJob = (id, data) => {
    const job = {
        id,
        ownerUid: data.ownerUid || null,
        videoPath: data.videoPath,
        audioPath: data.audioPath,
        status: 'queued',
        progress: 0,
        stageId: 'upload',
        stageOutcome: null,
        workflowVersion: WORKFLOW_VERSION,
        created_at: Date.now(),
        queuedAt: Date.now(),
        originalFilename: data.originalFilename || null
    };
    if (data.mode !== undefined) job.mode = data.mode;
    jobsStore.set(id, job);
    persist();
    return getJob(id);
};

export const getJob = id => {
    const row = jobsStore.get(id);
    if (!row) return null;
    const cloned = { ...row };
    if (typeof cloned.result === 'string') {
        try { cloned.result = JSON.parse(cloned.result); } catch { }
    }
    return cloned;
};

export const listJobs = ({ ownerUid = null } = {}) =>
    [...jobsStore.values()]
        .filter(job => !ownerUid || job.ownerUid === ownerUid)
        .sort((left, right) => right.created_at - left.created_at)
        .map(job => getJob(job.id));

export const getQueuedJobs = () =>
    [...jobsStore.values()]
        .filter(job => job.status === 'queued')
        .sort((left, right) => (left.queuedAt || left.created_at) - (right.queuedAt || right.created_at))
        .map(job => getJob(job.id));

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
    for (const [key, value] of Object.entries(updates)) {
        updated[key] = key === 'result' && typeof value !== 'string'
            ? JSON.stringify(value)
            : value;
    }
    jobsStore.set(id, updated);
    persist();
};

export const getExpiredJobs = timeLimit =>
    [...jobsStore.values()]
        .filter(job => job.status === 'complete' && !job.expired &&
            job.completed_at != null && job.completed_at < timeLimit)
        .map(job => ({ id: job.id }));

export const deleteJob = id => {
    jobsStore.delete(id);
    encryptedJobKeys.delete(id);
    persist();
};

export const recoverStuckJobs = () => {
    const recovered = [];
    for (const [id, job] of jobsStore.entries()) {
        if (isLegacyJob(job)) {
            job.status = 'error';
            job.error = 'Legacy workflow job cannot resume under workflow version ' + WORKFLOW_VERSION + '. Start a new job.';
        } else if (['processing', 'queued'].includes(job.status)) {
            job.status = 'queued';
            job.error = null;
            job.queuedAt ||= job.created_at;
            recovered.push(id);
        }
        jobsStore.set(id, job);
    }
    persist();
    return recovered;
};
