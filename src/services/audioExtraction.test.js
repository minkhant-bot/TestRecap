import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { getAudioDetails, runFFmpeg } from '../ffmpeg/index.js';
import {
    extractWorkspaceAudio,
    getWorkspaceAudioPaths,
    validateExtractedAudio
} from './audioExtraction.js';

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testrecap-audio-extraction-'));

const formats = [
    { extension: 'mp4', codecs: ['-c:v', 'mpeg4', '-c:a', 'aac'] },
    { extension: 'mkv', codecs: ['-c:v', 'mpeg4', '-c:a', 'pcm_s16le'] },
    { extension: 'mov', codecs: ['-c:v', 'mpeg4', '-c:a', 'aac'] },
    { extension: 'avi', codecs: ['-c:v', 'mpeg4', '-c:a', 'pcm_s16le'] },
    { extension: 'webm', codecs: ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus'] }
];

const generateVideo = async ({ extension, codecs }, name = `source.${extension}`) => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, `${extension}-`));
    const output = path.join(directory, name);
    await runFFmpeg([
        '-y',
        '-f', 'lavfi',
        '-i', 'color=c=blue:s=320x180:d=1',
        '-f', 'lavfi',
        '-i', 'sine=frequency=440:duration=1',
        '-shortest',
        ...codecs,
        output
    ], directory, null, 60000);
    return output;
};

after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

test('FFmpeg is available and extracts validated audio from MP4, MKV, MOV, AVI, and WEBM', async () => {
    await runFFmpeg(['-version'], temporaryRoot, null, 30000);
    for (const format of formats) {
        const sourcePath = await generateVideo(format);
        const result = await extractWorkspaceAudio({
            sourcePath
        });
        assert.equal(result.audioPath, getWorkspaceAudioPaths(sourcePath).audioPath);
        assert.ok(fs.existsSync(result.audioPath), `${format.extension} audio output is missing`);
        assert.ok(result.audioDuration > 0, `${format.extension} duration is invalid`);
        assert.ok(await validateExtractedAudio(result.audioPath) > 0);
        const details = await getAudioDetails(result.audioPath);
        assert.equal(details.codec, 'pcm_s16le');
        assert.equal(Number(details.sampleRate), 16000);
        assert.equal(details.channels, 1);
    }
});

test('forwards extraction progress from the FFmpeg runner', async () => {
    const directory = fs.mkdtempSync(path.join(temporaryRoot, 'progress-'));
    const sourcePath = path.join(directory, 'source.mp4');
    fs.writeFileSync(sourcePath, 'source');
    const progress = [];
    const result = await extractWorkspaceAudio({
        sourcePath,
        onProgress: value => progress.push(value),
        run: async (args, cwd, onProgress) => {
            if (args[0] === '-version') return;
            assert.equal(cwd, directory);
            onProgress(42);
            fs.writeFileSync(getWorkspaceAudioPaths(sourcePath).partialPath, 'audio');
        },
        validate: async () => 1
    });
    assert.deepEqual(progress, [42]);
    assert.equal(result.audioDuration, 1);
    assert.ok(fs.existsSync(result.audioPath));
});

test('large valid source extracts without loading the source into memory', async () => {
    const sourcePath = await generateVideo(formats[0], 'large.mp4');
    fs.appendFileSync(sourcePath, Buffer.alloc(12 * 1024 * 1024));
    assert.ok(fs.statSync(sourcePath).size > 10 * 1024 * 1024);
    const result = await extractWorkspaceAudio({ sourcePath });
    assert.ok(result.audioDuration > 0);
    assert.ok(fs.statSync(result.audioPath).size > 44);
});

test('missing and corrupted inputs fail safely and remove partial audio', async () => {
    const missing = path.join(temporaryRoot, 'missing.mp4');
    await assert.rejects(() => extractWorkspaceAudio({ sourcePath: missing }), /Source video is missing/);

    const directory = fs.mkdtempSync(path.join(temporaryRoot, 'corrupt-'));
    const corrupt = path.join(directory, 'corrupt.mp4');
    fs.writeFileSync(corrupt, 'not a video');
    await assert.rejects(() => extractWorkspaceAudio({ sourcePath: corrupt }));
    const paths = getWorkspaceAudioPaths(corrupt);
    assert.equal(fs.existsSync(paths.partialPath), false);
    assert.equal(fs.existsSync(paths.audioPath), false);
});

test('permission and validation failures remove partial and final artifacts', async () => {
    const sourcePath = await generateVideo(formats[0]);
    const paths = getWorkspaceAudioPaths(sourcePath);
    await assert.rejects(() => extractWorkspaceAudio({
        sourcePath,
        run: async args => {
            if (args[0] === '-version') return;
            fs.writeFileSync(paths.partialPath, 'partial');
            const error = new Error('permission denied');
            error.code = 'EACCES';
            throw error;
        }
    }), /permission denied/);
    assert.equal(fs.existsSync(paths.partialPath), false);
    assert.equal(fs.existsSync(paths.audioPath), false);
});

test('cancellation terminates extraction and removes partial output', async () => {
    const sourcePath = await generateVideo(formats[0]);
    const paths = getWorkspaceAudioPaths(sourcePath);
    const controller = new AbortController();
    const pending = extractWorkspaceAudio({
        sourcePath,
        signal: controller.signal,
        run: async args => {
            if (args[0] === '-version') return;
            fs.writeFileSync(paths.partialPath, 'partial');
            await new Promise((resolve, reject) => {
                const rejectCancellation = () => {
                    const error = new Error('cancelled');
                    error.code = 'ABORT_ERR';
                    reject(error);
                };
                if (controller.signal.aborted) {
                    rejectCancellation();
                    return;
                }
                controller.signal.addEventListener('abort', () => {
                    rejectCancellation();
                }, { once: true });
            });
        }
    });
    controller.abort();
    await assert.rejects(() => pending, error => error.name === 'AbortError');
    assert.equal(fs.existsSync(paths.partialPath), false);
    assert.equal(fs.existsSync(paths.audioPath), false);
});
