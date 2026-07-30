import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EdgeTtsEmptyAudioError, synthesizeEdgeTts } from './edgeTtsRequest.js';

class FakeSocket extends EventEmitter {
    constructor(messages) {
        super();
        this.messages = messages;
        this.readyState = 1;
    }
    send() {
        setImmediate(() => {
            for (const [data, isBinary] of this.messages) this.emit('message', data, isBinary);
        });
    }
    close() {
        this.readyState = 3;
        setImmediate(() => this.emit('close', 1000, Buffer.from('normal')));
    }
    terminate() { this.close(); }
}

const clientFor = messages => ({
    timeout: 1000,
    lang: 'my-MM',
    voice: 'my-MM-ThihaNeural',
    rate: '+35%',
    pitch: '+0Hz',
    volume: 'default',
    saveSubtitles: false,
    _connectWebSocket: async () => new FakeSocket(messages)
});

test('rejects turn.end with zero binary audio and preserves service diagnostics', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-empty-'));
    const output = path.join(dir, 'empty.wav');
    const response = 'Path:response\r\n\r\n{"status":"throttled"}';
    try {
        await assert.rejects(
            synthesizeEdgeTts(clientFor([
                [Buffer.from(response), false],
                [Buffer.from('Path:turn.end\r\n'), false]
            ]), 'စာသား', output),
            error => {
                assert.ok(error instanceof EdgeTtsEmptyAudioError);
                assert.equal(error.diagnostics.audioFrameCount, 0);
                assert.equal(error.diagnostics.receivedBytes, 0);
                assert.equal(error.diagnostics.closeCode, 1000);
                assert.equal(error.diagnostics.closeReason, 'normal');
                assert.deepEqual(error.diagnostics.serviceResponses, [response]);
                return true;
            }
        );
        assert.equal(fs.statSync(output).size, 0);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('accepts a turn only after receiving a non-empty audio payload', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-audio-'));
    const output = path.join(dir, 'audio.wav');
    const payload = Buffer.from([1, 2, 3, 4]);
    try {
        const diagnostics = await synthesizeEdgeTts(clientFor([
            [Buffer.concat([Buffer.from('Path:audio\r\n'), payload]), true],
            [Buffer.from('Path:turn.end\r\n'), false]
        ]), 'စာသား', output);
        assert.equal(diagnostics.audioFrameCount, 1);
        assert.equal(diagnostics.receivedBytes, payload.length);
        assert.equal(diagnostics.closeCode, 1000);
        assert.equal(diagnostics.closeReason, 'normal');
        assert.deepEqual(fs.readFileSync(output), payload);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('explicit abort terminates an in-flight Edge TTS request', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-abort-'));
    const output = path.join(dir, 'audio.wav');
    const socket = new FakeSocket([]);
    const controller = new AbortController();
    try {
        const pending = synthesizeEdgeTts({
            ...clientFor([]),
            _connectWebSocket: async () => socket
        }, 'စာသား', output, { signal: controller.signal });
        await new Promise(resolve => setImmediate(resolve));
        controller.abort();
        await assert.rejects(pending, error =>
            error.name === 'AbortError' && error.code === 'ABORT_ERR');
        assert.equal(socket.readyState, 3);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
