import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    collectCompletedJobArtifactPaths,
    deleteCompletedJobAndRecord,
    deleteCompletedJobArtifacts,
    deleteTerminalJobArtifacts,
    resolveCompletedJobForDeletion,
    validateTerminalJobArtifacts
} from './completedOutputDeletion.js';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

const makeFixture = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'completed-delete-'));
    const output = path.join(root, 'public', 'output');
    const cache = path.join(root, 'data', 'cache');
    const temporary = path.join(root, 'src', 'tmp');
    fs.mkdirSync(path.join(cache, JOB_ID), { recursive: true });
    fs.mkdirSync(path.join(cache, OTHER_ID), { recursive: true });
    fs.mkdirSync(output, { recursive: true });
    fs.mkdirSync(temporary, { recursive: true });
    const upload = path.join(temporary, 'owned-upload');
    for (const file of [
        path.join(output, `${JOB_ID}.mp4`),
        path.join(output, `${JOB_ID}.mp3`),
        path.join(cache, JOB_ID, 'translated_transcript.json'),
        path.join(cache, JOB_ID, 'narration_tts.wav.timeline.json'),
        path.join(temporary, `${JOB_ID}_final.mp4`),
        upload,
        path.join(output, `${OTHER_ID}.mp4`),
        path.join(cache, OTHER_ID, 'state.json'),
        path.join(temporary, `${OTHER_ID}_final.mp4`)
    ]) fs.writeFileSync(file, 'owned');
    return {
        root,
        upload,
        job: { id: JOB_ID, status: 'complete', videoPath: upload, audioPath: null }
    };
};

test('deletes only the selected completed job artifacts', () => {
    const fixture = makeFixture();
    try {
        deleteCompletedJobArtifacts({ job: fixture.job, projectRoot: fixture.root });
        assert.equal(fs.existsSync(path.join(fixture.root, 'public', 'output', `${JOB_ID}.mp4`)), false);
        assert.equal(fs.existsSync(path.join(fixture.root, 'public', 'output', `${JOB_ID}.mp3`)), false);
        assert.equal(fs.existsSync(path.join(fixture.root, 'data', 'cache', JOB_ID)), false);
        assert.equal(fs.existsSync(fixture.upload), false);
        assert.equal(fs.existsSync(path.join(fixture.root, 'src', 'tmp', `${JOB_ID}_final.mp4`)), false);

        assert.equal(fs.existsSync(path.join(fixture.root, 'public', 'output', `${OTHER_ID}.mp4`)), true);
        assert.equal(fs.existsSync(path.join(fixture.root, 'data', 'cache', OTHER_ID, 'state.json')), true);
        assert.equal(fs.existsSync(path.join(fixture.root, 'src', 'tmp', `${OTHER_ID}_final.mp4`)), true);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('rejects traversal IDs and recorded paths outside the temporary root before deletion', () => {
    const fixture = makeFixture();
    const outside = path.join(fixture.root, 'do-not-delete');
    fs.writeFileSync(outside, 'safe');
    try {
        assert.throws(
            () => collectCompletedJobArtifactPaths({
                job: { ...fixture.job, id: '../../escape' },
                projectRoot: fixture.root
            }),
            /Invalid job ID/
        );
        assert.throws(
            () => deleteCompletedJobArtifacts({
                job: { ...fixture.job, videoPath: outside },
                projectRoot: fixture.root
            }),
            /Unsafe temporary artifact path/
        );
        assert.equal(fs.existsSync(outside), true);
        assert.equal(fs.existsSync(path.join(fixture.root, 'public', 'output', `${JOB_ID}.mp4`)), true);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('refuses to delete an actively processing job', () => {
    const fixture = makeFixture();
    try {
        assert.throws(
            () => deleteCompletedJobArtifacts({
                job: { ...fixture.job, status: 'processing' },
                projectRoot: fixture.root
            }),
            /Only completed jobs/
        );
        assert.equal(fs.existsSync(path.join(fixture.root, 'public', 'output', `${JOB_ID}.mp4`)), true);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});
test('removes the job record only after artifact deletion succeeds', () => {
    const fixture = makeFixture();
    const events = [];
    try {
        deleteCompletedJobAndRecord({
            job: fixture.job, projectRoot: fixture.root,
            clearCredentials: id => events.push('credentials:' + id),
            deleteRecord: id => events.push('record:' + id)
        });
        assert.deepEqual(events, ['credentials:' + JOB_ID, 'record:' + JOB_ID]);
        assert.equal(fs.existsSync(path.join(fixture.root, 'data', 'cache', JOB_ID)), false);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('retains the job record when artifact validation fails', () => {
    const fixture = makeFixture();
    const events = [];
    const outside = path.join(fixture.root, 'outside-upload');
    fs.writeFileSync(outside, 'safe');
    try {
        assert.throws(() => deleteCompletedJobAndRecord({
            job: { ...fixture.job, videoPath: outside }, projectRoot: fixture.root,
            clearCredentials: () => events.push('credentials'),
            deleteRecord: () => events.push('record')
        }), /Unsafe temporary artifact path/);
        assert.deepEqual(events, []);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});
test('resolves a safe durable completed MP4 after an in-memory record is lost', () => {
    const fixture = makeFixture();
    try {
        assert.deepEqual(resolveCompletedJobForDeletion({
            jobId: JOB_ID, job: null, projectRoot: fixture.root
        }), { id: JOB_ID, status: 'complete', videoPath: null, audioPath: null });
        assert.equal(resolveCompletedJobForDeletion({
            jobId: '33333333-3333-4333-8333-333333333333', job: null, projectRoot: fixture.root
        }), null);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('preserves an active in-memory job even when an output path exists', () => {
    const fixture = makeFixture();
    try {
        const active = { ...fixture.job, status: 'processing' };
        assert.equal(resolveCompletedJobForDeletion({
            jobId: JOB_ID, job: active, projectRoot: fixture.root
        }), active);
        assert.throws(() => deleteCompletedJobArtifacts({
            job: active, projectRoot: fixture.root
        }), /Only completed jobs/);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('terminal deletion preflight rejects symlinked output before record mutation', () => {
    const fixture = makeFixture();
    const outputPath = path.join(fixture.root, 'public', 'output', `${JOB_ID}.mp4`);
    const outside = path.join(fixture.root, 'outside-output');
    fs.writeFileSync(outside, 'must remain');
    fs.unlinkSync(outputPath);
    fs.symlinkSync(outside, outputPath);
    try {
        assert.throws(
            () => validateTerminalJobArtifacts({ job: fixture.job, projectRoot: fixture.root }),
            /Unsafe file artifact/
        );
        assert.equal(fs.readFileSync(outside, 'utf8'), 'must remain');
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('terminal artifact cleanup supports failed and cancelled core jobs', () => {
    for (const status of ['error', 'cancelled']) {
        const fixture = makeFixture();
        try {
            deleteTerminalJobArtifacts({
                job: { ...fixture.job, status },
                projectRoot: fixture.root
            });
            assert.equal(
                fs.existsSync(path.join(fixture.root, 'public', 'output', `${JOB_ID}.mp4`)),
                false
            );
            assert.equal(
                fs.existsSync(path.join(fixture.root, 'data', 'cache', JOB_ID)),
                false
            );
        } finally {
            fs.rmSync(fixture.root, { recursive: true, force: true });
        }
    }
});
