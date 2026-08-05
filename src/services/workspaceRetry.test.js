import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sawaungthin-retry-'));
process.env.DATA_DIR = root;
process.env.WORKSPACE_JOB_STORE_PATH = path.join(root, 'workspace-jobs.json');
process.env.JOB_STORE_PATH = path.join(root, 'core-jobs.json');

const { createWorkspaceJob, getWorkspaceJobInternal, updateWorkspaceJobInternal } = await import('./workspaceJobs.js');
const { createJob, updateJob } = await import('./jobManager.js');
const { inspectWorkspaceRetry } = await import('./workspaceRetry.js');
const { WORKFLOW_VERSION } = await import('../domain/workflow.js');

after(() => fs.rmSync(root, { recursive: true, force: true }));

const failedWorkspace = () => {
    const id = randomUUID();
    const directory = path.join(root, 'uploads', 'workspace', id);
    fs.mkdirSync(directory, { recursive: true });
    const storedPath = path.join(directory, 'source.mp4');
    fs.writeFileSync(storedPath, 'source');
    createWorkspaceJob({ id, ownerUid: 'owner', filename: 'retry.mp4', fileSize: 6, duration: 1, storedPath });
    updateWorkspaceJobInternal(id, { status: 'failed', stage: 'failed' });
    return { id, storedPath };
};

test('v3 retry preserves a valid Faster-Whisper/translation checkpoint stage', () => {
    const value = failedWorkspace();
    const cache = path.join(root, 'cache', value.id);
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'state.json'), JSON.stringify({
        workflowVersion: WORKFLOW_VERSION,
        stageId: 'translate_burmese',
        originalTranscript: [{ timestamp: [0, 1], text: 'hello' }]
    }));
    createJob(value.id, { ownerUid: 'owner', videoPath: value.storedPath });
    updateJob(value.id, { status: 'error', stageId: 'translate_burmese', progress: 30 });
    assert.deepEqual(inspectWorkspaceRetry(getWorkspaceJobInternal(value.id)), {
        recoverable: true, resumeStage: 'translate_burmese', resumeProgress: 30
    });
});

test('pre-replacement hybrid checkpoint is recoverable only by restarting at upload', () => {
    const value = failedWorkspace();
    createJob(value.id, { ownerUid: 'owner', videoPath: value.storedPath });
    updateJob(value.id, { workflowVersion: 2, status: 'error', stageId: 'generate_tts' });
    assert.deepEqual(inspectWorkspaceRetry(getWorkspaceJobInternal(value.id)), {
        recoverable: true,
        resumeStage: 'upload',
        resumeProgress: 5,
        restartIncompatiblePipeline: true
    });
});

test('retry still rejects inactive billing reservations', () => {
    const value = failedWorkspace();
    updateWorkspaceJobInternal(value.id, { billing: { billingStatus: 'released' } });
    assert.deepEqual(inspectWorkspaceRetry(getWorkspaceJobInternal(value.id)), {
        recoverable: false,
        code: 'RETRY_BILLING_STATE_UNAVAILABLE',
        reason: 'The previous billing reservation is no longer active.'
    });
});
