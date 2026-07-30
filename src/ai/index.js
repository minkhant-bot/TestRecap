
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EdgeTTS } from 'node-edge-tts';
import { getVoiceConfig } from './voices.js';
import { getTranslationSystemInstruction } from './translation.js';
import { normalizeBurmeseNumberText } from './numberNormalization.js';
import { synthesizeEdgeTts, formatEdgeTtsDiagnostics } from './edgeTtsRequest.js';
import { fitTtsSegmentDuration, rewriteBurmeseSegmentForDuration, MAX_TTS_TEMPO } from './durationFit.js';
import { runFFmpeg, getDuration } from '../ffmpeg/index.js';
import { getSetting } from '../services/settings.js';
import { fileURLToPath } from 'url';
import { WORKFLOW_VERSION } from '../domain/workflow.js';
import { transcribeWithFasterWhisper, fingerprintFile } from './fasterWhisper.js';
import { translateTranscriptWithGemini } from './geminiTranslation.js';
import { isAbortError, throwIfAborted, waitWithSignal } from '../services/cancellation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const computeSimilarity = async (text1, text2) => {
    return null;
};

export const waitForAllTtsWorkers = async (workers) => {
    let firstError = null;
    const trackedWorkers = workers.map(worker => Promise.resolve(worker).catch(error => {
        if (firstError === null) firstError = error;
        throw error;
    }));
    await Promise.allSettled(trackedWorkers);
    if (firstError !== null) throw firstError;
};

export const getTtsRetryDelayMs = attempt => Math.min(4000, 500 * (2 ** (attempt - 1)));


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

const narrationGraphemeSegmenter = new Intl.Segmenter('my', { granularity: 'grapheme' });

const narrationGraphemes = text =>
    Array.from(narrationGraphemeSegmenter.segment(text), item => item.segment);

export const splitNarrationText = (text, maxChars = 180) => {
    if (typeof text !== 'string' || text.length <= maxChars) return [text];
    const tokens = text.trim().split(/\s+/);
    const parts = [];
    let current = '';
    for (const token of tokens) {
        const candidate = current ? `${current} ${token}` : token;
        if (current && candidate.length > maxChars) {
            parts.push(current);
            current = token;
        } else {
            current = candidate;
        }
        let graphemes = narrationGraphemes(current);
        while (graphemes.length > maxChars) {
            parts.push(graphemes.slice(0, maxChars).join(''));
            graphemes = graphemes.slice(maxChars);
            current = graphemes.join('');
        }
    }
    if (current) parts.push(current);
    return parts.length ? parts : [text];
};

export const isSpeakableTtsText = text => typeof text === 'string' && /[\p{L}\p{N}]/u.test(text);

export const mergeOrphanTtsBlocks = blocks => {
    const merged = [];
    let leadingOrphans = [];
    for (const block of blocks) {
        if (isSpeakableTtsText(block.mergedText)) {
            if (leadingOrphans.length > 0) {
                block.mergedText = leadingOrphans.map(orphan => orphan.mergedText).join('') + block.mergedText;
                block.orig_start = leadingOrphans[0].orig_start;
                leadingOrphans = [];
            }
            merged.push(block);
        } else if (merged.length > 0) {
            const previous = merged[merged.length - 1];
            previous.mergedText += block.mergedText;
            previous.orig_end = block.orig_end;
        } else {
            leadingOrphans.push(block);
        }
    }
    if (leadingOrphans.length > 0) {
        throw new Error('Narration contains no speakable text for punctuation attachment.');
    }
    return merged;
};

export const splitTimedNarrationBlock = (block) => {
    const maxChars = Math.max(1, Math.ceil(block.mergedText.length / 2));
    const parts = splitNarrationText(block.mergedText, maxChars);
    if (parts.length < 2) return [block];
    const totalWeight = parts.reduce((sum, part) => sum + Math.max(1, part.length), 0);
    const duration = block.orig_end - block.orig_start;
    let elapsedWeight = 0;
    const timedParts = parts.map(part => {
        const start = block.orig_start + duration * (elapsedWeight / totalWeight);
        elapsedWeight += Math.max(1, part.length);
        const end = block.orig_start + duration * (elapsedWeight / totalWeight);
        return { ...block, mergedText: part, orig_start: start, orig_end: end };
    });
    return mergeOrphanTtsBlocks(timedParts);
};

const joinNarrationSegments = segments => {
    let text = '';
    const withOffsets = segments.map((segment, index) => {
        const separator = index === 0 || /^[\s၊။,.;:!?]/u.test(segment.text) ? '' : ' ';
        text += separator;
        const text_start = text.length;
        text += segment.text;
        return { ...segment, text_start, text_end: text.length };
    });
    return { text, segments: withOffsets };
};

