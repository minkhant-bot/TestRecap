import crypto from 'node:crypto';
import fs from 'node:fs';
import { GoogleGenAI, Type } from '@google/genai';
import { WORKFLOW_VERSION } from '../domain/workflow.js';
import { getTranslationSystemInstruction } from './translation.js';
import { getModelCandidates, rememberSuccessfulGeminiModel } from './geminiModelSelection.js';
import { createAbortError, isAbortError, throwIfAborted } from '../services/cancellation.js';

export const GEMINI_TRANSLATION_ALGORITHM_VERSION = 'sawaungthin-burmese-translation-v1';
export const GEMINI_TRANSLATION_MAX_RETRIES = 3;
export const RETRYABLE_GEMINI_STATUSES = Object.freeze([429, 500, 502, 503, 504]);

export class GeminiAvailabilityError extends Error {
    constructor(status, message = null) {
        super(message || ("Gemini remained unavailable after bounded retries across compatible Flash models. Translation can be retried without restarting earlier stages."));
        this.name = "GeminiAvailabilityError";
        this.code = "GEMINI_AVAILABILITY_EXHAUSTED";
        this.status = status;
        this.retryable = true;
        this.resumeStage = "translate_burmese";
    }
}

export const getGeminiErrorStatus = error => {
    for (const candidate of [error?.status, error?.code, error?.response?.status, error?.error?.code]) {
        const status = Number(candidate);
        if (Number.isInteger(status)) return status;
    }
    if (String(error?.status || error?.error?.status || "").toUpperCase() === "UNAVAILABLE") return 503;
    const match = String(error?.message || '').match(/\b(400|401|403|404|429|500|502|503|504)\b/);
    return match ? Number(match[1]) : null;
};

export const isRetryableGeminiError = error => RETRYABLE_GEMINI_STATUSES.includes(getGeminiErrorStatus(error));
export const getGeminiRetryDelayMs = (attempt, random = Math.random) => {
    const exponential = Math.min(8000, 500 * (2 ** Math.max(0, attempt - 1)));
    return Math.round(exponential * (0.5 + random()));
};

export const TRANSLATION_RESPONSE_SCHEMA = {
    type: Type.ARRAY,
    items: {
        type: Type.OBJECT,
        required: ['index', 'text'],
        properties: {
            index: { type: Type.INTEGER },
            text: { type: Type.STRING }
        }
    }
};

const hashJson = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const parseStructuredTranslation = (responseText, sourceRecords, batchStart = 0) => {
    let parsed;
    try {
        parsed = JSON.parse(responseText);
    } catch {
        throw new Error('Gemini translation returned malformed JSON.');
    }
    if (!Array.isArray(parsed)) throw new Error('Gemini translation response must be an array.');
    if (parsed.length !== sourceRecords.length) {
        throw new Error(`Gemini translation record count ${parsed.length} does not match source count ${sourceRecords.length}.`);
    }

    return parsed.map((item, localIndex) => {
        const expectedIndex = batchStart + localIndex;
        const source = sourceRecords[localIndex];
        if (!item || item.index !== expectedIndex) {
            throw new Error(`Gemini translation order mismatch at record ${expectedIndex}.`);
        }
        if (typeof item.text !== 'string' || !item.text.trim()) {
            throw new Error(`Gemini translation record ${expectedIndex} has invalid text.`);
        }
        return {
            timestamp: [...source.timestamp],
            text: item.text.trim()
        };
    });
};

export const createTranslationCacheIdentity = ({
    sourceRecords,
    sourceFingerprint,
    model,
    settings
}) => ({
    workflowVersion: WORKFLOW_VERSION,
    algorithmVersion: GEMINI_TRANSLATION_ALGORITHM_VERSION,
    model,
    sourceFingerprint,
    sourceTranscriptFingerprint: hashJson(sourceRecords),
    translationSettingsFingerprint: hashJson(settings)
});

const cacheIdentityMatches = (cached, identity) =>
    Object.entries(identity).every(([key, value]) => cached?.[key] === value);

const safeDiagnostic = error => String(error?.message || error || 'Unknown error')
    .replace(/key=[A-Za-z0-9_-]+/gi, 'key=REDACTED')
    .slice(0, 500);

