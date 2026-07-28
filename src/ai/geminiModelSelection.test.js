import assert from 'node:assert/strict';
import test from 'node:test';
import {
    clearGeminiModelCacheForTests,
    rankCompatibleFlashModels
} from './geminiModelSelection.js';
import {
    GeminiAvailabilityError,
    translateTranscriptWithGemini
} from './geminiTranslation.js';

const source = [{ timestamp: [0, 1], text: 'Hello' }];
const response = JSON.stringify([
    { index: 0, timestamp: [0, 1], text: 'မင်္ဂလာပါ', kind: 'narration' }
]);
const models = [
    { name: 'models/gemini-2.0-pro', supportedActions: ['generateContent'] },
    { name: 'models/gemini-3-flash-preview', supportedActions: ['generateContent'] },
    { name: 'models/gemini-2.0-flash-lite', supportedActions: ['generateContent'] },
    { name: 'models/gemini-2.5-flash', supportedActions: ['generateContent'] },
    { name: 'models/gemini-2.0-flash', supportedActions: ['generateContent'] },
    { name: 'models/gemini-1.5-flash', supportedActions: ['embedContent'] }
];

const request = overrides => translateTranscriptWithGemini({
    sourceRecords: source,
    apiKey: 'model-key-' + Math.random(),
    sourceFingerprint: 'source',
    settings: { instruction: 'translate', colloquialMode: false },
    listModels: async () => models,
    sleep: async () => {},
    random: () => 0.5,
    ...overrides
});

test('model discovery filters generateContent and ranks stable Flash models', () => {
    assert.deepEqual(rankCompatibleFlashModels(models), [
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite'
    ]);
});

test('availability exhaustion on one model fails over and caches the successful model', async () => {
    clearGeminiModelCacheForTests();
    const calls = [];
    let listCalls = 0;
    const apiKey = 'cache-key';
    const generateContent = async request => {
        calls.push(request.model);
        if (request.model === 'gemini-2.5-flash') {
            throw Object.assign(new Error('503 UNAVAILABLE'), { status: 503 });
        }
        return { text: response };
    };
    const first = await request({
        apiKey,
        listModels: async () => { listCalls += 1; return models; },
        generateContent
    });
    assert.equal(first[0].text, 'မင်္ဂလာပါ');
    assert.deepEqual(calls, [
        'gemini-2.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash',
        'gemini-2.0-flash'
    ]);

    calls.length = 0;
    await request({
        apiKey,
        listModels: async () => { listCalls += 1; return models; },
        generateContent
    });
    assert.equal(listCalls, 1);
    assert.deepEqual(calls, ['gemini-2.0-flash']);
});

test('every candidate receives the strict schema and all unavailable models return one retryable error', async () => {
    clearGeminiModelCacheForTests();
    const requests = [];
    await assert.rejects(() => request({
        generateContent: async request => {
            requests.push(request);
            throw Object.assign(new Error('429 busy'), { status: 429 });
        }
    }), error => {
        assert.ok(error instanceof GeminiAvailabilityError);
        assert.equal(error.retryable, true);
        assert.equal(error.resumeStage, 'translate_burmese');
        return true;
    });
    assert.equal(requests.length, 9);
    assert.ok(requests.every(item =>
        item.config.responseMimeType === 'application/json' && item.config.responseSchema));
});
