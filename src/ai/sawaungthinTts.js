import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EdgeTTS } from 'node-edge-tts';
import { getVoiceConfig } from './voices.js';
import { synthesizeEdgeTts } from './edgeTtsRequest.js';
import { runFFmpeg, getDuration } from '../ffmpeg/index.js';
import { getSetting } from '../services/settings.js';
import { WORKFLOW_VERSION } from '../domain/workflow.js';
import { isAbortError, throwIfAborted, waitWithSignal } from '../services/cancellation.js';

export const SAWAUNGTHIN_TTS_ALGORITHM_VERSION = 'sawaungthin-edge-tts-continuous-v1';

export const buildSawaungthinTtsBlocks = (sceneNarration, dialogueMode = false) => {
    const maxGap = dialogueMode ? 3.0 : 0.75;
    const maxDur = dialogueMode ? 60 : 12;
    const mergedBlocks = [];
    let currentBlock = null;
    for (let i = 0; i < sceneNarration.length; i += 1) {
        const scene = sceneNarration[i];
        if (!currentBlock) {
            currentBlock = {
                scenes: [i], mergedText: scene.narration_text,
                orig_start: scene.scene_start, orig_end: scene.scene_end
            };
            continue;
        }
        const gap = scene.scene_start - currentBlock.orig_end;
        const proposedDuration = scene.scene_end - currentBlock.orig_start;
        if (gap < maxGap && proposedDuration <= maxDur) {
            currentBlock.scenes.push(i);
            currentBlock.mergedText += ` ${scene.narration_text}`;
            currentBlock.orig_end = scene.scene_end;
        } else {
            mergedBlocks.push(currentBlock);
            currentBlock = {
                scenes: [i], mergedText: scene.narration_text,
                orig_start: scene.scene_start, orig_end: scene.scene_end
            };
        }
    }
    if (currentBlock) mergedBlocks.push(currentBlock);
    return mergedBlocks;
};

export const buildSawaungthinTimelineEntries = ({
    block,
    sceneNarration,
    chunkDuration,
    runningAudioTime,
    charToTime = null
}) => {
    const sceneStartCharIndices = [];
    let currentCharIndex = 0;
    for (let index = 0; index < block.scenes.length; index += 1) {
        sceneStartCharIndices.push(currentCharIndex);
        currentCharIndex += sceneNarration[block.scenes[index]].narration_text.length;
        if (index < block.scenes.length - 1) currentCharIndex += 1;
    }
    const totalTextLength = block.scenes.reduce(
        (sum, sceneIndex) => sum + sceneNarration[sceneIndex].narration_text.length,
        0
    );
    let blockRunningTime = runningAudioTime;
    return block.scenes.map((sceneIndex, index) => {
        const scene = sceneNarration[sceneIndex];
        let sceneDuration;
        if (charToTime) {
            const startIndex = sceneStartCharIndices[index];
            const nextStartIndex = index < block.scenes.length - 1
                ? sceneStartCharIndices[index + 1]
                : block.mergedText.length;
            const startSeconds = index === 0 ? 0 : (charToTime[startIndex] || 0);
            const nextStartSeconds = index < block.scenes.length - 1
                ? (charToTime[nextStartIndex] || 0)
                : chunkDuration;
            sceneDuration = index === block.scenes.length - 1
                ? chunkDuration - (blockRunningTime - runningAudioTime)
                : nextStartSeconds - startSeconds;
        } else {
            sceneDuration = totalTextLength > 0
                ? (scene.narration_text.length / totalTextLength) * chunkDuration
                : chunkDuration / block.scenes.length;
            if (index === block.scenes.length - 1) {
                sceneDuration = chunkDuration - (blockRunningTime - runningAudioTime);
            }
        }
        sceneDuration = Math.max(0, sceneDuration);
        const entry = {
            chunk_index: sceneIndex,
            orig_start: scene.scene_start,
            orig_end: scene.scene_end,
            orig_dur: Math.max(0, scene.scene_end - scene.scene_start),
            final_audio_start: blockRunningTime,
            final_audio_end: blockRunningTime + sceneDuration,
            final_dur: sceneDuration,
            text: scene.narration_text
        };
        blockRunningTime += sceneDuration;
        return entry;
    });
};

