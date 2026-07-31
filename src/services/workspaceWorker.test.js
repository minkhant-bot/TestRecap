import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testrecap-workspace-worker-'));
process.env.DATA_DIR = temporaryRoot;
process.env.WORKSPACE_JOB_STORE_PATH = path.join(temporaryRoot, 'workspace-jobs.json');

const {
    claimNextWorkspaceJob,
    clearWorkspaceJobsForTests,
    createWorkspaceJob,
    getWorkspaceJob,
    getWorkspaceJobInternal,
    queueWorkspaceJob,
    requestWorkspaceJobCancellation,
    updateWorkspaceJobEffects
} = await import('./workspaceJobs.js');
const { WorkspaceWorker, createGeminiFailureDiagnostic } = await import('./workspaceWorker.js');
const { subscribeToWorkspaceJob } = await import('./workspaceEvents.js');

const ownerUid = 'worker-test-owner';
const waitFor = async (condition, timeoutMs = 2000) => {
    const started = Date.now();
    while (!condition()) {
        if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for worker state.');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
};

const createPending = filename => {
    const id = randomUUID();
    const directory = path.join(temporaryRoot, 'uploads', 'workspace', id);
    fs.mkdirSync(directory, { recursive: true });
    const storedPath = path.join(directory, 'source.mp4');
    fs.writeFileSync(storedPath, filename);
    return createWorkspaceJob({
        id,
        ownerUid,
        filename,
        fileSize: filename.length,
        duration: null,
        storedPath
    });
};

after(() => {
    clearWorkspaceJobsForTests();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test('persistent worker processes FIFO with concurrency one and backend progress events', async () => {
    clearWorkspaceJobsForTests();
    const first = createPending('first.mp4');
    const second = createPending('second.mp4');
    updateWorkspaceJobEffects(first.id, ownerUid, {
        colorGrading: 'cinematic',
        flipVideoEnabled: true
    });
    queueWorkspaceJob(first.id, ownerUid);
    await new Promise(resolve => setTimeout(resolve, 2));
    queueWorkspaceJob(second.id, ownerUid);

    const order = [];
    const progressEvents = [];
    let active = 0;
    let peak = 0;
    const effectsCalls = [];
    const coreCalls = [];
    const unsubscribe = subscribeToWorkspaceJob(first.id, event => progressEvents.push(event));
    const worker = new WorkspaceWorker({
        workerId: 'fifo-worker',
        pollIntervalMs: 5,
        executeStage: async ({ job, reportProgress }) => {
            active += 1;
            peak = Math.max(peak, active);
            order.push(job.filename);
            reportProgress(55);
            await new Promise(resolve => setTimeout(resolve, 20));
            active -= 1;
            return {
                audioPath: path.join(path.dirname(job.storedPath), 'audio.wav'),
                audioDuration: 1.25
            };
        },
        translateStage: async ({ job }) => ({
            transcriptPath: path.join(path.dirname(job.storedPath), 'gemini-transcript.json'),
            segmentCount: 2,
            model: 'test-model'
        }),
        coreStage: async input => {
            coreCalls.push(input);
            return {
                videoUrl: `/output/${input.job.id}.mp4`,
                audioUrl: `/output/${input.job.id}.mp3`,
                srtPath: path.join(temporaryRoot, 'cache', input.job.id, 'subs.srt')
            };
        },
        finalEffectsStage: async input => {
            effectsCalls.push(input);
            input.onProgress('Verify Output');
        }
    });
    worker.start();
    await waitFor(() => getWorkspaceJob(second.id, ownerUid)?.status === 'completed');
    await worker.stop();
    unsubscribe();

    assert.deepEqual(order, ['first.mp4', 'second.mp4']);
    assert.equal(peak, 1);
    assert.equal(worker.snapshot().concurrency, 1);
    assert.equal(worker.snapshot().running, false);
    assert.equal(effectsCalls.length, 2);
    assert.ok(coreCalls[0].signal instanceof AbortSignal);
    assert.equal(coreCalls[0].isCancellationRequested(), false);
    assert.equal(effectsCalls[0].signal, coreCalls[0].signal);
    assert.equal(effectsCalls[0].subtitleSrtPath, path.join(temporaryRoot, 'cache', first.id, 'subs.srt'));
    assert.equal(effectsCalls[0].effects.colorGrading, 'cinematic');
    assert.equal(effectsCalls[0].effects.flipVideoEnabled, true);
    assert.equal(effectsCalls[0].effects.burnSubtitlesEnabled, false);
    assert.equal(effectsCalls[0].inputPath, path.join(temporaryRoot, 'output', `${first.id}.mp4`));
    assert.equal(getWorkspaceJob(first.id, ownerUid).videoUrl, `/output/${first.id}.mp4`);
    assert.equal(getWorkspaceJob(first.id, ownerUid).progress, 100);
    assert.equal(getWorkspaceJob(first.id, ownerUid).audioDuration, 1.25);
    assert.ok(getWorkspaceJob(first.id, ownerUid).extractionStartedAt);
    assert.ok(getWorkspaceJob(first.id, ownerUid).extractionCompletedAt);
    assert.equal(getWorkspaceJob(first.id, ownerUid).transcriptSegmentCount, 2);
    assert.ok(getWorkspaceJob(first.id, ownerUid).transcriptionStartedAt);
    assert.ok(getWorkspaceJob(first.id, ownerUid).transcriptionCompletedAt);
    assert.equal('audioPath' in getWorkspaceJob(first.id, ownerUid), false);
    assert.equal(getWorkspaceJobInternal(first.id).audioPath, path.join(
        path.dirname(getWorkspaceJobInternal(first.id).storedPath),
        'audio.wav'
    ));
    assert.ok(progressEvents.some(event =>
        event.eventType === 'stage.started' && event.payload.stage === 'audio_extraction'));
    assert.ok(progressEvents.some(event => event.eventType === 'stage.progress' && event.payload.progress === 55));
    assert.ok(progressEvents.some(event =>
        event.eventType === 'stage.progress' &&
        event.payload.stage === 'final_export' &&
        event.payload.progress === 99));
    assert.ok(progressEvents.some(event =>
        event.eventType === 'stage.completed' && event.payload.audioDuration === 1.25));
    assert.ok(progressEvents.some(event =>
        event.eventType === 'stage.started' && event.payload.stage === 'gemini_transcript'));
    assert.ok(progressEvents.some(event => event.eventType === 'job.completed'));
});

test('worker cancels active work, invokes cleanup, and shuts down gracefully', async () => {
    clearWorkspaceJobsForTests();
    const job = createPending('cancel.mp4');
    queueWorkspaceJob(job.id, ownerUid);
    let cleanupCalls = 0;
    let statusDuringCleanup = null;
    const worker = new WorkspaceWorker({
        workerId: 'cancel-worker',
        pollIntervalMs: 5,
        executeStage: ({ signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => {
                const error = new Error('cancelled');
                error.name = 'AbortError';
                reject(error);
            }, { once: true });
        }),
        coreStage: async () => ({}),
        cleanup: async () => {
            cleanupCalls += 1;
            statusDuringCleanup = getWorkspaceJob(job.id, ownerUid);
        }
    });
    worker.start();
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'processing');
    const cancellation = requestWorkspaceJobCancellation(job.id, ownerUid);
    assert.equal(cancellation.interruptWorker, true);
    assert.equal(cancellation.job.status, 'processing');
    assert.equal(cancellation.job.cancellationRequested, true);
    worker.cancel(job.id);
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'cancelled');
    await worker.stop();
    assert.equal(cleanupCalls, 1);
    assert.equal(statusDuringCleanup.status, 'processing');
    assert.equal(statusDuringCleanup.cancellationRequested, true);
    assert.ok(getWorkspaceJob(job.id, ownerUid).cancelledAt);
    assert.equal(getWorkspaceJob(job.id, ownerUid).workerId, null);
    assert.equal(getWorkspaceJob(job.id, ownerUid).cancellationRequested, true);
});

