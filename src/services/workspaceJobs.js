import fs from 'node:fs';
import path from 'node:path';
import { ensureStoragePaths, getStoragePaths } from '../config/runtime.js';
import { normalizeVideoEffects } from './videoEffects.js';

const storagePaths = ensureStoragePaths(getStoragePaths());
const statePath = process.env.WORKSPACE_JOB_STORE_PATH ||
    (process.env.NODE_TEST_CONTEXT
        ? path.join(process.env.TMPDIR || '/tmp', `testrecap-workspace-jobs-${process.pid}.json`)
        : path.join(storagePaths.settings, 'workspace-jobs.json'));

const jobs = new Map();

const load = () => {
    if (!fs.existsSync(statePath)) return;
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.jobs)) {
        throw new Error('Workspace job state is incompatible.');
    }
    for (const job of parsed.jobs) {
        if (job?.id && job?.ownerUid) jobs.set(job.id, job);
    }
};

const persist = () => {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const temporary = `${statePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({
        schemaVersion: 1,
        jobs: [...jobs.values()]
    }, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, statePath);
};

export const WORKSPACE_JOB_STATUSES = Object.freeze([
    'pending', 'queued', 'processing', 'completed', 'failed', 'cancelled'
]);
export const WORKSPACE_ACTIVE_JOB_STATUSES = Object.freeze([
    'pending', 'queued', 'processing'
]);
export const WORKSPACE_ACTIVE_JOB_LIMIT = 2;
export const WORKSPACE_JOB_STAGES = Object.freeze([
    'pending', 'queued', 'preparing', 'audio_extraction', 'gemini_transcript',
    'voice_generation', 'timeline_verification', 'scene_rebuild', 'final_export',
    'completed', 'failed', 'cancelled'
]);

const publicJob = job => ({
    id: job.id,
    filename: job.filename,
    fileSize: job.fileSize,
    duration: job.duration,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    createdAt: job.createdAt,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
    cancelledAt: job.cancelledAt,
    updatedAt: job.updatedAt,
    workerId: job.workerId,
    error: job.error,
    retry: {
        attempts: job.retry?.attempts || 0,
        maxAttempts: job.retry?.maxAttempts || 0,
        lastAttemptAt: job.retry?.lastAttemptAt || null,
        resumeStage: job.retry?.resumeStage || null
    },
    recoveryCount: job.recoveryCount,
    audioDuration: job.audioDuration,
    extractionStartedAt: job.extractionStartedAt,
    extractionCompletedAt: job.extractionCompletedAt,
    transcriptSegmentCount: job.transcriptSegmentCount,
    transcriptionStartedAt: job.transcriptionStartedAt,
    transcriptionCompletedAt: job.transcriptionCompletedAt,
    videoUrl: job.videoUrl,
    audioUrl: job.audioUrl,
    effects: normalizeVideoEffects(job.effects),
    billing: job.billing || null,
    cancellationRequested: Boolean(job.cancellationRequested)
});

const assertOwnedStoragePath = storedPath => {
    const uploadsRoot = path.resolve(storagePaths.uploads);
    const target = path.resolve(storedPath);
    if (target === uploadsRoot || !target.startsWith(`${uploadsRoot}${path.sep}`)) {
        throw new Error('Workspace upload path is outside the configured storage root.');
    }
    return target;
};

load();

export const getWorkspaceJobQuota = ownerUid => {
    const activeJobCount = [...jobs.values()]
        .filter(job =>
            job.ownerUid === ownerUid &&
            WORKSPACE_ACTIVE_JOB_STATUSES.includes(job.status))
        .length;
    return {
        activeJobCount,
        activeJobLimit: WORKSPACE_ACTIVE_JOB_LIMIT,
        available: activeJobCount < WORKSPACE_ACTIVE_JOB_LIMIT
    };
};

const assertWorkspaceJobQuota = ownerUid => {
    const quota = getWorkspaceJobQuota(ownerUid);
    if (quota.available) return;
    const error = new Error(
        `A maximum of ${quota.activeJobLimit} active recap projects is allowed per user.`
    );
    error.code = 'ACTIVE_JOB_QUOTA_EXCEEDED';
    error.quota = quota;
    throw error;
};

export const createWorkspaceJob = data => {
    assertWorkspaceJobQuota(data.ownerUid);
    const now = new Date().toISOString();
    const job = {
        id: data.id,
        ownerUid: data.ownerUid,
        filename: data.filename,
        fileSize: data.fileSize,
        duration: data.duration ?? null,
        status: 'pending',
        stage: 'pending',
        progress: 0,
        createdAt: now,
        queuedAt: null,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        cancelledAt: null,
        updatedAt: now,
        workerId: null,
        error: null,
        diagnostic: null,
        retry: {
            attempts: 0,
            maxAttempts: 0,
            lastAttemptAt: null
        },
        recoveryCount: 0,
        audioPath: null,
        audioDuration: null,
        extractionStartedAt: null,
        extractionCompletedAt: null,
        transcriptPath: null,
        transcriptSegmentCount: null,
        transcriptionStartedAt: null,
        transcriptionCompletedAt: null,
        videoUrl: null,
        audioUrl: null,
        effects: normalizeVideoEffects(null),
        billing: null,
        cancellationRequested: false,
        storedPath: assertOwnedStoragePath(data.storedPath)
    };
    jobs.set(job.id, job);
    persist();
    return publicJob(job);
};

export const listWorkspaceJobs = ownerUid =>
    [...jobs.values()]
        .filter(job => job.ownerUid === ownerUid)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(publicJob);

export const getExpiredCompletedWorkspaceJobs = timeLimit =>
    [...jobs.values()]
        .filter(job =>
            job.status === 'completed' &&
            Number.isFinite(Date.parse(job.completedAt)) &&
            Date.parse(job.completedAt) < timeLimit)
        .map(job => ({ id: job.id, ownerUid: job.ownerUid }));

export const getWorkspaceJob = (id, ownerUid) => {
    const job = jobs.get(id);
    return job?.ownerUid === ownerUid ? publicJob(job) : null;
};

export const getWorkspaceJobInternal = id => jobs.get(id) || null;

export const listWorkspaceJobsForAdmission = () =>
    [...jobs.values()]
        .filter(job => Boolean(job.queuedAt))
        .map(job => ({
            id: job.id,
            ownerUid: job.ownerUid,
            queuedAt: job.queuedAt
        }));

const updateInternal = (id, updates) => {
    const existing = jobs.get(id);
    if (!existing) return null;
    if (updates.status && !WORKSPACE_JOB_STATUSES.includes(updates.status)) {
        throw new Error(`Unsupported workspace job status: ${updates.status}`);
    }
    if (updates.stage && !WORKSPACE_JOB_STAGES.includes(updates.stage)) {
        throw new Error(`Unsupported workspace job stage: ${updates.stage}`);
    }
    const updated = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString()
    };
    jobs.set(id, updated);
    persist();
    return publicJob(updated);
};

export const queueWorkspaceJob = (id, ownerUid) => {
    const job = jobs.get(id);
    if (!job || job.ownerUid !== ownerUid) return null;
    if (job.status !== 'pending') {
        const error = new Error('Only pending projects can enter the queue.');
        error.code = 'INVALID_JOB_STATE';
        throw error;
    }
    return updateInternal(id, {
        status: 'queued',
        stage: 'queued',
        progress: 0,
        queuedAt: new Date().toISOString(),
        error: null,
        diagnostic: null,
        workerId: null,
        cancellationRequested: false
    });
};

export const retryFailedWorkspaceJob = (id, ownerUid, {
    idempotencyKey, resumeStage, resumeProgress = 0
}) => {
    const job = jobs.get(id);
    if (!job || job.ownerUid !== ownerUid) return null;
    const key = String(idempotencyKey || '').trim();
    if (!key || key.length > 150) {
        const error = new Error('Idempotency-Key is required and must be at most 150 characters.');
        error.code = 'IDEMPOTENCY_KEY_REQUIRED';
        throw error;
    }
    if (['queued', 'processing'].includes(job.status)) {
        if (job.retry?.lastIdempotencyKey === key) {
            return { job: publicJob(job), replayed: true };
        }
        const error = new Error('This project is already queued or processing.');
        error.code = 'JOB_ALREADY_ACTIVE';
        throw error;
    }
    if (job.status !== 'failed') {
        const error = new Error('Only failed projects can be retried.');
        error.code = 'JOB_NOT_FAILED';
        throw error;
    }
    assertWorkspaceJobQuota(ownerUid);
    const now = new Date().toISOString();
    const updated = updateInternal(id, {
        status: 'queued',
        stage: 'queued',
        progress: Math.max(0, Math.min(99, Math.round(resumeProgress))),
        queuedAt: now,
        startedAt: null,
        failedAt: null,
        workerId: null,
        error: null,
        diagnostic: null,
        cancellationRequested: false,
        retry: {
            ...job.retry,
            attempts: (job.retry?.attempts || 0) + 1,
            lastAttemptAt: now,
            lastIdempotencyKey: key,
            resumeStage
        }
    });
    return { job: updated, replayed: false };
};

export const claimNextWorkspaceJob = workerId => {
    const next = [...jobs.values()]
        .filter(job => job.status === 'queued' && !job.workerId)
        .sort((left, right) =>
            String(left.queuedAt || left.createdAt).localeCompare(String(right.queuedAt || right.createdAt)))[0];
    if (!next) return null;
    const now = new Date().toISOString();
    updateInternal(next.id, {
        status: 'processing',
        stage: 'preparing',
        progress: 10,
        startedAt: now,
        workerId,
        error: null,
        retry: {
            ...next.retry,
            lastAttemptAt: now
        }
    });
    return getWorkspaceJobInternal(next.id);
};

export const updateWorkspaceJobInternal = (id, updates) => updateInternal(id, updates);

export const updateWorkspaceJobBilling = (id, ownerUid, billing) => {
    const job = jobs.get(id);
    if (!job || job.ownerUid !== ownerUid) return null;
    return updateInternal(id, { billing });
};

export const updateWorkspaceJobEffects = (id, ownerUid, effects) => {
    const job = jobs.get(id);
    if (!job || job.ownerUid !== ownerUid) return null;
    if (job.status !== 'pending') {
        const error = new Error('Video effects can only be changed before processing starts.');
        error.code = 'INVALID_JOB_STATE';
        throw error;
    }
    return updateInternal(id, { effects: normalizeVideoEffects(effects) });
};

export const listQueuedWorkspaceJobs = () =>
    [...jobs.values()]
        .filter(job => job.status === 'queued')
        .sort((left, right) =>
            String(left.queuedAt || left.createdAt).localeCompare(String(right.queuedAt || right.createdAt)))
        .map(publicJob);

export const getWorkspaceQueue = ownerUid => {
    const queued = listQueuedWorkspaceJobs();
    return queued
        .map((job, index) => ({ ...job, position: index + 1 }))
        .filter(job => getWorkspaceJobInternal(job.id)?.ownerUid === ownerUid);
};

export const requestWorkspaceJobCancellation = (id, ownerUid) => {
    const job = jobs.get(id);
    if (!job || job.ownerUid !== ownerUid) return null;
    if (!['queued', 'processing'].includes(job.status)) {
        const error = new Error('Only queued or processing jobs can be cancelled.');
        error.code = 'INVALID_JOB_STATE';
        throw error;
    }
    if (job.status === 'queued') {
        const now = new Date().toISOString();
        return {
            job: updateInternal(id, {
                cancellationRequested: true,
                status: 'cancelled',
                stage: 'cancelled',
                progress: 0,
                cancelledAt: now,
                workerId: null
            }),
            interruptWorker: false
        };
    }
    return {
        job: updateInternal(id, { cancellationRequested: true }),
        interruptWorker: true
    };
};

export const recoverWorkspaceJobs = () => {
    const recovered = [];
    for (const job of jobs.values()) {
        if (job.status !== 'processing') continue;
        updateInternal(job.id, {
            status: 'queued',
            stage: 'queued',
            progress: job.transcriptPath ? 30 : job.audioPath ? 20 : 0,
            startedAt: null,
            workerId: null,
            error: null,
            cancellationRequested: false,
            recoveryCount: (job.recoveryCount || 0) + 1
        });
        recovered.push(job.id);
    }
    return recovered;
};

export const requeueInterruptedWorkspaceJob = id => {
    const job = jobs.get(id);
    if (!job || job.status !== 'processing' || job.cancellationRequested === true) return null;
    return updateInternal(id, {
        status: 'queued',
        stage: 'queued',
        progress: 0,
        startedAt: null,
        workerId: null,
        error: null,
        cancellationRequested: false,
        recoveryCount: (job.recoveryCount || 0) + 1
    });
};

export const prepareWorkspaceJobDeletion = (id, ownerUid) => {
    const job = jobs.get(id);
    if (!job || job.ownerUid !== ownerUid) return null;
    if (['queued', 'processing'].includes(job.status)) {
        const error = new Error('Active jobs must be cancelled before deletion.');
        error.code = 'ACTIVE_JOB';
        throw error;
    }
    const storedPath = assertOwnedStoragePath(job.storedPath);
    const artifactPaths = [storedPath, job.audioPath, job.transcriptPath]
        .filter(Boolean)
        .map(assertOwnedStoragePath);
    for (const artifactPath of artifactPaths) {
        if (!fs.existsSync(artifactPath)) continue;
        const stat = fs.lstatSync(artifactPath);
        if (stat.isSymbolicLink() || !stat.isFile()) {
            throw new Error('Workspace upload artifact is unsafe.');
        }
    }
    return {
        id,
        ownerUid,
        artifactPaths,
        parent: path.dirname(storedPath)
    };
};

export const commitWorkspaceJobDeletion = prepared => {
    const job = jobs.get(prepared.id);
    if (!job || job.ownerUid !== prepared.ownerUid) return false;
    if (['queued', 'processing'].includes(job.status)) {
        const error = new Error('Active jobs must be cancelled before deletion.');
        error.code = 'ACTIVE_JOB';
        throw error;
    }
    for (const artifactPath of prepared.artifactPaths) {
        assertOwnedStoragePath(artifactPath);
    }
    for (const artifactPath of prepared.artifactPaths) {
        if (fs.existsSync(artifactPath)) fs.unlinkSync(artifactPath);
    }
    if (prepared.parent !== path.resolve(storagePaths.uploads) &&
        fs.existsSync(prepared.parent) &&
        fs.readdirSync(prepared.parent).length === 0) {
        fs.rmdirSync(prepared.parent);
    }
    jobs.delete(prepared.id);
    persist();
    return true;
};

export const clearWorkspaceJobsForTests = () => {
    jobs.clear();
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
};
