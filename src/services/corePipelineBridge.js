import fs from 'node:fs';
import path from 'node:path';
import { WORKFLOW_STAGE, WORKFLOW_VERSION } from '../domain/workflow.js';
import { ensureStoragePaths, getStoragePaths } from '../config/runtime.js';
import {
    createJob,
    deleteJob,
    getJob,
    getJobKeys,
    setJobKeys,
    updateJob
} from './jobManager.js';
import { processRecapPipeline } from '../workers/processor.js';

const storagePaths = ensureStoragePaths(getStoragePaths());

const regularNonemptyFile = target => {
    if (!fs.existsSync(target)) return false;
    const stat = fs.lstatSync(target);
    return !stat.isSymbolicLink() && stat.isFile() && stat.size > 0;
};

const mirrorCoreJob = (jobId, onProgress) => {
    const coreJob = getJob(jobId);
    if (coreJob) onProgress?.(coreJob);
};

export const assertCompletedCoreOutput = (jobId, result, outputDirectory = storagePaths.output) => {
    const expectedVideoUrl = `/output/${jobId}.mp4`;
    const expectedAudioUrl = `/output/${jobId}.mp3`;
    if (result?.videoUrl !== expectedVideoUrl || result?.audioUrl !== expectedAudioUrl) {
        throw new Error('The completed core job has no authoritative MP4 and MP3 URLs.');
    }
    const mp4Path = path.join(outputDirectory, `${jobId}.mp4`);
    const mp3Path = path.join(outputDirectory, `${jobId}.mp3`);
    if (!regularNonemptyFile(mp4Path)) {
        throw new Error('The completed core job final MP4 artifact is invalid.');
    }
    if (!regularNonemptyFile(mp3Path)) {
        throw new Error('The completed core job final MP3 artifact is invalid.');
    }
    return result;
};

export const prepareCorePipelineState = ({ job }) => ({
    workflowVersion: WORKFLOW_VERSION,
    stageId: WORKFLOW_STAGE.UPLOAD,
    ownerUid: job.ownerUid,
    videoPath: job.storedPath
});

const replaceIncompatibleCoreJob = job => {
    const existing = getJob(job.id);
    if (!existing || existing.workflowVersion === WORKFLOW_VERSION) return existing;
    const credentials = getJobKeys(job.id);
    deleteJob(job.id);
    const cacheDir = path.join(storagePaths.cache, job.id);
    if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true });
    const created = createJob(job.id, {
        ownerUid: job.ownerUid,
        videoPath: job.storedPath,
        originalFilename: job.filename
    });
    if (credentials.geminiApiKey) setJobKeys(job.id, credentials);
    return created;
};

export const continueWithCorePipeline = async ({
    job,
    signal,
    isCancellationRequested = () => false,
    onProgress,
    runPipeline = processRecapPipeline
}) => {
    if (signal?.aborted) {
        throw Object.assign(new Error('Processing cancelled.'), { name: 'AbortError' });
    }
    let existing = replaceIncompatibleCoreJob(job);
    if (existing?.status === 'complete') {
        return assertCompletedCoreOutput(job.id, existing.result);
    }
    if (!existing) {
        existing = createJob(job.id, {
            ownerUid: job.ownerUid,
            videoPath: job.storedPath,
            originalFilename: job.filename
        });
    }
    updateJob(job.id, {
        ownerUid: job.ownerUid,
        videoPath: job.storedPath,
        audioPath: null,
        workflowVersion: WORKFLOW_VERSION,
        status: 'processing',
        error: null
    });
    mirrorCoreJob(job.id, onProgress);
    const monitor = setInterval(() => mirrorCoreJob(job.id, onProgress), 200);
    monitor.unref?.();
    try {
        await runPipeline(job.id, { signal, isCancellationRequested });
    } finally {
        clearInterval(monitor);
        mirrorCoreJob(job.id, onProgress);
    }
    const completed = getJob(job.id);
    if (completed?.status !== 'complete') {
        throw new Error(completed?.error || 'The final recap could not be created.');
    }
    return assertCompletedCoreOutput(job.id, completed.result);
};
