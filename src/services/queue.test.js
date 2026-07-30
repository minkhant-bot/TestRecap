import assert from 'node:assert/strict';
import test from 'node:test';
import { createJob, deleteJob, getJob } from './jobManager.js';
import { cancelQueuedJob, getQueueSnapshot } from './queue.js';

test('persistent queue snapshot is FIFO with concurrency one', async () => {
    createJob('fifo-a', { ownerUid: 'u', videoPath: '/tmp/a', audioPath: null });
    await new Promise(resolve => setTimeout(resolve, 2));
    createJob('fifo-b', { ownerUid: 'u', videoPath: '/tmp/b', audioPath: null });
    const snapshot = getQueueSnapshot();
    assert.equal(snapshot.concurrency, 1);
    assert.deepEqual(
        snapshot.queued.filter(item => item.jobId.startsWith('fifo-')).map(item => item.jobId),
        ['fifo-a', 'fifo-b']
    );
    deleteJob('fifo-a');
    deleteJob('fifo-b');
});

test('queued jobs can be cancelled without entering processing', () => {
    createJob('cancel-me', { ownerUid: 'u', videoPath: '/tmp/c', audioPath: null });
    assert.deepEqual(cancelQueuedJob('cancel-me'), { cancelled: true });
    assert.equal(getJob('cancel-me').status, 'cancelled');
    deleteJob('cancel-me');
});
