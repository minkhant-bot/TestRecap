import fs from 'fs';
import path from 'path';
import { updateJob, getJob, getJobKeys, clearJobKeys } from '../services/jobManager.js';
import { getDuration, getStreamsDuration, extractWav, detectScenes, runFFmpeg } from '../ffmpeg/index.js';
import { getSetting } from '../services/settings.js';
import { GEMINI_RETRY_STAGE_MESSAGE, getGeminiFailureJobUpdate } from '../services/geminiRetryPolicy.js';
import { transcribeWav, translateWithGemini, generateNarrationTTS, fingerprintFile } from '../ai/index.js';
import {
    assertSafeJobPath,
    buildAtempoFilter,
    buildConcatManifest,
    buildSegmentFFmpegArgs,
    buildTimelineManifest,
    getJobOutputPaths,
    getSegmentPath,
    mapRecordsChronologically,
    readTimelineManifest,
    validateFinalMedia
} from './sceneRebuild.js';
import { cleanupPipelineArtifacts } from './workflowCleanup.js';
import {
    WORKFLOW_VERSION,
    WORKFLOW_STAGE,
    getFinalSpeedStageOutcome,
    hasCompletedStage,
    isLegacyJob,
    readCompatibleWorkflowState
} from '../domain/workflow.js';
import { ensureStoragePaths, getStoragePaths } from '../config/runtime.js';

const STAGES = WORKFLOW_STAGE;
const storagePaths = ensureStoragePaths(getStoragePaths());

const artifactMetadataMatches = (metadataPath, expected) => {
    if (!fs.existsSync(metadataPath)) return false;
    try {
        const actual = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        return Object.entries(expected).every(([key, value]) => actual[key] === value);
    } catch {
        return false;
    }
};

const writeArtifactMetadata = (metadataPath, metadata) =>
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

const assertSafeUpload = uploadPath => {
    const uploadRoot = storagePaths.uploads;
    const candidate = path.resolve(uploadPath);
    if (!candidate.startsWith(uploadRoot + path.sep) || !fs.existsSync(candidate)) {
        throw new Error('Missing or unsafe workflow input artifact.');
    }
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size === 0) {
        throw new Error('Workflow input must be a non-empty regular file.');
    }
    return candidate;
};

