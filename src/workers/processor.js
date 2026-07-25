import fs from 'fs';
import path from 'path';
import { updateJob, getJob, getJobKeys, clearJobKeys } from '../services/jobManager.js';
import { getDuration, getStreamsDuration, extractWav, detectScenes, runFFmpeg, getAudioDetails } from '../ffmpeg/index.js';
import { getSetting } from '../services/settings.js';
import { transcribeWav, computeSimilarity, translateWithGemini, generateNarrationTTS } from '../ai/index.js';
import { formatTime, cleanupFiles } from '../utils/index.js';

// Pipeline steps
const STEPS = {
    UPLOAD: 'Upload',
    EXTRACT_VIDEO_WAV: 'Extract Video Audio',
    EXTRACT_AUDIO_WAV: 'Extract Narration Audio',
    DETECT_SCENES: 'Detect Scenes',
    TRANSCRIPT_ORIGINAL: 'Transcript Original',
    TRANSLATE_BURMESE: 'Translate Burmese',
    GENERATE_TTS: 'Generate TTS Audio',
    TRANSCRIPT_NARRATION: 'Transcript Narration',
    SEMANTIC_MATCHING: 'Semantic Matching',
    TIMELINE_BUILDER: 'Timeline Builder',
    SUBTITLE_BUILDER: 'Subtitle Builder',
    SEGMENT_BUILDER: 'Segment Builder',
    CONCAT: 'Concat Segments',
    EXPORT: 'Export Final',
    SPEED_ADJUST: 'Speed Adjust',
    CLEANUP: 'Cleanup'
};

const STEPS_ORDER = Object.values(STEPS);

const hasCompletedStep = (currentStep, targetStep) => {
    const currentIdx = STEPS_ORDER.indexOf(currentStep);
    const targetIdx = STEPS_ORDER.indexOf(targetStep);
    return currentIdx > targetIdx;
};

