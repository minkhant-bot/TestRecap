import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import apiRoutes from './api.js';
import { createJob, deleteJob, updateJob } from '../services/jobManager.js';
import { setAuthVerifierForTests } from '../middleware/auth.js';

const OWNER_UID = 'route-test-owner';
const authHeaders = { Cookie: '__session=route-test-session' };
setAuthVerifierForTests(async () => ({
    uid: OWNER_UID,
    displayName: 'Route Test',
    email: 'route@example.com',
    role: 'user',
    status: 'active',
    createdAt: null,
    lastLogin: null
}));

const startTestServer = async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', apiRoutes);
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    return {
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`
    };
};

test('DELETE removes a durable completed output after restart and reload keeps other jobs', async () => {
    const selectedId = randomUUID();
    const otherId = randomUUID();
    const outputRoot = path.join(process.cwd(), 'public', 'output');
    const cacheRoot = path.join(process.cwd(), 'data', 'cache');
    const temporaryRoot = path.join(process.cwd(), 'src', 'tmp');
    const selectedPaths = [
        path.join(outputRoot, `${selectedId}.mp4`),
        path.join(outputRoot, `${selectedId}.mp3`),
        path.join(cacheRoot, selectedId),
        path.join(temporaryRoot, `${selectedId}_final.mp4`)
    ];
    const otherPaths = [
        path.join(outputRoot, `${otherId}.mp4`),
        path.join(cacheRoot, otherId)
    ];
    fs.mkdirSync(selectedPaths[2], { recursive: true });
    fs.mkdirSync(otherPaths[1], { recursive: true });
    for (const file of [
        selectedPaths[0],
        selectedPaths[1],
        path.join(selectedPaths[2], 'translated_transcript.json'),
        path.join(selectedPaths[2], 'narration_tts.wav.timeline.json'),
        selectedPaths[3],
        otherPaths[0],
        path.join(otherPaths[1], 'state.json')
    ]) fs.writeFileSync(file, 'test artifact');
    createJob(selectedId, { ownerUid: OWNER_UID, videoPath: null, audioPath: null, originalFilename: 'selected.mp4' });
    updateJob(selectedId, { status: 'complete', completed_at: Date.now() });
    createJob(otherId, { ownerUid: OWNER_UID, videoPath: null, audioPath: null, originalFilename: 'other.mp4' });
    updateJob(otherId, { status: 'complete', completed_at: Date.now() });

    const { server, baseUrl } = await startTestServer();
    try {
        const deletion = await fetch(`${baseUrl}/api/jobs/${selectedId}`, {
            method: 'DELETE', headers: authHeaders
        });
        assert.equal(deletion.status, 200);
        assert.deepEqual(await deletion.json(), { deleted: true, jobId: selectedId });
        assert.ok(selectedPaths.every(target => !fs.existsSync(target)));

        const reload = await fetch(`${baseUrl}/api/completed-jobs`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [selectedId, otherId] })
        });
        assert.equal(reload.status, 200);
        assert.deepEqual((await reload.json()).map(job => job.jobId), [otherId]);
        assert.ok(otherPaths.every(target => fs.existsSync(target)));
    } finally {
        await new Promise(resolve => server.close(resolve));
        for (const target of otherPaths) {
            if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
        }
        deleteJob(otherId);
    }
});

test('DELETE route blocks an active job even if an output file exists', async () => {
    const jobId = randomUUID();
    const outputPath = path.join(process.cwd(), 'public', 'output', `${jobId}.mp4`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, 'active output');
    createJob(jobId, { ownerUid: OWNER_UID, videoPath: null, audioPath: null, originalFilename: 'active.mp4' });
    updateJob(jobId, { status: 'processing' });
    const { server, baseUrl } = await startTestServer();
    try {
        const response = await fetch(`${baseUrl}/api/jobs/${jobId}`, {
            method: 'DELETE', headers: authHeaders
        });
        assert.equal(response.status, 409);
        assert.match((await response.json()).error, /Only completed jobs/);
        assert.equal(fs.existsSync(outputPath), true);
    } finally {
        await new Promise(resolve => server.close(resolve));
        deleteJob(jobId);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
});
