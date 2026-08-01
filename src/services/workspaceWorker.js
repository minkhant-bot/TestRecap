import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
    claimNextWorkspaceJob,
    getWorkspaceJobInternal,
    listQueuedWorkspaceJobs,
    requeueInterruptedWorkspaceJob,
    recoverWorkspaceJobs,
    updateWorkspaceJobInternal
} from './workspaceJobs.js';
import { publishWorkspaceEvent } from './workspaceEvents.js';
import {
    cleanupWorkspaceAudioArtifacts,
    cleanupWorkspaceAudioPartials,
    extractWorkspaceAudio
} from './audioExtraction.js';
import {
    cleanupGeminiTranscriptArtifacts,
    cleanupGeminiTranscriptPartial,
    createGeminiAudioTranscript
} from './geminiAudioTranscript.js';
import { getJobKeys } from './jobManager.js';
import { assertCompletedCoreOutput, continueWithCorePipeline } from './corePipelineBridge.js';
import { applyFinalVideoEffects } from './videoEffects.js';
import { ensureStoragePaths, getStoragePaths } from '../config/runtime.js';
import {
    acquireLiveJobLease,
    handleLiveJobFailure,
    heartbeatLiveJobLease,
    isLiveJobBillingEnabled,
    markLiveJobReviewRequired,
    markPaidProviderStarted,
    releaseLiveJobLease,
    settleLiveJob
} from './liveJobBilling.js';
import { inspectQueuedWorkspaceRetry } from './workspaceRetry.js';

const storagePaths = ensureStoragePaths(getStoragePaths());

const validCheckpointFile = target => {
    if (!target || !fs.existsSync(target)) return false;
    const stat = fs.lstatSync(target);
    return !stat.isSymbolicLink() && stat.isFile() && stat.size > 0;
};

const CORE_STAGE_MAP = Object.freeze({
    generate_tts: 'voice_generation',
    match_scenes: 'timeline_verification',
    build_timeline: 'timeline_verification',
    rebuild_scenes: 'scene_rebuild',
    export_final: 'final_export',
    adjust_final_speed: 'final_export',
    cleanup: 'final_export',
    done: 'completed'
});

const safelySerialize = value => {
    const seen = new WeakSet();
    const visit = (current, depth) => {
        if (current === null || ['string', 'number', 'boolean'].includes(typeof current)) return current;
        if (typeof current === 'bigint') return current.toString();
        if (typeof current === 'undefined') return '[undefined]';
        if (typeof current === 'function') return `[Function ${current.name || 'anonymous'}]`;
        if (typeof current !== 'object') return String(current);
        if (seen.has(current)) return '[Circular]';
        if (depth > 8) return '[Maximum depth reached]';
        seen.add(current);
        if (current instanceof Error) {
            const serialized = {
                name: current.name,
                message: current.message,
                stack: current.stack || null
            };
            for (const property of Object.getOwnPropertyNames(current)) {
                if (['name', 'message', 'stack'].includes(property)) continue;
                serialized[property] = visit(current[property], depth + 1);
            }
            return serialized;
        }
        if (Array.isArray(current)) return current.map(item => visit(item, depth + 1));
        return Object.fromEntries(Object.entries(current).map(([key, item]) => [
            /api[-_]?key|authorization/i.test(key) ? key : key,
            /api[-_]?key|authorization/i.test(key) ? '[REDACTED]' : visit(item, depth + 1)
        ]));
    };
    try {
        return visit(value, 0);
    } catch (serializationError) {
        return {
            serializationFailure: serializationError?.message || String(serializationError),
            fallback: String(value)
        };
    }
};

const firstDefined = (...values) => values.find(value => value !== undefined && value !== null) ?? null;

const sanitizePipelineError = value => String(value || 'Unknown pipeline error.')
    .replace(/key=[A-Za-z0-9_-]+/gi, 'key=HIDDEN')
    .replace(/AIza[A-Za-z0-9_-]+/g, '[REDACTED]');

