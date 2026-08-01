import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type, createPartFromUri } from '@google/genai';
import { getModelCandidates, rememberSuccessfulGeminiModel } from '../ai/geminiModelSelection.js';
import { validateExtractedAudio } from './audioExtraction.js';

export const GEMINI_AUDIO_TIMEOUT_MS = Number(process.env.GEMINI_TRANSCRIPT_TIMEOUT_MS) || 120000;
export const GEMINI_TRANSCRIPT_END_EPSILON_SECONDS = 0.5;
export const GEMINI_TRANSCRIPT_FILENAME = 'gemini-transcript.json';
export const GEMINI_TRANSCRIPT_PARTIAL_FILENAME = 'gemini-transcript.partial.json';

export const GEMINI_AUDIO_RESPONSE_SCHEMA = Object.freeze({
    type: Type.ARRAY,
    items: {
        type: Type.OBJECT,
        required: ['start_time', 'end_time', 'type', 'original_text', 'burmese_text'],
        properties: {
            start_time: { type: Type.NUMBER },
            end_time: { type: Type.NUMBER },
            speaker: { type: Type.STRING, nullable: true },
            type: { type: Type.STRING, enum: ['dialogue', 'narration'] },
            original_text: { type: Type.STRING },
            burmese_text: { type: Type.STRING }
        }
    }
});

export const GEMINI_AUDIO_PROMPT = `Transcribe the complete supplied audio and translate every spoken segment into Burmese.
Return a JSON array only. Return valid JSON only, with no markdown and no code fences.
Preserve chronological order and the complete spoken content.
Do not summarize, expand, omit, invent, or hallucinate content.
For every segment return start_time and end_time in seconds, speaker when detectable,
type as exactly "dialogue" or "narration", original_text, and burmese_text.
Timestamps must be chronological, non-overlapping, and within the supplied audio.`;

const abortError = () => Object.assign(new Error('Gemini transcript cancelled.'), { name: 'AbortError' });

export const getGeminiTranscriptPaths = audioPath => {
    const directory = path.dirname(path.resolve(audioPath));
    return {
        transcriptPath: path.join(directory, GEMINI_TRANSCRIPT_FILENAME),
        partialPath: path.join(directory, GEMINI_TRANSCRIPT_PARTIAL_FILENAME)
    };
};

export const cleanupGeminiTranscriptPartial = audioPath => {
    const { partialPath } = getGeminiTranscriptPaths(audioPath);
    if (fs.existsSync(partialPath)) fs.unlinkSync(partialPath);
};

export const cleanupGeminiTranscriptArtifacts = audioPath => {
    const paths = getGeminiTranscriptPaths(audioPath);
    for (const target of [paths.partialPath, paths.transcriptPath]) {
        if (fs.existsSync(target)) fs.unlinkSync(target);
    }
};

export const validateGeminiTranscript = (value, audioDuration) => {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error('Gemini transcript is empty.');
    }
    let previousEnd = 0;
    return value.map((segment, index) => {
        if (!segment || typeof segment !== 'object') {
            throw new Error(`Gemini transcript segment ${index} is invalid.`);
        }
        const startTime = Number(segment.start_time);
        const endTime = Number(segment.end_time);
        if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
            throw new Error(`Gemini transcript segment ${index} is missing valid timestamps.`);
        }
        const isLastSegment = index === value.length - 1;
        const endOverflow = endTime - audioDuration;
        const canClampFinalEnd = isLastSegment &&
            endOverflow > 0 &&
            endOverflow <= GEMINI_TRANSCRIPT_END_EPSILON_SECONDS &&
            startTime < audioDuration;
        const validatedEndTime = canClampFinalEnd ? audioDuration : endTime;
        if (startTime < 0 || startTime >= audioDuration ||
            validatedEndTime <= startTime || validatedEndTime > audioDuration) {
            throw new Error(`Gemini transcript segment ${index} is outside the audio duration.`);
        }
        if (startTime < previousEnd) {
            throw new Error(`Gemini transcript segment ${index} overlaps the previous segment.`);
        }
        if (!['dialogue', 'narration'].includes(segment.type)) {
            throw new Error(`Gemini transcript segment ${index} has an invalid type.`);
        }
        if (typeof segment.original_text !== 'string' || !segment.original_text.trim()) {
            throw new Error(`Gemini transcript segment ${index} has no source text.`);
        }
        if (typeof segment.burmese_text !== 'string' || !segment.burmese_text.trim()) {
            throw new Error(`Gemini transcript segment ${index} has no Burmese translation.`);
        }
        if (segment.speaker != null && typeof segment.speaker !== 'string') {
            throw new Error(`Gemini transcript segment ${index} has an invalid speaker.`);
        }
        previousEnd = validatedEndTime;
        return {
            start_time: startTime,
            end_time: validatedEndTime,
            ...(segment.speaker?.trim() ? { speaker: segment.speaker.trim() } : {}),
            type: segment.type,
            original_text: segment.original_text.trim(),
            burmese_text: segment.burmese_text.trim()
        };
    });
};

