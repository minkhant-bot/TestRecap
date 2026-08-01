import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-workspace-retry-'));
process.env.DATA_DIR = root;
process.env.WORKSPACE_JOB_STORE_PATH = path.join(root, 'workspace-jobs.json');
process.env.JOB_STORE_PATH = path.join(root, 'core-jobs.json');

const { createWorkspaceJob, getWorkspaceJobInternal, updateWorkspaceJobInternal } = await import('./workspaceJobs.js');
const { createJob, updateJob } = await import('./jobManager.js');
const { inspectWorkspaceRetry } = await import('./workspaceRetry.js');

after(() => fs.rmSync(root, { recursive: true, force: true }));

const createFailed = () => {
    const id = randomUUID();
    const directory = path.join(root, 'uploads', 'workspace', id);
    fs.mkdirSync(directory, { recursive: true });
    const storedPath = path.join(directory, 'source.mp4');
    const audioPath = path.join(directory, 'audio.wav');
    const transcriptPath = path.join(directory, 'transcript.json');
    fs.writeFileSync(storedPath, 'source');
    fs.writeFileSync(audioPath, 'audio');
    fs.writeFileSync(transcriptPath, JSON.stringify({ segments: [{ original_text: 'hello' }] }));
    createWorkspaceJob({ id, ownerUid: 'owner', filename: 'retry.mp4', fileSize: 6, duration: 1, storedPath });
    updateWorkspaceJobInternal(id, {
        status: 'failed', stage: 'failed', failedAt: new Date().toISOString(),
        audioPath, audioDuration: 1, extractionCompletedAt: new Date().toISOString(),
        transcriptPath, transcriptSegmentCount: 1, transcriptionCompletedAt: new Date().toISOString()
    });
    return { id, directory, storedPath, audioPath, transcriptPath };
};

test('recoverability preserves the existing translate_burmese core checkpoint', () => {
    const value = createFailed();
    const cache = path.join(root, 'cache', value.id);
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'state.json'), JSON.stringify({
        workflowVersion: 2,
        stageId: 'translate_burmese',
        originalTranscript: [{ timestamp: [0, 1], text: 'hello' }]
    }));
    createJob(value.id, { ownerUid: 'owner', videoPath: value.storedPath, audioPath: value.audioPath });
    updateJob(value.id, {
        status: 'error', stageId: 'translate_burmese', progress: 30,
        retryable: true, resumeStage: 'translate_burmese'
    });
    assert.deepEqual(inspectWorkspaceRetry(getWorkspaceJobInternal(value.id)), {
        recoverable: true, resumeStage: 'translate_burmese', resumeProgress: 30
    });
});

test('recoverability fails closed for corrupt completed artifacts and inactive billing', () => {
    const corrupt = createFailed();
    fs.writeFileSync(corrupt.transcriptPath, '{broken');
    assert.equal(inspectWorkspaceRetry(getWorkspaceJobInternal(corrupt.id)).code, 'RETRY_CHECKPOINT_CORRUPT');

    const billed = createFailed();
    updateWorkspaceJobInternal(billed.id, { billing: { billingStatus: 'released' } });
    assert.deepEqual(inspectWorkspaceRetry(getWorkspaceJobInternal(billed.id)), {
        recoverable: false,
        code: 'RETRY_BILLING_STATE_UNAVAILABLE',
        reason: 'The previous billing reservation is no longer active.'
    });
});
