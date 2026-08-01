import fs from 'node:fs';
import path from 'node:path';
import { ensureStoragePaths, getStoragePaths } from '../config/runtime.js';
import {
    WORKFLOW_VERSION,
    getWorkflowStageIndex,
    isLegacyJob,
    readCompatibleWorkflowState
} from '../domain/workflow.js';
import { getJob } from './jobManager.js';

const storagePaths = ensureStoragePaths(getStoragePaths());

export class WorkspaceRetryError extends Error {
    constructor(message, { code = 'JOB_NOT_RECOVERABLE', status = 422 } = {}) {
        super(message);
        this.name = 'WorkspaceRetryError';
        this.code = code;
        this.status = status;
    }
}

const fail = (message, code, status = 422) => {
    throw new WorkspaceRetryError(message, { code, status });
};

const validatePrivateFile = (target, root, label) => {
    if (!target) fail(`${label} checkpoint metadata is missing.`, 'RETRY_CHECKPOINT_MISSING');
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(target);
    if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
        fail(`${label} checkpoint reference is invalid.`, 'RETRY_CHECKPOINT_CORRUPT');
    }
    if (!fs.existsSync(resolved)) fail(`${label} artifact is missing.`, 'RETRY_ARTIFACT_MISSING');
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size === 0) {
        fail(`${label} artifact is corrupt.`, 'RETRY_ARTIFACT_CORRUPT');
    }
    return resolved;
};

const validateTranscript = target => {
    const transcriptPath = validatePrivateFile(target, storagePaths.uploads, 'Transcript');
    try {
        const parsed = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
        if (!Array.isArray(parsed?.segments) || parsed.segments.length === 0) throw new Error();
    } catch {
        fail('Transcript checkpoint is corrupt.', 'RETRY_CHECKPOINT_CORRUPT');
    }
};

const validateCoreCheckpoint = (workspaceJob, coreJob) => {
    if (coreJob.ownerUid && coreJob.ownerUid !== workspaceJob.ownerUid) {
        fail('Core checkpoint ownership does not match.', 'JOB_NOT_RECOVERABLE');
    }
    if (isLegacyJob(coreJob) || coreJob.workflowVersion !== WORKFLOW_VERSION) {
        fail('This project uses an incompatible workflow checkpoint.', 'RETRY_CHECKPOINT_INCOMPATIBLE', 409);
    }
    if (!coreJob.stageId) fail('Core resume-stage metadata is missing.', 'RETRY_CHECKPOINT_MISSING');
    if (coreJob.status === 'complete') {
        if (coreJob.result?.videoUrl !== `/output/${workspaceJob.id}.mp4`) {
            fail('Completed core output metadata is invalid.', 'RETRY_CHECKPOINT_CORRUPT');
        }
        validatePrivateFile(
            path.join(storagePaths.output, `${workspaceJob.id}.mp4`),
            storagePaths.output,
            'Final video'
        );
    }
    const statePath = path.join(storagePaths.cache, workspaceJob.id, 'state.json');
    validatePrivateFile(statePath, storagePaths.cache, 'Core workflow');
    let state;
    try {
        state = readCompatibleWorkflowState(fs.readFileSync(statePath, 'utf8'));
    } catch {
        fail('Core workflow checkpoint is corrupt or incompatible.', 'RETRY_CHECKPOINT_CORRUPT');
    }
    if (!state.stageId || getWorkflowStageIndex(state.stageId) < getWorkflowStageIndex(coreJob.stageId) - 1) {
        fail('Core workflow checkpoint does not match its resume stage.', 'RETRY_CHECKPOINT_CORRUPT');
    }
    if (getWorkflowStageIndex(coreJob.stageId) >= getWorkflowStageIndex('translate_burmese') &&
        (!Array.isArray(state.originalTranscript) || state.originalTranscript.length === 0)) {
        fail('Core transcript checkpoint is missing.', 'RETRY_CHECKPOINT_CORRUPT');
    }
    if (getWorkflowStageIndex(coreJob.stageId) >= getWorkflowStageIndex('generate_tts') &&
        (!Array.isArray(state.translatedTranscript) || state.translatedTranscript.length === 0)) {
        fail('Core translation checkpoint is missing.', 'RETRY_CHECKPOINT_CORRUPT');
    }
    const resumeStage = coreJob.retryable === true && coreJob.resumeStage === 'translate_burmese'
        ? 'translate_burmese'
        : coreJob.status === 'complete' ? 'final_export' : coreJob.stageId;
    return {
        resumeStage,
        resumeProgress: Number.isFinite(coreJob.progress) ? coreJob.progress : 30
    };
};

export const inspectWorkspaceRetry = workspaceJob => {
    if (!workspaceJob || workspaceJob.status !== 'failed') {
        return { recoverable: false, code: 'JOB_NOT_FAILED', reason: 'Only failed projects can be retried.' };
    }
    try {
        validatePrivateFile(workspaceJob.storedPath, storagePaths.uploads, 'Source video');
        if (workspaceJob.billing && workspaceJob.billing.billingStatus !== 'reserved') {
            fail('The previous billing reservation is no longer active.', 'RETRY_BILLING_STATE_UNAVAILABLE', 409);
        }
        if (workspaceJob.extractionCompletedAt || workspaceJob.audioPath) {
            validatePrivateFile(workspaceJob.audioPath, storagePaths.uploads, 'Audio');
        }
        if (workspaceJob.transcriptionCompletedAt || workspaceJob.transcriptPath) {
            validateTranscript(workspaceJob.transcriptPath);
        }
        const coreJob = getJob(workspaceJob.id);
        if (coreJob) {
            const core = validateCoreCheckpoint(workspaceJob, coreJob);
            return { recoverable: true, ...core };
        }
        if (workspaceJob.transcriptionCompletedAt && workspaceJob.transcriptPath) {
            return { recoverable: true, resumeStage: 'generate_tts', resumeProgress: 30 };
        }
        if (workspaceJob.extractionCompletedAt && workspaceJob.audioPath) {
            return { recoverable: true, resumeStage: 'gemini_transcript', resumeProgress: 20 };
        }
        return { recoverable: true, resumeStage: 'audio_extraction', resumeProgress: 10 };
    } catch (error) {
        if (!(error instanceof WorkspaceRetryError)) throw error;
        return { recoverable: false, code: error.code, reason: error.message };
    }
};

export const requireRecoverableWorkspaceRetry = workspaceJob => {
    const result = inspectWorkspaceRetry(workspaceJob);
    if (!result.recoverable) {
        throw new WorkspaceRetryError(result.reason, {
            code: result.code,
            status: result.code === 'RETRY_BILLING_STATE_UNAVAILABLE' ||
                result.code === 'RETRY_CHECKPOINT_INCOMPATIBLE' ? 409 : 422
        });
    }
    return result;
};

export const inspectQueuedWorkspaceRetry = workspaceJob => inspectWorkspaceRetry({
    ...workspaceJob,
    status: 'failed'
});