test('backend stop abort requeues the same job without cancelling it', async () => {
    clearWorkspaceJobsForTests();
    const job = createPending('restart.mp4');
    queueWorkspaceJob(job.id, ownerUid);
    const worker = new WorkspaceWorker({
        workerId: 'restart-worker',
        pollIntervalMs: 5,
        executeStage: ({ signal }) => new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => {
                const error = new Error('worker stopped');
                error.name = 'AbortError';
                reject(error);
            }, { once: true });
        })
    });
    worker.start();
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'processing');
    await worker.stop();
    const recovered = getWorkspaceJob(job.id, ownerUid);
    assert.equal(recovered.id, job.id);
    assert.equal(recovered.status, 'queued');
    assert.equal(recovered.stage, 'queued');
    assert.equal(recovered.cancellationRequested, false);
    assert.equal(recovered.recoveryCount, 1);
});

test('AbortError without explicit cancellation fails and preserves its error', async () => {
    clearWorkspaceJobsForTests();
    const job = createPending('unexpected-abort.mp4');
    queueWorkspaceJob(job.id, ownerUid);
    const worker = new WorkspaceWorker({
        workerId: 'abort-worker',
        pollIntervalMs: 5,
        executeStage: async () => {
            const error = new Error('upstream stream aborted unexpectedly');
            error.name = 'AbortError';
            throw error;
        }
    });
    worker.start();
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'failed');
    await worker.stop();
    const failed = getWorkspaceJob(job.id, ownerUid);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error, 'upstream stream aborted unexpectedly');
    assert.equal(failed.cancellationRequested, false);
});