const createNarrationGroup = segments => {
    const joined = joinNarrationSegments(segments);
    return {
        scenes: joined.segments.map(segment => segment.index),
        segments: joined.segments,
        mergedText: joined.text,
        orig_start: joined.segments[0].orig_start,
        orig_end: joined.segments.at(-1).orig_end,
        kind: joined.segments[0].kind,
        speaker: joined.segments[0].speaker
    };
};

export const buildNarrationGroups = (
    sceneNarration,
    { maxGap = null, maxSpan = null, maxChars = 1200 } = {}
) => {
    if (!Array.isArray(sceneNarration) || sceneNarration.length === 0) return [];
    const groups = [];
    let currentSegments = [];

    for (let index = 0; index < sceneNarration.length; index++) {
        const scene = sceneNarration[index];
        const segment = {
            index,
            text: scene.narration_text,
            orig_start: scene.scene_start,
            orig_end: scene.scene_end,
            kind: scene.kind || 'narration',
            speaker: scene.speaker || (scene.kind === 'narration' ? 'narrator' : null)
        };
        if (!['dialogue', 'narration'].includes(segment.kind) ||
            (segment.kind === 'dialogue' && !segment.speaker) ||
            typeof segment.text !== 'string' ||
            !Number.isFinite(segment.orig_start) || !Number.isFinite(segment.orig_end) ||
            segment.orig_end <= segment.orig_start) {
            throw new Error(`Pipeline Error: Invalid narration segment ${index}.`);
        }

        if (currentSegments.length === 0) {
            currentSegments.push(segment);
            continue;
        }

        const first = currentSegments[0];
        const previous = currentSegments.at(-1);
        const candidateText = joinNarrationSegments([...currentSegments, segment]).text;
        const gap = segment.orig_start - previous.orig_end;
        const span = segment.orig_end - first.orig_start;
        const groupingMaxGap = maxGap ?? (segment.kind === 'dialogue' ? 3 : 0.75);
        const groupingMaxSpan = maxSpan ?? (segment.kind === 'dialogue' ? 60 : 12);
        const sameSpeechContext = segment.kind === previous.kind &&
            (segment.kind === 'narration' || segment.speaker === previous.speaker);
        const canJoin = sameSpeechContext && gap <= groupingMaxGap && span <= groupingMaxSpan && candidateText.length <= maxChars;

        if (canJoin || (!isSpeakableTtsText(segment.text) && sameSpeechContext)) {
            currentSegments.push(segment);
        } else {
            groups.push(createNarrationGroup(currentSegments));
            currentSegments = [segment];
        }
    }
    if (currentSegments.length > 0) groups.push(createNarrationGroup(currentSegments));

    for (let index = 0; index < groups.length; index++) {
        if (isSpeakableTtsText(groups[index].mergedText)) continue;
        const sameContext = candidate => candidate.kind === groups[index].kind &&
            (candidate.kind === 'narration' || candidate.speaker === groups[index].speaker);
        if (index > 0 && sameContext(groups[index - 1])) {
            groups[index - 1] = createNarrationGroup([...groups[index - 1].segments, ...groups[index].segments]);
            groups.splice(index, 1);
            index--;
        } else if (index + 1 < groups.length && sameContext(groups[index + 1])) {
            groups[index + 1] = createNarrationGroup([...groups[index].segments, ...groups[index + 1].segments]);
            groups.splice(index, 1);
            index--;
        } else {
            throw new Error('Narration contains punctuation that cannot cross a speaker boundary.');
        }
    }
    return groups;
};

export const assignNarrationGroupAnchors = (groups, videoDuration) => groups.map((group, index) => {
    const previousEnd = index > 0 ? groups[index - 1].orig_end : 0;
    const nextStart = index < groups.length - 1 ? groups[index + 1].orig_start : videoDuration;
    const anchorStart = group.kind === 'dialogue'
        ? Math.max(previousEnd, group.orig_start - 1)
        : group.orig_start;
    const anchorEnd = group.kind === 'dialogue'
        ? Math.min(nextStart, videoDuration, group.orig_end + 1)
        : nextStart;
    if (!Number.isFinite(anchorStart) || !Number.isFinite(anchorEnd) || anchorEnd <= anchorStart) {
        throw new Error(`Pipeline Error: Invalid narration group anchor ${index}: ${anchorStart} -> ${anchorEnd}.`);
    }
    return { ...group, anchor_start: anchorStart, anchor_end: anchorEnd };
});

