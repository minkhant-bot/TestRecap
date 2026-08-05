import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    parseStructuredTranslation,
    translateTranscriptWithGemini
} from './geminiTranslation.js';

const source = [
    { timestamp: [0, 1], text: 'Stop!' },
    { timestamp: [1.2, 2.5], text: 'He walked away.' }
];
const response = JSON.stringify([
    { index: 0, timestamp: [900, 901], text: 'ရပ်လိုက်။' },
    { index: 1, timestamp: [902, 903], text: 'သူ ထွက်သွားတယ်။' }
]);

test('Gemini receives text only and program code preserves Whisper timestamps', () => {
    assert.deepEqual(parseStructuredTranslation(response, source), [
        { timestamp: [0, 1], text: 'ရပ်လိုက်။' },
        { timestamp: [1.2, 2.5], text: 'သူ ထွက်သွားတယ်။' }
    ]);
    assert.throws(() => parseStructuredTranslation(JSON.stringify([
        { index: 1, text: 'x' },
        { index: 0, text: 'y' }
    ]), source), /order mismatch/);
    assert.throws(() => parseStructuredTranslation('[]', source), /record count/);
});

test('malformed structured responses retry within the bounded limit', async () => {
    const requests = [];
    const replies = ['not-json', '[]', response];
    const result = await translateTranscriptWithGemini({
        sourceRecords: source, apiKey: 'test', sourceFingerprint: 'source-a',
        model: 'test-model', settings: { instruction: 'translate', colloquialMode: false },
        generateContent: async request => { requests.push(request); return { text: replies.shift() }; },
        sleep: async () => {}
    });
    assert.equal(requests.length, 3);
    assert.equal(requests[0].config.responseMimeType, 'application/json');
    assert.ok(requests[0].config.responseSchema);
    assert.doesNotMatch(requests[0].contents[0].parts[0].text, /"timestamp"/);
    assert.deepEqual(result.map(item => item.timestamp), source.map(item => item.timestamp));
});

test('translation cache invalidates source transcript and settings changes', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'translation-cache-'));
    const cachePath = path.join(directory, 'burmese-transcript.json');
    let calls = 0;
    const generateContent = async () => { calls++; return { text: response }; };
    const base = {
        sourceRecords: source, cachePath, apiKey: 'test', sourceFingerprint: 'source-a',
        model: 'test-model', generateContent, sleep: async () => {}
    };
    try {
        await translateTranscriptWithGemini({ ...base, settings: { instruction: 'a', colloquialMode: false } });
        await translateTranscriptWithGemini({ ...base, settings: { instruction: 'a', colloquialMode: false } });
        assert.equal(calls, 1);
        await translateTranscriptWithGemini({ ...base, settings: { instruction: 'b', colloquialMode: true } });
        assert.equal(calls, 2);
        await translateTranscriptWithGemini({ ...base, sourceFingerprint: 'source-b', settings: { instruction: 'b', colloquialMode: true } });
        assert.equal(calls, 3);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('400/403 translation errors are not retried while 429 remains bounded and retryable', async () => {
    let forbiddenCalls = 0;
    await assert.rejects(translateTranscriptWithGemini({
        sourceRecords: source, apiKey: 'test', sourceFingerprint: 'source-a',
        model: 'test-model', settings: { instruction: 'translate' },
        generateContent: async () => {
            forbiddenCalls += 1;
            throw Object.assign(new Error('403 permission denied'), { status: 403 });
        },
        sleep: async () => {}
    }), /translation failed/);
    assert.equal(forbiddenCalls, 1);

    let quotaCalls = 0;
    await assert.rejects(translateTranscriptWithGemini({
        sourceRecords: source, apiKey: 'test', sourceFingerprint: 'source-a',
        model: 'test-model', settings: { instruction: 'translate' },
        generateContent: async () => {
            quotaCalls += 1;
            throw Object.assign(new Error('429 quota'), { status: 429 });
        },
        sleep: async () => {}
    }), error => error.code === 'GEMINI_AVAILABILITY_EXHAUSTED');
    assert.equal(quotaCalls, 3);
});