test('workspace worker mirrors every restored core stage and exposes both completed outputs', async () => {
    clearWorkspaceJobsForTests();
    const job = createPending('restored-core.mp4');
    queueWorkspaceJob(job.id, ownerUid);
    const events = [];
    const unsubscribe = subscribeToWorkspaceJob(job.id, event => events.push(event));
    const worker = new WorkspaceWorker({
        workerId: 'restored-core-worker',
        pollIntervalMs: 5,
        executeStage: async ({ job: activeJob }) => ({
            audioPath: path.join(path.dirname(activeJob.storedPath), 'audio.wav'),
            audioDuration: 2
        }),
        translateStage: async ({ job: activeJob }) => ({
            transcriptPath: path.join(path.dirname(activeJob.storedPath), 'gemini-transcript.json'),
            segmentCount: 1
        }),
        coreStage: async ({ job: activeJob, onProgress }) => {
            onProgress({ stageId: 'generate_tts', progress: 35 });
            onProgress({ stageId: 'build_timeline', progress: 70 });
            onProgress({ stageId: 'rebuild_scenes', progress: 92 });
            onProgress({ stageId: 'export_final', progress: 99 });
            return {
                videoUrl: `/output/${activeJob.id}.mp4`,
                audioUrl: `/output/${activeJob.id}.mp3`
            };
        }
    });
    worker.start();
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'completed');
    await worker.stop();
    unsubscribe();

    const completed = getWorkspaceJob(job.id, ownerUid);
    assert.equal(completed.videoUrl, `/output/${job.id}.mp4`);
    assert.equal(completed.audioUrl, `/output/${job.id}.mp3`);
    assert.deepEqual(
        events
            .filter(event => event.eventType === 'stage.progress')
            .map(event => event.payload.stage)
            .filter(stage => [
                'voice_generation', 'timeline_verification', 'scene_rebuild', 'final_export'
            ].includes(stage)),
        ['voice_generation', 'timeline_verification', 'scene_rebuild', 'final_export', 'final_export']
    );
    assert.ok(events.some(event =>
        event.eventType === 'stage.progress' &&
        event.payload.stage === 'final_export' &&
        event.payload.progress === 99));
});

