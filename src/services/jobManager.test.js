import test from 'node:test';
import assert from 'node:assert/strict';
import { createJob, getJob, deleteJob, getJobKeys, listJobs, setJobKeys } from './jobManager.js';

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

test('jobs retain owner boundaries and encrypted resumable credentials', () => {
    createJob('owned-job', {
        ownerUid: 'user-1', videoPath: '/tmp/video', audioPath: null
    });
    setJobKeys('owned-job', { geminiApiKey: 'private-key' });
    assert.equal(getJob('owned-job').ownerUid, 'user-1');
    assert.equal(getJobKeys('owned-job').geminiApiKey, 'private-key');
    assert.deepEqual(listJobs({ ownerUid: 'user-2' }), []);
    assert.deepEqual(listJobs({ ownerUid: 'user-1' }).map(job => job.id), ['owned-job']);
    deleteJob('owned-job');
});