const parseGeminiResponse = (response, audioDuration) => {
    let parsed;
    try {
        parsed = JSON.parse(response?.text || '');
    } catch {
        throw new Error('Gemini returned invalid transcript JSON.');
    }
    return validateGeminiTranscript(parsed, audioDuration);
};

const waitForActiveFile = async ({ file, getFile, signal, deadline, sleep }) => {
    let current = file;
    while (String(current?.state || 'ACTIVE').toUpperCase() === 'PROCESSING') {
        if (signal.aborted) throw abortError();
        if (Date.now() >= deadline) throw new Error('Gemini transcript request timed out.');
        await sleep(250);
        if (signal.aborted) throw abortError();
        current = await getFile({ name: current.name, config: { abortSignal: signal } });
    }
    if (String(current?.state || 'ACTIVE').toUpperCase() !== 'ACTIVE') {
        throw new Error('Gemini could not process the extracted audio.');
    }
    return current;
};

export const createGeminiAudioTranscript = async ({
    audioPath,
    apiKey,
    model,
    signal,
    timeoutMs = GEMINI_AUDIO_TIMEOUT_MS,
    uploadFile,
    getFile,
    deleteFile,
    generateContent,
    listModels,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) => {
    if (!apiKey) throw new Error('A Gemini API key is required.');
    const audioDuration = await validateExtractedAudio(audioPath);
    const paths = getGeminiTranscriptPaths(audioPath);
    cleanupGeminiTranscriptArtifacts(audioPath);

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    const deadline = Date.now() + timeoutMs;
    const ai = uploadFile && getFile && deleteFile && generateContent && (model || listModels)
        ? null
        : new GoogleGenAI({ apiKey });
    const calls = {
        uploadFile: uploadFile || (parameters => ai.files.upload(parameters)),
        getFile: getFile || (parameters => ai.files.get(parameters)),
        deleteFile: deleteFile || (parameters => ai.files.delete(parameters)),
        generateContent: generateContent || (parameters => ai.models.generateContent(parameters)),
        listModels: listModels || (parameters => ai.models.list(parameters))
    };
    let remoteFile;
    let selectedModel = model || null;
    try {
        const candidates = model
            ? [model]
            : await getModelCandidates({ apiKey, listModels: calls.listModels });
        if (candidates.length === 0) {
            throw new Error('No stable Gemini Flash model supporting generateContent is available to this API key.');
        }
        selectedModel = candidates[0];
        remoteFile = await calls.uploadFile({
            file: audioPath,
            config: {
                mimeType: 'audio/wav',
                displayName: path.basename(path.dirname(audioPath)),
                abortSignal: controller.signal
            }
        });
        remoteFile = await waitForActiveFile({
            file: remoteFile,
            getFile: calls.getFile,
            signal: controller.signal,
            deadline,
            sleep
        });
        if (!remoteFile?.uri || !remoteFile?.mimeType) {
            throw new Error('Gemini audio upload returned an invalid file reference.');
        }
        if (controller.signal.aborted) throw abortError();
        const response = await calls.generateContent({
            model: selectedModel,
            contents: [{
                role: 'user',
                parts: [
                    createPartFromUri(remoteFile.uri, remoteFile.mimeType),
                    { text: GEMINI_AUDIO_PROMPT }
                ]
            }],
            config: {
                responseMimeType: 'application/json',
                responseSchema: GEMINI_AUDIO_RESPONSE_SCHEMA,
                temperature: 0,
                abortSignal: controller.signal,
                httpOptions: { timeout: timeoutMs }
            }
        });
        const segments = parseGeminiResponse(response, audioDuration);
        if (!model) rememberSuccessfulGeminiModel(apiKey, selectedModel);
        fs.writeFileSync(paths.partialPath, JSON.stringify({
            schemaVersion: 1,
            model: selectedModel,
            audioDuration,
            createdAt: new Date().toISOString(),
            segments
        }, null, 2), { mode: 0o600 });
        fs.renameSync(paths.partialPath, paths.transcriptPath);
        return { transcriptPath: paths.transcriptPath, segmentCount: segments.length, model: selectedModel };
    } catch (error) {
        cleanupGeminiTranscriptArtifacts(audioPath);
        const diagnosticContext = {
            requestModel: selectedModel,
            requestTimeoutMs: timeoutMs,
            retryAttempt: error?.retryAttempt ?? error?.attempt ?? null
        };
        if (controller.signal.aborted) {
            if (signal?.aborted) throw abortError();
            throw Object.assign(
                new Error('Gemini transcript request timed out.', { cause: error }),
                { geminiDiagnosticContext: diagnosticContext }
            );
        }
        if (error && (typeof error === 'object' || typeof error === 'function')) {
            error.geminiDiagnosticContext = diagnosticContext;
        } else {
            throw Object.assign(new Error('Gemini threw a non-Error value.'), {
                originalThrownValue: error,
                geminiDiagnosticContext: diagnosticContext
            });
        }
        throw error;
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        if (remoteFile?.name) {
            await calls.deleteFile({ name: remoteFile.name }).catch(() => undefined);
        }
    }
};
