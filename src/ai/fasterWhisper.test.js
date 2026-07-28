import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    formatFasterWhisperStartupConfig,
    getFasterWhisperRuntimeConfig,
    invokeFasterWhisper,
    transcribeWithFasterWhisper,
    validateSourceTranscript
} from './fasterWhisper.js';

test('Railway CPU defaults use small int8 with one worker and bounded detected threads', () => {
    const defaults = getFasterWhisperRuntimeConfig({}, 8);
    assert.equal(defaults.model, 'small');
    assert.equal(defaults.device, 'cpu');
    assert.equal(defaults.computeType, 'int8');
    assert.equal(defaults.cpuThreads, 4);
    assert.equal(defaults.numWorkers, 1);
    assert.equal(defaults.beamSize, 3);
    assert.match(formatFasterWhisperStartupConfig(defaults), /model=small device=cpu compute_type=int8/);
});

test('Railway CPU variables override defaults without oversubscribing detected CPUs', () => {
    const configured = getFasterWhisperRuntimeConfig({
        WHISPER_MODEL: 'small',
        WHISPER_DEVICE: 'cpu',
        WHISPER_COMPUTE_TYPE: 'int8',
        WHISPER_CPU_THREADS: '16',
        WHISPER_NUM_WORKERS: '8',
        WHISPER_BEAM_SIZE: '5',
        OMP_NUM_THREADS: '12',
        HF_HOME: '/data/models'
    }, 2);
    assert.equal(configured.cpuThreads, 2);
    assert.equal(configured.numWorkers, 2);
    assert.equal(configured.ompNumThreads, 2);
    assert.equal(configured.beamSize, 5);
    assert.equal(configured.cacheDirectory, '/data/models');
});

const fakeChild = ({ stdout = '', stderr = '', code = 0, close = true } = {}) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = undefined;
    child.killed = false;
    child.killSignals = [];
    child.kill = signal => { child.killed = true; child.killSignals.push(signal); };
    queueMicrotask(() => {
        if (stdout) child.stdout.emit('data', Buffer.from(stdout));
        if (stderr) child.stderr.emit('data', Buffer.from(stderr));
        if (close) child.emit('close', code);
    });
    return child;
};

test('successfully invokes Faster-Whisper through the resolved Python interpreter', async () => {
    const calls = [];
    const records = await invokeFasterWhisper({
        wavPath: '/tmp/source.wav', scriptPath: '/tmp/transcribe.py', duration: 3,
        pythonCandidates: ['/python'], timeoutMs: 1000,
        spawnImpl: (command, args, options) => {
            calls.push({ command, args, options });
            return fakeChild({ stdout: '[{"timestamp":[0,1.5],"text":"hello"}]' });
        }
    });
    assert.deepEqual(records, [{ timestamp: [0, 1.5], text: 'hello' }]);
    assert.equal(calls[0].command, '/python');
    assert.deepEqual(calls[0].args, ['/tmp/transcribe.py', '/tmp/source.wav']);
    assert.equal(calls[0].options.stdio[0], 'ignore');
});

test('rejects malformed Python JSON and non-zero exits', async () => {
    await assert.rejects(() => invokeFasterWhisper({
        wavPath: 'source.wav', scriptPath: 'transcribe.py', duration: 3,
        pythonCandidates: ['python3'], timeoutMs: 1000,
        spawnImpl: () => fakeChild({ stdout: 'not-json' })
    }), /malformed JSON/);
    await assert.rejects(() => invokeFasterWhisper({
        wavPath: 'source.wav', scriptPath: 'transcribe.py', duration: 3,
        pythonCandidates: ['python3'], timeoutMs: 1000,
        spawnImpl: () => fakeChild({ stderr: 'model failed', code: 7 })
    }), /exited with code 7: model failed/);
});

test('timeout and cancellation terminate the transcription child', async () => {
    const timedOutChild = fakeChild({ close: false });
    await assert.rejects(() => invokeFasterWhisper({
        wavPath: 'source.wav', scriptPath: 'transcribe.py', duration: 3,
        pythonCandidates: ['python3'], timeoutMs: 5, spawnImpl: () => timedOutChild
    }), error => error.code === 'ETIMEDOUT');
    assert.deepEqual(timedOutChild.killSignals, ['SIGTERM']);

    const controller = new AbortController();
    const cancelledChild = fakeChild({ close: false });
    const pending = invokeFasterWhisper({
        wavPath: 'source.wav', scriptPath: 'transcribe.py', duration: 3,
        pythonCandidates: ['python3'], timeoutMs: 1000, signal: controller.signal,
        spawnImpl: () => cancelledChild
    });
    controller.abort();
    await assert.rejects(() => pending, error => error.code === 'ABORT_ERR');
    assert.deepEqual(cancelledChild.killSignals, ['SIGTERM']);
});

test('strictly validates order, overlap, ranges, and real WAV duration', () => {
    assert.deepEqual(validateSourceTranscript([
        { timestamp: [0, 1], text: ' first ' },
        { timestamp: [1.2, 2], text: 'second' }
    ], 2), [
        { timestamp: [0, 1], text: 'first' },
        { timestamp: [1.2, 2], text: 'second' }
    ]);
    assert.throws(() => validateSourceTranscript([{ timestamp: [1, 1], text: 'x' }], 2), /invalid range/);
    assert.throws(() => validateSourceTranscript([
        { timestamp: [0, 1.2], text: 'x' }, { timestamp: [1, 2], text: 'y' }
    ], 2), /overlaps/);
    assert.throws(() => validateSourceTranscript([{ timestamp: [0, 2.1], text: 'x' }], 2), /exceeds/);
});

test('source transcript cache invalidates workflow, source, and algorithm mismatches', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'faster-whisper-cache-'));
    const cachePath = path.join(directory, 'source-transcript.json');
    let invocations = 0;
    const invoke = async () => { invocations++; return [{ timestamp: [0, 1], text: 'fresh' }]; };
    try {
        await transcribeWithFasterWhisper({ wavPath: 'unused', cachePath, duration: 1, sourceFingerprint: 'a', invoke });
        assert.equal(invocations, 1);
        await transcribeWithFasterWhisper({ wavPath: 'unused', cachePath, duration: 1, sourceFingerprint: 'a', invoke });
        assert.equal(invocations, 1);
        await transcribeWithFasterWhisper({ wavPath: 'unused', cachePath, duration: 1, sourceFingerprint: 'b', invoke });
        assert.equal(invocations, 2);
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        cached.workflowVersion = 1;
        fs.writeFileSync(cachePath, JSON.stringify(cached));
        await transcribeWithFasterWhisper({ wavPath: 'unused', cachePath, duration: 1, sourceFingerprint: 'b', invoke });
        assert.equal(invocations, 3);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
