import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { sweepExpiredCompletedJobs } from './cleanup.js';
import { createJob, deleteJob, getJob, updateJob } from './jobManager.js';

const EXPIRED_ID = '11111111-1111-4111-8111-111111111111';
const CURRENT_ID = '22222222-2222-4222-8222-222222222222';

test('expiration cleanup removes only the selected expired completed job', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expiration-cleanup-'));
    for (const id of [EXPIRED_ID, CURRENT_ID]) {
        createJob(id, { videoPath: null, audioPath: null });
        updateJob(id, {
            status: 'complete',
            completed_at: id === EXPIRED_ID ? 1 : Date.now(),
            stageId: 'done'
        });
        fs.mkdirSync(path.join(root, 'public', 'output'), { recursive: true });
        fs.mkdirSync(path.join(root, 'data', 'cache', id), { recursive: true });
        fs.writeFileSync(path.join(root, 'public', 'output', `${id}.mp4`), 'video');
        fs.writeFileSync(path.join(root, 'public', 'output', `${id}.mp3`), 'audio');
    }
    try {
        const swept = sweepExpiredCompletedJobs({ now: Date.now(), maxAgeMs: 1000, projectRoot: root });
        assert.equal(swept, 1);

        // Expired -- record kept (not deleted) so a direct link can report
        // "Expired", but marked and stripped of media links; artifacts gone.
        const expiredJob = getJob(EXPIRED_ID);
        assert.notEqual(expiredJob, null);
        assert.equal(expiredJob.expired, true);
        assert.equal(typeof expiredJob.expiredAt, 'string');
        assert.equal(expiredJob.status, 'complete');
        assert.equal(fs.existsSync(path.join(root, 'public', 'output', `${EXPIRED_ID}.mp4`)), false);
        assert.equal(fs.existsSync(path.join(root, 'public', 'output', `${EXPIRED_ID}.mp3`)), false);

        // Not yet expired -- fully untouched.
        const currentJob = getJob(CURRENT_ID);
        assert.notEqual(currentJob, null);
        assert.equal(Boolean(currentJob.expired), false);
        assert.equal(fs.existsSync(path.join(root, 'public', 'output', `${CURRENT_ID}.mp4`)), true);

        // Idempotent / restart-safe: re-running the sweep must not error,
        // must not re-report the already-expired job, and must not touch
        // the (already-deleted) artifacts again.
        const secondSweep = sweepExpiredCompletedJobs({ now: Date.now(), maxAgeMs: 1000, projectRoot: root });
        assert.equal(secondSweep, 0);
        assert.deepEqual(getJob(EXPIRED_ID), expiredJob);
    } finally {
        deleteJob(EXPIRED_ID);
        deleteJob(CURRENT_ID);
    }
});