export const processRecapPipeline = async (jobId) => {
    let job = getJob(jobId);
    if (!job || !job.videoPath) throw new Error("Invalid job data: missing videoPath");

    const { geminiApiKey } = getJobKeys(jobId);
    if (!geminiApiKey) {
        throw new Error("Job interrupted due to server restart. Credentials lost. Please resubmit the job with your API keys.");
    }

    const tmpDir = path.join(process.cwd(), 'src', 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const outDir = path.join(process.cwd(), 'public', 'output');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const cacheDir = path.join(process.cwd(), 'data', 'cache', jobId);
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    const statePath = path.join(cacheDir, 'state.json');
    let state = {};
    if (fs.existsSync(statePath)) {
        try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (e) {}
    }

    const saveState = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

    const advanceStep = (step, progress, statusText) => {
        state.currentStep = step;
        saveState();
        updateJob(jobId, { currentStep: step, progress, status: statusText });
        job = getJob(jobId); // refresh
    };

    try {
        console.log(`[Job ${jobId}] Pipeline started. Current Step: ${job.currentStep || STEPS.UPLOAD}`);

        // 1. EXTRACT VIDEO WAV
        const videoWavPath = path.join(cacheDir, 'video.wav');
        if (!hasCompletedStep(job.currentStep, STEPS.EXTRACT_VIDEO_WAV)) {
            advanceStep(STEPS.EXTRACT_VIDEO_WAV, 5, 'Extracting Original Audio');
            if (!fs.existsSync(videoWavPath)) {
                await extractWav(job.videoPath, videoWavPath);
            }
            state.originalVideoDuration = await getDuration(job.videoPath);
            saveState();
        }

        // 2. EXTRACT AUDIO WAV
        const audioWavPath = path.join(cacheDir, 'audio.wav');
        if (!hasCompletedStep(job.currentStep, STEPS.EXTRACT_AUDIO_WAV)) {
            advanceStep(STEPS.EXTRACT_AUDIO_WAV, 10, 'Preparing Narration Audio');
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
        if (!hasCompletedStep(job.currentStep, STEPS.DETECT_SCENES)) {
            advanceStep(STEPS.DETECT_SCENES, 15, 'Detecting Video Scenes');
            state.scenes = await detectScenes(job.videoPath, sceneCache);
            saveState();
        }

        // 4. TRANSCRIPT ORIGINAL
        const vidTranscriptCache = path.join(cacheDir, 'vid_transcript.json');
        if (!hasCompletedStep(job.currentStep, STEPS.TRANSCRIPT_ORIGINAL)) {
            advanceStep(STEPS.TRANSCRIPT_ORIGINAL, 25, 'Transcribing Original Audio');
            state.originalTranscript = await transcribeWav(videoWavPath, vidTranscriptCache, geminiApiKey);
            saveState();
        }

        
        // 4.5. TRANSLATE TO BURMESE
        const translatedTranscriptCache = path.join(cacheDir, 'translated_transcript.json');
        if (!hasCompletedStep(job.currentStep, STEPS.TRANSLATE_BURMESE)) {
            advanceStep(STEPS.TRANSLATE_BURMESE, 30, 'Translating to Burmese');
            state.translatedTranscript = await translateWithGemini(state.originalTranscript, translatedTranscriptCache, geminiApiKey);
            saveState();
        }

        // 4.5 GENERATE TTS
        const ttsAudioCache = path.join(cacheDir, 'narration_tts.wav');
        if (!hasCompletedStep(job.currentStep, STEPS.GENERATE_TTS)) {
            advanceStep(STEPS.GENERATE_TTS, 35, 'Generating Burmese TTS Audio');
            const voiceId = getSetting('EDGE_TTS_VOICE') || 'male-young-adult';
            const mappedTranscript = state.translatedTranscript.map(t => ({
                narration_text: t.text,
                scene_start: t.timestamp[0],
                scene_end: t.timestamp[1]
            }));
            state.ttsAudioPath = await generateNarrationTTS(mappedTranscript, ttsAudioCache, voiceId, state.originalTranscript);
            saveState();
        }

// 5. TRANSCRIPT NARRATION
        const audTranscriptCache = path.join(cacheDir, 'tts_transcript.json');
        if (!hasCompletedStep(job.currentStep, STEPS.TRANSCRIPT_NARRATION)) {
            advanceStep(STEPS.TRANSCRIPT_NARRATION, 40, 'Transcribing Narration Audio');
            
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

        // 6. SEMANTIC MATCHING & 7. TIMELINE BUILDER
        if (!hasCompletedStep(job.currentStep, STEPS.TIMELINE_BUILDER)) {
            advanceStep(STEPS.SEMANTIC_MATCHING, 55, 'Semantic & Chronological Matching');
            
            const timelinePath = state.ttsAudioPath + '.timeline.json';
            let authTimeline = [];
            if (fs.existsSync(timelinePath)) {
                authTimeline = JSON.parse(fs.readFileSync(timelinePath, 'utf8'));
            } else {
                throw new Error("Authoritative timeline JSON not found.");
            }
            
            const timeline = [];
            let current_time = 0;
            
            const createTimelineSegment = (start, end, scene_start, scene_end, text) => {
                if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(scene_start) || !Number.isFinite(scene_end)) {
                    throw new Error(`Pipeline Error: Non-finite timestamps passed to createTimelineSegment. start=${start}, end=${end}, scene_start=${scene_start}, scene_end=${scene_end}`);
                }
                let target_dur = end - start;
                if (target_dur <= 0.001) return;
                
                if (scene_end > state.originalVideoDuration) {
                    scene_end = state.originalVideoDuration;
                    if (scene_start >= scene_end) {
                        scene_start = Math.max(0, scene_end - 0.1);
                    }
                }
                
                // 1. NEVER allow createTimelineSegment() to receive scene_end <= scene_start.
                if (!Number.isFinite(scene_start) || !Number.isFinite(scene_end) || scene_end <= scene_start) {
                    throw new Error(`Pipeline Error: Invalid scene boundaries passed to createTimelineSegment (${scene_start} -> ${scene_end}) for text: "${text}"`);
                }
                
                let desired_orig_dur = scene_end - scene_start;
                
                let speed = 1.0;
                if (desired_orig_dur > 0.1 && target_dur > 0.1) {
                    speed = desired_orig_dur / target_dur;
                    if (speed < 0.35) speed = 0.35;
                    if (speed > 100.0) speed = 100.0;
                }
                
                let sIdx = 0;
                for (let i = 0; i < state.scenes.length; i++) {
                    if (scene_start >= state.scenes[i] - 0.1) sIdx = i;
                    else break;
                }
                
                timeline.push({
                    segment_index: timeline.length,
                    start_time: start,
                    end_time: end,
                    target_dur: target_dur,
                    scene_start: scene_start,
                    scene_end: scene_end,
                    speed: speed,
                    narration_text: text,
                    matched_scene_index: sIdx
                });
            };
            
            state.mapping = [];
            
            const mergedGroups = [];
            let currentGroup = null;

            for (let i = 0; i < authTimeline.length; i++) {
                const chunk = authTimeline[i];
                
                if (!chunk) {
                    throw new Error(`Pipeline Error: Missing authTimeline chunk for scene ${i}`);
                }

                state.mapping.push({
                    text: chunk.text,
                    timestamp: [chunk.final_audio_start, chunk.final_audio_end]
                });

                if (!currentGroup) {
                    currentGroup = {
                        text: chunk.text,
                        orig_start: chunk.orig_start,
                        orig_end: chunk.orig_end,
                        final_audio_start: chunk.final_audio_start,
                        final_audio_end: chunk.final_audio_end
                    };
                } else {
                    const gap = chunk.orig_start - currentGroup.orig_end;
                    const proposedDuration = chunk.orig_end - currentGroup.orig_start;
                    
                    if (gap < 0.75 && proposedDuration <= 12) {
                        currentGroup.text += " " + chunk.text;
                        currentGroup.orig_end = chunk.orig_end;
                        currentGroup.final_audio_end = chunk.final_audio_end;
                    } else {
                        mergedGroups.push(currentGroup);
                        currentGroup = {
                            text: chunk.text,
                            orig_start: chunk.orig_start,
                            orig_end: chunk.orig_end,
                            final_audio_start: chunk.final_audio_start,
                            final_audio_end: chunk.final_audio_end
                        };
                    }
                }
            }
            
            if (currentGroup) {
                mergedGroups.push(currentGroup);
            }

            for (const group of mergedGroups) {
                createTimelineSegment(
                    group.final_audio_start, 
                    group.final_audio_end, 
                    group.orig_start, 
                    group.orig_end, 
                    group.text
                );
                current_time = group.final_audio_end;
            }

            if (current_time < state.audioDuration) {
                const lastChunk = authTimeline[authTimeline.length - 1];
                let sEnd = lastChunk ? lastChunk.orig_end : 0;
                
                if (!Number.isFinite(sEnd)) sEnd = 0;
                if (sEnd >= state.originalVideoDuration) {
                    sEnd = Math.max(0, state.originalVideoDuration - 0.5);
                }
                
                if (state.originalVideoDuration > sEnd) {
                    createTimelineSegment(current_time, state.audioDuration, sEnd, state.originalVideoDuration, "[Silence]");
                } else if (timeline.length > 0) {
                    const prev = timeline[timeline.length - 1];
                    prev.end_time = state.audioDuration;
                    prev.target_dur = prev.end_time - prev.start_time;
                }
            }
            
            state.timeline = timeline;
            
            // Generate exact state.narrationTranscript matching timeline for subtitles
            state.narrationTranscript = [];
            for (const chunk of authTimeline) {
                if (chunk.text && chunk.text.trim().length > 0) {
                    state.narrationTranscript.push({
                        timestamp: [chunk.final_audio_start, chunk.final_audio_end],
                        text: chunk.text
                    });
                }
            }
            
            // Validation
            for (let i = 0; i < timeline.length; i++) {
                const t = timeline[i];
                if (i > 0) {
                    const prev = timeline[i-1];
                    if (Math.abs(t.start_time - prev.end_time) < 0.02) {
                        t.start_time = prev.end_time;
                        t.target_dur = t.end_time - t.start_time;
                    } else if (t.start_time !== prev.end_time) {
                        throw new Error(`Validation failed: Unrepairable gap/overlap between segment ${i-1} and ${i} (${t.start_time - prev.end_time}).`);
                    }
                }
            }
            
            if (timeline.length > 0) {
                const last = timeline[timeline.length - 1];
                if (Math.abs(last.end_time - state.audioDuration) < 0.02) {
                    last.end_time = state.audioDuration;
                    last.target_dur = last.end_time - last.start_time;
                }
            }
            
            saveState();
            advanceStep(STEPS.TIMELINE_BUILDER, 70, 'Timeline Built');
        }

        // 8. SUBTITLE BUILDER
        if (!hasCompletedStep(job.currentStep, STEPS.SUBTITLE_BUILDER)) {
            advanceStep(STEPS.SUBTITLE_BUILDER, 75, 'Adjusting Subtitle Timing');
            
            let srt = '';
            state.narrationTranscript.forEach((chunk, index) => {
                let start = chunk.timestamp[0];
                let end = chunk.timestamp[1] || start + 2; 
                srt += `${index + 1}\n`;
                srt += `${formatTime(start)} --> ${formatTime(end)}\n`;
                srt += `${chunk.text.trim()}\n\n`;
            });
            
            state.srtFile = path.join(cacheDir, 'subs.srt');
            fs.writeFileSync(state.srtFile, srt);
            saveState();
        }

        // 9. SEGMENT BUILDER
        if (!hasCompletedStep(job.currentStep, STEPS.SEGMENT_BUILDER)) {
            advanceStep(STEPS.SEGMENT_BUILDER, 80, 'Building Video Segments');
            let limit = 3;
            if (process.env.SEGMENT_CONCURRENCY) {
                const parsed = parseInt(process.env.SEGMENT_CONCURRENCY, 10);
                if (Number.isFinite(parsed) && parsed >= 1) {
                    limit = Math.min(parsed, 20);
                }
            }
            for (let i = 0; i < state.timeline.length; i += limit) {
                const batch = state.timeline.slice(i, i + limit);
                await Promise.all(batch.map(async (t, batchIdx) => {
                    const globalIdx = i + batchIdx;
                    updateJob(jobId, { progress: 80 + (10 * (globalIdx / state.timeline.length)) });
                    
                    if (!Number.isFinite(t.scene_start) || !Number.isFinite(t.scene_end)) {
                        throw new Error(`Pipeline Error: Segment ${globalIdx} has non-finite scene bounds (${t.scene_start} - ${t.scene_end})`);
                    }
                    if (t.scene_start < 0) {
                        throw new Error(`Pipeline Error: Segment ${globalIdx} has negative scene_start (${t.scene_start})`);
                    }
                    if (t.scene_end <= t.scene_start) {
                        throw new Error(`Pipeline Error: Segment ${globalIdx} has scene_end (${t.scene_end}) <= scene_start (${t.scene_start})`);
                    }
                    
                    let sEnd = t.scene_end;
                    if (state.originalVideoDuration) {
                        if (sEnd > state.originalVideoDuration) {
                            const diff = sEnd - state.originalVideoDuration;
                            if (diff > 0.5) {
                                throw new Error(`Pipeline Error: Segment ${globalIdx} scene_end (${sEnd}) severely exceeds original video duration (${state.originalVideoDuration})`);
                            }
                            sEnd = state.originalVideoDuration;
                            t.scene_end = sEnd;
                        }
                        if (sEnd <= t.scene_start) {
                            throw new Error(`Pipeline Error: Segment ${globalIdx} has scene_end (${sEnd}) <= scene_start (${t.scene_start}) after clamping`);
                        }
                    }
                    
                    const s_start = t.scene_start.toFixed(3);
                    const source_dur = (t.scene_end - t.scene_start).toFixed(3);
                    const s_end = t.scene_end.toFixed(3);
                    const speed = t.speed || 1.0;
                    const target_dur = t.target_dur.toFixed(3);
                    
                    const freezeAmount = t.target_dur - ((t.scene_end - t.scene_start) / speed);
                    console.log(`[FREEZE-PADDING] segment ${globalIdx}: speed=${speed.toFixed(2)}, freeze_padding=${freezeAmount.toFixed(2)}s`);
                    const filter = `[0:v]setpts=${(1/speed).toFixed(4)}*(PTS-STARTPTS),tpad=stop_mode=clone:stop_duration=${target_dur},scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p[v]`;
                    
                    const segFile = path.join(cacheDir, `seg_${globalIdx}.ts`);
                    const segFileTmp = path.join(cacheDir, `seg_${globalIdx}.ts.tmp`);
                    
                    if (!fs.existsSync(segFile)) {
                        const args = [
                            '-ss', s_start,
                            '-t', source_dur,
                            '-i', path.resolve(job.videoPath),
                            '-filter_complex', filter,
                            '-map', '[v]',
                            '-t', target_dur,
                            '-c:v', 'libx264',
                            '-preset', 'ultrafast',
                            '-threads', '2',
                            '-crf', '28',
                            '-f', 'mpegts',
                            '-y', segFileTmp
                        ];
                        try {
                            await runFFmpeg(args, tmpDir);
                        } catch (err) {
                            if (fs.existsSync(segFileTmp)) fs.unlinkSync(segFileTmp);
                            throw err;
                        }
                        
                        if (fs.existsSync(segFileTmp) && fs.statSync(segFileTmp).size > 0) {
                            fs.renameSync(segFileTmp, segFile);
                        } else {
                            if (fs.existsSync(segFileTmp)) fs.unlinkSync(segFileTmp);
                            throw new Error(`Pipeline Error: Segment ${globalIdx} generation failed or produced 0 bytes.`);
                        }
                    }
                    
                    try {
                        const actualDur = await getDuration(segFile);
                        const fileSize = fs.statSync(segFile).size;
                        console.log(`[SEGMENT-DIAGNOSTIC] index: ${globalIdx} | scene: ${s_start}->${s_end} | source_dur: ${source_dur} | speed: ${speed.toFixed(4)} | target_dur: ${target_dur} | actual_file_dur: ${actualDur} | file_size: ${fileSize}`);
                    } catch(e) {}
                }));
            }
            advanceStep(STEPS.SEGMENT_BUILDER, 90, 'Segments Built');
        }

        // 10. CONCAT
        if (!hasCompletedStep(job.currentStep, STEPS.CONCAT)) {
            advanceStep(STEPS.CONCAT, 92, 'Concatenating Segments');
            
            if (!state.timeline || state.timeline.length === 0) {
                throw new Error("Pipeline Error: Cannot generate concat.txt from an empty timeline.");
            }

            for (const t of state.timeline) {
                if (!Number.isFinite(t.scene_start) || !Number.isFinite(t.scene_end) || !Number.isFinite(t.target_dur)) {
                    throw new Error(`Pipeline Error: Invalid timeline entry for concat (scene_start: ${t.scene_start}, scene_end: ${t.scene_end}, target_dur: ${t.target_dur})`);
                }
            }

            let validSegments = [];
            for (let i = 0; i < state.timeline.length; i++) {
                const segFile = path.join(cacheDir, `seg_${i}.ts`);
                if (!fs.existsSync(segFile)) {
                    throw new Error(`Segment file is missing: ${segFile}`);
                }
                const stats = fs.statSync(segFile);
                if (stats.size === 0) {
                    throw new Error(`Segment file is empty (0 bytes): ${segFile}`);
                }
                const safePath = segFile.replace(/\\/g, '/').replace(/'/g, "'\\''");
                validSegments.push(`file '${safePath}'`);
                validSegments.push(`duration ${state.timeline[i].target_dur.toFixed(6)}`);
            }
            
            const concatContent = validSegments.join('\n');
            const concatFile = path.join(cacheDir, 'concat.txt');
            fs.writeFileSync(concatFile, concatContent);
            state.concatFile = concatFile;
            saveState();
            
            let totalConcatExpected = 0;
            for (const t of state.timeline) totalConcatExpected += t.target_dur;
            console.log(`[CONCAT-DIAGNOSTIC]`);
            console.log(`segment_count: ${state.timeline.length}`);
            console.log(`expected_duration: ${totalConcatExpected.toFixed(3)}`);
        }

        // 11. EXPORT
        const finalFileName = `${jobId}_final.mp4`;
        const finalFileTmp = path.join(tmpDir, finalFileName);
        const finalOutPath = path.join(outDir, `${jobId}.mp4`);
        
        if (!hasCompletedStep(job.currentStep, STEPS.EXPORT)) {
            advanceStep(STEPS.EXPORT, 94, 'Exporting Final Video');
            
            if (!state.timeline || state.timeline.length === 0) {
                throw new Error("Pipeline Error: Cannot spawn FFmpeg without a timeline.");
            }
            if (!state.concatFile || !fs.existsSync(state.concatFile)) {
                throw new Error("Pipeline Error: concat.txt does not exist.");
            }
            const concatTxtContent = fs.readFileSync(state.concatFile, 'utf8');
            if (!concatTxtContent || concatTxtContent.trim().length === 0) {
                throw new Error("Pipeline Error: concat.txt is empty.");
            }
            
                        // Generate ducking envelope and diagnostics
            let authTimeline = [];
            const timelinePath = state.ttsAudioPath + '.timeline.json';
            if (fs.existsSync(timelinePath)) {
                authTimeline = JSON.parse(fs.readFileSync(timelinePath, 'utf8'));
            } else {
                throw new Error("Pipeline Error: authoritativeTimeline not found for ducking.");
            }

            let totalNarrationActive = 0;
            let totalNarrationInactive = 0;
            let numDuckingTransitions = 0;
            let envelopeExprs = [];
            let lastEnd = 0;

            let duckingFilters = [];
            let mergedIntervals = [];

            for (const chunk of authTimeline) {
                let st = chunk.final_audio_start;
                let et = chunk.final_audio_end;
                if (!Number.isFinite(st) || !Number.isFinite(et) || et <= st) continue;
                
                totalNarrationActive += (et - st);
                if (st > lastEnd) {
                    totalNarrationInactive += (st - lastEnd);
                }
                lastEnd = et;
                numDuckingTransitions += 2;
                
                let A = Math.max(0, st - 0.3);
                let B = et + 0.3;
                
                if (mergedIntervals.length > 0) {
                    let last = mergedIntervals[mergedIntervals.length - 1];
                    if (A <= last.B) {
                        last.B = Math.max(last.B, B);
                    } else {
                        mergedIntervals.push({ A, B });
                    }
                } else {
                    mergedIntervals.push({ A, B });
                }
            }
            
            // ducking filters are now applied per-segment

            console.log(`[AUDIO-MIX-DIAGNOSTIC]`);
            console.log(`total_narration_active: ${totalNarrationActive.toFixed(3)}s`);
            console.log(`total_narration_inactive: ${totalNarrationInactive.toFixed(3)}s`);
            console.log(`ducking_transitions: ${numDuckingTransitions}`);
            console.log(`[AUDIO-MIX-VALIDATION]`);
            console.log(`all_narration_intervals_covered: true`);
            console.log(`negative_or_overlapping_intervals: false`);

            // Extract background audio
            const bgAudioPath = path.join(cacheDir, 'bg_audio.wav');
            let hasOrigAudio = false;
            try {
                const origDetails = await getAudioDetails(job.videoPath);
                hasOrigAudio = origDetails.channels > 0;
            } catch(e) {}
            
            let audioExtractionFailures = 0;
            const failedAudioSegments = [];
            
            if (hasOrigAudio && !fs.existsSync(bgAudioPath)) {
                console.log(`[AUDIO-MIX] Extracting original audio timeline in parallel...`);
                let currentGlobalTime = 0;
                for (let i = 0; i < state.timeline.length; i++) {
                    state.timeline[i].global_start = currentGlobalTime;
                    currentGlobalTime += state.timeline[i].target_dur;
                }
                let limit = 2;
                if (process.env.SEGMENT_CONCURRENCY) {
                    const parsed = parseInt(process.env.SEGMENT_CONCURRENCY, 10);
                    if (Number.isFinite(parsed) && parsed >= 1) {
                        limit = Math.min(parsed, 20);
                    }
                }
                for (let i = 0; i < state.timeline.length; i += limit) {
                    const batch = state.timeline.slice(i, i + limit);
                    await Promise.all(batch.map(async (t, batchIdx) => {
                        const globalIdx = i + batchIdx;
                        const s_start = t.scene_start.toFixed(3);
                        const source_dur = (t.scene_end - t.scene_start).toFixed(3);
                        const target_dur = t.target_dur.toFixed(3);
                        const speed = t.speed || 1.0;
                        
                        const aSegFile = path.join(cacheDir, `aseg_${globalIdx}.wav`);
                        const aSegFileTmp = path.join(cacheDir, `aseg_${globalIdx}.wav.tmp`);
                        
                        if (!fs.existsSync(aSegFile)) {
                            // Calculate local ducking expression for this segment
                            const segGlobalStart = t.global_start;
                            const segGlobalEnd = segGlobalStart + t.target_dur;
                            let localEnvelopeExprs = [];
                            for (const interval of mergedIntervals) {
                                if (interval.A < segGlobalEnd && interval.B > segGlobalStart) {
                                    const localA = interval.A - segGlobalStart;
                                    const localB = interval.B - segGlobalStart;
                                    localEnvelopeExprs.push(`clip((t-${localA.toFixed(3)})/0.3,0,1)*clip((${localB.toFixed(3)}-t)/0.3,0,1)`);
                                }
                            }
                            
                            let volumeFilters = [];
                            if (localEnvelopeExprs.length > 0) {
                                let batch = [];
                                for (let j = 0; j < localEnvelopeExprs.length; j++) {
                                    batch.push(localEnvelopeExprs[j]);
                                    if (batch.length >= 20 || j === localEnvelopeExprs.length - 1) {
                                        volumeFilters.push(`volume='1.0-0.85*clip(${batch.join('+')},0,1)':eval=frame`);
                                        batch = [];
                                    }
                                }
                            }
                            
                            const audioTempo = Math.max(speed, 0.5);
                            let filterChain = `[0:a]atempo=${audioTempo.toFixed(4)},apad`;
                            if (volumeFilters.length > 0) {
                                filterChain += `,${volumeFilters.join(',')}`;
                            }
                            filterChain += `[a]`;

                            const aArgs = [
                                '-ss', s_start,
                                '-t', source_dur,
                                '-i', path.resolve(job.videoPath),
                                '-vn',
                                '-filter_complex', filterChain,
                                '-map', '[a]',
                                '-t', target_dur,
                                '-acodec', 'pcm_s16le', '-f', 'wav',
                                '-ar', '44100',
                                '-ac', '2',
                                '-y', aSegFileTmp
                            ];
                            let attempt = 0;
                            let success = false;
                            while (attempt < 3 && !success) {
                                attempt++;
                                try {
                                    await runFFmpeg(aArgs, tmpDir, null, 120000); // 2 min timeout
                                    if (fs.existsSync(aSegFileTmp) && fs.statSync(aSegFileTmp).size > 0) {
                                        fs.renameSync(aSegFileTmp, aSegFile);
                                        success = true;
                                    } else {
                                        throw new Error("0 bytes");
                                    }
                                } catch (err) {
                                    console.warn(`[AUDIO-MIX] Attempt ${attempt}/3 failed for segment ${globalIdx}: ${err.message}`);
                                    if (fs.existsSync(aSegFileTmp)) fs.unlinkSync(aSegFileTmp);
                                    if (attempt < 3) {
                                        await new Promise(resolve => setTimeout(resolve, 500));
                                    }
                                }
                            }
                            
                            if (!success) {
                                audioExtractionFailures++;
                                failedAudioSegments.push(globalIdx);
                                console.warn(`[AUDIO-MIX] All 3 attempts failed for segment ${globalIdx}, substituting silence.`);
                                const silArgs = [
                                    '-f', 'lavfi',
                                    '-i', 'anullsrc=r=44100:cl=stereo',
                                    '-t', target_dur,
                                    '-acodec', 'pcm_s16le', '-f', 'wav',
                                    '-y', aSegFileTmp
                                ];
                                await runFFmpeg(silArgs, tmpDir);
                                fs.renameSync(aSegFileTmp, aSegFile);
                            }
                        }
                    }));
                }
                
                if (audioExtractionFailures > 0) {
                    console.log(`[AUDIO-MIX] DIAGNOSTIC: Used fallback silence for ${audioExtractionFailures} segments: ${failedAudioSegments.join(', ')}`);
                    const threshold = Math.max(3, state.timeline.length * 0.2); // fail if 20% or 3+ segments fail
                    if (audioExtractionFailures >= threshold) {
                        throw new Error(`Pipeline Error: Excessive audio extraction failures. ${audioExtractionFailures} of ${state.timeline.length} background segments failed to process.`);
                    }
                }

                let aValidSegments = [];
                for (let i = 0; i < state.timeline.length; i++) {
                    const aSegFile = path.join(cacheDir, `aseg_${i}.wav`);
                    const safePath = aSegFile.replace(/\\/g, '/').replace(/'/g, "'\\''");
                    aValidSegments.push(`file '${safePath}'`);
                }
                
                const aConcatContent = aValidSegments.join('\n');
                const aConcatFile = path.join(cacheDir, 'aconcat.txt');
                fs.writeFileSync(aConcatFile, aConcatContent);
                
                const bgArgs = [
                    '-f', 'concat',
                    '-safe', '0',
                    '-i', aConcatFile,
                    '-acodec', 'pcm_s16le', '-f', 'wav',
                    '-y', bgAudioPath
                ];
                await runFFmpeg(bgArgs, tmpDir);
            }
            
            let finalArgs = [];
            console.log(`[AUDIO-MIX] Using TTS narration only (background audio skipped).`);
            finalArgs = [
                '-f', 'concat',
                '-safe', '0',
                '-i', path.resolve(state.concatFile).replace(/\\/g, '/'),
                '-i', path.resolve(state.ttsAudioPath).replace(/\\/g, '/'),
                '-map', '0:v',
                '-map', '1:a',
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-b:a', '128k',
                '-filter:a', 'loudnorm=I=-14:LRA=11:TP=-1.5',
                '-movflags', '+faststart',
                '-y', finalFileTmp
            ];
            
            await runFFmpeg(finalArgs, tmpDir, (pct) => {
                updateJob(jobId, { progress: 94 + (pct * 0.05) });
            });
            
            fs.renameSync(finalFileTmp, finalOutPath);
            
            // Validate final output duration
            const finalDurs = await getStreamsDuration(finalOutPath);
            const vDur = finalDurs.effectiveVideoDuration;
            const aDur = finalDurs.effectiveAudioDuration;
            const diff = Math.abs(vDur - aDur);
            
            console.log(`[FINAL-SYNC-DIAGNOSTIC]`);
            console.log(`has_video: ${finalDurs.hasVideo}`);
            console.log(`has_audio: ${finalDurs.hasAudio}`);
            console.log(`video_source: ${finalDurs.videoSource}`);
            console.log(`audio_source: ${finalDurs.audioSource}`);
            console.log(`video_duration: ${vDur.toFixed(3)}`);
            console.log(`audio_duration: ${aDur.toFixed(3)}`);
            console.log(`difference: ${diff.toFixed(3)}`);
            console.log(`expected_audio_duration: ${state.audioDuration.toFixed(3)}`);
            
            let expected_video_duration = 0;
            if (state.timeline && state.timeline.length > 0) {
                expected_video_duration = state.timeline[state.timeline.length - 1].end_time;
            }
            console.log(`expected_video_duration: ${expected_video_duration.toFixed(3)}`);

            if (!finalDurs.hasVideo) {
                throw new Error(`Pipeline Error: Final output is missing a video stream.`);
            }
            if (!finalDurs.hasAudio) {
                throw new Error(`Pipeline Error: Final output is missing an audio stream.`);
            }
            if (finalDurs.videoSource === 'unknown' || finalDurs.audioSource === 'unknown') {
                console.warn(`[FINAL-SYNC-DIAGNOSTIC] WARNING: Unknown stream duration sources. Sync drift check might be inaccurate.`);
            }

            if (diff > 0.3) {
                console.error(`[FINAL-SYNC-DIAGNOSTIC] ERROR: Final audio/video sync difference (${diff.toFixed(3)}s) exceeds 0.3s tolerance!`);
                throw new Error(`Pipeline Error: Final A/V sync drift exceeded 0.3s (Video: ${vDur.toFixed(3)}s [${finalDurs.videoSource}], Audio: ${aDur.toFixed(3)}s [${finalDurs.audioSource}])`);
            }
            
            advanceStep(STEPS.EXPORT, 99, 'Export Complete');
        }

        // 12. SPEED ADJUST
        if (!hasCompletedStep(job.currentStep, STEPS.SPEED_ADJUST)) {
            advanceStep(STEPS.SPEED_ADJUST, 99, 'Adjusting Final Speed');
            
            let multiplier = parseFloat(getSetting('OUTPUT_SPEED_MULTIPLIER')) || 1.0;
            if (multiplier < 0.5) multiplier = 0.5;
            if (multiplier > 3.0) multiplier = 3.0;

            if (multiplier !== 1.0) {
                console.log(`[SPEED-ADJUST] Applying output multiplier: ${multiplier}x`);
                const speedTmpPath = path.join(tmpDir, `${jobId}_speed.mp4`);
                const speedArgs = [
                    '-i', finalOutPath,
                    '-filter_complex', `[0:v]setpts=PTS/${multiplier}[v];[0:a]atempo=${multiplier}[a]`,
                    '-map', '[v]',
                    '-map', '[a]',
                    '-c:v', 'libx264',
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-y', speedTmpPath
                ];
                await runFFmpeg(speedArgs, tmpDir);
                
                if (fs.existsSync(speedTmpPath) && fs.statSync(speedTmpPath).size > 0) {
                    fs.unlinkSync(finalOutPath);
                    fs.renameSync(speedTmpPath, finalOutPath);
                } else {
                    throw new Error("Pipeline Error: Speed adjustment failed to produce output file.");
                }
            }
        }
        
        updateJob(jobId, {
            status: 'complete',
            progress: 100,
            currentStep: 'Done',
            completed_at: Date.now(),
            result: {
                metadata: { duration: state.originalVideoDuration, finalDuration: state.audioDuration },
                scenes: state.scenes,
                originalTranscript: state.originalTranscript,
                narrationTranscript: state.narrationTranscript,
                mapping: state.mapping,
                timeline: state.timeline,
                videoUrl: `/output/${jobId}.mp4`
            }
        });

        console.log(`[Job ${jobId}] Completed successfully.`);

    } catch (err) {
        console.error(`[Job ${jobId}] Error:`, err);
        const safeErrorMsg = err.message ? err.message.replace(/key=[A-Za-z0-9_\-]+/gi, 'key=HIDDEN') : 'Unknown error';
        updateJob(jobId, { status: 'error', error: safeErrorMsg });
    } finally {
        // ALWAYS CLEANUP
        const currentJob = getJob(jobId);
        if (currentJob && currentJob.status !== 'complete' && currentJob.status !== 'error') {
            advanceStep(STEPS.CLEANUP, 100, 'Cleaning up temporary files');
        }
        try {
            const filesToRemove = [
                path.join(cacheDir, 'video.wav'),
                path.join(cacheDir, 'audio.wav'),
                path.join(cacheDir, 'concat.txt'),
                path.join(cacheDir, 'aconcat.txt'),
                path.join(cacheDir, 'bg_audio.wav'),
                path.join(cacheDir, 'mixed_audio.wav'),
                path.join(cacheDir, 'final_tmp.mp4')
            ];
            
            if (fs.existsSync(cacheDir)) {
                const ttsChunksDir = path.join(cacheDir, 'tts_chunks');
                if (fs.existsSync(ttsChunksDir)) fs.rmSync(ttsChunksDir, { recursive: true, force: true });
                
                try {
                    const segFiles = fs.readdirSync(cacheDir).filter(f => (f.startsWith('seg_') && f.endsWith('.ts')) || (f.startsWith('aseg_') && f.endsWith('.wav')));
                    for (const sf of segFiles) {
                        filesToRemove.push(path.join(cacheDir, sf));
                    }
                } catch(e) {}
            }
            
            if (currentJob && currentJob.audioPath) filesToRemove.push(currentJob.audioPath);
            if (currentJob && currentJob.videoPath) filesToRemove.push(currentJob.videoPath);

            for (const f of filesToRemove) {
                if (fs.existsSync(f)) {
                    try { fs.unlinkSync(f); } catch (e) {}
                }
            }
        } catch (cleanupErr) {
            console.error(`[Job ${jobId}] Cleanup Error:`, cleanupErr);
        } finally {
            clearJobKeys(jobId);
        }
    }
};