test('a missing final MP4 fails the workspace job with the original safe export error', async () => {
    clearWorkspaceJobsForTests();
    const job = createPending('missing-output.mp4');
    queueWorkspaceJob(job.id, ownerUid);
    const worker = new WorkspaceWorker({
        workerId: 'missing-output-worker',
        pollIntervalMs: 5,
        executeStage: async ({ job: activeJob }) => ({
            audioPath: path.join(path.dirname(activeJob.storedPath), 'audio.wav'),
            audioDuration: 2
        }),
        translateStage: async ({ job: activeJob }) => ({
            transcriptPath: path.join(path.dirname(activeJob.storedPath), 'gemini-transcript.json'),
            segmentCount: 1
        }),
        coreStage: async ({ onProgress }) => {
            onProgress({ stageId: 'export_final', progress: 99 });
            throw new Error('The completed core job has no final MP4 artifact.');
        }
    });
    worker.start();
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'failed');
    await worker.stop();

    const failed = getWorkspaceJob(job.id, ownerUid);
    const internalFailure = getWorkspaceJobInternal(job.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.stage, 'failed');
    assert.equal(failed.videoUrl, null);
    assert.equal(failed.error, 'The completed core job has no final MP4 artifact.');
    assert.equal(internalFailure.diagnostic.stage, 'final_export');
    assert.equal(internalFailure.diagnostic.message, failed.error);
});

test('startup recovers a persistently locked job after a crash', async () => {
    clearWorkspaceJobsForTests();
    const job = createPending('recovered.mp4');
    queueWorkspaceJob(job.id, ownerUid);
    const claimed = claimNextWorkspaceJob('dead-worker');
    assert.equal(claimed.id, job.id);
    assert.equal(getWorkspaceJob(job.id, ownerUid).status, 'processing');

    const worker = new WorkspaceWorker({
        workerId: 'recovery-worker',
        pollIntervalMs: 5,
        executeStage: async () => {},
        translateStage: async () => {},
        coreStage: async ({ job: activeJob }) => ({
            videoUrl: `/output/${activeJob.id}.mp4`
        })
    });
    worker.start();
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'completed');
    await worker.stop();
    assert.equal(getWorkspaceJob(job.id, ownerUid).recoveryCount, 1);
    assert.equal(getWorkspaceJob(job.id, ownerUid).workerId, null);
});

test('live worker requires a lease, resumes validated checkpoints, and settles after output validation', async () => {
    clearWorkspaceJobsForTests();
    const job = createPending('live-recovery.mp4');
    const internal = getWorkspaceJobInternal(job.id);
    internal.billing = { billingStatus: 'reserved', billingMode: 'byok' };
    internal.audioPath = path.join(path.dirname(internal.storedPath), 'audio.wav');
    internal.transcriptPath = path.join(path.dirname(internal.storedPath), 'transcript.json');
    fs.writeFileSync(internal.audioPath, 'validated audio');
    fs.writeFileSync(internal.transcriptPath, '{"segments":[{}]}');
    queueWorkspaceJob(job.id, ownerUid);
    const calls = [];
    const worker = new WorkspaceWorker({
        workerId: 'live-recovery-worker',
        pollIntervalMs: 5,
        liveBillingEnabled: () => true,
        billing: {
            acquireLease: async () => {
                calls.push('lease');
                return {
                    jobId: job.id, workerId: 'live-recovery-worker', leaseToken: randomUUID()
                };
            },
            heartbeatLease: async () => true,
            releaseLease: async () => calls.push('lease-release'),
            markStarted: async () => calls.push('reservation-committed'),
            settle: async () => {
                calls.push('settle');
                return { ...internal.billing, billingStatus: 'settled' };
            },
            fail: async () => calls.push('failure'),
            review: async () => calls.push('review')
        },
        executeStage: async () => {
            throw new Error('validated audio checkpoint should be reused');
        },
        translateStage: async () => {
            throw new Error('validated transcript checkpoint should be reused');
        },
        coreStage: async () => ({
            videoUrl: `/output/${job.id}.mp4`
        }),
        finalEffectsStage: async () => {
            fs.mkdirSync(path.join(temporaryRoot, 'output'), { recursive: true });
            fs.writeFileSync(path.join(temporaryRoot, 'output', `${job.id}.mp4`), 'valid output');
        }
    });
    worker.start();
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'completed');
    await worker.stop();
    assert.deepEqual(calls, [
        'lease', 'reservation-committed', 'settle', 'lease-release'
    ]);
    assert.equal(getWorkspaceJob(job.id, ownerUid).billing.billingStatus, 'settled');
});