export const distributeNarrationGroupAudio = (
    group,
    audioStart,
    audioDuration,
    { subtitleParts = null, spokenText = null, requireSubtitleBoundaries = false } = {}
) => {
    let localBoundaries = null;
    if (Array.isArray(subtitleParts) && subtitleParts.length > 0 && typeof spokenText === 'string') {
        const charToTime = buildSubtitleCharTimeline(spokenText, subtitleParts);
        if (charToTime) {
            let searchFrom = 0;
            const textOffsets = group.segments.map((segment, index) => {
                const normalizedSegmentText = normalizeBurmeseNumberText(segment.text);
                const offset = spokenText.indexOf(normalizedSegmentText, searchFrom);
                if (offset < 0) {
                    throw new Error(`Timeline Error: Cannot locate normalized TTS text for segment ${segment.index}.`);
                }
                searchFrom = offset + normalizedSegmentText.length;
                return index === 0 ? 0 : offset;
            });
            const starts = textOffsets.map((offset, index) => index === 0
                ? 0
                : findSubtitleTimeAtOrAfter(charToTime, offset));
            if (starts.every(Number.isFinite)) {
                localBoundaries = starts.map((segmentStart, index) => ({
                    start: segmentStart,
                    end: index + 1 < starts.length ? starts[index + 1] : audioDuration
                }));
            }
        }
    }
    if (!localBoundaries && requireSubtitleBoundaries) {
        throw new Error('Timeline Error: Edge-TTS subtitle boundaries are missing or invalid.');
    }

    if (!localBoundaries) {
        const totalWeight = group.segments.reduce(
            (sum, segment) => sum + Math.max(1, narrationGraphemes(segment.text).length),
            0
        );
        let elapsedWeight = 0;
        localBoundaries = group.segments.map(segment => {
            const segmentStart = audioDuration * (elapsedWeight / totalWeight);
            elapsedWeight += Math.max(1, narrationGraphemes(segment.text).length);
            return { start: segmentStart, end: audioDuration * (elapsedWeight / totalWeight) };
        });
    }

    return group.segments.map((segment, index) => {
        const boundary = localBoundaries[index];
        if (!Number.isFinite(boundary.start) || !Number.isFinite(boundary.end) ||
            boundary.start < 0 || boundary.end > audioDuration + 0.05 || boundary.end <= boundary.start) {
            throw new Error(`Timeline Error: Invalid audio boundary for segment ${segment.index}.`);
        }
        return {
            index: segment.index,
            text: segment.text,
            kind: segment.kind,
            speaker: segment.speaker,
            orig_start: segment.orig_start,
            orig_end: segment.orig_end,
            final_audio_start: audioStart + boundary.start,
            final_audio_end: audioStart + Math.min(audioDuration, boundary.end)
        };
    });
};

export const mergeNarrationGroups = (groups, index) => {
    if (groups.length < 2 || index < 0 || index >= groups.length) {
        throw new Error('Pipeline Error: Cannot merge narration group ' + index + '.');
    }
    const candidates = [index + 1, index - 1].filter(candidate => candidate >= 0 && candidate < groups.length);
    const neighborIndex = groups[index].kind === 'narration'
        ? candidates.find(candidate => groups[candidate].kind === 'narration')
        : undefined;
    if (neighborIndex === undefined) {
        throw new Error('Pipeline Error: Dialogue group ' + index + ' cannot merge across a speaker or speech-type boundary.');
    }
    const leftIndex = Math.min(index, neighborIndex);
    const merged = createNarrationGroup([
        ...groups[leftIndex].segments,
        ...groups[leftIndex + 1].segments
    ]);
    return [...groups.slice(0, leftIndex), merged, ...groups.slice(leftIndex + 2)];
};

export const buildContinuousNarrationBlocks = (sceneNarration) => {
    if (!Array.isArray(sceneNarration) || sceneNarration.length === 0) return [];
    const blocks = sceneNarration.flatMap((scene, index) => {
        const parts = splitNarrationText(scene.narration_text);
        const totalWeight = parts.reduce((sum, part) => sum + Math.max(1, part.length), 0);
        const duration = scene.scene_end - scene.scene_start;
        let elapsedWeight = 0;
        return parts.map(part => {
            const start = scene.scene_start + duration * (elapsedWeight / totalWeight);
            elapsedWeight += Math.max(1, part.length);
            const end = scene.scene_start + duration * (elapsedWeight / totalWeight);
            return {
                scenes: [index],
                mergedText: part,
                orig_start: start,
                orig_end: end
            };
        });
    });
    return mergeOrphanTtsBlocks(blocks);
};

export const GEMINI_EOF_DRIFT_TOLERANCE_SECONDS = 0.3;

