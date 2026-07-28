import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeminiTranscriptResponse } from './index.js';
import { getTranslationSystemInstruction } from './translation.js';

test('translation prompt preserves dialogue and narration without recap rewriting', () => {
    const prompt = getTranslationSystemInstruction();
    assert.match(prompt, /Dialogue must remain direct dialogue/);
    assert.match(prompt, /narration must remain narration/);
    assert.match(prompt, /Never merge different speakers or omit intended content/);
    assert.doesNotMatch(prompt, /speaker telling a story/);
    assert.doesNotMatch(prompt, /Keep sentences concise, punchy/);
});

test('Gemini parser preserves speech type, speaker, text, and order', () => {
    const response = JSON.stringify([
        { timestamp: [0, 1], text: 'Where are you going?', translatedText: 'မင်း ဘယ်သွားမလို့လဲ။', kind: 'dialogue', speaker: 'speaker_1' },
        { timestamp: [1, 2], text: 'He walked away.', translatedText: 'သူ ထွက်သွားတယ်။', kind: 'narration' }
    ]);
    assert.deepEqual(parseGeminiTranscriptResponse(response, 2), [
        { timestamp: [0, 1], text: 'Where are you going?', translatedText: 'မင်း ဘယ်သွားမလို့လဲ။', kind: 'dialogue', speaker: 'speaker_1' },
        { timestamp: [1, 2], text: 'He walked away.', translatedText: 'သူ ထွက်သွားတယ်။', kind: 'narration' }
    ]);
});

test('Gemini parser rejects missing translation or speech type', () => {
    assert.throws(() => parseGeminiTranscriptResponse(JSON.stringify([
        { timestamp: [0, 1], text: 'Stop!' }
    ]), 1), /missing original or translated text/);
    assert.throws(() => parseGeminiTranscriptResponse(JSON.stringify([
        { timestamp: [0, 1], text: 'Stop!', translatedText: 'ရပ်လိုက်။', kind: 'summary' }
    ]), 1), /invalid speech kind/);
});

test('independent Gemini translation rejects stale cache and retains classified context', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { translateWithGemini } = await import('./index.js');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialogue-cache-'));
    const cachePath = path.join(tempDir, 'burmese-transcript.json');
    try {
        fs.writeFileSync(cachePath, JSON.stringify([{ timestamp: [0, 1], text: 'stale recap' }]));
        const result = await translateWithGemini([{ timestamp: [0, 1], text: 'Stop!' }], cachePath, 'unused', {
            sourceFingerprint: 'source',
            settings: { instruction: 'translate', colloquialMode: false },
            listModels: async () => [{
                name: 'models/gemini-2.5-flash',
                supportedActions: ['generateContent']
            }],
            generateContent: async () => ({ text: JSON.stringify([{
                index: 0, timestamp: [0, 1], text: 'ရပ်လိုက်။', kind: 'dialogue', speaker: 'speaker_1'
            }]) }),
            sleep: async () => {}
        });
        assert.deepEqual(result, [{
            timestamp: [0, 1], text: 'ရပ်လိုက်။', kind: 'dialogue', speaker: 'speaker_1'
        }]);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('unified prompt preserves narration facts and scene order', () => {
    const prompt = getTranslationSystemInstruction();
    assert.match(prompt, /natural spoken Burmese while preserving facts, scene order, and context/);
    assert.match(prompt, /Never rewrite dialogue as recap narration/);
});

test('dialogue parser requires a speaker identifier', () => {
    assert.throws(() => parseGeminiTranscriptResponse(JSON.stringify([{
        timestamp: [0, 1], text: 'Wait!', translatedText: 'စောင့်ဦး။', kind: 'dialogue'
    }]), 1), /missing a speaker identifier/);
});
