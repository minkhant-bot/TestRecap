import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const moduleUrl = new URL('./workspaceJobs.js', import.meta.url).href;
const run = (root, statePath, source) => execFileSync(process.execPath, [
    '--input-type=module', '--eval', source
], {
    cwd: process.cwd(),
    env: {
        ...process.env,
        DATA_DIR: root,
        WORKSPACE_JOB_STORE_PATH: statePath,
        WORKSPACE_JOBS_MODULE_URL: moduleUrl
    },
    encoding: 'utf8'
}).trim();

test('an accepted failed-job retry is rediscovered as one queued job after restart', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-retry-restart-'));
    const statePath = path.join(root, 'workspace-jobs.json');
    const sourcePath = path.join(root, 'uploads', 'workspace', 'retry-job', 'source.mp4');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, 'source');
    try {
        run(root, statePath, `
            const store = await import(process.env.WORKSPACE_JOBS_MODULE_URL);
            store.createWorkspaceJob({
                id: 'retry-job', ownerUid: 'owner', filename: 'retry.mp4',
                fileSize: 6, duration: 1, storedPath: ${JSON.stringify(sourcePath)}
            });
            store.updateWorkspaceJobInternal('retry-job', {
                status: 'failed', stage: 'failed', failedAt: new Date().toISOString()
            });
            store.retryFailedWorkspaceJob('retry-job', 'owner', {
                idempotencyKey: 'restart-key', resumeStage: 'audio_extraction', resumeProgress: 10
            });
        `);
        const restored = JSON.parse(run(root, statePath, `
            const store = await import(process.env.WORKSPACE_JOBS_MODULE_URL);
            const queued = store.listQueuedWorkspaceJobs();
            console.log(JSON.stringify({ queued, internal: store.getWorkspaceJobInternal('retry-job') }));
        `));
        assert.equal(restored.queued.length, 1);
        assert.equal(restored.queued[0].id, 'retry-job');
        assert.equal(restored.queued[0].retry.attempts, 1);
        assert.equal(restored.queued[0].retry.resumeStage, 'audio_extraction');
        assert.equal(restored.internal.retry.lastIdempotencyKey, 'restart-key');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