export const validateTimestamps = (
    transcript,
    mediaDuration,
    eofDriftTolerance = GEMINI_EOF_DRIFT_TOLERANCE_SECONDS
) => {
    if (!Array.isArray(transcript)) throw new Error('Transcript is not an array.');
    if (!Number.isFinite(mediaDuration) || mediaDuration <= 0) {
        throw new Error('Real media duration is invalid.');
    }
    let previousEnd = 0;

    return transcript.map((chunk, index) => {
        if (!chunk || !Array.isArray(chunk.timestamp) || chunk.timestamp.length !== 2) {
            throw new Error(`Gemini timestamp at segment ${index} must contain exactly [start, end].`);
        }
        const [start, reportedEnd] = chunk.timestamp;
        if (!Number.isFinite(start) || !Number.isFinite(reportedEnd)) {
            throw new Error(`Gemini timestamp at segment ${index} contains a non-finite value.`);
        }
        if (start < 0 || reportedEnd <= start) {
            throw new Error(`Gemini timestamp at segment ${index} has an invalid range ${start} -> ${reportedEnd}.`);
        }
        if (start >= mediaDuration) {
            throw new Error(
                `Gemini timestamp at segment ${index} starts outside the real media duration ` +
                `(${start} >= ${mediaDuration}); refusing to drop or truncate speech.`
            );
        }
        if (start < previousEnd) {
            throw new Error(
                `Gemini timestamp overlap at segment ${index}: ${start} < previous end ${previousEnd}; ` +
                'refusing to move or overlap speech.'
            );
        }

        let end = reportedEnd;
        if (reportedEnd > mediaDuration) {
            const overshoot = reportedEnd - mediaDuration;
            const isFinalSegment = index === transcript.length - 1;
            if (!isFinalSegment || overshoot - eofDriftTolerance > 1e-9) {
                throw new Error(
                    `Gemini timestamp at segment ${index} exceeds the real media duration by ` +
                    `${overshoot.toFixed(3)}s; only final-segment drift up to ` +
                    `${eofDriftTolerance.toFixed(3)}s can be repaired safely.`
                );
            }
            end = mediaDuration;
        }
        if (end <= start) {
            throw new Error(
                `Gemini timestamp at segment ${index} cannot be repaired without truncating speech.`
            );
        }

        previousEnd = end;
        return end === reportedEnd ? chunk : { ...chunk, timestamp: [start, end] };
    });
};

export const GEMINI_TRANSCRIPT_TARGET_MIN_SECONDS = 2;
export const GEMINI_TRANSCRIPT_TARGET_MAX_SECONDS = 6;
export const GEMINI_TRANSCRIPT_MAX_SEGMENT_SECONDS = 6.3;
export const GEMINI_TRANSCRIPT_MAX_CONTINUOUS_SPEECH_GAP_SECONDS = 2;
export const GEMINI_TRANSCRIPT_CACHE_VERSION = 3;

export const parseGeminiTranscriptResponse = (responseText, duration) => {
    let parsed;
    try { parsed = JSON.parse(responseText); } catch (error) {
        throw new Error("Gemini did not return valid JSON.");
    }
    if (!Array.isArray(parsed)) throw new Error("Gemini did not return a JSON array.");
    const normalized = parsed.map((item, index) => {
        if (!item || typeof item.text !== "string" || !item.text.trim() ||
            typeof item.translatedText !== "string" || !item.translatedText.trim()) {
            throw new Error("Gemini transcript segment " + index + " is missing original or translated text.");
        }
        const originalText = item.text.trim();
        const translatedText = item.translatedText.trim();
        if (!isSpeakableTtsText(originalText) || !isSpeakableTtsText(translatedText)) {
            throw new Error("Gemini transcript segment " + index + " contains punctuation-only text.");
        }
        if (!Array.isArray(item.timestamp) || item.timestamp.length !== 2 ||
            !item.timestamp.every(Number.isFinite)) {
            throw new Error("Gemini timestamp at segment " + index + " must contain exactly [start, end].");
        }
        const segmentDuration = item.timestamp[1] - item.timestamp[0];
        if (segmentDuration > GEMINI_TRANSCRIPT_MAX_SEGMENT_SECONDS + 1e-9) {
            throw new Error(
                "Gemini transcript segment " + index + " is " + segmentDuration.toFixed(3) +
                "s long and exceeds the maximum natural clause duration of " +
                GEMINI_TRANSCRIPT_MAX_SEGMENT_SECONDS.toFixed(1) + "s."
            );
        }
        if (item.kind !== "dialogue" && item.kind !== "narration") {
            throw new Error("Gemini transcript segment " + index + " has invalid speech kind.");
        }
        if (item.speaker !== undefined && typeof item.speaker !== "string") {
            throw new Error("Gemini transcript segment " + index + " has an invalid speaker.");
        }
        if (item.kind === "dialogue" && (!item.speaker || !item.speaker.trim())) {
            throw new Error("Gemini dialogue segment " + index + " is missing a speaker identifier.");
        }
        return { timestamp: item.timestamp, text: originalText, translatedText,
            kind: item.kind, ...(item.speaker?.trim() ? { speaker: item.speaker.trim() } : {}) };
    });
    return validateTimestamps(normalized, duration);
};

