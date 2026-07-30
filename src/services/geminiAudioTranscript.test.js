import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { GoogleGenAI } from '@google/genai';
import { runFFmpeg } from '../ffmpeg/index.js';
import {
    createGeminiAudioTranscript,
    GEMINI_AUDIO_PROMPT,
    GEMINI_AUDIO_RESPONSE_SCHEMA,
    getGeminiTranscriptPaths,
    validateGeminiTranscript
} from './geminiAudioTranscript.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testrecap-gemini-audio-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const createWav = async (duration = 1) => {
    const directory = fs.mkdtempSync(path.join(root, 'wav-'));
    const output = path.join(directory, 'audio.wav');
    await runFFmpeg([
        '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration}`,
        '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', output
    ], directory, null, 60000);
    return output;
};

const validSegments = duration => [{
    start_time: 0,
    end_time: Math.min(0.8, duration),
    speaker: 'Speaker 1',
    type: 'dialogue',
    original_text: 'Hello',
    burmese_text: 'မင်္ဂလာပါ'
}];

const createCalls = ({ segments, responseText, uploadedState = 'ACTIVE' }) => {
    const calls = { uploads: 0, generates: 0, deletes: 0, requests: [] };
    return {
        calls,
        uploadFile: async () => {
            calls.uploads += 1;
            return {
                name: 'files/test-audio',
                uri: 'https://files.example/audio',
                mimeType: 'audio/wav',
                state: uploadedState
            };
        },
        getFile: async () => ({
            name: 'files/test-audio',
            uri: 'https://files.example/audio',
            mimeType: 'audio/wav',
            state: 'ACTIVE'
        }),
        deleteFile: async () => { calls.deletes += 1; },
        listModels: async () => [{
            name: 'models/gemini-2.5-flash',
            supportedActions: ['generateContent']
        }],
        generateContent: async request => {
            calls.generates += 1;
            calls.requests.push(request);
            return { text: responseText ?? JSON.stringify(segments) };
        }
    };
};

test('short WAV uses one structured Gemini request and persists validated JSON', async () => {
    const audioPath = await createWav(1);
    const mocks = createCalls({ segments: validSegments(1) });
    const result = await createGeminiAudioTranscript({
        audioPath,
        apiKey: 'test-key',
        model: 'test-flash',
        ...mocks
    });
    assert.equal(mocks.calls.generates, 1);
    assert.equal(mocks.calls.deletes, 1);
    assert.equal(result.segmentCount, 1);
    assert.ok(fs.existsSync(result.transcriptPath));
    const artifact = JSON.parse(fs.readFileSync(result.transcriptPath, 'utf8'));
    assert.equal(artifact.model, 'test-flash');
    assert.deepEqual(artifact.segments, validSegments(1));
    const request = mocks.calls.requests[0];
    assert.equal(request.config.responseMimeType, 'application/json');
    assert.deepEqual(request.config.responseSchema, GEMINI_AUDIO_RESPONSE_SCHEMA);
    assert.equal(request.config.temperature, 0);
    assert.match(request.contents[0].parts[1].text, /no markdown/i);
    assert.equal(request.contents[0].parts[1].text, GEMINI_AUDIO_PROMPT);
});

test('long WAV follows the same single-request contract', async () => {
    const audioPath = await createWav(12);
    const mocks = createCalls({ segments: [{
        ...validSegments(12)[0],
        end_time: 11.5
    }] });
    const result = await createGeminiAudioTranscript({ audioPath, apiKey: 'test-key', ...mocks });
    assert.equal(result.segmentCount, 1);
    assert.equal(mocks.calls.generates, 1);
});

test('strict validation rejects empty, missing, overlapping, and invalid translations', () => {
    assert.throws(() => validateGeminiTranscript([], 10), /empty/);
    assert.throws(() => validateGeminiTranscript([{
        end_time: 1, type: 'narration', original_text: 'a', burmese_text: 'က'
    }], 10), /timestamps/);
    assert.throws(() => validateGeminiTranscript([
        { start_time: 0, end_time: 2, type: 'narration', original_text: 'a', burmese_text: 'က' },
        { start_time: 1, end_time: 3, type: 'narration', original_text: 'b', burmese_text: 'ခ' }
    ], 10), /overlaps/);
    assert.throws(() => validateGeminiTranscript([{
        start_time: 0, end_time: 1, type: 'narration', original_text: 'a', burmese_text: ''
    }], 10), /Burmese/);
});