const createPipelineFailureDiagnostic = (error, stage) => ({
    capturedAt: new Date().toISOString(),
    stage,
    name: error instanceof Error ? error.name : firstDefined(error?.name, typeof error),
    message: sanitizePipelineError(error instanceof Error ? error.message : firstDefined(error?.message, error)),
    stack: error instanceof Error && error.stack ? sanitizePipelineError(error.stack) : null
});

export const createGeminiFailureDiagnostic = error => {
    const serializedError = safelySerialize(error);
    const context = error?.geminiDiagnosticContext || error?.cause?.geminiDiagnosticContext || {};
    let messageResponseBody = null;
    try {
        const parsed = JSON.parse(error?.message);
        if (parsed && typeof parsed === 'object') messageResponseBody = parsed;
    } catch {
        // SDK errors do not always contain a JSON response in their message.
    }
    return {
        capturedAt: new Date().toISOString(),
        stage: 'gemini_transcript',
        name: error instanceof Error ? error.name : firstDefined(error?.name, typeof error),
        message: error instanceof Error ? error.message : firstDefined(error?.message, String(error)),
        stack: error instanceof Error ? error.stack || null : firstDefined(error?.stack, null),
        httpStatus: firstDefined(
            error?.status,
            error?.statusCode,
            error?.httpStatus,
            error?.response?.status,
            error?.providerError?.httpStatus,
            error?.cause?.status,
            error?.cause?.response?.status
        ),
        geminiSdkErrorCode: firstDefined(
            error?.code,
            error?.error?.code,
            error?.response?.data?.error?.code,
            error?.response?.body?.error?.code,
            error?.providerError?.body?.error?.code,
            messageResponseBody?.error?.code,
            error?.cause?.code
        ),
        responseBody: firstDefined(
            error?.providerError?.body,
            error?.response?.data,
            error?.response?.body,
            error?.body,
            messageResponseBody,
            error?.cause?.response?.data,
            error?.cause?.body
        ),
        requestModel: context.requestModel ?? null,
        requestTimeoutMs: context.requestTimeoutMs ?? null,
        retryAttempt: context.retryAttempt ?? null,
        serializedError
    };
};

export const publishQueuePositions = () => {
    listQueuedWorkspaceJobs().forEach((job, index) => {
        publishWorkspaceEvent(job.id, 'queue.position_changed', {
            status: 'queued',
            stage: 'queued',
            position: index + 1
        });
    });
};

