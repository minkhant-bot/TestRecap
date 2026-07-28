import assert from 'node:assert/strict';
import test from 'node:test';
import {
    GeminiAvailabilityError,
    getGeminiErrorStatus,
    getGeminiRetryDelayMs,
    isRetryableGeminiError,
    translateTranscriptWithGemini
} from './geminiTranslation.js';

const source = [{ timestamp: [0, 1], text: 'Hello' }];
const success = JSON.stringify([
    { index: 0, timestamp: [0, 1], text: 'မင်္ဂလာပါ', kind: 'dialogue', speaker: 'speaker_1' }
]);
const request = overrides => translateTranscriptWithGemini({
    sourceRecords: source,
    apiKey: 'test',
    sourceFingerprint: 'source',
    model: 'test-model',
    settings: { instruction: 'translate', colloquialMode: false },
    sleep: async () => {},
    random: () => 0.5,
    ...overrides
});

test('Gemini status parsing recognizes numeric and message-only HTTP statuses', () => {
    assert.equal(getGeminiErrorStatus({ status: 404 }), 404);
    assert.equal(getGeminiErrorStatus({
        message: '{"error":{"code":404,"status":"NOT_FOUND"}}'
    }), 404);
    assert.equal(getGeminiErrorStatus({
        message: 'NOT_FOUND: requested model failed with code 404'
    }), 404);
    assert.equal(getGeminiErrorStatus({ message: 'NOT_FOUND without an HTTP status' }), null);
    for (const status of [429, 500, 502, 503, 504]) {
        assert.equal(getGeminiErrorStatus({ message: `${status} service response` }), status);
    }
});

test('429, 500, 502, 503, and 504 are retryable Gemini availability errors', () => {
    for (const status of [429, 500, 502, 503, 504]) {
        assert.equal(isRetryableGeminiError({ status }), true);
    }
    assert.equal(isRetryableGeminiError({ status: 400 }), false);
    assert.equal(isRetryableGeminiError({ status: 'UNAVAILABLE' }), true);
    assert.equal(isRetryableGeminiError({ message: '503 UNAVAILABLE' }), true);
});

test('503 retries with bounded exponential jitter and a later attempt succeeds', async () => {
    let calls = 0;
    const delays = [];
    const messages = [];
    const result = await request({
        generateContent: async () => {
            calls += 1;
            if (calls < 3) throw Object.assign(new Error('503 UNAVAILABLE'), { status: 503 });
            return { text: success };
        },
        sleep: async delay => delays.push(delay),
        onRetry: retry => messages.push(retry.message)
    });
    assert.equal(calls, 3);
    assert.deepEqual(delays, [500, 1000]);
    assert.deepEqual(messages, [
        'Gemini is busy. Retrying translation…',
        'Gemini is busy. Retrying translation…'
    ]);
    assert.equal(result[0].text, 'မင်္ဂလာပါ');
    assert.ok(getGeminiRetryDelayMs(20, () => 1) <= 12000);
});

test('exhausted 503 retries produce a retryable translate-only error', async () => {
    let calls = 0;
    await assert.rejects(() => request({
        generateContent: async () => {
            calls += 1;
            throw Object.assign(new Error('service unavailable'), { response: { status: 503 } });
        }
    }), error => {
        assert.ok(error instanceof GeminiAvailabilityError);
        assert.equal(error.retryable, true);
        assert.equal(error.resumeStage, 'translate_burmese');
        return true;
    });
    assert.equal(calls, 3);
});