test('worker records a safe terminal failure and no automatic retry', async () => {
    clearWorkspaceJobsForTests();
    const job = createPending('failed.mp4');
    queueWorkspaceJob(job.id, ownerUid);
    const worker = new WorkspaceWorker({
        workerId: 'failure-worker',
        pollIntervalMs: 5,
        executeStage: async () => { throw new Error('private failure detail'); }
        , coreStage: async () => ({})
    });
    worker.start();
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'failed');
    await worker.stop();
    const failed = getWorkspaceJob(job.id, ownerUid);
    assert.ok(failed.failedAt);
    assert.equal(failed.error, 'Audio could not be extracted from this video.');
    assert.deepEqual(failed.retry, { attempts: 0, maxAttempts: 0, lastAttemptAt: failed.startedAt });
});

test('Gemini failure preserves structured diagnostics while public error remains friendly', async () => {
    clearWorkspaceJobsForTests();
    const job = createPending('gemini-failed.mp4');
    queueWorkspaceJob(job.id, ownerUid);
    const original = Object.assign(new Error('Model endpoint was not found.'), {
        status: 404,
        code: 'NOT_FOUND',
        response: {
            status: 404,
            data: {
                error: {
                    code: 404,
                    status: 'NOT_FOUND',
                    message: 'models/example-flash is not found'
                }
            }
        },
        geminiDiagnosticContext: {
            requestModel: 'example-flash',
            requestTimeoutMs: 120000,
            retryAttempt: 1
        }
    });
    const worker = new WorkspaceWorker({
        workerId: 'gemini-failure-worker',
        pollIntervalMs: 5,
        executeStage: async ({ job }) => ({
            audioPath: path.join(path.dirname(job.storedPath), 'audio.wav'),
            audioDuration: 1
        }),
        translateStage: async () => { throw original; },
        coreStage: async () => ({})
    });
    worker.start();
    await waitFor(() => getWorkspaceJob(job.id, ownerUid)?.status === 'failed');
    await worker.stop();

    const publicFailure = getWorkspaceJob(job.id, ownerUid);
    const internalFailure = getWorkspaceJobInternal(job.id);
    assert.equal(publicFailure.error, 'The transcript and Burmese translation could not be created.');
    assert.equal(Object.hasOwn(publicFailure, 'diagnostic'), false);
    assert.equal(internalFailure.progress, 22);
    assert.equal(internalFailure.diagnostic.name, 'Error');
    assert.equal(internalFailure.diagnostic.message, 'Model endpoint was not found.');
    assert.match(internalFailure.diagnostic.stack, /workspaceWorker\.test\.js/);
    assert.equal(internalFailure.diagnostic.httpStatus, 404);
    assert.equal(internalFailure.diagnostic.geminiSdkErrorCode, 'NOT_FOUND');
    assert.deepEqual(internalFailure.diagnostic.responseBody, original.response.data);
    assert.equal(internalFailure.diagnostic.requestModel, 'example-flash');
    assert.equal(internalFailure.diagnostic.requestTimeoutMs, 120000);
    assert.equal(internalFailure.diagnostic.retryAttempt, 1);
});

test('Gemini SDK JSON embedded in error.message is retained as the provider response', () => {
    const diagnostic = createGeminiFailureDiagnostic(Object.assign(
        new Error('{"error":{"message":"","code":404,"status":"Not Found"}}'),
        { name: 'ApiError', status: 404 }
    ));
    assert.equal(diagnostic.httpStatus, 404);
    assert.equal(diagnostic.geminiSdkErrorCode, 404);
    assert.deepEqual(diagnostic.responseBody, {
        error: { message: '', code: 404, status: 'Not Found' }
    });
});