export class WorkspaceWorker {
    constructor({
        workerId = `workspace-${randomUUID()}`,
        pollIntervalMs = 250,
        executeStage = ({ job, signal, reportProgress }) => extractWorkspaceAudio({
            sourcePath: job.storedPath,
            signal,
            onProgress: ffmpegProgress => reportProgress(10 + (ffmpegProgress * 0.1))
        }),
        translateStage = ({ job, audioPath, signal }) => createGeminiAudioTranscript({
            audioPath,
            signal,
            apiKey: getJobKeys(job.id).geminiApiKey || process.env.GEMINI_API_KEY
        }),
        coreStage = continueWithCorePipeline,
        finalEffectsStage = applyFinalVideoEffects,
        validateOutput = assertCompletedCoreOutput,
        cleanup = async ({ job }) => cleanupWorkspaceAudioPartials(job.storedPath),
        liveBillingEnabled = isLiveJobBillingEnabled,
        billing = {
            acquireLease: acquireLiveJobLease,
            heartbeatLease: heartbeatLiveJobLease,
            releaseLease: releaseLiveJobLease,
            markStarted: markPaidProviderStarted,
            settle: settleLiveJob,
            fail: handleLiveJobFailure,
            review: markLiveJobReviewRequired
        }
    } = {}) {
        this.workerId = workerId;
        this.pollIntervalMs = pollIntervalMs;
        this.executeStage = executeStage;
        this.translateStage = translateStage;
        this.coreStage = coreStage;
        this.finalEffectsStage = finalEffectsStage;
        this.validateOutput = validateOutput;
        this.cleanup = cleanup;
        this.liveBillingEnabled = liveBillingEnabled;
        this.billing = billing;
        this.running = false;
        this.timer = null;
        this.activeJobId = null;
        this.activeController = null;
        this.tickPromise = null;
        this.stopping = false;
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.stopping = false;
        const recovered = recoverWorkspaceJobs();
        for (const jobId of recovered) {
            publishWorkspaceEvent(jobId, 'job.recovered', { status: 'queued', stage: 'queued' });
        }
        if (this.liveBillingEnabled()) {
            Promise.all(recovered.map(async jobId => {
                const job = getWorkspaceJobInternal(jobId);
                if (job?.billing?.billingStatus === 'settled') {
                    try {
                        assertCompletedCoreOutput(jobId, { videoUrl: `/output/${jobId}.mp4` });
                        updateWorkspaceJobInternal(jobId, {
                            status: 'completed', stage: 'completed', progress: 100,
                            videoUrl: `/output/${jobId}.mp4`, workerId: null
                        });
                    } catch {
                        await this.billing.review(
                            jobId, 'settled_job_recovery_output_state_uncertain'
                        );
                        updateWorkspaceJobInternal(jobId, {
                            status: 'failed', stage: 'failed', workerId: null,
                            error: 'Billing recovery requires Super Admin review.',
                            billing: { ...job.billing, billingStatus: 'review_required' }
                        });
                    }
                }
            })).catch(error => {
                console.error('[WorkspaceWorker] Billing reconciliation failed:',
                    error?.message || error);
            }).finally(() => this.schedule(0));
        } else {
            this.schedule(0);
        }
    }