export const processRecapPipeline = async (jobId) => {
    let job = getJob(jobId);
    if (!job || !job.videoPath) throw new Error("Invalid job data: missing videoPath");
    job.videoPath = assertSafeUpload(job.videoPath);
    if (isLegacyJob(job)) {
        throw new Error("Legacy workflow job cannot resume under workflow version " + WORKFLOW_VERSION + ". Start a new job.");
    }

    const { geminiApiKey } = getJobKeys(jobId);
    if (!geminiApiKey) {
        throw new Error("Job interrupted due to server restart. Credentials lost. Please resubmit the job with your API keys.");
    }

    const outDir = storagePaths.output;

    const cacheDir = path.join(storagePaths.cache, jobId);
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const jobTmpDir = path.join(cacheDir, 'media-work');
    const segmentsDir = path.join(jobTmpDir, 'segments');
    fs.mkdirSync(segmentsDir, { recursive: true });

    const statePath = path.join(cacheDir, 'state.json');
    let state = { workflowVersion: WORKFLOW_VERSION, stageId: job.stageId || STAGES.UPLOAD };
    if (fs.existsSync(statePath)) {
        state = readCompatibleWorkflowState(fs.readFileSync(statePath, 'utf8'));
    }

    const saveState = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    const advanceStage = (stageId, progress, stageOutcome = null) => {
        state.workflowVersion = WORKFLOW_VERSION;
        state.stageId = stageId;
        state.stageOutcome = stageOutcome;
        saveState();
        updateJob(jobId, { stageId, stageOutcome, progress, status: 'processing' });
        job = getJob(jobId); // refresh
    };

    try {
        console.log(`[Job ${jobId}] Pipeline started. Current Step: ${job.stageId || STAGES.UPLOAD}`);

        // 1. EXTRACT VIDEO WAV
        state.sourceVideoFingerprint ||= fingerprintFile(job.videoPath);
        const videoWavPath = path.join(cacheDir, 'video.wav');
        if (!hasCompletedStage(job.stageId, STAGES.EXTRACT_AUDIO)) {
            advanceStage(STAGES.EXTRACT_AUDIO, 5);
            if (fs.existsSync(videoWavPath)) {
                const wavStat = fs.lstatSync(videoWavPath);
                if (wavStat.isSymbolicLink() || !wavStat.isFile() || wavStat.size === 0) fs.unlinkSync(videoWavPath);
            }
            if (!fs.existsSync(videoWavPath)) await extractWav(job.videoPath, videoWavPath);
            state.originalVideoDuration = await getDuration(job.videoPath);
            saveState();
        }

        // 2. EXTRACT AUDIO WAV
        const audioWavPath = path.join(cacheDir, 'audio.wav');
        if (!hasCompletedStage(job.stageId, STAGES.EXTRACT_AUDIO)) {
            advanceStage(STAGES.EXTRACT_AUDIO, 10);
            if (job.audioPath && !fs.existsSync(audioWavPath)) {
                await extractWav(job.audioPath, audioWavPath);
            }
            if (fs.existsSync(audioWavPath)) {
                state.audioDuration = await getDuration(audioWavPath);
            }
            saveState();
        }

        // 3. DETECT SCENES
        const sceneCache = path.join(cacheDir, 'scenes.json');
        if (!hasCompletedStage(job.stageId, STAGES.DETECT_SCENES)) {
            advanceStage(STAGES.DETECT_SCENES, 15);
            state.scenes = await detectScenes(job.videoPath, sceneCache, { sourceFingerprint: state.sourceVideoFingerprint });
            saveState();
        }

        // 4. TRANSCRIPT ORIGINAL
        const vidTranscriptCache = path.join(cacheDir, 'source-transcript.json');
        if (!hasCompletedStage(job.stageId, STAGES.TRANSCRIBE_SOURCE)) {
            advanceStage(STAGES.TRANSCRIBE_SOURCE, 25);
            state.sourceFingerprint = fingerprintFile(videoWavPath);
            state.originalTranscript = await transcribeWav(videoWavPath, vidTranscriptCache, null, {
                sourceFingerprint: state.sourceFingerprint
            });
            saveState();
        }

        
        // 4.5. TRANSLATE TO BURMESE
        const translatedTranscriptCache = path.join(cacheDir, 'burmese-transcript.json');
        if (!hasCompletedStage(job.stageId, STAGES.TRANSLATE_BURMESE)) {
            advanceStage(STAGES.TRANSLATE_BURMESE, 30);
            state.sourceFingerprint ||= fingerprintFile(videoWavPath);
            state.translatedTranscript = await translateWithGemini(
                state.originalTranscript, translatedTranscriptCache, geminiApiKey,
                {
                    sourceFingerprint: state.sourceFingerprint,
                    onRetry: retry => updateJob(jobId, {
                        stageId: STAGES.TRANSLATE_BURMESE,
                        stageMessage: retry.message || GEMINI_RETRY_STAGE_MESSAGE
                    }),
                    onModelSelected: model => updateJob(jobId, {
                        selectedGeminiModel: model,
                        stageMessage: 'Selected Gemini model: ' + model
                    })
                }
            );
            updateJob(jobId, { stageMessage: null, retryable: false, resumeStage: null });
            saveState();
        }

        // 4.5 GENERATE TTS
        const ttsAudioCache = path.join(cacheDir, 'narration_tts.wav');
        if (!hasCompletedStage(job.stageId, STAGES.GENERATE_TTS)) {
            advanceStage(STAGES.GENERATE_TTS, 35);
            const voiceId = getSetting('EDGE_TTS_VOICE') || 'male-young-adult';
            const mappedTranscript = state.translatedTranscript.map(t => ({
                narration_text: t.text,
                scene_start: t.timestamp[0],
                scene_end: t.timestamp[1],
                kind: t.kind,
                speaker: t.speaker || null
            }));
            state.ttsAudioPath = await generateNarrationTTS(
                mappedTranscript,
                ttsAudioCache,
                voiceId,
                state.originalTranscript,
                state.originalVideoDuration,
                { geminiApiKey, sourceFingerprint: state.sourceFingerprint, enableLegacyDurationFit: false }
            );
            saveState();
        }

// Validate generated TTS audio without exposing a separate workflow stage.
        if (!hasCompletedStage(job.stageId, STAGES.GENERATE_TTS)) {
            ;
            
            const ttsAudioPath = state.ttsAudioPath;
            if (!ttsAudioPath || !fs.existsSync(ttsAudioPath)) {
                throw new Error("Pipeline Error: TTS audio file is missing.");
            }
            const stats = fs.statSync(ttsAudioPath);
            if (stats.size === 0) {
                throw new Error("Pipeline Error: TTS audio file is zero bytes.");
            }
            
            const duration = await getDuration(ttsAudioPath);
            if (!Number.isFinite(duration) || duration <= 0) {
                throw new Error("Pipeline Error: TTS audio has invalid or missing audio stream.");
            }
            
            // We no longer run Whisper on the TTS audio because we generate an authoritative timeline.
            state.audioDuration = duration;
            saveState();
        }

        // Narration transcript is now populated from authoritative timeline later.

        // 6. CHRONOLOGICAL MATCHING & 7. VERSIONED TIMELINE BUILDER
        if (!hasCompletedStage(job.stageId, STAGES.BUILD_TIMELINE)) {
            advanceStage(STAGES.MATCH_SCENES, 55);
            const ttsSidecarPath = state.ttsAudioPath + '.timeline.json';
            if (!fs.existsSync(ttsSidecarPath)) throw new Error('Authoritative TTS timing sidecar not found.');
            const authTimeline = JSON.parse(fs.readFileSync(ttsSidecarPath, 'utf8'));
            const anchoredSegments = authTimeline.flatMap(group => {
                if (!group || !Array.isArray(group.segments)) {
                    throw new Error('Pipeline Error: Invalid grouped authoritative timeline.');
                }
                return group.segments;
            });
            state.mapping = mapRecordsChronologically(
                anchoredSegments, state.scenes, state.originalVideoDuration, state.audioDuration);
            state.timelineManifest = buildTimelineManifest(
                state.mapping, state.originalVideoDuration, state.audioDuration, state.sourceFingerprint);
            state.timelineManifestPath = path.join(cacheDir, 'timeline-manifest.v2.json');
            fs.writeFileSync(state.timelineManifestPath, JSON.stringify(state.timelineManifest, null, 2));
            state.timeline = state.timelineManifest.segments;
            state.narrationTranscript = anchoredSegments.map(segment => ({
                text: segment.text,
                timestamp: [segment.final_audio_start, segment.final_audio_end]
            }));
            saveState();
            advanceStage(STAGES.BUILD_TIMELINE, 70, 'completed');
        } else {
            state.timelineManifestPath = path.join(cacheDir, 'timeline-manifest.v2.json');
            if (!fs.existsSync(state.timelineManifestPath)) {
                throw new Error('Completed timeline stage has no manifest.');
            }
            state.timelineManifest = readTimelineManifest(state.timelineManifestPath, {
                sourceFingerprint: state.sourceFingerprint,
                mediaDuration: state.originalVideoDuration,
                ttsDuration: state.audioDuration
            });
            state.timeline = state.timelineManifest.segments;
        }

        // 8. REAL SCENE REBUILD
        if (!hasCompletedStage(job.stageId, STAGES.REBUILD_SCENES)) {
            advanceStage(STAGES.REBUILD_SCENES, 90);
            const timelineFingerprint = fingerprintFile(state.timelineManifestPath);
            for (const segment of state.timelineManifest.segments) {
                const segmentPath = getSegmentPath(jobTmpDir, segment.output_order);
                const temporaryPath = assertSafeJobPath(segmentPath + '.tmp.mp4', jobTmpDir);
                const metadataPath = assertSafeJobPath(segmentPath + '.workflow.json', jobTmpDir);
                const expectedMetadata = { workflowVersion: WORKFLOW_VERSION, timelineFingerprint, outputOrder: segment.output_order };
                if (fs.existsSync(segmentPath) && !fs.lstatSync(segmentPath).isSymbolicLink() &&
                    fs.statSync(segmentPath).size > 0 && artifactMetadataMatches(metadataPath, expectedMetadata)) continue;
                if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
                await runFFmpeg(buildSegmentFFmpegArgs(job.videoPath, temporaryPath, segment), jobTmpDir);
                if (!fs.existsSync(temporaryPath) || fs.lstatSync(temporaryPath).isSymbolicLink() ||
                    fs.statSync(temporaryPath).size === 0) {
                    throw new Error(`Segment ${segment.output_order} generation produced no usable file.`);
                }
                fs.renameSync(temporaryPath, segmentPath);
                writeArtifactMetadata(metadataPath, expectedMetadata);
            }
            const concatContent = buildConcatManifest(state.timelineManifest, jobTmpDir);
            state.concatFile = assertSafeJobPath(path.join(jobTmpDir, 'concat.v2.txt'), jobTmpDir);
            fs.writeFileSync(state.concatFile, concatContent);
            state.renderedSegmentCount = state.timelineManifest.segments.length;
            saveState();
            advanceStage(STAGES.REBUILD_SCENES, 92, 'completed');
        } else {
            if (state.renderedSegmentCount !== state.timelineManifest.segments.length) {
                throw new Error('Completed rebuild stage has an incomplete segment count.');
            }
            state.concatFile = assertSafeJobPath(path.join(jobTmpDir, 'concat.v2.txt'), jobTmpDir);
            if (!fs.existsSync(state.concatFile) || fs.statSync(state.concatFile).size === 0) {
                throw new Error('Completed rebuild stage has no valid concatenation manifest.');
            }
            buildConcatManifest(state.timelineManifest, jobTmpDir);
            const timelineFingerprint = fingerprintFile(state.timelineManifestPath);
            for (const segment of state.timelineManifest.segments) {
                const segmentPath = getSegmentPath(jobTmpDir, segment.output_order);
                const metadataPath = assertSafeJobPath(segmentPath + '.workflow.json', jobTmpDir);
                if (!artifactMetadataMatches(metadataPath, { workflowVersion: WORKFLOW_VERSION, timelineFingerprint, outputOrder: segment.output_order })) {
                    throw new Error('Segment ' + segment.output_order + ' has incompatible cache metadata.');
                }
            }
        }

        // 9. CONCATENATION AND FINAL EXPORT
        const outputPaths = getJobOutputPaths(outDir, jobId);
        const finalFileTmp = assertSafeJobPath(path.join(jobTmpDir, 'export.v2.tmp.mp4'), jobTmpDir);
        const exportMetadataPath = assertSafeJobPath(path.join(jobTmpDir, 'export.v2.json'), jobTmpDir);
        const exportMetadata = {
            workflowVersion: WORKFLOW_VERSION,
            timelineFingerprint: fingerprintFile(state.timelineManifestPath),
            renderedSegmentCount: state.timelineManifest.segments.length,
            mp4Path: outputPaths.mp4,
            mp3Path: outputPaths.mp3
        };
        if (!hasCompletedStage(job.stageId, STAGES.EXPORT_FINAL)) {
            advanceStage(STAGES.EXPORT_FINAL, 94);
            if (state.renderedSegmentCount !== state.timelineManifest.segments.length) {
                throw new Error('Not all intended timeline segments were rendered.');
            }
            await runFFmpeg([
                '-f', 'concat', '-safe', '0', '-i', state.concatFile,
                '-i', path.resolve(state.ttsAudioPath),
                '-map', '0:v:0', '-map', '1:a:0',
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
                '-c:a', 'aac', '-b:a', '128k',
                '-t', state.audioDuration.toFixed(6),
                '-movflags', '+faststart', '-y', finalFileTmp
            ], jobTmpDir, pct => updateJob(jobId, { progress: 94 + (pct * 0.05) }));
            validateFinalMedia(
                await getStreamsDuration(finalFileTmp),
                fs.existsSync(finalFileTmp) ? fs.statSync(finalFileTmp).size : 0,
                state.audioDuration
            );
            fs.renameSync(finalFileTmp, outputPaths.mp4);
            writeArtifactMetadata(exportMetadataPath, exportMetadata);
            advanceStage(STAGES.EXPORT_FINAL, 99, 'completed');
        } else if (!fs.existsSync(outputPaths.mp4) || fs.statSync(outputPaths.mp4).size === 0 ||
            !artifactMetadataMatches(exportMetadataPath, exportMetadata)) {
            throw new Error('Completed export stage has no compatible MP4 artifact.');
        }

        // 10. OPTIONAL FINAL SPEED ADJUSTMENT
        const finalSpeed = Number(getSetting('OUTPUT_SPEED_MULTIPLIER') || 1);
        if (!Number.isFinite(finalSpeed) || finalSpeed <= 0) {
            throw new Error(`Invalid final speed multiplier: ${finalSpeed}`);
        }
        const speedMetadataPath = assertSafeJobPath(path.join(jobTmpDir, 'speed-adjustment.v2.json'), jobTmpDir);
        const speedMetadata = { ...exportMetadata, multiplier: finalSpeed };
        if (!hasCompletedStage(job.stageId, STAGES.ADJUST_FINAL_SPEED)) {
            const speedOutcome = getFinalSpeedStageOutcome(finalSpeed);
            advanceStage(STAGES.ADJUST_FINAL_SPEED, 99, speedOutcome.stageOutcome);
            if (finalSpeed !== 1 && !artifactMetadataMatches(speedMetadataPath, speedMetadata)) {
                const adjustedTmp = assertSafeJobPath(
                    path.join(jobTmpDir, 'speed-adjusted.v2.tmp.mp4'), jobTmpDir);
                await runFFmpeg([
                    '-i', outputPaths.mp4,
                    '-filter_complex',
                    `[0:v]setpts=PTS/${finalSpeed.toFixed(8)}[v];[0:a]${buildAtempoFilter(finalSpeed)}[a]`,
                    '-map', '[v]', '-map', '[a]',
                    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
                    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
                    '-y', adjustedTmp
                ], jobTmpDir);
                validateFinalMedia(
                    await getStreamsDuration(adjustedTmp),
                    fs.existsSync(adjustedTmp) ? fs.statSync(adjustedTmp).size : 0,
                    state.audioDuration / finalSpeed
                );
                fs.renameSync(adjustedTmp, outputPaths.mp4);
            }
            writeArtifactMetadata(speedMetadataPath, speedMetadata);
        } else if (!artifactMetadataMatches(speedMetadataPath, speedMetadata)) {
            throw new Error('Completed speed-adjustment stage has incompatible metadata.');
        }
        const finalDetails = validateFinalMedia(
            await getStreamsDuration(outputPaths.mp4),
            fs.existsSync(outputPaths.mp4) ? fs.statSync(outputPaths.mp4).size : 0,
            state.audioDuration / finalSpeed
        );
        await runFFmpeg([
            '-i', outputPaths.mp4, '-map', '0:a:0', '-vn',
            '-c:a', 'libmp3lame', '-b:a', '128k', '-y', outputPaths.mp3
        ], outDir);
        if (!fs.existsSync(outputPaths.mp3) || fs.statSync(outputPaths.mp3).size === 0) {
            throw new Error('Pipeline Error: MP3 export is missing or empty.');
        }

        updateJob(jobId, {
            status: 'complete',
            progress: 100,
            stageId: STAGES.DONE,
            stageOutcome: 'completed',
            workflowVersion: WORKFLOW_VERSION,
            completed_at: Date.now(),
            result: {
                metadata: { duration: state.originalVideoDuration, finalDuration: finalDetails.videoDuration },
                scenes: state.scenes,
                originalTranscript: state.originalTranscript,
                narrationTranscript: state.narrationTranscript,
                mapping: state.mapping,
                timeline: state.timeline,
                videoUrl: `/output/${jobId}.mp4`,
                audioUrl: `/output/${jobId}.mp3`
            }
        });

        console.log(`[Job ${jobId}] Completed successfully.`);

    } catch (err) {
        console.error(`[Job ${jobId}] Error:`, err);
        const safeErrorMsg = err.message ? err.message.replace(/key=[A-Za-z0-9_\-]+/gi, 'key=HIDDEN') : 'Unknown error';
        const geminiFailureUpdate = getGeminiFailureJobUpdate(err);
        updateJob(jobId, geminiFailureUpdate || { status: 'error', error: safeErrorMsg, retryable: false });
    } finally {
        const currentJob = getJob(jobId);
        const lifecycleStatus = currentJob?.status || 'error';
        if (lifecycleStatus === 'complete') {
            state.stageId = STAGES.CLEANUP;
            state.stageOutcome = null;
            saveState();
            updateJob(jobId, { stageId: STAGES.CLEANUP });
        }
        try {
            cleanupPipelineArtifacts({
                cacheDir,
                uploadRoot: storagePaths.uploads,
                videoPath: currentJob?.videoPath,
                audioPath: currentJob?.audioPath,
                lifecycleStatus
            });
        } catch (cleanupError) {
            console.error('[Job ' + jobId + '] Cleanup Error:', cleanupError);
        } finally {
            if (lifecycleStatus === 'complete' || lifecycleStatus === 'cancelled') clearJobKeys(jobId);
            if (lifecycleStatus === 'complete') {
                state.stageId = STAGES.DONE;
                state.stageOutcome = 'completed';
                saveState();
                updateJob(jobId, { stageId: STAGES.DONE, stageOutcome: 'completed' });
            }
        }
    }
};
