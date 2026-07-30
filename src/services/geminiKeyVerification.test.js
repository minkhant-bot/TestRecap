import assert from 'node:assert/strict';
import test from 'node:test';
import { clearGeminiModelCacheForTests } from '../ai/geminiModelSelection.js';
import { verifyGeminiApiKey } from './geminiKeyVerification.js';

test('Gemini key verification requires generateContent support', async () => {
    clearGeminiModelCacheForTests();
    const valid = await verifyGeminiApiKey('valid-key', {
        fetchImpl: async () => ({
            ok: true,
            json: async () => ({
                models: [{
                    name: 'models/gemini-2.5-flash',
                    supportedGenerationMethods: ['generateContent']
                }]
            })
        })
    });
    assert.equal(valid.valid, true);
    assert.equal(valid.model, 'gemini-2.5-flash');

    clearGeminiModelCacheForTests();
    const unsupported = await verifyGeminiApiKey('unsupported-key', {
        fetchImpl: async () => ({
            ok: true,
            json: async () => ({ models: [{ supportedGenerationMethods: ['embedContent'] }] })
        })
    });
    assert.equal(unsupported.valid, false);
});

test('invalid and unavailable Gemini key responses remain distinguishable', async () => {
    clearGeminiModelCacheForTests();
    const invalid = await verifyGeminiApiKey('invalid-key', {
        fetchImpl: async () => ({
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            text: async () => JSON.stringify({
                error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid.' }
            })
        })
    });
    assert.equal(invalid.valid, false);
    assert.equal(invalid.retryable, false);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.error, 'API key not valid.');
    assert.equal(invalid.providerError.httpStatusText, 'Bad Request');
    assert.match(invalid.providerError.rawBody, /"INVALID_ARGUMENT"/);
    assert.deepEqual(invalid.providerError.body, {
        error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid.' }
    });

    clearGeminiModelCacheForTests();
    const unavailable = await verifyGeminiApiKey('busy-key', {
        fetchImpl: async () => ({
            ok: false,
            status: 503,
            text: async () => '{"error":{"code":503,"status":"UNAVAILABLE","message":"Service busy."}}'
        })
    });
    assert.equal(unavailable.retryable, true);
    assert.equal(unavailable.error, 'Service busy.');
    assert.equal(unavailable.providerError.body.error.status, 'UNAVAILABLE');
});
