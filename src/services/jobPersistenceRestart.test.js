import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const moduleUrl = new URL('./jobManager.js', import.meta.url).href;

const run = (statePath, source) => execFileSync(process.execPath, [
    '--input-type=module', '--eval', source
], {
    cwd: process.cwd(),
    env: { ...process.env, JOB_STORE_PATH: statePath, JOB_MANAGER_MODULE_URL: moduleUrl },
    encoding: 'utf8'
}).trim();

test('queued workflow-v3 jobs and encrypted BYOK credentials survive restart', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-queue-'));
    const statePath = path.join(root, 'saas-state.json');
    try {
        run(statePath, `
            const store = await import(process.env.JOB_MANAGER_MODULE_URL);
            store.createJob('restart-job', {
                ownerUid: 'owner-1', videoPath: '/tmp/video.mp4', audioPath: null
            });
            store.setJobKeys('restart-job', { geminiApiKey: 'secret-value' });
            store.updateJob('restart-job', { status: 'processing' });
        `);
        const restored = JSON.parse(run(statePath, `
            const store = await import(process.env.JOB_MANAGER_MODULE_URL);
            const recovered = store.recoverStuckJobs();
            console.log(JSON.stringify({
                recovered,
                job: store.getJob('restart-job'),
                key: store.getJobKeys('restart-job').geminiApiKey,
                queued: store.getQueuedJobs().map(job => job.id)
            }));
        `));
        assert.deepEqual(restored.recovered, ['restart-job']);
        assert.equal(restored.job.status, 'queued');
        assert.equal(restored.job.ownerUid, 'owner-1');
        assert.equal(restored.key, 'secret-value');
        assert.deepEqual(restored.queued, ['restart-job']);
        assert.doesNotMatch(fs.readFileSync(statePath, 'utf8'), /secret-value/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
