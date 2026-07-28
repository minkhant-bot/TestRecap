import test from 'node:test';
import assert from 'node:assert/strict';
import { createJob, getJob, deleteJob } from './jobManager.js';

test('keeps a legacy mode readable without requiring one', () => {
    createJob('mode-dialogue', { videoPath: '/tmp/video', audioPath: null, mode: 'dialogue' });
    assert.equal(getJob('mode-dialogue').mode, 'dialogue');
    deleteJob('mode-dialogue');
});

test('new unified jobs do not contain mode', () => {
    createJob('mode-legacy', { videoPath: '/tmp/video', audioPath: null });
    assert.equal(Object.hasOwn(getJob('mode-legacy'), 'mode'), false);
    deleteJob('mode-legacy');
});