export const buildGeminiTranscriptionPrompt = (
    duration,
    translationRules = getTranslationSystemInstruction()
) => {
    const responseExample = '[{"timestamp":[0,4.2],"text":"original clause","translatedText":"မြန်မာဘာသာပြန် စာပိုဒ်","kind":"dialogue","speaker":"speaker_1"}]';
    return `Listen to the source audio and provide a complete chronological transcript and Burmese translation.

SEGMENTATION AND TIMESTAMP RULES:
- Emit natural sentence- or clause-level records, normally ${GEMINI_TRANSCRIPT_TARGET_MIN_SECONDS}–${GEMINI_TRANSCRIPT_TARGET_MAX_SECONDS} seconds each.
- Derive every record's start and end timestamp independently by listening to the source audio. Timestamps must follow the actual spoken clause boundaries.
- Never calculate sub-segment timestamps proportionally from text, character counts, or a longer parent timestamp.
- Never combine multiple natural clauses into one long record. A short complete utterance under ${GEMINI_TRANSCRIPT_TARGET_MIN_SECONDS} seconds must remain intact.
- When speech continues, the gap between consecutive records must not exceed ${GEMINI_TRANSCRIPT_MAX_CONTINUOUS_SPEECH_GAP_SECONDS} seconds. Preserve genuine source silence.
- Preserve every intended word, fact, intent, question, command, reply, tone, and the exact source order.
- Classify each record independently as kind "dialogue" or "narration". Keep stable speaker identifiers for dialogue, and never merge different speakers or dialogue with narration.
- Preserve Burmese Unicode grapheme clusters intact. Never split a Burmese grapheme cluster between records.
- Never emit punctuation-only, symbol-only, or whitespace-only records.

This audio is exactly ${duration.toFixed(2)} seconds long. No timestamp may exceed the real media duration.

CRITICAL RULES FOR TRANSLATION:
${translationRules}

Return STRICTLY a JSON array of objects containing timestamp, original text, Burmese translatedText, kind, and speaker for dialogue, with no markdown outside the JSON. Example:
${responseExample}`;
};

export const transcribeWav = async (wavPath, cachePath, _apiKey, options = {}) => {
    const duration = await getDuration(wavPath);
    return transcribeWithFasterWhisper({
        wavPath, cachePath, duration,
        signal: options.signal, timeoutMs: options.timeoutMs,
        ...(options.invoke ? { invoke: options.invoke } : {}),
        ...(options.sourceFingerprint ? { sourceFingerprint: options.sourceFingerprint } : {})
    });
};

export const translateWithGemini = async (originalTranscript, cachePath, apiKey = null, options = {}) => {
    const sourceFingerprint = options.sourceFingerprint || crypto.createHash('sha256').update(JSON.stringify(originalTranscript)).digest('hex');
    const colloquialValue = getSetting('COLLOQUIAL_MODE');
    const settings = options.settings || {
        colloquialMode: colloquialValue === 'true' || colloquialValue === '1' || colloquialValue === true,
        instruction: getTranslationSystemInstruction()
    };
    return translateTranscriptWithGemini({
        sourceRecords: originalTranscript, cachePath, apiKey, sourceFingerprint, settings,
        model: 'gemini-3.6-flash',
        ...(options.generateContent ? { generateContent: options.generateContent } : {}),
        ...(options.sleep ? { sleep: options.sleep } : {}),
        ...(options.random ? { random: options.random } : {}),
        ...(options.onRetry ? { onRetry: options.onRetry } : {}),
        ...(options.listModels ? { listModels: options.listModels } : {}),
        ...(options.onModelSelected ? { onModelSelected: options.onModelSelected } : {}),
        signal: options.signal
    });
};

export { fingerprintFile };

export const createTtsNarrationFingerprint = ({ sceneNarration, edgeVoice, pitch, rate, videoDuration, sourceFingerprint = null }) =>
    crypto.createHash('sha256').update(JSON.stringify({
        workflowVersion: WORKFLOW_VERSION, algorithmVersion: 'edge-tts-grouped-v12', sourceFingerprint, voice: edgeVoice, pitch, rate, videoDuration,
        narration: sceneNarration.map(scene => ({
            text: scene.narration_text, start: scene.scene_start, end: scene.scene_end,
            kind: scene.kind || 'narration', speaker: scene.speaker || null
        }))
    })).digest('hex');

