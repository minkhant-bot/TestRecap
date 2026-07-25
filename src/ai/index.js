import axios from 'axios';

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { EdgeTTS } from 'node-edge-tts';
import { GoogleGenAI } from '@google/genai';
import { getVoiceConfig } from './voices.js';
import { getTranslationSystemInstruction } from './translation.js';
import { runFFmpeg, getDuration, getAudioDetails } from '../ffmpeg/index.js';
import { getSetting } from '../services/settings.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const computeSimilarity = async (text1, text2) => {
    return null;
};

export const initModels = async () => {};

export const buildSubtitleCharTimeline = (mergedText, subtitleParts) => {
    if (typeof mergedText !== 'string' || !Array.isArray(subtitleParts)) return null;
    const charToTime = new Array(mergedText.length);
    let searchFrom = 0;
    for (const sub of subtitleParts) {
        if (!sub || typeof sub.part !== 'string' || sub.part.length === 0 ||
            !Number.isFinite(sub.start) || !Number.isFinite(sub.end)) return null;
        const partStart = mergedText.indexOf(sub.part, searchFrom);
        if (partStart < 0) return null;
        const startSec = sub.start / 1000;
        const endSec = sub.end / 1000;
        for (let k = 0; k < sub.part.length; k++) {
            charToTime[partStart + k] = startSec + (k / sub.part.length) * (endSec - startSec);
        }
        searchFrom = partStart + sub.part.length;
    }
    return charToTime;
};

export const findSubtitleTimeAtOrAfter = (charToTime, charIndex) => {
    if (!Array.isArray(charToTime)) return null;
    for (let i = Math.max(0, charIndex); i < charToTime.length; i++) {
        if (Number.isFinite(charToTime[i])) return charToTime[i];
    }
    return null;
};

export const validateTimestamps = (transcript, audioDuration, tolerance = 0.05, allowClamp = 2.0) => {
    if (!Array.isArray(transcript)) throw new Error("Transcript is not an array");
    let prevEnd = -1;
    // We will filter out invalid chunks to avoid throwing out the entire valid transcript
    const validTranscript = [];
    
    for (let i = 0; i < transcript.length; i++) {
        const chunk = transcript[i];
        if (!Array.isArray(chunk.timestamp) || chunk.timestamp.length !== 2) {
            console.warn(`[Validate] Invalid timestamp structure at chunk ${i}, skipping`);
            continue;
        }
        let [start, end] = chunk.timestamp;
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
            console.warn(`[Validate] Non-finite timestamp at chunk ${i}, skipping`);
            continue;
        }
        if (start < 0) {
            console.warn(`[Validate] Negative start timestamp at chunk ${i}, clamping to 0`);
            start = 0;
            chunk.timestamp[0] = start;
        }
        if (end <= start) {
            console.warn(`[Validate] end <= start at chunk ${i}, skipping`);
            continue;
        }
        
        if (start >= audioDuration) {
            if (start - audioDuration <= allowClamp) {
                console.warn(`[Validate] start timestamp (${start}) exceeds WAV duration (${audioDuration}) but within clamp range. Skipping segment.`);
                continue;
            } else {
                const isNearEnd = i >= transcript.length - 2;
                if (isNearEnd) {
                    console.warn(`[Validate] Severe start overshoot at chunk ${i} (${start} >= ${audioDuration}). Discarding trailing segment.`);
                    continue;
                }
                throw new Error(`start timestamp (${start}) exceeds WAV duration (${audioDuration}) at chunk ${i} (overshoot: ${start - audioDuration})`);
            }
        }
        
        if (i > 0 && start < prevEnd - tolerance) {
            console.warn(`[Validate] Overlapping transcript timestamps at chunk ${i}: start ${start} < prevEnd ${prevEnd} - ${tolerance}. Adjusting start.`);
            start = prevEnd;
            chunk.timestamp[0] = start;
            if (end <= start) {
                 continue; // skip if fixing overlap breaks length
            }
        }
        
        if (end > audioDuration) {
            if (end - audioDuration <= allowClamp) {
                console.warn(`[Validate] end timestamp (${end}) exceeds WAV duration (${audioDuration}). Clamping to ${audioDuration}`);
                end = audioDuration;
                chunk.timestamp[1] = end;
            } else {
                const isNearEnd = i >= transcript.length - 2;
                if (isNearEnd) {
                    console.warn(`[Validate] Severe end overshoot at chunk ${i} (${end} > ${audioDuration}). Discarding trailing segment.`);
                    continue;
                }
                throw new Error(`end timestamp (${end}) exceeds WAV duration (${audioDuration}) at chunk ${i} by more than allowClamp (${allowClamp})`);
            }
        }
        
        validTranscript.push(chunk);
        prevEnd = end;
    }
    
    if (validTranscript.length === 0 && transcript.length > 0) {
        throw new Error("All segments were invalid or out of bounds.");
    }
    
    return validTranscript;
};

