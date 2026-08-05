import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sawaungthin-core-bridge-'));
process.env.DATA_DIR = root;
process.env.JOB_STORE_PATH = path.join(root, 'jobs.json');

const {
    assertCompletedCoreOutput,
    continueWithCorePipeline,
    prepareCorePipelineState
} = await import('./corePipelineBridge.js');
const { createJob, getJob, getJobKeys, setJobKeys, updateJob } = await import('./jobManager.js');
const { WORKFLOW_VERSION } = await import('../domain/workflow.js');

after(() => fs.rmSync(root, { recursive: true, force: true }));

const writeOutputs = jobId => {
    fs.mkdirSync(path.join(root, 'output'), { recursive: true });
    fs.writeFileSync(path.join(root, 'output', `${jobId}.mp4`), 'mp4');
    fs.writeFileSync(path.join(root, 'output', `${jobId}.mp3`), 'mp3');
};
const resultFor = jobId => ({
    videoUrl: `/output/${jobId}.mp4`, audioUrl: `/output/${jobId}.mp3`
});

test('workspace bridge starts the restored workflow at upload without a hybrid transcript', () => {
    const state = prepareCorePipelineState({
        job: { id: 'bridge-start', ownerUid: 'owner', storedPath: '/data/source.mp4' }
    });
    assert.deepEqual(state, {
        workflowVersion: WORKFLOW_VERSION,
        stageId: 'upload',
        ownerUid: 'owner',
        videoPath: '/data/source.mp4'
    });
    assert.equal('originalTranscript' in state, false);
    assert.equal('translatedTranscript' in state, false);
});

test('completion guard requires authoritative nonempty MP4 and MP3 artifacts', () => {
    const output = path.join(root, 'guard-output');
    const id = 'guard-job';
    fs.mkdirSync(output, { recursive: true });
    assert.throws(() => assertCompletedCoreOutput(id, resultFor(id), output), /MP4 artifact is invalid/);
    fs.writeFileSync(path.join(output, `${id}.mp4`), 'mp4');
    assert.throws(() => assertCompletedCoreOutput(id, resultFor(id), output), /MP3 artifact is invalid/);
    fs.writeFileSync(path.join(output, `${id}.mp3`), 'mp3');
    assert.equal(assertCompletedCoreOutput(id, resultFor(id), output).videoUrl, `/output/${id}.mp4`);
});

test('compatible v3 retry preserves its earliest incomplete core stage', async () => {
    const id = 'compatible-retry';
    createJob(id, { ownerUid: 'owner', videoPath: '/data/source.mp4' });
    updateJob(id, { status: 'error', stageId: 'translate_burmese', progress: 30 });
    let observed;
    await assert.rejects(continueWithCorePipeline({
        job: { id, ownerUid: 'owner', storedPath: '/data/source.mp4' },
        runPipeline: async jobId => {
            observed = getJob(jobId).stageId;
            throw new Error('stop');
        }
    }), /stop/);
    assert.equal(observed, 'translate_burmese');
});

test('hybrid v2 checkpoint restarts at source while retaining encrypted job credentials', async () => {
    const id = 'hybrid-restart';
    createJob(id, { ownerUid: 'owner', videoPath: '/data/source.mp4' });
    updateJob(id, { workflowVersion: 2, status: 'error', stageId: 'generate_tts' });
    setJobKeys(id, { geminiApiKey: 'secret-test-key' });
    const cache = path.join(root, 'cache', id);
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, 'state.json'), JSON.stringify({ workflowVersion: 2 }));
    writeOutputs(id);
    await continueWithCorePipeline({
        job: { id, ownerUid: 'owner', storedPath: '/data/source.mp4' },
        runPipeline: async jobId => {
            assert.equal(getJob(jobId).workflowVersion, WORKFLOW_VERSION);
            assert.equal(getJob(jobId).stageId, 'upload');
            assert.equal(getJobKeys(jobId).geminiApiKey, 'secret-test-key');
            assert.equal(fs.existsSync(path.join(cache, 'state.json')), false);
            updateJob(jobId, { status: 'complete', result: resultFor(jobId) });
        }
    });
});