    schedule(delay = this.pollIntervalMs) {
        if (!this.running) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.tickPromise = this.tick().finally(() => {
                this.tickPromise = null;
                this.schedule();
            });
        }, delay);
        this.timer.unref?.();
    }

    async tick() {
        if (!this.running || this.activeJobId) return;
        const job = claimNextWorkspaceJob(this.workerId);
        if (!job) return;
        publishQueuePositions();

        if ((job.retry?.attempts || 0) > 0) {
            const eligibility = inspectQueuedWorkspaceRetry(job);
            if (!eligibility.recoverable) {
                const failed = updateWorkspaceJobInternal(job.id, {
                    status: 'failed', stage: 'failed', workerId: null,
                    failedAt: new Date().toISOString(),
                    error: eligibility.reason || 'Retry checkpoint is no longer recoverable.'
                });
                publishWorkspaceEvent(job.id, 'job.failed', failed);
                publishQueuePositions();
                return;
            }
        }

        const usesLiveBilling = this.liveBillingEnabled() && Boolean(job.billing);
        let lease = null;
        let leaseHeartbeat = null;
        if (usesLiveBilling) {
            try {
                lease = await this.billing.acquireLease(job.id, this.workerId);
                if (!lease) {
                    requeueInterruptedWorkspaceJob(job.id);
                    return;
                }
                await this.billing.markStarted(job.id);
            } catch (error) {
                if (lease) await this.billing.releaseLease(lease).catch(() => {});
                requeueInterruptedWorkspaceJob(job.id);
                console.error(`[WorkspaceWorker] Billing admission failed for ${job.id}:`,
                    error?.message || error);
                return;
            }
            leaseHeartbeat = setInterval(() => {
                this.billing.heartbeatLease(lease).catch(error => {
                    console.error(`[WorkspaceWorker] Lease heartbeat failed for ${job.id}:`,
                        error?.message || error);
                    this.activeController?.abort();
                });
            }, 30000);
            leaseHeartbeat.unref?.();
        }

        this.activeJobId = job.id;
        this.activeController = new AbortController();
        let cancellationStage = null;
        publishWorkspaceEvent(job.id, 'job.processing_started', {
            status: 'processing',
            stage: 'preparing',
            progress: 10,
            workerId: this.workerId
        });

        try {
            const extractionStartedAt = new Date().toISOString();
            const extracting = updateWorkspaceJobInternal(job.id, {
                stage: 'audio_extraction',
                progress: 15,
                extractionStartedAt
            });
            publishWorkspaceEvent(job.id, 'stage.started', extracting);
            const checkpoint = getWorkspaceJobInternal(job.id);
            const result = validCheckpointFile(checkpoint?.audioPath)
                ? { audioPath: checkpoint.audioPath, audioDuration: checkpoint.audioDuration }
                : await this.executeStage({
                    job: { ...job },
                    signal: this.activeController.signal,
                    reportProgress: progress => {
                        const bounded = Math.max(10, Math.min(95, Math.round(progress)));
                        const updated = updateWorkspaceJobInternal(job.id, { progress: bounded });
                        publishWorkspaceEvent(job.id, 'stage.progress', updated);
                    }
                });
            if (getWorkspaceJobInternal(job.id)?.cancellationRequested) {
                throw Object.assign(new Error('Processing cancelled.'), { name: 'AbortError' });
            }
            const extractionCompletedAt = new Date().toISOString();
            const extracted = updateWorkspaceJobInternal(job.id, {
                progress: 20,
                ...(result?.audioPath ? {
                    audioPath: result.audioPath,
                    audioDuration: result.audioDuration,
                    extractionCompletedAt
                } : {})
            });
            publishWorkspaceEvent(job.id, 'stage.completed', extracted);
            const transcriptionStartedAt = new Date().toISOString();
            const transcribing = updateWorkspaceJobInternal(job.id, {
                stage: 'gemini_transcript',
                progress: 22,
                transcriptionStartedAt
            });
            publishWorkspaceEvent(job.id, 'stage.started', transcribing);
            const transcriptCheckpoint = getWorkspaceJobInternal(job.id);
            const transcriptResult = validCheckpointFile(transcriptCheckpoint?.transcriptPath)
                ? {
                    transcriptPath: transcriptCheckpoint.transcriptPath,
                    segmentCount: transcriptCheckpoint.transcriptSegmentCount
                }
                : await this.translateStage({
                    job: { ...job },
                    audioPath: result?.audioPath || getWorkspaceJobInternal(job.id)?.audioPath,
                    signal: this.activeController.signal
                });
            if (getWorkspaceJobInternal(job.id)?.cancellationRequested) {
                throw Object.assign(new Error('Processing cancelled.'), { name: 'AbortError' });
            }
            const translated = updateWorkspaceJobInternal(job.id, {
                progress: 30,
                ...(transcriptResult?.transcriptPath ? {
                    transcriptPath: transcriptResult.transcriptPath,
                    transcriptSegmentCount: transcriptResult.segmentCount,
                    transcriptionCompletedAt: new Date().toISOString()
                } : {})
            });
            publishWorkspaceEvent(job.id, 'stage.completed', translated);
            const reportCoreProgress = coreJob => {
                const stage = CORE_STAGE_MAP[coreJob.stageId];
                if (!stage || stage === 'completed') return;
                const reportedProgress = Math.max(35, Math.min(99, Math.round(coreJob.progress || 35)));
                const updated = updateWorkspaceJobInternal(job.id, {
                    stage,
                    progress: stage === 'final_export' ? Math.min(90, reportedProgress) : reportedProgress
                });
                publishWorkspaceEvent(job.id, 'stage.progress', updated);
            };
            const coreStarting = updateWorkspaceJobInternal(job.id, {
                stage: 'voice_generation',
                progress: 35
            });
            publishWorkspaceEvent(job.id, 'stage.started', coreStarting);
            const output = await this.coreStage({
                job: { ...getWorkspaceJobInternal(job.id) },
                audioPath: result?.audioPath || getWorkspaceJobInternal(job.id)?.audioPath,
                transcriptPath: transcriptResult?.transcriptPath ||
                    getWorkspaceJobInternal(job.id)?.transcriptPath,
                signal: this.activeController.signal,
                isCancellationRequested: () =>
                    getWorkspaceJobInternal(job.id)?.cancellationRequested === true,
                onProgress: reportCoreProgress
            });
            const workerEffects = getWorkspaceJobInternal(job.id)?.effects;
            console.info('[Blink effects]', JSON.stringify({
                boundary: 'worker.finalEffects',
                jobId: job.id,
                effects: workerEffects
            }));
            await this.finalEffectsStage({
                inputPath: path.join(storagePaths.output, `${job.id}.mp4`),
                effects: workerEffects,
                subtitleSrtPath: output.srtPath,
                signal: this.activeController.signal,
                onProgress: substep => {
                    const progressBySubstep = {
                        'Color Grading': 92,
                        Flip: 94,
                        Blur: 96,
                        Subtitle: 98,
                        'Verify Output': 99
                    };
                    const updated = updateWorkspaceJobInternal(job.id, {
                        stage: 'final_export',
                        progress: progressBySubstep[substep] || 90
                    });
                    publishWorkspaceEvent(job.id, 'stage.progress', updated);
                }
            });
            this.validateOutput(job.id, { videoUrl: `/output/${job.id}.mp4` });
            if (getWorkspaceJobInternal(job.id)?.cancellationRequested) {
                throw Object.assign(new Error('Processing cancelled.'), { name: 'AbortError' });
            }
            if (usesLiveBilling) {
                const billingSnapshot = await this.billing.settle(job.id, {
                    outputValidated: true
                });
                updateWorkspaceJobInternal(job.id, { billing: billingSnapshot });
            }
            const completed = updateWorkspaceJobInternal(job.id, {
                status: 'completed',
                stage: 'completed',
                progress: 100,
                videoUrl: `/output/${job.id}.mp4`,
                audioUrl: output.audioUrl || null,
                completedAt: new Date().toISOString(),
                workerId: null,
                cancellationRequested: false
            });
            publishWorkspaceEvent(job.id, 'job.completed', completed);
        } catch (error) {
            const failedStage = getWorkspaceJobInternal(job.id)?.stage;
            const cancellationRequested =
                getWorkspaceJobInternal(job.id)?.cancellationRequested === true;
            if (error?.name === 'AbortError' && cancellationRequested) {
                cancellationStage = failedStage;
            } else if (error?.name === 'AbortError' && this.stopping) {
                const recovered = requeueInterruptedWorkspaceJob(job.id);
                if (recovered) {
                    publishWorkspaceEvent(job.id, 'job.recovered', recovered);
                }
            } else {
                const diagnostic = failedStage === 'gemini_transcript'
                    ? createGeminiFailureDiagnostic(error)
                    : failedStage === 'audio_extraction'
                        ? null
                        : createPipelineFailureDiagnostic(error, failedStage);
                if (diagnostic) {
                    console.error(`[WorkspaceWorker] ${failedStage} failure diagnostic:\n` +
                        JSON.stringify(diagnostic, null, 2));
                }
                if (failedStage === 'audio_extraction') {
                    cleanupWorkspaceAudioArtifacts(job.storedPath);
                } else if (failedStage === 'gemini_transcript' &&
                    getWorkspaceJobInternal(job.id)?.audioPath) {
                    cleanupGeminiTranscriptArtifacts(getWorkspaceJobInternal(job.id).audioPath);
                }
                const failed = updateWorkspaceJobInternal(job.id, {
                    status: 'failed',
                    stage: 'failed',
                    failedAt: new Date().toISOString(),
                    workerId: null,
                    error: error?.name === 'AbortError'
                        ? error.message
                        : failedStage === 'gemini_transcript'
                        ? 'The transcript and Burmese translation could not be created.'
                        : failedStage === 'audio_extraction'
                            ? 'Audio could not be extracted from this video.'
                            : diagnostic.message,
                    diagnostic,
                    ...(failedStage === 'audio_extraction' ? {
                        audioPath: null,
                        audioDuration: null,
                        extractionCompletedAt: null
                    } : {}),
                    ...(['audio_extraction', 'gemini_transcript'].includes(failedStage) ? {
                        transcriptPath: null,
                        transcriptSegmentCount: null,
                        transcriptionCompletedAt: null
                    } : {}),
                    cancellationRequested: false
                });
                publishWorkspaceEvent(job.id, 'job.failed', failed);
                if (usesLiveBilling) {
                    const billingSnapshot = await this.billing.fail(
                        job.id, `system_failure:${failedStage || 'unknown'}`
                    );
                    if (billingSnapshot) {
                        updateWorkspaceJobInternal(job.id, { billing: billingSnapshot });
                    }
                }
            }
        } finally {
            try {
                if (cancellationStage) {
                    try {
                        await this.cleanup({ jobId: job.id, job: { ...job } });
                        const audioPath = getWorkspaceJobInternal(job.id)?.audioPath;
                        if (audioPath) cleanupGeminiTranscriptPartial(audioPath);
                        if (cancellationStage === 'audio_extraction') {
                            cleanupWorkspaceAudioArtifacts(job.storedPath);
                        } else if (audioPath) {
                            cleanupGeminiTranscriptArtifacts(audioPath);
                        }
                    } catch (cleanupError) {
                        console.error(`[WorkspaceWorker] Cancellation cleanup failed for ${job.id}:`,
                            cleanupError?.message || cleanupError);
                    }
                    const cancelled = updateWorkspaceJobInternal(job.id, {
                        status: 'cancelled',
                        stage: 'cancelled',
                        progress: 0,
                        cancelledAt: new Date().toISOString(),
                        workerId: null,
                        error: null,
                        ...(cancellationStage === 'audio_extraction' ? {
                            audioPath: null,
                            audioDuration: null,
                            extractionCompletedAt: null
                        } : {}),
                        transcriptPath: null,
                        transcriptSegmentCount: null,
                        transcriptionCompletedAt: null,
                        cancellationRequested: true
                    });
                    publishWorkspaceEvent(job.id, 'job.cancelled', cancelled);
                    if (usesLiveBilling) {
                        const billingSnapshot = await this.billing.fail(job.id, 'job_cancelled');
                        if (billingSnapshot) {
                            updateWorkspaceJobInternal(job.id, { billing: billingSnapshot });
                        }
                    }
                } else {
                    await this.cleanup({ jobId: job.id, job: { ...job } });
                    const audioPath = getWorkspaceJobInternal(job.id)?.audioPath;
                    if (audioPath) cleanupGeminiTranscriptPartial(audioPath);
                }
            } finally {
                if (leaseHeartbeat) clearInterval(leaseHeartbeat);
                if (lease) {
                    try {
                        await this.billing.releaseLease(lease);
                    } catch (error) {
                        console.error(`[WorkspaceWorker] Lease release failed for ${job.id}:`,
                            error?.message || error);
                    }
                }
                this.activeJobId = null;
                this.activeController = null;
                publishQueuePositions();
            }
        }
    }

    cancel(jobId) {
        if (this.activeJobId === jobId) this.activeController?.abort();
    }

    wake() {
        if (!this.running || this.activeJobId) return;
        this.schedule(0);
    }

    async stop() {
        this.stopping = true;
        this.running = false;
        clearTimeout(this.timer);
        this.activeController?.abort();
        if (this.tickPromise) await this.tickPromise;
    }

    snapshot() {
        return {
            workerId: this.workerId,
            running: this.running,
            concurrency: 1,
            activeJobId: this.activeJobId
        };
    }
}

export const workspaceWorker = new WorkspaceWorker();
