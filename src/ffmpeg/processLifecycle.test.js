import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { runFFmpeg } from './index.js';

const fakeChild = () => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.signals = [];
    child.kill = signal => {
        child.killed = true;
        child.signals.push(signal);
    };
    return child;
};

test('FFmpeg cancellation terminates the child and rejects with ABORT_ERR', async () => {
    const child = fakeChild();
    const controller = new AbortController();
    const pending = runFFmpeg(['-version'], process.cwd(), null, 10000, {
        signal: controller.signal,
        spawnImpl: () => child
    });
    controller.abort();
    await assert.rejects(() => pending, error => error.code === 'ABORT_ERR');
    assert.deepEqual(child.signals, ['SIGTERM']);
});

test('FFmpeg timeout terminates the child process', async () => {
    const child = fakeChild();
    await assert.rejects(() => runFFmpeg(['-version'], process.cwd(), null, 1, {
        spawnImpl: () => child
    }), /timed out/);
    assert.deepEqual(child.signals, ['SIGTERM']);
});
