import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sawaungthin-workspace-worker-'));
process.env.DATA_DIR = root;
process.env.WORKSPACE_JOB_STORE_PATH = path.join(root, 'workspace-jobs.json');

const {
    clearWorkspaceJobsForTests,
    createWorkspaceJob,
    getWorkspaceJob,
    getWorkspaceJobInternal,
    queueWorkspaceJob,
    requestWorkspaceJobCancellation,
    updateWorkspaceJobInternal
} = await import('./workspaceJobs.js');
const { WorkspaceWorker } = await import('./workspaceWorker.js');
const { subscribeToWorkspaceJob } = await import('./workspaceEvents.js');

const ownerUid = 'worker-owner';
const waitFor = async condition => {
    const started = Date.now();
    while (!condition()) {
        if (Date.now() - started > 2500) throw new Error('Timed out waiting for worker state.');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
};
const createPending = filename => {
    const id = randomUUID();
    const directory = path.join(root, 'uploads', 'workspace', id);
    fs.mkdirSync(directory, { recursive: true });
    const storedPath = path.join(directory, 'source.mp4');
    fs.writeFileSync(storedPath, filename);
    return createWorkspaceJob({
        id, ownerUid, filename, fileSize: filename.length, duration: null, storedPath
    });
};
const output = id => ({
    videoUrl: `/output/${id}.mp4`, audioUrl: `/output/${id}.mp3`,
    srtPath: path.join(root, 'cache', id, 'subs.srt')
});
const workerOptions = overrides => ({
    pollIntervalMs: 5,
    validateOutput: () => true,
    finalEffectsStage: async () => {},
    ...overrides
});

after(() => {
    clearWorkspaceJobsForTests();
    fs.rmSync(root, { recursive: true, force: true });
});

test('workspace runs one direct restored core pipeline at a time in FIFO order', async () => {
    clearWorkspaceJobsForTests();
    const first = createPending('first.mp4');
    const second = createPending('second.mp4');
    queueWorkspaceJob(first.id, ownerUid);
    queueWorkspaceJob(second.id, ownerUid);
    const order = [];
    let active = 0;
    let peak = 0;
    const worker = new WorkspaceWorker(workerOptions({
        coreStage: async ({ job }) => {
            active += 1;
            peak = Math.max(peak, active);
            order.push(job.filename);
            await new Promise(resolve => setTimeout(resolve, 15));
            active -= 1;
            return output(job.id);
        }
    }));
    worker.start();
    await waitFor(() => getWorkspaceJob(second.id, ownerUid)?.status === 'completed');
    await worker.stop();
    assert.deepEqual(order, ['first.mp4', 'second.mp4']);
    assert.equal(peak, 1);
});

test('SSE progress mirrors every real restored core stage without Gemini-audio progress', async () => {
    clearWorkspaceJobsForTests();
    const job = createPending('stages.mp4');
    queueWorkspaceJob(job.id, ownerUid);
    const events = [];
    const unsubscribe = subscribeToWorkspaceJob(job.id, event => events.push(event));
    const stages = [
        'extract_audio', 'detect_scenes', 'transcribe_source', 'translate_burmese',
        'generate_tts', 'build_timeline', 'rebuild_scenes', 'export_final'
    ];
    const worker = new WorkspaceWorker(workerOptions({
        coreStage: async ({ job: activeJob, onProgress }) => {
            stages.forEach((stageId, index) => onProgress({ stageId, progress: 10 + index * 10 }));
            return output(activeJob.id);
        }
    }));
    worker.start();
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'completed');
    await worker.stop();
    unsubscribe();
    const reported = events.filter(event => event.eventType === 'stage.progress')
        .map(event => event.payload.stage);
    assert.deepEqual(reported.slice(0, stages.length), [
        'audio_extraction', 'audio_extraction', 'transcript_translation', 'transcript_translation',
        'voice_generation', 'timeline_verification', 'scene_rebuild', 'final_export'
    ]);
    assert.equal(reported.includes('gemini_transcript'), false);
    assert.equal(getWorkspaceJob(job.id, ownerUid).audioUrl, `/output/${job.id}.mp3`);
});

