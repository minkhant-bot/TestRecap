import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import apiRoutes from './api.js';
import { createJob, deleteJob, updateJob } from '../services/jobManager.js';

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

    const { server, baseUrl } = await startTestServer();
    try {
        const deletion = await fetch(`${baseUrl}/api/jobs/${selectedId}`, { method: 'DELETE' });
        assert.equal(deletion.status, 200);
        assert.deepEqual(await deletion.json(), { deleted: true, jobId: selectedId });
        assert.ok(selectedPaths.every(target => !fs.existsSync(target)));

        const reload = await fetch(`${baseUrl}/api/completed-jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
    }
});

test('DELETE route blocks an active job even if an output file exists', async () => {
    const jobId = randomUUID();
    const outputPath = path.join(process.cwd(), 'public', 'output', `${jobId}.mp4`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, 'active output');
    createJob(jobId, { videoPath: null, audioPath: null, originalFilename: 'active.mp4' });
    updateJob(jobId, { status: 'processing' });
    const { server, baseUrl } = await startTestServer();
    try {
        const response = await fetch(`${baseUrl}/api/jobs/${jobId}`, { method: 'DELETE' });
        assert.equal(response.status, 409);
        assert.match((await response.json()).error, /Only completed jobs/);
        assert.equal(fs.existsSync(outputPath), true);
    } finally {
        await new Promise(resolve => server.close(resolve));
        deleteJob(jobId);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
});
