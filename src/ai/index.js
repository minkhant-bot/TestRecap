import crypto from 'node:crypto';
import { getDuration } from '../ffmpeg/index.js';
import { getSetting } from '../services/settings.js';
import { getTranslationSystemInstruction } from './translation.js';
import { fingerprintFile, transcribeWithFasterWhisper } from './fasterWhisper.js';
import { translateTranscriptWithGemini } from './geminiTranslation.js';

export const computeSimilarity = async () => null;
export const initModels = async () => {};

export const transcribeWav = async (wavPath, cachePath, _apiKey, options = {}) => {
    const duration = await getDuration(wavPath);
    return transcribeWithFasterWhisper({
        wavPath,
        cachePath,
        duration,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        ...(options.invoke ? { invoke: options.invoke } : {}),
        ...(options.sourceFingerprint ? { sourceFingerprint: options.sourceFingerprint } : {})
    });
};

export const translateWithGemini = async (
    originalTranscript,
    cachePath,
    apiKey = null,
    options = {}
) => {
    const sourceFingerprint = options.sourceFingerprint || crypto.createHash('sha256')
        .update(JSON.stringify(originalTranscript)).digest('hex');
    const colloquialValue = getSetting('COLLOQUIAL_MODE');
    const dialogueValue = getSetting('DIALOGUE_MODE');
    const settings = options.settings || {
        colloquialMode: colloquialValue === 'true' || colloquialValue === '1' || colloquialValue === true,
        dialogueMode: dialogueValue === 'true' || dialogueValue === '1' || dialogueValue === true,
        instruction: getTranslationSystemInstruction()
    };
    return translateTranscriptWithGemini({
        sourceRecords: originalTranscript,
        cachePath,
        apiKey,
        sourceFingerprint,
        settings,
        ...(options.model || process.env.GEMINI_MODEL
            ? { model: options.model || process.env.GEMINI_MODEL }
            : {}),
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
