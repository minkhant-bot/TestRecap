import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { hasCompletedStage } from '../domain/workflow.js';
import { GeminiAvailabilityError } from '../ai/geminiTranslation.js';
import { cleanupPipelineArtifacts } from '../workers/workflowCleanup.js';
import { getGeminiFailureJobUpdate, getRetryStartStage } from './geminiRetryPolicy.js';

test('availability exhaustion is retryable from translation and earlier stages remain completed', () => {
    const update = getGeminiFailureJobUpdate(new GeminiAvailabilityError(503));
    assert.equal(update.retryable, true);
    assert.equal(getRetryStartStage(update), 'translate_burmese');
    assert.equal(hasCompletedStage(update.stageId, 'extract_audio'), true);
    assert.equal(hasCompletedStage(update.stageId, 'detect_scenes'), true);
    assert.equal(hasCompletedStage(update.stageId, 'transcribe_source'), true);
});

test('exhausted availability cleanup preserves source and completed resume artifacts', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-resume-'));
    const cacheDir = path.join(root, 'cache');
    const uploadRoot = path.join(root, 'uploads');
    fs.mkdirSync(cacheDir);
    fs.mkdirSync(uploadRoot);
    const videoPath = path.join(uploadRoot, 'source.mp4');
    fs.writeFileSync(videoPath, 'source');
    for (const name of ['video.wav', 'scenes.json', 'source-transcript.json', 'state.json']) {
        fs.writeFileSync(path.join(cacheDir, name), name);
    }
    cleanupPipelineArtifacts({
        cacheDir, uploadRoot, videoPath, lifecycleStatus: 'error'
    });
    assert.equal(fs.existsSync(videoPath), true);
    for (const name of ['video.wav', 'scenes.json', 'source-transcript.json', 'state.json']) {
        assert.equal(fs.existsSync(path.join(cacheDir, name)), true);
    }
});
