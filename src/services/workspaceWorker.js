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
import { admissionService } from './admissionControl.js';

const storagePaths = ensureStoragePaths(getStoragePaths());

const validCheckpointFile = target => {
    if (!target || !fs.existsSync(target)) return false;
    const stat = fs.lstatSync(target);
    return !stat.isSymbolicLink() && stat.isFile() && stat.size > 0;
};

const CORE_STAGE_MAP = Object.freeze({
    upload: 'preparing',
    extract_audio: 'audio_extraction',
    detect_scenes: 'audio_extraction',
    transcribe_source: 'transcript_translation',
    translate_burmese: 'transcript_translation',
    generate_tts: 'voice_generation',
    match_scenes: 'timeline_verification',
    build_timeline: 'timeline_verification',
    rebuild_scenes: 'scene_rebuild',
    export_final: 'final_export',
    adjust_final_speed: 'final_export',
    cleanup: 'final_export',
    done: 'completed'
});

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
        coreStage = continueWithCorePipeline,
        finalEffectsStage = applyFinalVideoEffects,
        validateOutput = assertCompletedCoreOutput,
        cleanup = async () => {},
        liveBillingEnabled = isLiveJobBillingEnabled,
        billing = {
            acquireLease: acquireLiveJobLease,
            heartbeatLease: heartbeatLiveJobLease,
            releaseLease: releaseLiveJobLease,
            markStarted: markPaidProviderStarted,
            settle: settleLiveJob,
            fail: handleLiveJobFailure,
            review: markLiveJobReviewRequired
        },
        // Refunds a processing-usage-quota slot when a genuinely queued job
        // later fails or is cancelled by the pipeline (bounded, see
        // refundProcessingStartOnFailure) -- a system/pipeline failure must
        // not permanently cost the user a slot the same way a completed job
        // does. Injectable so tests can assert on it without touching the
        // real on-disk admission store.
        admission = admissionService
    } = {}) {
        this.workerId = workerId;
        this.pollIntervalMs = pollIntervalMs;
        this.coreStage = coreStage;
        this.finalEffectsStage = finalEffectsStage;
        this.validateOutput = validateOutput;
        this.cleanup = cleanup;
        this.liveBillingEnabled = liveBillingEnabled;
        this.billing = billing;
        this.admission = admission;
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
            const reportCoreProgress = coreJob => {
                const stage = CORE_STAGE_MAP[coreJob.stageId];
                if (!stage || stage === 'completed') return;
                const reportedProgress = Math.max(5, Math.min(99, Math.round(coreJob.progress || 5)));
                const updated = updateWorkspaceJobInternal(job.id, {
                    stage,
                    progress: stage === 'final_export' ? Math.min(90, reportedProgress) : reportedProgress
                });
                publishWorkspaceEvent(job.id, 'stage.progress', updated);
            };
            const coreStarting = updateWorkspaceJobInternal(job.id, {
                stage: 'preparing',
                progress: 5
            });
            publishWorkspaceEvent(job.id, 'stage.started', coreStarting);
            const output = await this.coreStage({
                job: { ...getWorkspaceJobInternal(job.id) },
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
            this.validateOutput(job.id, output);
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
                const diagnostic = createPipelineFailureDiagnostic(error, failedStage);
                if (diagnostic) {
                    console.error(`[WorkspaceWorker] ${failedStage} failure diagnostic:\n` +
                        JSON.stringify(diagnostic, null, 2));
                }
                const failed = updateWorkspaceJobInternal(job.id, {
                    status: 'failed',
                    stage: 'failed',
                    failedAt: new Date().toISOString(),
                    workerId: null,
                    error: error?.name === 'AbortError' ? error.message : diagnostic.message,
                    diagnostic,
                    cancellationRequested: false
                });
                publishWorkspaceEvent(job.id, 'job.failed', failed);
                this.refundProcessingUsage(job);
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
                        cancellationRequested: true
                    });
                    publishWorkspaceEvent(job.id, 'job.cancelled', cancelled);
                    this.refundProcessingUsage(job);
                    if (usesLiveBilling) {
                        const billingSnapshot = await this.billing.fail(job.id, 'job_cancelled');
                        if (billingSnapshot) {
                            updateWorkspaceJobInternal(job.id, { billing: billingSnapshot });
                        }
                    }
                } else {
                    await this.cleanup({ jobId: job.id, job: { ...job } });
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

    // A bookkeeping failure here must never break failure/cancellation
    // handling itself -- worst case, a slot stays consumed exactly as it
    // did before this refund path existed.
    refundProcessingUsage(job) {
        try {
            this.admission.refundProcessingStartOnFailure(job.ownerUid, job.id);
        } catch (error) {
            console.error(`[WorkspaceWorker] Processing-usage refund failed for ${job.id}:`,
                error?.message || error);
        }
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
