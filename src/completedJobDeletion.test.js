import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getCompletedJobDeletionError,
    removeCompletedJobId,
    requestCompletedJobDeletion
} from './completedJobDeletion.js';

test('asks for confirmation before issuing a completed-job delete request', async () => {
    let requests = 0;
    const deleted = await requestCompletedJobDeletion({
        jobId: 'job-1',
        confirmDeletion: () => false,
        deleteRequest: async () => { requests++; }
    });
    assert.equal(deleted, false);
    assert.equal(requests, 0);
});

test('reports success only after backend deletion resolves', async () => {
    const events = [];
    const deletion = requestCompletedJobDeletion({
        jobId: 'job-1',
        confirmDeletion: () => true,
        deleteRequest: async () => {
            events.push('request');
            await Promise.resolve();
            events.push('success');
        }
    });
    events.push('ui-still-present');
    assert.equal(await deletion, true);
    assert.deepEqual(events, ['request', 'ui-still-present', 'success']);
});

test('keeps the UI record when backend deletion fails and exposes its error', async () => {
    const error = Object.assign(new Error('network failure'), {
        response: { data: { error: 'Completed output could not be deleted.' } }
    });
    await assert.rejects(
        requestCompletedJobDeletion({
            jobId: 'job-1',
            confirmDeletion: () => true,
            deleteRequest: async () => { throw error; }
        }),
        error
    );
    assert.deepEqual(removeCompletedJobId(['job-1', 'job-2'], 'job-x'), ['job-1', 'job-2']);
    assert.equal(getCompletedJobDeletionError(error), 'Completed output could not be deleted.');
});

test('removes only the selected job ID after successful deletion', () => {
    assert.deepEqual(
        removeCompletedJobId(['job-1', 'job-2', 'job-3'], 'job-2'),
        ['job-1', 'job-3']
    );
});
