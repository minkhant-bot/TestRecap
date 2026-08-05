import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WORKFLOW_VERSION } from '../domain/workflow.js';
import {
    FFMPEG_VIDEO_THREADS_DEFAULT,
    FFMPEG_VIDEO_THREADS_MAX,
    MAX_AV_DRIFT_SECONDS,
    TIMELINE_ALGORITHM_VERSION,
    buildConcatManifest,
    buildFinalExportArgs,
    buildSegmentFFmpegArgs,
    buildTimelineManifest,
    getJobOutputPaths,
    getSegmentPath,
    mapRecordsChronologically,
    resolveFfmpegVideoThreads,
    validateFinalMedia,
    validateTimelineManifest
} from './sceneRebuild.js';

const auth = [
    { orig_start: 0, orig_end: 2, final_audio_start: 0, final_audio_end: 1, text: 'one' },
    { orig_start: 3, orig_end: 6, final_audio_start: 1, final_audio_end: 3, text: 'two' }
];

test('Sawaungthin timeline selects scene boundaries while retaining original Whisper windows', () => {
    const mapped = mapRecordsChronologically(auth, [0, 2.5, 5], 8, 3);
    assert.deepEqual(mapped.map(item => item.matched_scene_index), [0, 1]);
    assert.deepEqual(mapped.map(item => [item.source_start, item.source_end]), [[0, 2], [3, 6]]);
});

test('Sawaungthin timeline merges nearby records at gap <0.75 and span <=12 seconds', () => {
    const mapped = mapRecordsChronologically([
        auth[0],
        { orig_start: 2.5, orig_end: 4, final_audio_start: 1, final_audio_end: 2, text: 'two' }
    ], [0, 3], 5, 2);
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0].text, 'one two');
    assert.deepEqual([mapped[0].source_start, mapped[0].source_end], [0, 4]);
});

test('versioned artifact schema clamps visual speed to the ZIP 0.35x-100x range', () => {
    const manifest = buildTimelineManifest([
        { ...mapRecordsChronologically([auth[0]], [0], 8, 1)[0], source_end: 0.1 }
    ], 8, 1, 'source');
    assert.equal(manifest.workflowVersion, WORKFLOW_VERSION);
    assert.equal(manifest.algorithmVersion, TIMELINE_ALGORITHM_VERSION);
    assert.equal(manifest.segments[0].playback_rate, 0.35);
    assert.equal(validateTimelineManifest(manifest, 8, 1), manifest);
});

test('FFMPEG_VIDEO_THREADS falls back to the previous hardcoded default of 2 when unset', () => {
    assert.equal(FFMPEG_VIDEO_THREADS_DEFAULT, 2);
    assert.equal(resolveFfmpegVideoThreads({}), 2);
});

test('a valid FFMPEG_VIDEO_THREADS environment override is used', () => {
    assert.equal(resolveFfmpegVideoThreads({ FFMPEG_VIDEO_THREADS: '6' }), 6);
});

test('an invalid or unsafe FFMPEG_VIDEO_THREADS falls back to the safe default', () => {
    for (const unsafe of ['0', '-4', 'not-a-number', '', undefined]) {
        assert.equal(resolveFfmpegVideoThreads({ FFMPEG_VIDEO_THREADS: unsafe }), 2, `unsafe value ${JSON.stringify(unsafe)} must fall back to the default`);
    }
});

test('FFMPEG_VIDEO_THREADS cannot exceed the sanity cap of 32', () => {
    assert.equal(FFMPEG_VIDEO_THREADS_MAX, 32);
    assert.equal(resolveFfmpegVideoThreads({ FFMPEG_VIDEO_THREADS: '999' }), 32);
});

test('segment render command restores portrait crop, freeze padding, 30fps, and MPEG-TS', () => {
    const args = buildSegmentFFmpegArgs('/tmp/source.mp4', '/tmp/segment.ts', {
        source_start: 1, source_end: 3, playback_rate: 2,
        target_output_duration: 1
    });
    const filter = args[args.indexOf('-vf') + 1];
    assert.match(filter, /setpts=0\.50000000\*\(PTS-STARTPTS\)/);
    assert.match(filter, /tpad=stop_mode=clone/);
    assert.match(filter, /scale=1080:1920/);
    assert.match(filter, /crop=1080:1920/);
    assert.equal(args[args.indexOf('-f') + 1], 'mpegts');
});

test('concat and completion validation require ordered nonempty artifacts and bounded A/V drift', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sawaungthin-segments-'));
    try {
        fs.mkdirSync(path.join(root, 'segments'));
        const manifest = buildTimelineManifest(mapRecordsChronologically(auth, [0, 2.5], 8, 3), 8, 3, 'source');
        manifest.segments.forEach(segment => fs.writeFileSync(
            getSegmentPath(root, segment.output_order), `segment-${segment.output_order}`
        ));
        const concat = buildConcatManifest(manifest, root);
        assert.match(concat, /segment-000000\.ts/);
        assert.match(concat, /duration 1\.000000/);
        assert.deepEqual(validateFinalMedia({
            hasVideo: true, hasAudio: true,
            effectiveVideoDuration: 3,
            effectiveAudioDuration: 3 + MAX_AV_DRIFT_SECONDS
        }, 100, 3), { videoDuration: 3, audioDuration: 3.3, drift: 0.2999999999999998 });
        assert.throws(() => validateFinalMedia({
            hasVideo: true, hasAudio: true,
            effectiveVideoDuration: 3,
            effectiveAudioDuration: 3.31
        }, 100, 3), /drift/);
        assert.deepEqual(getJobOutputPaths('/output', 'job'), {
            mp4: path.join('/output', 'job.mp4'), mp3: path.join('/output', 'job.mp3')
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('final export uses the ZIP TTS-only AAC loudness contract and faststart', () => {
    const args = buildFinalExportArgs('/tmp/concat.txt', '/tmp/tts.wav', '/tmp/final.mp4');
    assert.equal(args[args.indexOf('-c:v') + 1], 'copy');
    assert.equal(args[args.indexOf('-filter:a') + 1], 'loudnorm=I=-14:LRA=11:TP=-1.5');
    assert.equal(args[args.indexOf('-movflags') + 1], '+faststart');
    assert.deepEqual(args.slice(args.indexOf('-map'), args.indexOf('-c:v')), [
        '-map', '0:v:0', '-map', '1:a:0'
    ]);
});