test('invalid JSON and empty Gemini responses fail without leaving transcript artifacts', async () => {
    for (const responseText of ['not-json', '[]']) {
        const audioPath = await createWav(1);
        const mocks = createCalls({ responseText });
        await assert.rejects(
            () => createGeminiAudioTranscript({ audioPath, apiKey: 'test-key', ...mocks }),
            /invalid transcript JSON|empty/
        );
        const paths = getGeminiTranscriptPaths(audioPath);
        assert.equal(fs.existsSync(paths.partialPath), false);
        assert.equal(fs.existsSync(paths.transcriptPath), false);
    }
});

test('empty and corrupted WAV files fail before any Gemini request', async () => {
    for (const contents of [Buffer.alloc(0), Buffer.from('corrupt')]) {
        const directory = fs.mkdtempSync(path.join(root, 'invalid-'));
        const audioPath = path.join(directory, 'audio.wav');
        fs.writeFileSync(audioPath, contents);
        const mocks = createCalls({ segments: validSegments(1) });
        await assert.rejects(() => createGeminiAudioTranscript({
            audioPath, apiKey: 'test-key', ...mocks
        }));
        assert.equal(mocks.calls.uploads, 0);
        assert.equal(mocks.calls.generates, 0);
    }
});

test('API failure, timeout, and cancellation clean temporary transcript state', async () => {
    const failedAudio = await createWav(1);
    const failed = createCalls({ segments: validSegments(1) });
    failed.generateContent = async () => { throw new Error('service unavailable'); };
    await assert.rejects(() => createGeminiAudioTranscript({
        audioPath: failedAudio, apiKey: 'test-key', ...failed
    }), /service unavailable/);

    const timeoutAudio = await createWav(1);
    const timeoutMocks = createCalls({ segments: validSegments(1), uploadedState: 'PROCESSING' });
    await assert.rejects(() => createGeminiAudioTranscript({
        audioPath: timeoutAudio,
        apiKey: 'test-key',
        timeoutMs: 10,
        ...timeoutMocks
    }), /timed out/);

    const cancelledAudio = await createWav(1);
    const controller = new AbortController();
    const cancelled = createCalls({ segments: validSegments(1) });
    cancelled.generateContent = request => new Promise((resolve, reject) => {
        request.config.abortSignal.addEventListener('abort', () => reject(
            Object.assign(new Error('cancelled'), { name: 'AbortError' })
        ), { once: true });
    });
    const pending = createGeminiAudioTranscript({
        audioPath: cancelledAudio,
        apiKey: 'test-key',
        signal: controller.signal,
        ...cancelled
    });
    controller.abort();
    await assert.rejects(() => pending, error => error.name === 'AbortError');
    for (const audioPath of [failedAudio, timeoutAudio, cancelledAudio]) {
        const paths = getGeminiTranscriptPaths(audioPath);
        assert.equal(fs.existsSync(paths.partialPath), false);
        assert.equal(fs.existsSync(paths.transcriptPath), false);
    }
});

test('official SDK file upload uses the non-duplicated upload endpoint and resumable headers', async () => {
    const audioPath = await createWav(1);
    const originalFetch = globalThis.fetch;
    let captured;
    globalThis.fetch = async (url, init) => {
        captured = {
            url: String(url),
            method: init?.method,
            headers: Object.fromEntries(new Headers(init?.headers).entries())
        };
        return new Response('diagnostic stop', { status: 418 });
    };
    try {
        const ai = new GoogleGenAI({ apiKey: 'test-key' });
        await assert.rejects(() => ai.files.upload({
            file: audioPath,
            config: {
                mimeType: 'audio/wav',
                displayName: 'test-upload',
                abortSignal: new AbortController().signal
            }
        }));
    } finally {
        globalThis.fetch = originalFetch;
    }
    assert.equal(
        captured.url,
        'https://generativelanguage.googleapis.com/upload/v1beta/files'
    );
    assert.equal(captured.method, 'POST');
    assert.equal(captured.headers['x-goog-upload-protocol'], 'resumable');
    assert.equal(captured.headers['x-goog-upload-command'], 'start');
    assert.equal(captured.headers['x-goog-upload-header-content-type'], 'audio/wav');
});