export const generateNarrationTTS = async (
    sceneNarration,
    cachePath,
    voiceId,
    _ignoredOriginalTranscript,
    _videoDuration,
    { sourceFingerprint = null, signal } = {}
) => {
    throwIfAborted(signal);
    try {
        console.log("[AI] Starting TTS Generation (Scene-based Continuous Audio)");
        const cacheMetaPath = cachePath + '.meta.json';
        const voiceConfig = getVoiceConfig(voiceId);
        const edgeVoice = voiceConfig.edgeVoice;
        const pitch = voiceConfig.pitch;
        const rate = voiceConfig.rate;

        const narrationFingerprint = crypto.createHash('sha256')
            .update(JSON.stringify(sceneNarration)).digest('hex');
        const currentMeta = {
            workflowVersion: WORKFLOW_VERSION,
            algorithmVersion: SAWAUNGTHIN_TTS_ALGORITHM_VERSION,
            sourceFingerprint,
            narrationFingerprint,
            voice: edgeVoice, pitch, rate, len: sceneNarration.length
        };
        if (fs.existsSync(cachePath) && fs.existsSync(cacheMetaPath)) {
            try {
                const existingMeta = JSON.parse(fs.readFileSync(cacheMetaPath, 'utf8'));
                if (existingMeta.workflowVersion === currentMeta.workflowVersion &&
                    existingMeta.algorithmVersion === currentMeta.algorithmVersion &&
                    existingMeta.sourceFingerprint === currentMeta.sourceFingerprint &&
                    existingMeta.narrationFingerprint === currentMeta.narrationFingerprint &&
                    existingMeta.voice === currentMeta.voice && 
                    existingMeta.pitch === currentMeta.pitch && 
                    existingMeta.rate === currentMeta.rate && 
                    existingMeta.len === currentMeta.len) {
                    console.log("[AI] Reusing cached continuous TTS audio.");
                    return cachePath;
                }
            } catch (e) { }
        }

        const cacheDir = path.dirname(cachePath);
        const ttsDir = path.join(cacheDir, 'tts_chunks_scene');
        if (!fs.existsSync(ttsDir)) {
            fs.mkdirSync(ttsDir, { recursive: true });
        }

        const dialogueVal = getSetting('DIALOGUE_MODE');
        const isDialogue = dialogueVal === 'true' || dialogueVal === '1' || dialogueVal === true;
        const mergedBlocks = buildSawaungthinTtsBlocks(sceneNarration, isDialogue);

        const chunks = [];
        const ttsClient = new EdgeTTS({ voice: edgeVoice, pitch, rate, saveSubtitles: true, timeout: 30000 });
        
        let concurrencyLimit = 3;
        if (process.env.TTS_CONCURRENCY) {
            const parsed = parseInt(process.env.TTS_CONCURRENCY, 10);
            if (Number.isFinite(parsed) && parsed >= 1) {
                concurrencyLimit = Math.min(parsed, 20);
            }
        }

        for (let i = 0; i < mergedBlocks.length; i++) {
            const chunkFileName = `chunk_${String(i).padStart(4, '0')}.wav`;
            chunks.push(path.join(ttsDir, chunkFileName));
        }

        let currentIndex = 0;
        const processNext = async () => {
            while (currentIndex < mergedBlocks.length) {
                throwIfAborted(signal);
                const bIdx = currentIndex++;
                const chunkText = mergedBlocks[bIdx].mergedText;
                if (!chunkText || typeof chunkText !== 'string' || chunkText.trim() === '') {
                    throw new Error(`Merged block ${bIdx} text is empty or invalid.`);
                }

                const chunkPath = chunks[bIdx];
                console.log(`[AI] Generating TTS chunk ${bIdx + 1} / ${mergedBlocks.length}...`);
                
                let success = false;
                let lastError = null;
                
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        await synthesizeEdgeTts(ttsClient, chunkText, chunkPath, { signal });
                        
                        if (fs.existsSync(chunkPath) && fs.statSync(chunkPath).size > 0) {
                            success = true;
                            break;
                        } else {
                            throw new Error("TTS generated empty file");
                        }
                    } catch (err) {
                        if (isAbortError(err)) throw err;
                        lastError = err;
                        console.warn(`[AI] TTS attempt ${attempt} failed for block ${bIdx}:`, err);
                        if (attempt < 3) await waitWithSignal(500 * (2 ** (attempt - 1)), signal);
                    }
                }

                if (!success) {
                    throw new Error(`Failed to generate TTS for block ${bIdx} after 3 attempts. Last error: ${lastError?.message}`);
                }
            }
        };

        const workers = [];
        for (let i = 0; i < Math.min(concurrencyLimit, mergedBlocks.length); i++) {
            workers.push(processNext());
        }
        const settledWorkers = await Promise.allSettled(workers);
        const workerFailure = settledWorkers.find(result => result.status === 'rejected');
        if (workerFailure) throw workerFailure.reason;

        // Build Authoritative Timeline (Continuous)
        const processedChunks = [];
        const authoritativeTimeline = [];
        let runningAudioTime = 0;
        
        for (let bIdx = 0; bIdx < mergedBlocks.length; bIdx++) {
            throwIfAborted(signal);
            const rawChunk = chunks[bIdx];
            const block = mergedBlocks[bIdx];

            let chunkDur = 0;
            try {
                chunkDur = parseFloat(await getDuration(rawChunk));
            } catch(e) {
                throw new Error(`Failed to get duration for ${rawChunk}`);
            }

            const standardizedPath = path.join(ttsDir, `chunk_std_${String(bIdx).padStart(4, '0')}.wav`);
            await runFFmpeg(['-i', rawChunk, '-acodec', 'pcm_s16le', '-ar', '24000', '-ac', '1', '-y', standardizedPath], ttsDir);
            processedChunks.push(standardizedPath);
            
            let actualFinalDur = chunkDur;
            try {
                let actualDur = parseFloat(await getDuration(standardizedPath));
                if (Number.isFinite(actualDur) && actualDur > 0) {
                    actualFinalDur = actualDur;
                } else {
                    throw new Error(`Invalid FFprobe duration for ${standardizedPath}`);
                }
            } catch(e) {
                throw new Error(`Timeline Error: Cannot determine actual duration for chunk ${bIdx}`);
            }

            // Precise boundary mapping via EdgeTTS subtitle timing (if available)
            const subFilePath = rawChunk + '.json';
            let charToTime = null;

            if (fs.existsSync(subFilePath)) {
                try {
                    const subData = JSON.parse(fs.readFileSync(subFilePath, 'utf8'));
                    charToTime = new Array(block.mergedText.length).fill(0);
                    let charCounter = 0;
                    for (const sub of subData) {
                        const partLen = sub.part.length;
                        const startSec = sub.start / 1000;
                        const endSec = sub.end / 1000;
                        for (let k = 0; k < partLen; k++) {
                            if (charCounter < charToTime.length) {
                                charToTime[charCounter] = startSec + (k / partLen) * (endSec - startSec);
                                charCounter++;
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`[AI] Failed to parse subtitle timing for chunk ${bIdx}`);
                    charToTime = null;
                }
            }

            authoritativeTimeline.push(...buildSawaungthinTimelineEntries({
                block, sceneNarration, chunkDuration: actualFinalDur, runningAudioTime, charToTime
            }));

            runningAudioTime += actualFinalDur;
        }

        const concatListPath = path.join(ttsDir, 'concat.txt');
        let concatLines = processedChunks.map(c => `file '${path.basename(c)}'`).join('\n');

        if (processedChunks.length === 0) {
            console.warn("[WARNING] No audio chunks to concatenate. Generating 100ms silent audio...");
            const gapPath = path.join(ttsDir, 'gap_empty.wav');
            await runFFmpeg(['-f', 'lavfi', '-i', `anullsrc=r=24000:cl=mono`, '-t', '0.1', '-acodec', 'pcm_s16le', '-y', gapPath], ttsDir);
            concatLines = `file 'gap_empty.wav'`;
            processedChunks.push(gapPath);
        }

        fs.writeFileSync(concatListPath, concatLines);
        
        const args = [
            '-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
            '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '24000', cachePath
        ];
        
        await runFFmpeg(args, ttsDir);
        
        if (!fs.existsSync(cachePath) || fs.statSync(cachePath).size === 0) {
            throw new Error("Final TTS audio generation failed or is 0 bytes.");
        }
        
        const duration = await getDuration(cachePath);
        if (!Number.isFinite(duration) || duration <= 0) {
            throw new Error(`Final TTS audio has invalid duration: ${duration}`);
        }
        
        let numChunks = processedChunks.length;
        const absDiff = Math.abs(runningAudioTime - duration);
        let status = absDiff <= 0.05 ? 'PASS' : 'FAIL';
        
        if (numChunks === 0 && duration <= 0.15) { 
             status = 'PASS';
             runningAudioTime = duration;
        }

        console.log(`[FINAL-TIMELINE-VALIDATION]`);
        console.log(`timeline_duration: ${runningAudioTime.toFixed(3)}`);
        console.log(`final_audio_duration: ${duration.toFixed(3)}`);
        console.log(`absolute_difference: ${absDiff.toFixed(3)}`);
        console.log(`chunk_count: ${numChunks}`);
        console.log(`gap_count: 0`);
        console.log(`status: ${status}`);

        if (status === 'FAIL') {
            throw new Error(`Pipeline Error: Final TTS audio duration difference (${absDiff.toFixed(3)}s) exceeds 0.05s tolerance!`);
        }

        console.log(`[AI-DIAGNOSTIC] FINAL ASSEMBLY: Expected duration=${runningAudioTime.toFixed(2)}s | Actual duration=${duration}s | Audio chunks=${numChunks} | Silence gaps=0`);
        console.log(`[AI-TIMELINE-SUMMARY] chunks=${numChunks} | gaps=0 | authoritative_timeline_duration=${runningAudioTime.toFixed(3)}s`);
        
        fs.writeFileSync(cacheMetaPath, JSON.stringify(currentMeta));
        const authoritativeTimelinePath = cachePath + '.timeline.json';
        fs.writeFileSync(authoritativeTimelinePath, JSON.stringify(authoritativeTimeline, null, 2));
        
        try {
            if (fs.existsSync(ttsDir)) {
                fs.rmSync(ttsDir, { recursive: true, force: true });
            }
        } catch (cleanupErr) { }
        
        return cachePath;

    } catch (err) {
        console.error("[AI] Error generating TTS:", err);
        const cacheDir = path.dirname(cachePath);
        const ttsDir = path.join(cacheDir, 'tts_chunks_scene');
        try {
            if (fs.existsSync(ttsDir)) {
                fs.rmSync(ttsDir, { recursive: true, force: true });
            }
        } catch (cleanupErr) { }
        if (fs.existsSync(cachePath)) {
            fs.unlinkSync(cachePath);
        }
        throw err;
    }
};
