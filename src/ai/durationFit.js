import { GoogleGenAI } from '@google/genai';

export const MAX_TTS_TEMPO = 1.25;
export const MAX_DURATION_FIT_ATTEMPTS = 3;
export const DURATION_FIT_RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        text: { type: 'STRING', minLength: '1' }
    },
    required: ['text'],
    minProperties: '1',
    maxProperties: '1'
};
const MAX_DIAGNOSTIC_RESPONSE_LENGTH = 500;

const sanitizeDiagnosticText = value => {
    if (typeof value !== 'string') return '';
    return value
        .replace(/AIza[A-Za-z0-9_-]+/g, '[REDACTED_API_KEY]')
        .replace(/(authorization["'\s]*:["'\s]*)(?:bearer\s+)?[^"',}\s]+/gi, '$1[REDACTED]')
        .replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]')
        .replace(/(["'\s]*(?:api[_-]?key|credential|token)["'\s]*[:=]["'\s]*)[^"',}\s]+/gi, '$1[REDACTED]')
        .slice(0, MAX_DIAGNOSTIC_RESPONSE_LENGTH);
};

const getResponseDiagnostics = (response, attempt, error) => {
    const candidate = response?.candidates?.[0];
    const promptFeedback = response?.promptFeedback;
    return {
        attempt,
        raw_response: sanitizeDiagnosticText(response?.text),
        finish_reason: candidate?.finishReason || null,
        block_reason: promptFeedback?.blockReason || null,
        safety_metadata: candidate?.safetyRatings || promptFeedback?.safetyRatings || null,
        error
    };
};

export const parseDurationFitGeminiResponse = (response, attempt) => {
    let parsed;
    try {
        parsed = JSON.parse(response?.text);
    } catch (error) {
        const wrapped = new Error('Gemini returned malformed or empty structured JSON.');
        wrapped.code = 'DURATION_FIT_INVALID_RESPONSE';
        wrapped.diagnostic = getResponseDiagnostics(response, attempt, error.message);
        throw wrapped;
    }
    const isObject = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    const keys = isObject ? Object.keys(parsed) : [];
    if (!isObject || keys.length !== 1 || keys[0] !== 'text' ||
        typeof parsed.text !== 'string' || !parsed.text.trim()) {
        const error = new Error(
            'Gemini structured response must be exactly an object containing one non-empty string field named "text".'
        );
        error.code = 'DURATION_FIT_INVALID_RESPONSE';
        error.diagnostic = getResponseDiagnostics(response, attempt, error.message);
        throw error;
    }
    return parsed.text.trim();
};

export const buildDurationFitPrompt = ({ segment, targetDuration, generatedDuration, attempt }) => `Shorten exactly one Burmese ${segment.kind} segment so its spoken audio fits its own original timestamp window.

Immutable metadata:
- segment index: ${segment.index}
- kind: ${segment.kind}
- speaker: ${segment.speaker || 'narrator'}
- original start: ${segment.orig_start}
- original end: ${segment.orig_end}
- exact target duration: ${targetDuration.toFixed(6)} seconds
- measured generated duration: ${generatedDuration.toFixed(6)} seconds
- maximum allowed audio tempo: ${MAX_TTS_TEMPO.toFixed(2)}x
- duration-fit attempt: ${attempt}/${MAX_DURATION_FIT_ATTEMPTS}

Original Burmese text:
${segment.text}

Rules:
- Return only a JSON object with one string field named "text".
- Rewrite only this segment into shorter, natural spoken Burmese.
- Preserve the complete meaning, every fact, order, intent, question, command, reply, context, and conversational tone.
- Keep dialogue as direct dialogue and narration as narration.
- Preserve the speaker; do not add, remove, merge, or move content.
- Do not return punctuation-only or whitespace-only text.
- Do not explain the rewrite.`;

export const rewriteBurmeseSegmentForDuration = async ({
    segment,
    targetDuration,
    generatedDuration,
    attempt,
    apiKey,
    generateContent
}) => {
    if (!apiKey) throw new Error('Gemini API key is required for TTS duration fitting.');
    const requestGenerateContent = generateContent ||
        (request => new GoogleGenAI({ apiKey }).models.generateContent(request));
    const response = await requestGenerateContent({
        model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
        contents: [{ role: 'user', parts: [{ text: buildDurationFitPrompt({
            segment, targetDuration, generatedDuration, attempt
        }) }] }],
        config: {
            responseMimeType: 'application/json',
            responseSchema: DURATION_FIT_RESPONSE_SCHEMA,
            temperature: 0.1
        }
    });
    const text = parseDurationFitGeminiResponse(response, attempt);
    if (!/[\p{L}\p{N}]/u.test(text)) {
        throw new Error(`Duration-fit Gemini response for segment ${segment.index} has no speakable text.`);
    }
    return text;
};

export const fitTtsSegmentDuration = async ({
    segment,
    generatedDuration,
    rewriteText,
    synthesizeAndMeasure,
    maxAttempts = MAX_DURATION_FIT_ATTEMPTS,
    maxTempo = MAX_TTS_TEMPO
}) => {
    const targetDuration = segment.orig_end - segment.orig_start;
    if (!Number.isFinite(targetDuration) || targetDuration <= 0 ||
        !Number.isFinite(generatedDuration) || generatedDuration <= 0) {
        throw new Error(`Duration-fit segment ${segment.index} has invalid source or target duration.`);
    }
    const original = { ...segment };
    let candidate = { ...segment };
    let measuredDuration = generatedDuration;
    const diagnostics = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const beforeText = candidate.text;
        let afterText;
        try {
            afterText = await rewriteText({
                segment: { ...candidate },
                targetDuration,
                generatedDuration: measuredDuration,
                attempt
            });
        } catch (error) {
            if (error?.code !== 'DURATION_FIT_INVALID_RESPONSE') throw error;
            diagnostics.push({
                segment_index: segment.index,
                attempt,
                kind: original.kind,
                speaker: original.speaker || null,
                orig_start: original.orig_start,
                orig_end: original.orig_end,
                accepted: false,
                response_error: error.diagnostic
            });
            continue;
        }
        if (typeof afterText !== 'string' || !/[\p{L}\p{N}]/u.test(afterText)) {
            throw new Error(`Duration-fit rewrite for segment ${segment.index} has no speakable text.`);
        }
        candidate = { ...candidate, text: afterText.trim() };
        measuredDuration = await synthesizeAndMeasure({ segment: { ...candidate }, attempt });
        const appliedTempo = Math.max(1, measuredDuration / targetDuration);
        const record = {
            segment_index: segment.index,
            attempt,
            kind: original.kind,
            speaker: original.speaker || null,
            orig_start: original.orig_start,
            orig_end: original.orig_end,
            before_text: beforeText,
            after_text: candidate.text,
            target_duration: targetDuration,
            generated_duration: measuredDuration,
            applied_tempo: appliedTempo,
            accepted: appliedTempo <= maxTempo
        };
        diagnostics.push(record);
        if (record.accepted) {
            return {
                segment: {
                    ...candidate,
                    original_text: original.original_text || original.text,
                    duration_fit: diagnostics
                },
                generatedDuration: measuredDuration,
                appliedTempo,
                diagnostics
            };
        }
    }

    const invalidResponses = diagnostics.filter(record => record.response_error);
    if (invalidResponses.length === maxAttempts) {
        const error = new Error(
            `Duration-fit Gemini returned an invalid structured response for segment ${segment.index} ` +
            `on all ${maxAttempts} attempts.`
        );
        error.code = 'TTS_DURATION_FIT_GEMINI_FAILED';
        error.segment = { ...original };
        error.diagnostics = diagnostics;
        throw error;
    }

    const error = new Error(
        `Pipeline Error: TTS segment ${segment.index} still requires ` +
        `${(measuredDuration / targetDuration).toFixed(3)}x tempo after ${maxAttempts} duration-fit attempts; ` +
        `maximum is ${maxTempo.toFixed(2)}x.`
    );
    error.code = 'TTS_DURATION_FIT_FAILED';
    error.segment = { ...original };
    error.diagnostics = diagnostics;
    throw error;
};
