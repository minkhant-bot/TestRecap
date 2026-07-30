import fs from 'node:fs';
import path from 'node:path';
import { detectScenes, getDuration } from '../ffmpeg/index.js';
import { fingerprintFile } from '../ai/index.js';
import { WORKFLOW_STAGE, WORKFLOW_VERSION } from '../domain/workflow.js';
import { ensureStoragePaths, getStoragePaths } from '../config/runtime.js';
import { createJob, getJob, updateJob } from './jobManager.js';
import { processRecapPipeline } from '../workers/processor.js';
import { throwIfAborted } from './cancellation.js';

const storagePaths = ensureStoragePaths(getStoragePaths());

const readWorkspaceTranscript = transcriptPath => {
    const parsed = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
    if (!Array.isArray(parsed?.segments) || parsed.segments.length === 0) {
        throw new Error('The validated Gemini transcript artifact is missing segments.');
    }
    return parsed.segments;
};

export const prepareCorePipelineState = async ({
    job,
    audioPath,
    transcriptPath,
    detect = detectScenes,
    duration = getDuration,
    fingerprint = fingerprintFile,
    signal
}) => {
    throwIfAborted(signal);
    const segments = readWorkspaceTranscript(transcriptPath);
    const sourceFingerprint = fingerprint(audioPath);
    const sourceVideoFingerprint = fingerprint(job.storedPath);
    const originalVideoDuration = await duration(job.storedPath);
    throwIfAborted(signal);
    const cacheDir = path.join(storagePaths.cache, job.id);
    fs.mkdirSync(cacheDir, { recursive: true });
    const scenes = await detect(job.storedPath, path.join(cacheDir, 'scenes.json'), {
        sourceFingerprint: sourceVideoFingerprint,
        signal
    });
    throwIfAborted(signal);
    const state = {
        workflowVersion: WORKFLOW_VERSION,
        stageId: WORKFLOW_STAGE.GENERATE_TTS,
        stageOutcome: null,
        sourceVideoFingerprint,
        sourceFingerprint,
        originalVideoDuration,
        audioDuration: await duration(audioPath),
        scenes,
        originalTranscript: segments.map(segment => ({
            timestamp: [segment.start_time, segment.end_time],
            text: segment.original_text
        })),
        translatedTranscript: segments.map(segment => ({
            timestamp: [segment.start_time, segment.end_time],
            text: segment.burmese_text,
            kind: segment.type,
            speaker: segment.speaker || null
        }))
    };
    fs.writeFileSync(path.join(cacheDir, 'state.json'), JSON.stringify(state, null, 2));
    return state;
};

const mirrorCoreJob = (jobId, onProgress) => {
    const coreJob = getJob(jobId);
    if (coreJob) onProgress?.(coreJob);
};

export const assertCompletedCoreOutput = (jobId, result, outputDirectory = storagePaths.output) => {
    const expectedUrl = `/output/${jobId}.mp4`;
    if (result?.videoUrl !== expectedUrl) {
        throw new Error('The completed core job has no authoritative final video URL.');
    }
    const outputPath = path.join(outputDirectory, `${jobId}.mp4`);
    if (!fs.existsSync(outputPath)) {
        throw new Error('The completed core job has no final MP4 artifact.');
    }
    const stat = fs.lstatSync(outputPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size === 0) {
        throw new Error('The completed core job final MP4 artifact is invalid.');
    }
    return result;
};

export const continueWithCorePipeline = async ({
    job,
    audioPath,
    transcriptPath,
    signal,
    isCancellationRequested = () => false,
    onProgress
}) => {
    if (signal?.aborted) {
        throw Object.assign(new Error('Processing cancelled.'), { name: 'AbortError' });
    }
    const existing = getJob(job.id);
    if (existing?.status === 'complete') {
        return assertCompletedCoreOutput(job.id, existing.result);
    }
    await prepareCorePipelineState({ job, audioPath, transcriptPath, signal });
    if (!getJob(job.id)) {
        createJob(job.id, {
            ownerUid: job.ownerUid,
            videoPath: job.storedPath,
            audioPath,
            originalFilename: job.filename
        });
    }
    updateJob(job.id, {
        ownerUid: job.ownerUid,
        videoPath: job.storedPath,
        audioPath,
        status: 'processing',
        stageId: WORKFLOW_STAGE.GENERATE_TTS,
        stageOutcome: null,
        progress: 35,
        error: null
    });
    mirrorCoreJob(job.id, onProgress);
    const monitor = setInterval(() => mirrorCoreJob(job.id, onProgress), 200);
    monitor.unref?.();
    try {
        await processRecapPipeline(job.id, { signal, isCancellationRequested });
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