export const generateNarrationTTS = async (sceneNarration, cachePath, voiceId, _ignoredOriginalTranscript, videoDuration, { geminiApiKey, sourceFingerprint = null, rewriteSegment = rewriteBurmeseSegmentForDuration, enableLegacyDurationFit = true, signal } = {}) => {
    throwIfAborted(signal);
    const cacheDir = path.dirname(cachePath);
    const ttsDir = path.join(cacheDir, 'tts_chunks_scene');
    try {
        console.log('[AI] Starting grouped TTS generation');
        const cacheMetaPath = cachePath + '.meta.json';
        const timelinePath = cachePath + '.timeline.json';
        const timelineMetaPath = cachePath + '.timeline.meta.json';
        const sourceVideoDuration = Number.isFinite(videoDuration)
            ? videoDuration
            : Math.max(...sceneNarration.map(scene => scene.scene_end));
        const voiceConfig = getVoiceConfig(voiceId);
        const edgeVoice = voiceConfig.edgeVoice;
        const pitch = voiceConfig.pitch;
        const rate = voiceConfig.rate;
        const narrationFingerprint = createTtsNarrationFingerprint({
            sceneNarration, edgeVoice, pitch, rate, videoDuration: sourceVideoDuration, sourceFingerprint
        });
        const currentMeta = {
            workflowVersion: WORKFLOW_VERSION,
            algorithmVersion: 'edge-tts-grouped-v12',
            sourceFingerprint,
            voice: edgeVoice,
            pitch,
            rate,
            len: sceneNarration.length,
            narrationFingerprint
        };

        if (fs.existsSync(cachePath) && fs.existsSync(cacheMetaPath) &&
            fs.existsSync(timelinePath) && fs.existsSync(timelineMetaPath)) {
            try {
                const existingMeta = JSON.parse(fs.readFileSync(cacheMetaPath, 'utf8'));
                const existingTimelineMeta = JSON.parse(fs.readFileSync(timelineMetaPath, 'utf8'));
                if (existingMeta.workflowVersion === currentMeta.workflowVersion &&
                    existingMeta.algorithmVersion === currentMeta.algorithmVersion &&
                    existingMeta.sourceFingerprint === currentMeta.sourceFingerprint &&
                    existingMeta.voice === currentMeta.voice &&
                    existingMeta.pitch === currentMeta.pitch &&
                    existingMeta.rate === currentMeta.rate &&
                    existingMeta.len === currentMeta.len &&
                    existingMeta.narrationFingerprint === currentMeta.narrationFingerprint &&
                    existingTimelineMeta.workflowVersion === currentMeta.workflowVersion &&
                    existingTimelineMeta.algorithmVersion === currentMeta.algorithmVersion &&
                    existingTimelineMeta.sourceFingerprint === currentMeta.sourceFingerprint &&
                    existingTimelineMeta.narrationFingerprint === currentMeta.narrationFingerprint) {
                    console.log('[AI] Reusing cached grouped TTS audio.');
                    return cachePath;
                }
            } catch (error) { }
        }

        if (!fs.existsSync(ttsDir)) fs.mkdirSync(ttsDir, { recursive: true });
        let groups = buildNarrationGroups(sceneNarration);
        if (groups.length === 0) throw new Error('Pipeline Error: Narration contains no groups.');

        const ttsClient = new EdgeTTS({
            voice: edgeVoice,
            pitch,
            rate,
            saveSubtitles: true,
            timeout: 120000
        });
        let concurrencyLimit = 3;
        if (process.env.TTS_CONCURRENCY) {
            const parsed = parseInt(process.env.TTS_CONCURRENCY, 10);
            if (Number.isFinite(parsed) && parsed >= 1) concurrencyLimit = Math.min(parsed, 20);
        }

        let chunks = [];
        let audioDurations = [];
        const generateCurrentGroups = async () => {
            chunks = groups.map((_, index) =>
                path.join(ttsDir, `chunk_${String(index).padStart(4, '0')}.wav`)
            );
            let currentIndex = 0;
            const processNext = async () => {
                while (currentIndex < groups.length) {
                    throwIfAborted(signal);
                    const groupIndex = currentIndex++;
                    const chunkText = normalizeBurmeseNumberText(groups[groupIndex].mergedText);
                    if (!isSpeakableTtsText(chunkText)) {
                        throw new Error(`Narration group ${groupIndex} contains no speakable text.`);
                    }
                    const chunkPath = chunks[groupIndex];
                    let success = false;
                    let lastError = null;
                    console.log(`[AI] Generating TTS group ${groupIndex + 1} / ${groups.length} (${groups[groupIndex].segments.length} anchors)...`);
                    for (let attempt = 1; attempt <= 3; attempt++) {
                        try {
                            const diagnostics = await synthesizeEdgeTts(ttsClient, chunkText, chunkPath, { signal });
                            console.log(`[AI] TTS diagnostics ${formatEdgeTtsDiagnostics({ blockIndex: groupIndex, attempt, diagnostics })}`);
                            if (!fs.existsSync(chunkPath) || fs.statSync(chunkPath).size === 0) {
                                throw new Error('TTS generated empty file');
                            }
                            success = true;
                            break;
                        } catch (error) {
                            if (isAbortError(error)) throw error;
                            lastError = error;
                            console.warn(`[AI] TTS diagnostics ${formatEdgeTtsDiagnostics({ blockIndex: groupIndex, attempt, diagnostics: error.diagnostics })}`);
                            console.warn(`[AI] TTS attempt ${attempt} failed for group ${groupIndex}:`, error);
                            if (attempt < 3) {
                                await waitWithSignal(getTtsRetryDelayMs(attempt), signal);
                            }
                        }
                    }
                    if (!success) {
                        throw new Error(`Failed to generate TTS for group ${groupIndex} after 3 attempts. Last error: ${lastError?.message}`);
                    }
                }
            };
            const workers = Array.from(
                { length: Math.min(concurrencyLimit, groups.length) },
                () => processNext()
            );
            await waitForAllTtsWorkers(workers);
            audioDurations = await Promise.all(chunks.map(async (chunkPath, index) => {
                const duration = parseFloat(await getDuration(chunkPath));
                if (!Number.isFinite(duration) || duration <= 0) {
                    throw new Error(`Timeline Error: Invalid duration for TTS group ${index}.`);
                }
                return duration;
            }));
        };

        await generateCurrentGroups();
        groups = assignNarrationGroupAnchors(groups, sourceVideoDuration);
        const durationFitDiagnostics = [];

        const measureGroupSegments = groupIndex => {
            const subtitlePath = chunks[groupIndex] + '.json';
            if (!fs.existsSync(subtitlePath)) {
                throw new Error(`Timeline Error: Edge-TTS subtitle sidecar is missing for group ${groupIndex}.`);
            }
            const subtitleParts = JSON.parse(fs.readFileSync(subtitlePath, 'utf8'));
            return distributeNarrationGroupAudio(groups[groupIndex], 0, audioDurations[groupIndex], {
                subtitleParts,
                spokenText: normalizeBurmeseNumberText(groups[groupIndex].mergedText),
                requireSubtitleBoundaries: true
            });
        };

        const regenerateGroupSerially = async groupIndex => {
            const chunkText = normalizeBurmeseNumberText(groups[groupIndex].mergedText);
            const chunkPath = chunks[groupIndex];
            let lastError = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    const diagnostics = await synthesizeEdgeTts(ttsClient, chunkText, chunkPath, { signal });
                    console.log(`[AI] Duration-fit TTS diagnostics ${formatEdgeTtsDiagnostics({
                        blockIndex: groupIndex, attempt, diagnostics
                    })}`);
                    if (!fs.existsSync(chunkPath) || fs.statSync(chunkPath).size === 0) {
                        throw new Error('TTS generated empty file');
                    }
                    const duration = parseFloat(await getDuration(chunkPath));
                    if (!Number.isFinite(duration) || duration <= 0) {
                        throw new Error(`Timeline Error: Invalid duration for TTS group ${groupIndex}.`);
                    }
                    audioDurations[groupIndex] = duration;
                    return;
                } catch (error) {
                    if (isAbortError(error)) throw error;
                    lastError = error;
                    console.warn(`[AI] Duration-fit TTS diagnostics ${formatEdgeTtsDiagnostics({
                        blockIndex: groupIndex, attempt, diagnostics: error.diagnostics
                    })}`);
                    if (attempt < 3) {
                        await waitWithSignal(getTtsRetryDelayMs(attempt), signal);
                    }
                }
            }
            throw new Error(
                `Failed to regenerate duration-fit TTS for group ${groupIndex} after 3 attempts. ` +
                `Last error: ${lastError?.message}`
            );
        };

        while (enableLegacyDurationFit) {
            let overflow = null;
            for (let groupIndex = 0; groupIndex < groups.length && !overflow; groupIndex++) {
                const measuredSegments = measureGroupSegments(groupIndex);
                for (const measured of measuredSegments) {
                    const generatedDuration = measured.final_audio_end - measured.final_audio_start;
                    const targetDuration = measured.orig_end - measured.orig_start;
                    if (generatedDuration / targetDuration > MAX_TTS_TEMPO) {
                        overflow = { groupIndex, measured, generatedDuration };
                        break;
                    }
                }
            }
            if (!overflow) break;

            const { groupIndex, measured, generatedDuration } = overflow;
            const group = groups[groupIndex];
            const segmentPosition = group.segments.findIndex(item => item.index === measured.index);
            const segment = group.segments[segmentPosition];
            console.log(
                `[AI] Segment ${segment.index} requires ${(generatedDuration /
                    (segment.orig_end - segment.orig_start)).toFixed(3)}x; starting bounded serial duration fit.`
            );
            try {
                const fit = await fitTtsSegmentDuration({
                    segment,
                    generatedDuration,
                    rewriteText: request => rewriteSegment({ ...request, apiKey: geminiApiKey }),
                    synthesizeAndMeasure: async ({ segment: rewritten }) => {
                        const updatedSegments = [...groups[groupIndex].segments];
                        updatedSegments[segmentPosition] = rewritten;
                        groups[groupIndex] = {
                            ...createNarrationGroup(updatedSegments),
                            anchor_start: groups[groupIndex].anchor_start,
                            anchor_end: groups[groupIndex].anchor_end
                        };
                        await regenerateGroupSerially(groupIndex);
                        const updatedMeasurement = measureGroupSegments(groupIndex)
                            .find(item => item.index === rewritten.index);
                        return updatedMeasurement.final_audio_end - updatedMeasurement.final_audio_start;
                    }
                });
                const updatedSegments = [...groups[groupIndex].segments];
                updatedSegments[segmentPosition] = fit.segment;
                groups[groupIndex] = {
                    ...createNarrationGroup(updatedSegments),
                    anchor_start: groups[groupIndex].anchor_start,
                    anchor_end: groups[groupIndex].anchor_end
                };
                durationFitDiagnostics.push(...fit.diagnostics);
                console.log(`[AI-DURATION-FIT] ${JSON.stringify(fit.diagnostics.at(-1))}`);
            } catch (error) {
                if (Array.isArray(error.diagnostics)) durationFitDiagnostics.push(...error.diagnostics);
                fs.writeFileSync(cachePath + '.duration-fit.json', JSON.stringify(durationFitDiagnostics, null, 2));
                throw error;
            }
        }
        fs.writeFileSync(cachePath + '.duration-fit.json', JSON.stringify(durationFitDiagnostics, null, 2));

        const processedChunks = [];
        const authoritativeTimeline = [];
        let runningAudioTime = 0;
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
            const rawChunk = chunks[groupIndex];
            const group = groups[groupIndex];
            const standardizedPath = path.join(
                ttsDir,
                `chunk_std_${String(groupIndex).padStart(4, '0')}.wav`
            );
            await runFFmpeg([
                '-i', rawChunk,
                '-acodec', 'pcm_s16le', '-ar', '24000', '-ac', '1',
                '-y', standardizedPath
            ], ttsDir, null, 600000, { signal });
            const actualDuration = parseFloat(await getDuration(standardizedPath));
            if (!Number.isFinite(actualDuration) || actualDuration <= 0) {
                throw new Error(`Timeline Error: Cannot determine duration for TTS group ${groupIndex}.`);
            }
            processedChunks.push(standardizedPath);

            const subtitlePath = rawChunk + '.json';
            if (!fs.existsSync(subtitlePath)) {
                throw new Error(`Timeline Error: Edge-TTS subtitle sidecar is missing for group ${groupIndex}.`);
            }
            const subtitleParts = JSON.parse(fs.readFileSync(subtitlePath, 'utf8'));
            const spokenText = normalizeBurmeseNumberText(group.mergedText);
            const segments = distributeNarrationGroupAudio(
                group,
                runningAudioTime,
                actualDuration,
                { subtitleParts, spokenText, requireSubtitleBoundaries: true }
            );

            authoritativeTimeline.push({
                group_index: groupIndex,
                orig_start: group.orig_start,
                orig_end: group.orig_end,
                anchor_start: group.anchor_start,
                anchor_end: group.anchor_end,
                final_audio_start: runningAudioTime,
                final_audio_end: runningAudioTime + actualDuration,
                final_dur: actualDuration,
                generated_duration: actualDuration,
                text: group.mergedText,
                kind: group.kind,
                speaker: group.speaker,
                segments
            });
            runningAudioTime += actualDuration;
        }

        const concatListPath = path.join(ttsDir, 'concat.txt');
        fs.writeFileSync(
            concatListPath,
            processedChunks.map(chunkPath => `file '${path.basename(chunkPath)}'`).join('\n')
        );
        await runFFmpeg([
            '-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
            '-acodec', 'pcm_s16le', '-ac', '1', '-ar', '24000', cachePath
        ], ttsDir, null, 600000, { signal });

        if (!fs.existsSync(cachePath) || fs.statSync(cachePath).size === 0) {
            throw new Error('Final TTS audio generation failed or is 0 bytes.');
        }
        const finalDuration = parseFloat(await getDuration(cachePath));
        const difference = Math.abs(runningAudioTime - finalDuration);
        if (!Number.isFinite(finalDuration) || difference > 0.05) {
            throw new Error(`Pipeline Error: Final grouped TTS duration difference (${difference.toFixed(3)}s) exceeds 0.05s tolerance.`);
        }

        fs.writeFileSync(cacheMetaPath, JSON.stringify(currentMeta));
        fs.writeFileSync(timelinePath, JSON.stringify(authoritativeTimeline, null, 2));
        fs.writeFileSync(timelineMetaPath, JSON.stringify({
            workflowVersion: currentMeta.workflowVersion,
            algorithmVersion: currentMeta.algorithmVersion,
            sourceFingerprint: currentMeta.sourceFingerprint,
            narrationFingerprint: currentMeta.narrationFingerprint
        }, null, 2));
        if (fs.existsSync(ttsDir)) fs.rmSync(ttsDir, { recursive: true, force: true });
        console.log(`[AI-TIMELINE-SUMMARY] groups=${groups.length} anchors=${sceneNarration.length} audio=${finalDuration.toFixed(3)}s`);
        return cachePath;
    } catch (error) {
        console.error('[AI] Error generating grouped TTS:', error);
        try {
            if (fs.existsSync(ttsDir)) fs.rmSync(ttsDir, { recursive: true, force: true });
        } catch (cleanupError) { }
        if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
        throw error;
    }
};