export const transcribeWav = async (wavPath, cachePath, apiKey) => {
    if (cachePath && fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
        try {
            const cachedData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            const duration = await getDuration(wavPath);
            const validated = validateTimestamps(cachedData, duration);
            return validated;
        } catch(e) {
            console.warn(`[Transcription] Cache rejected: ${e.message}`);
            try { fs.unlinkSync(cachePath); } catch (err) {}
        }
    }
    
    if (!apiKey) {
        throw new Error("Gemini API key is required for transcription and translation.");
    }
    
    console.log('[AI] Starting real Gemini-based transcription and translation...');
    const ai = new GoogleGenAI({ apiKey });
    
    const fallbackModels = [
        process.env.GEMINI_MODEL || 'gemini-3.5-flash',
        'gemini-3.1-flash-lite',
        'gemini-2.5-flash'
    ];
    
    const maxRetries = 5;
    let attempt = 0;
    let currentModelIndex = 0;
    
    const duration = await getDuration(wavPath);
    console.log(`[AI] Reading audio file ${wavPath} into memory (size: ${fs.statSync(wavPath).size} bytes)...`);
    const audioData = fs.readFileSync(wavPath).toString('base64');


    while (attempt < maxRetries) {
        attempt++;
        const targetModel = fallbackModels[currentModelIndex % fallbackModels.length];
        
        try {
            const translationRules = getTranslationSystemInstruction();
            const prompt = `Listen to the audio file and provide a complete transcript. For each spoken segment, provide the start and end timestamp in seconds, the original spoken text (in English), and the 'translatedText' containing the translation into Burmese.
This audio is exactly ${duration.toFixed(2)} seconds long — do not report any timestamp beyond this.

CRITICAL RULES FOR TRANSLATION:
${translationRules}

Return the result STRICTLY as a JSON array of objects, with NO markdown formatting outside the JSON. Format:
[
  {
    "timestamp": [0.0, 5.5],
    "text": "original text here",
    "translatedText": "Burmese translation here"
  }
]`;

            console.log(`[AI] Generating content with Gemini (Attempt ${attempt}/${maxRetries}, Model: ${targetModel})...`);
            const response = await ai.models.generateContent({
                model: targetModel,
                contents: [{
                    role: 'user',
                    parts: [
                        { inlineData: { data: audioData, mimeType: 'audio/wav' } },
                        { text: prompt }
                    ]
                }],
                config: {
                    responseMimeType: "application/json"
                }
            });

            const responseText = response.text;
            let parsed;
            try {
                parsed = JSON.parse(responseText);
            } catch (err) {
                console.error("[AI] Failed to parse JSON from Gemini response:", responseText);
                throw new Error("Gemini did not return valid JSON array.");
            }
            
            // Map translatedText to the main translation mapping format if we need to? 
            // Wait, validateTimestamps will ensure timestamps are fine.
            const validated = validateTimestamps(parsed, duration);
            
            if (cachePath) fs.writeFileSync(cachePath, JSON.stringify(validated, null, 2));
            
            // No cleanup needed for inlineData
            
            return validated;
        } catch(e) {
            console.error(`[AI] Gemini transcription attempt ${attempt} failed with model ${targetModel}: ${e.message}`);
            
            const isRateLimitOrUnavailable = e.message.includes('503') || e.message.includes('429') || e.message.includes('UNAVAILABLE') || e.message.includes('RESOURCE_EXHAUSTED');
            if (isRateLimitOrUnavailable) {
                console.log(`[AI] Switching to fallback model due to high demand/quota...`);
                currentModelIndex++;
            }
            
            if (attempt === maxRetries) {
                
                throw new Error(`Gemini transcription failed after ${maxRetries} attempts: ${e.message}`);
            }
            
            // Exponential backoff
            const delay = isRateLimitOrUnavailable ? 5000 * attempt : 2000 * attempt;
            console.log(`[AI] Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    
    return [];
};


export const translateWithGemini = async (originalTranscript, cachePath, apiKey = null) => {
    if (!originalTranscript || originalTranscript.length === 0) return [];
    
    if (cachePath && fs.existsSync(cachePath)) {
        try {
            const cachedData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            if (cachedData.length === originalTranscript.length) {
                return cachedData;
            }
        } catch(e) {}
    }

    // Since we now do transcription AND translation in a single Gemini call inside transcribeWav,
    // the originalTranscript should already contain 'translatedText'. If so, just extract it!
    const hasTranslations = originalTranscript.every(t => typeof t.translatedText === 'string');
    if (hasTranslations) {
        console.log("[AI] Bypassing separate translation step because transcript already contains translatedText.");
        const finalResult = originalTranscript.map((t, i) => ({
            timestamp: t.timestamp,
            text: t.translatedText
        }));
        if (cachePath) fs.writeFileSync(cachePath, JSON.stringify(finalResult, null, 2));
        return finalResult;
    }
    
    if (!apiKey) {
        throw new Error("Gemini API key is required for translation.");
    }
    
    if (apiKey === 'bypass') return originalTranscript;
    
    const modelName = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    const systemInstructionText = getTranslationSystemInstruction();
    
    const BATCH_SIZE = 40;
    const finalResult = [];
    
    for (let batchStart = 0; batchStart < originalTranscript.length; batchStart += BATCH_SIZE) {
        const batch = originalTranscript.slice(batchStart, batchStart + BATCH_SIZE);
        const inputPayload = batch.map((t, i) => ({
            index: batchStart + i,
            text: t.text
        }));
        
        const maxRetries = 3;
        let attempt = 0;
        let delay = 1000;
        let batchSuccess = false;
        
        while (attempt < maxRetries && !batchSuccess) {
            attempt++;
            try {
                const response = await axios.post(url, {
                    system_instruction: {
                        parts: [{ text: systemInstructionText }]
                    },
                    contents: [{
                        role: "user",
                        parts: [{ text: JSON.stringify(inputPayload) }]
                    }],
                    generationConfig: {
                        response_mime_type: "application/json",
                        temperature: 0.2
                    }
                }, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 120000
                });
                
                const textResponse = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!textResponse) throw new Error("Empty response from Gemini.");
                
                let parsed;
                try {
                    parsed = JSON.parse(textResponse);
                } catch (e) {
                    throw new Error("Invalid JSON response from Gemini.");
                }
                
                if (!Array.isArray(parsed)) throw new Error("Gemini response is not an array.");
                if (parsed.length !== batch.length) {
                    throw new Error(`Gemini response length (${parsed.length}) does not match input batch length (${batch.length}).`);
                }
                
                for (let i = 0; i < batch.length; i++) {
                    const globalIndex = batchStart + i;
                    const item = parsed.find(p => p.index === globalIndex);
                    if (!item || typeof item.text !== 'string') {
                        throw new Error(`Missing or invalid translation for chunk ${globalIndex}.`);
                    }
                    finalResult.push({
                        timestamp: originalTranscript[globalIndex].timestamp,
                        text: item.text
                    });
                }
                batchSuccess = true;
            } catch (err) {
                let errorMsg = err.message;
                if (err.response && err.response.status === 404) {
                    errorMsg = `Model '${modelName}' not found or unsupported (HTTP 404). Please configure a valid GEMINI_MODEL.`;
                }
                console.error(`[AI] Gemini translation attempt ${attempt} failed for batch ${batchStart}: ${errorMsg}`);
                
                const isTransient = !err.response || err.response.status >= 500 || err.response.status === 429 || err.code === 'ECONNABORTED';
                if (attempt === maxRetries || !isTransient || (err.response && err.response.status === 404)) {
                    throw new Error(`Gemini translation failed at batch ${batchStart}. ${errorMsg}`);
                }
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
            }
        }
    }
    
    if (cachePath) {
        fs.writeFileSync(cachePath, JSON.stringify(finalResult, null, 2));
    }
    
    return finalResult;
};

export const generateNarrationTTS = async (sceneNarration, cachePath, voiceId, _ignoredOriginalTranscript) => {
    try {
        console.log("[AI] Starting TTS Generation (Scene-based Continuous Audio)");
        const cacheMetaPath = cachePath + '.meta.json';
        const voiceConfig = getVoiceConfig(voiceId);
        const edgeVoice = voiceConfig.edgeVoice;
        const pitch = voiceConfig.pitch;
        const rate = voiceConfig.rate;
        const dialogueVal = getSetting('DIALOGUE_MODE');
        const isDialogue = dialogueVal === 'true' || dialogueVal === '1' || dialogueVal === true;

        const narrationFingerprint = crypto.createHash('sha256').update(JSON.stringify({
            version: 2,
            voice: edgeVoice,
            pitch,
            rate,
            dialogueMode: isDialogue,
            narration: sceneNarration.map(scene => ({
                text: scene.narration_text,
                start: scene.scene_start,
                end: scene.scene_end
            }))
        })).digest('hex');
        const currentMeta = { voice: edgeVoice, pitch, rate, len: sceneNarration.length, narrationFingerprint };
        if (fs.existsSync(cachePath) && fs.existsSync(cacheMetaPath)) {
            try {
                const existingMeta = JSON.parse(fs.readFileSync(cacheMetaPath, 'utf8'));
                if (existingMeta.voice === currentMeta.voice && 
                    existingMeta.pitch === currentMeta.pitch && 
                    existingMeta.rate === currentMeta.rate && 
                    existingMeta.len === currentMeta.len &&
                    existingMeta.narrationFingerprint === currentMeta.narrationFingerprint) {
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

        const mergedBlocks = [];
        let currentBlock = null;

        const maxGap = isDialogue ? 3.0 : 0.75;
        const maxDur = isDialogue ? 60 : 12;

        for (let i = 0; i < sceneNarration.length; i++) {
            const scene = sceneNarration[i];
            
            if (!currentBlock) {
                currentBlock = {
                    scenes: [i],
                    mergedText: scene.narration_text,
                    orig_start: scene.scene_start,
                    orig_end: scene.scene_end
                };
            } else {
                const gap = scene.scene_start - currentBlock.orig_end;
                const proposedDuration = scene.scene_end - currentBlock.orig_start;
                
                if (gap < maxGap && proposedDuration <= maxDur) {
                    currentBlock.scenes.push(i);
                    currentBlock.mergedText += " " + scene.narration_text;
                    currentBlock.orig_end = scene.scene_end;
                } else {
                    mergedBlocks.push(currentBlock);
                    currentBlock = {
                        scenes: [i],
                        mergedText: scene.narration_text,
                        orig_start: scene.scene_start,
                        orig_end: scene.scene_end
                    };
                }
            }
        }
        if (currentBlock) {
            mergedBlocks.push(currentBlock);
        }

        const chunks = [];
        const ttsClient = new EdgeTTS({ voice: edgeVoice, pitch, rate, saveSubtitles: true, timeout: 120000 });
        
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
                        let timeoutId;
                        try {
                            const timeoutPromise = new Promise((_, reject) => {
                                timeoutId = setTimeout(() => reject(new Error("Edge TTS timeout")), 120000);
                            });
                            await Promise.race([ttsClient.ttsPromise(chunkText, chunkPath), timeoutPromise]);
                        } finally {
                            if (timeoutId) clearTimeout(timeoutId);
                        }
                        
                        if (fs.existsSync(chunkPath) && fs.statSync(chunkPath).size > 0) {
                            success = true;
                            break;
                        } else {
                            throw new Error("TTS generated empty file");
                        }
                    } catch (err) {
                        lastError = err;
                        console.warn(`[AI] TTS attempt ${attempt} failed for block ${bIdx}:`, err);
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
        await Promise.all(workers);

        // Build Authoritative Timeline (Continuous)
        const processedChunks = [];
        const authoritativeTimeline = [];
        let runningAudioTime = 0;
        
        for (let bIdx = 0; bIdx < mergedBlocks.length; bIdx++) {
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
                    charToTime = buildSubtitleCharTimeline(block.mergedText, subData);
                    if (!charToTime) {
                        console.warn(`[AI] Subtitle text did not align with merged narration for chunk ${bIdx}; using proportional timing.`);
                    }
                } catch (e) {
                    console.warn(`[AI] Failed to parse subtitle timing for chunk ${bIdx}`);
                    charToTime = null;
                }
            }

            // Calculate start character indices for each scene in the block
            let sceneStartCharIndices = [];
            let currentCharIndex = 0;
            for (let i = 0; i < block.scenes.length; i++) {
                sceneStartCharIndices.push(currentCharIndex);
                currentCharIndex += sceneNarration[block.scenes[i]].narration_text.length;
                if (i < block.scenes.length - 1) {
                    currentCharIndex += 1; // space separator
                }
            }

            let blockRunningTime = runningAudioTime;
            const totalTextLength = block.scenes.reduce((sum, sIdx) => sum + sceneNarration[sIdx].narration_text.length, 0);
            let sceneBoundaryTimes = null;
            if (charToTime) {
                const candidateBoundaries = [0];
                for (let i = 1; i < sceneStartCharIndices.length; i++) {
                    candidateBoundaries.push(findSubtitleTimeAtOrAfter(charToTime, sceneStartCharIndices[i]));
                }
                candidateBoundaries.push(actualFinalDur);
                const validBoundaries = candidateBoundaries.every((value, index) =>
                    Number.isFinite(value) && value >= 0 && value <= actualFinalDur &&
                    (index === 0 || value >= candidateBoundaries[index - 1])
                );
                if (validBoundaries) {
                    sceneBoundaryTimes = candidateBoundaries;
                } else {
                    console.warn(`[AI] Invalid subtitle boundaries for chunk ${bIdx}; using proportional timing.`);
                }
            }

            for (let i = 0; i < block.scenes.length; i++) {
                const sIdx = block.scenes[i];
                const sceneItem = sceneNarration[sIdx];
                const textLen = sceneItem.narration_text.length;
                
                let sceneDur = 0;
                
                if (sceneBoundaryTimes) {
                    sceneDur = sceneBoundaryTimes[i + 1] - sceneBoundaryTimes[i];
                } else {
                    // Fallback to proportional
                    if (totalTextLength > 0) {
                        sceneDur = (textLen / totalTextLength) * actualFinalDur;
                    } else {
                        sceneDur = actualFinalDur / block.scenes.length;
                    }
                    if (i === block.scenes.length - 1) {
                        sceneDur = (actualFinalDur - (blockRunningTime - runningAudioTime));
                    }
                }

                if (sceneDur < 0) sceneDur = 0;

                let orig_start = sceneItem.scene_start;
                let orig_end = sceneItem.scene_end;
                let orig_dur = orig_end - orig_start;
                if (orig_dur < 0) orig_dur = 0;

                authoritativeTimeline.push({
                    chunk_index: sIdx,
                    orig_start: orig_start,
                    orig_end: orig_end,
                    orig_dur: orig_dur,
                    final_audio_start: blockRunningTime,
                    final_audio_end: blockRunningTime + sceneDur,
                    final_dur: sceneDur,
                    text: sceneItem.narration_text
                });

                blockRunningTime += sceneDur;
            }

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
