import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testrecap-core-bridge-'));
process.env.DATA_DIR = temporaryRoot;
process.env.JOB_STORE_PATH = path.join(temporaryRoot, 'jobs.json');

const {
    assertCompletedCoreOutput,
    continueWithCorePipeline,
    prepareCorePipelineState
} = await import('./corePipelineBridge.js');
const { createJob, getJob, updateJob } = await import('./jobManager.js');

after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

test('workspace transcript seeds the proven workflow-v2 continuation at voice generation', async () => {
    const jobDirectory = path.join(temporaryRoot, 'uploads', 'workspace', 'bridge-job');
    fs.mkdirSync(jobDirectory, { recursive: true });
    const videoPath = path.join(jobDirectory, 'source.mp4');
    const audioPath = path.join(jobDirectory, 'audio.wav');
    const transcriptPath = path.join(jobDirectory, 'gemini-transcript.json');
    fs.writeFileSync(videoPath, 'video');
    fs.writeFileSync(audioPath, 'audio');
    fs.writeFileSync(transcriptPath, JSON.stringify({
        segments: [{
            start_time: 0,
            end_time: 2,
            type: 'dialogue',
            speaker: 'A',
            original_text: 'Hello',
            burmese_text: 'မင်္ဂလာပါ'
        }]
    }));

    const state = await prepareCorePipelineState({
        job: {
            id: 'bridge-job',
            storedPath: videoPath
        },
        audioPath,
        transcriptPath,
        detect: async () => [0, 1],
        duration: async target => target === videoPath ? 3 : 2,
        fingerprint: target => `fingerprint:${path.basename(target)}`
    });

    assert.equal(state.workflowVersion, 2);
    assert.equal(state.stageId, 'generate_tts');
    assert.deepEqual(state.scenes, [0, 1]);
    assert.deepEqual(state.originalTranscript, [{
        timestamp: [0, 2],
        text: 'Hello'
    }]);
    assert.deepEqual(state.translatedTranscript, [{
        timestamp: [0, 2],
        text: 'မင်္ဂလာပါ',
        kind: 'dialogue',
        speaker: 'A'
    }]);
    assert.deepEqual(
        JSON.parse(fs.readFileSync(path.join(temporaryRoot, 'cache', 'bridge-job', 'state.json'), 'utf8')),
        state
    );
});

test('a core job cannot complete without an authoritative non-empty MP4', () => {
    const outputDirectory = path.join(temporaryRoot, 'verified-output');
    fs.mkdirSync(outputDirectory, { recursive: true });
    const jobId = '11111111-1111-4111-8111-111111111111';
    const result = { videoUrl: `/output/${jobId}.mp4` };

    assert.throws(
        () => assertCompletedCoreOutput(jobId, result, outputDirectory),
        /no final MP4 artifact/
    );
    fs.writeFileSync(path.join(outputDirectory, `${jobId}.mp4`), 'mp4');
    assert.equal(assertCompletedCoreOutput(jobId, result, outputDirectory), result);
    assert.throws(
        () => assertCompletedCoreOutput(jobId, { videoUrl: '/output/wrong.mp4' }, outputDirectory),
        /no authoritative final video URL/
    );
});

test('restart resumes final effects from an already completed core output without source artifacts', async () => {
    const jobId = '22222222-2222-4222-8222-222222222222';
    const outputPath = path.join(temporaryRoot, 'output', `${jobId}.mp4`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, 'workflow-v2 output');
    createJob(jobId, {
        ownerUid: 'owner',
        videoPath: path.join(temporaryRoot, 'uploads', 'already-cleaned.mp4')
    });
    const result = {
        videoUrl: `/output/${jobId}.mp4`,
        audioUrl: `/output/${jobId}.mp3`,
        srtPath: path.join(temporaryRoot, 'cache', jobId, 'subs.srt')
    };
    updateJob(jobId, { status: 'complete', result });

    assert.deepEqual(await continueWithCorePipeline({
        job: { id: jobId, storedPath: path.join(temporaryRoot, 'uploads', 'already-cleaned.mp4') },
        audioPath: path.join(temporaryRoot, 'uploads', 'already-cleaned.wav'),
        transcriptPath: path.join(temporaryRoot, 'uploads', 'already-cleaned.json')
    }), result);
});

test('workspace retry preserves the verified translate_burmese core resume stage', async () => {
    const jobId = '33333333-3333-4333-8333-333333333333';
    const directory = path.join(temporaryRoot, 'uploads', 'workspace', jobId);
    const cache = path.join(temporaryRoot, 'cache', jobId);
    fs.mkdirSync(directory, { recursive: true });
    fs.mkdirSync(cache, { recursive: true });
    const videoPath = path.join(directory, 'source.mp4');
    const audioPath = path.join(directory, 'audio.wav');
    fs.writeFileSync(videoPath, 'video');
    fs.writeFileSync(audioPath, 'audio');
    fs.writeFileSync(path.join(cache, 'state.json'), JSON.stringify({
        workflowVersion: 2,
        stageId: 'translate_burmese',
        originalTranscript: [{ timestamp: [0, 1], text: 'hello' }]
    }));
    createJob(jobId, { ownerUid: 'owner', videoPath, audioPath });
    updateJob(jobId, {
        status: 'error', stageId: 'translate_burmese', progress: 30,
        retryable: true, resumeStage: 'translate_burmese', error: 'quota'
    });
    let observedStage = null;
    await assert.rejects(continueWithCorePipeline({
        job: { id: jobId, ownerUid: 'owner', storedPath: videoPath },
        audioPath,
        transcriptPath: path.join(directory, 'unused.json'),
        runPipeline: async id => {
            observedStage = getJob(id).stageId;
            throw new Error('stop after observing resume stage');
        }
    }), /stop after observing resume stage/);
    assert.equal(observedStage, 'translate_burmese');
    assert.equal(getJob(jobId).stageId, 'translate_burmese');
});