test('a job that has already started processing cannot be cancelled and runs to completion in the background', async () => {
    clearWorkspaceJobsForTests();
    const job = createPending('cancel.mp4');
    queueWorkspaceJob(job.id, ownerUid);
    let resolveCoreStage;
    const worker = new WorkspaceWorker(workerOptions({
        coreStage: ({ job: activeJob }) => new Promise(resolve => {
            resolveCoreStage = () => resolve(output(activeJob.id));
        })
    }));
    worker.start();
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'processing');

    assert.throws(
        () => requestWorkspaceJobCancellation(job.id, ownerUid),
        error => error.code === 'INVALID_JOB_STATE',
    );
    // Rejected, not merely queued for later interruption -- the job is
    // completely undisturbed and still actively processing.
    assert.equal(getWorkspaceJob(job.id, ownerUid).status, 'processing');
    assert.equal(getWorkspaceJob(job.id, ownerUid).cancellationRequested, false);

    resolveCoreStage();
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'completed');
    await worker.stop();
    assert.equal(getWorkspaceJob(job.id, ownerUid).cancellationRequested, false);
});

test('restored stage failure remains retryable by the workspace shell without duplicate work', async () => {
    clearWorkspaceJobsForTests();
    const job = createPending('failure.mp4');
    queueWorkspaceJob(job.id, ownerUid);
    let calls = 0;
    const worker = new WorkspaceWorker(workerOptions({
        coreStage: async ({ onProgress }) => {
            calls += 1;
            onProgress({ stageId: 'translate_burmese', progress: 30 });
            throw new Error('translation provider unavailable');
        }
    }));
    worker.start();
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'failed');
    await new Promise(resolve => setTimeout(resolve, 30));
    await worker.stop();
    assert.equal(calls, 1);
    assert.equal(getWorkspaceJob(job.id, ownerUid).error, 'translation provider unavailable');
    assert.equal(getWorkspaceJobInternal(job.id).diagnostic.stage, 'transcript_translation');
});

test('a genuine pipeline failure refunds the processing-usage slot exactly once', async () => {
    clearWorkspaceJobsForTests();
    const job = createPending('refund-failure.mp4');
    queueWorkspaceJob(job.id, ownerUid);
    const refundCalls = [];
    const worker = new WorkspaceWorker(workerOptions({
        coreStage: async () => { throw new Error('pipeline exploded'); },
        admission: {
            refundProcessingStartOnFailure: (uid, jobId) => {
                refundCalls.push({ uid, jobId });
                return { refunded: true };
            }
        }
    }));
    worker.start();
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'failed');
    await worker.stop();
    assert.deepEqual(refundCalls, [{ uid: ownerUid, jobId: job.id }]);
});

test('a refund bookkeeping failure does not prevent the job from being marked failed', async () => {
    clearWorkspaceJobsForTests();
    const job = createPending('refund-error.mp4');
    queueWorkspaceJob(job.id, ownerUid);
    const worker = new WorkspaceWorker(workerOptions({
        coreStage: async () => { throw new Error('pipeline exploded'); },
        admission: {
            refundProcessingStartOnFailure: () => { throw new Error('admission store unavailable'); }
        }
    }));
    worker.start();
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'failed');
    await worker.stop();
    assert.equal(getWorkspaceJob(job.id, ownerUid).status, 'failed');
});

test('a mid-processing cancellation refunds the processing-usage slot', async () => {
    clearWorkspaceJobsForTests();
    const job = createPending('refund-cancel.mp4');
    queueWorkspaceJob(job.id, ownerUid);
    const refundCalls = [];
    const worker = new WorkspaceWorker(workerOptions({
        coreStage: ({ signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
                const error = new Error('Processing cancelled.');
                error.name = 'AbortError';
                reject(error);
            });
        }),
        admission: {
            refundProcessingStartOnFailure: (uid, jobId) => {
                refundCalls.push({ uid, jobId });
                return { refunded: true };
            }
        }
    }));
    worker.start();
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'processing');
    updateWorkspaceJobInternal(job.id, { cancellationRequested: true });
    worker.cancel(job.id);
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'cancelled');
    await worker.stop();
    assert.deepEqual(refundCalls, [{ uid: ownerUid, jobId: job.id }]);
});
