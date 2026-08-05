import test from 'node:test';
import assert from 'node:assert/strict';
import { createJob, deleteJob, getJob, recoverStuckJobs, updateJob } from './jobManager.js';
import { WORKFLOW_VERSION } from '../domain/workflow.js';

test('new jobs persist workflow v2, stable stage ID, and queued lifecycle', () => {
    createJob('workflow-v3-job', { videoPath: '/tmp/video', audioPath: null });
    const job = getJob('workflow-v3-job');
    assert.equal(job.workflowVersion, WORKFLOW_VERSION);
    assert.equal(job.stageId, 'upload');
    assert.equal(job.status, 'queued');
    assert.equal(Object.hasOwn(job, 'currentStep'), false);
    deleteJob('workflow-v3-job');
});

test('legacy jobs are made non-resumable with a clear error policy', () => {
    createJob('legacy-workflow-job', { videoPath: '/tmp/video', audioPath: null });
    updateJob('legacy-workflow-job', { workflowVersion: 1, status: 'processing' });
    recoverStuckJobs();
    const job = getJob('legacy-workflow-job');
    assert.equal(job.status, 'error');
    assert.match(job.error, /Legacy workflow job cannot resume/);
    assert.match(job.error, /Start a new job/);
    deleteJob('legacy-workflow-job');
});

test('lifecycle status cannot contain stage display prose', () => {
    createJob('invalid-status-job', { videoPath: '/tmp/video', audioPath: null });
    assert.throws(
        () => updateJob('invalid-status-job', { status: 'Extracting audio' }),
        /Invalid job lifecycle status/
    );
    deleteJob('invalid-status-job');
});