const translateTranscriptWithSingleGeminiModel = async ({
    sourceRecords,
    cachePath,
    apiKey,
    sourceFingerprint,
    model,
    settings,
    generateContent,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    random = Math.random,
    onRetry = () => {},
    signal
}) => {
    throwIfAborted(signal);
    if (!Array.isArray(sourceRecords) || sourceRecords.length === 0) return [];
    if (!apiKey) throw new Error('Gemini API key is required for translation.');

    const translationSettings = settings || {
        colloquialMode: false,
        instruction: getTranslationSystemInstruction()
    };
    const identity = createTranslationCacheIdentity({
        sourceRecords, sourceFingerprint, model, settings: translationSettings
    });

    if (cachePath && fs.existsSync(cachePath)) {
        try {
            const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            if (!cacheIdentityMatches(cached, identity)) throw new Error('Translation cache fingerprint mismatch.');
            if (!Array.isArray(cached.records) || cached.records.length !== sourceRecords.length) {
                throw new Error('Translation cache record count mismatch.');
            }
            return parseStructuredTranslation(
                JSON.stringify(cached.records.map((record, index) => ({ ...record, index }))),
                sourceRecords
            );
        } catch (error) {
            console.warn(`[Translation] Cache rejected: ${error.message}`);
        }
    }

    const ai = generateContent ? null : new GoogleGenAI({ apiKey });
    const callGenerateContent = generateContent || (request => ai.models.generateContent(request));
    const result = [];
    const batchSize = 40;

    for (let batchStart = 0; batchStart < sourceRecords.length; batchStart += batchSize) {
        const batch = sourceRecords.slice(batchStart, batchStart + batchSize);
        const input = batch.map((record, localIndex) => ({
            index: batchStart + localIndex,
            text: record.text
        }));
        let translated;
        let lastError;
        for (let attempt = 1; attempt <= GEMINI_TRANSLATION_MAX_RETRIES; attempt++) {
            throwIfAborted(signal);
            try {
                const response = await callGenerateContent({
                    model,
                    contents: [{
                        role: 'user',
                        parts: [{ text: `${translationSettings.instruction}\n\n${JSON.stringify(input)}` }]
                    }],
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema: TRANSLATION_RESPONSE_SCHEMA,
                        temperature: 0.2,
                        httpOptions: { timeout: 120000 },
                        abortSignal: signal
                    }
                });
                translated = parseStructuredTranslation(response.text, batch, batchStart);
                break;
            } catch (error) {
                if (signal?.aborted) throw createAbortError('Gemini translation interrupted.');
                if (isAbortError(error)) throw error;
                lastError = error;
                if (getGeminiErrorStatus(error) === 404) throw error;
                const retryableAvailability = getGeminiErrorStatus(error) === null ||
                    isRetryableGeminiError(error);
                console.warn("[Translation] Attempt " + attempt + " failed: " + safeDiagnostic(error));
                if (!retryableAvailability) {
                    throw new Error('Gemini translation failed: ' + safeDiagnostic(error));
                }
                if (attempt < GEMINI_TRANSLATION_MAX_RETRIES) {
                    onRetry({
                        attempt, maxAttempts: GEMINI_TRANSLATION_MAX_RETRIES,
                        status: getGeminiErrorStatus(error),
                        message: "Gemini is busy. Retrying translation…"
                    });
                    await sleep(getGeminiRetryDelayMs(attempt, random));
                    throwIfAborted(signal);
                }
            }
        }
        if (!translated) {
            if (isRetryableGeminiError(lastError)) {
                throw new GeminiAvailabilityError(getGeminiErrorStatus(lastError));
            }
            throw new Error('Gemini translation failed after ' + GEMINI_TRANSLATION_MAX_RETRIES + ' attempts: ' + safeDiagnostic(lastError));
        }
        result.push(...translated);
    }

    if (cachePath) {
        fs.writeFileSync(cachePath, JSON.stringify({ ...identity, records: result }, null, 2));
    }
    return result;
};

export const translateTranscriptWithGemini = async options => {
    if (options.model) return translateTranscriptWithSingleGeminiModel(options);
    const ai = options.generateContent && options.listModels
        ? null
        : new GoogleGenAI({ apiKey: options.apiKey });
    const listModels = options.listModels || (params => ai.models.list(params));
    const generateContent = options.generateContent || (request => ai.models.generateContent(request));
    let candidates;
    try {
        candidates = await getModelCandidates({ apiKey: options.apiKey, listModels });
    } catch (error) {
        if (isRetryableGeminiError(error)) {
            throw new GeminiAvailabilityError(getGeminiErrorStatus(error));
        }
        throw new Error('Unable to list Gemini models available to this API key: ' + safeDiagnostic(error));
    }
    if (candidates.length === 0) {
        throw new GeminiAvailabilityError(null, 'No stable Gemini Flash model supporting generateContent is available to this API key. Translation can be retried later.');
    }

    let lastAvailabilityError;
    for (let index = 0; index < candidates.length; index += 1) {
        const selectedModel = candidates[index];
        try {
            const translated = await translateTranscriptWithSingleGeminiModel({
                ...options,
                model: selectedModel,
                generateContent
            });
            rememberSuccessfulGeminiModel(options.apiKey, selectedModel);
            console.info('[Translation] Selected Gemini model: ' + selectedModel);
            options.onModelSelected?.(selectedModel);
            return translated;
        } catch (error) {
            if (!(error instanceof GeminiAvailabilityError)) throw error;
            lastAvailabilityError = error;
            const nextModel = candidates[index + 1];
            if (nextModel) {
                console.warn('[Translation] Gemini model unavailable: ' + selectedModel + '; trying ' + nextModel);
                options.onRetry?.({
                    status: error.status,
                    model: selectedModel,
                    nextModel,
                    message: 'Gemini is busy. Trying another available Flash model…'
                });
            }
        }
    }
    throw new GeminiAvailabilityError(lastAvailabilityError?.status ?? null, 'No compatible Gemini Flash model completed translation after bounded retries. Translation can be retried later.');
};
