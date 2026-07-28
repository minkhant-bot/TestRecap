import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanupPipelineArtifacts } from './workflowCleanup.js';

const fixture = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-cleanup-'));
    const cacheDir = path.join(root, 'cache', 'job');
    const uploadRoot = path.join(root, 'uploads');
    fs.mkdirSync(path.join(cacheDir, 'media-work'), { recursive: true });
    fs.mkdirSync(uploadRoot, { recursive: true });
    const videoPath = path.join(uploadRoot, 'video');
    fs.writeFileSync(videoPath, 'video');
    fs.writeFileSync(path.join(cacheDir, 'video.wav'), 'wav');
    fs.writeFileSync(path.join(cacheDir, 'media-work', 'render.tmp.mp4'), 'partial');
    fs.writeFileSync(path.join(cacheDir, 'state.json'), '{}');
    return { root, cacheDir, uploadRoot, videoPath };
};

test('failure and retry cleanup remove partials but retain resumable inputs and cache', () => {
    for (const lifecycleStatus of ['error', 'queued']) {
        const item = fixture();
        const result = cleanupPipelineArtifacts({ ...item, lifecycleStatus });
        assert.equal(result.retainedForRetry, true);
        assert.equal(fs.existsSync(item.videoPath), true);
        assert.equal(fs.existsSync(path.join(item.cacheDir, 'video.wav')), true);
        assert.equal(fs.existsSync(path.join(item.cacheDir, 'media-work', 'render.tmp.mp4')), false);
        assert.equal(fs.existsSync(path.join(item.cacheDir, 'state.json')), true);
    }
});

test('success cleanup removes upload and transient media but preserves durable state', () => {
    const item = fixture();
    cleanupPipelineArtifacts({ ...item, lifecycleStatus: 'complete' });
    assert.equal(fs.existsSync(item.videoPath), false);
    assert.equal(fs.existsSync(path.join(item.cacheDir, 'video.wav')), false);
    assert.equal(fs.existsSync(path.join(item.cacheDir, 'media-work')), false);
    assert.equal(fs.existsSync(path.join(item.cacheDir, 'state.json')), true);
});

test('cleanup rejects paths outside the selected job and symlinks', () => {
    const item = fixture();
    assert.throws(() => cleanupPipelineArtifacts({
        ...item, videoPath: path.join(item.root, 'other'), lifecycleStatus: 'complete'
    }), /outside job ownership/);
    const link = path.join(item.cacheDir, 'unsafe-link');
    fs.symlinkSync(item.uploadRoot, link);
    assert.throws(() => cleanupPipelineArtifacts({
        ...item, lifecycleStatus: 'error'
    }), /symlink/);
});
