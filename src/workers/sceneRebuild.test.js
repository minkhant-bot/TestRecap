import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    MAX_VISUAL_PLAYBACK_RATE,
    buildAtempoFilter,
    buildConcatManifest,
    buildSegmentFFmpegArgs,
    buildTimelineManifest,
    getJobOutputPaths,
    getSegmentPath,
    mapRecordsChronologically,
    readTimelineManifest,
    validateFinalMedia,
    validateTimelineManifest
} from './sceneRebuild.js';

const records = [
    { orig_start: 0.5, orig_end: 2.5, final_audio_start: 0, final_audio_end: 1, text: 'one' },
    { orig_start: 3, orig_end: 5, final_audio_start: 1, final_audio_end: 2, text: 'two' }
];

test('chronological mapping uses latest scene boundary at or before source start', () => {
    const mapped = mapRecordsChronologically(records, [0, 1, 3, 4], 6, 2);
    assert.deepEqual(mapped.map(record => record.matched_scene_index), [0, 2]);
    assert.deepEqual(mapped.map(record => record.source_scene_index), [0, 2]);
});

test('chronological mapping rejects overlap, reverse, and out-of-media records', () => {
    assert.throws(() => mapRecordsChronologically([
        records[0], { ...records[1], orig_start: 2, orig_end: 4 }
    ], [0], 6, 2), /overlap/);
    assert.throws(() => mapRecordsChronologically([
        { ...records[0], orig_end: 0.4 }
    ], [0], 6, 2), /outside media/);
    assert.throws(() => mapRecordsChronologically([
        { ...records[0], orig_end: 7 }
    ], [0], 6, 2), /outside media/);
});

test('timeline manifest is deterministic, versioned, ordered, and fully specified', () => {
    const mapped = mapRecordsChronologically(records, [0, 1, 3], 6, 2);
    const first = buildTimelineManifest(mapped, 6, 2, 'source-a');
    const second = buildTimelineManifest(mapped, 6, 2, 'source-a');
    assert.deepEqual(first, second);
    assert.equal(first.workflowVersion, 2);
    assert.deepEqual(Object.keys(first.segments[0]), [
        'source_start', 'source_end', 'source_scene_index', 'matched_scene_index',
        'tts_start', 'tts_end', 'target_output_duration', 'playback_rate',
        'output_order', 'text'
    ]);
});

test('timeline validation rejects invalid ordering and unsafe playback rates', () => {
    const mapped = mapRecordsChronologically(records, [0], 6, 2);
    const manifest = buildTimelineManifest(mapped, 6, 2, 'source-a');
    assert.throws(() => validateTimelineManifest({
        ...manifest,
        segments: manifest.segments.map((segment, index) => ({ ...segment, output_order: 1 - index }))
    }, 6, 2), /output order/);
    assert.throws(() => buildTimelineManifest(mapRecordsChronologically([
        { orig_start: 0, orig_end: 5, final_audio_start: 0, final_audio_end: 0.1, text: 'x' }
    ], [0], 6, 2), 6, 2, 'source-a'), new RegExp(`${MAX_VISUAL_PLAYBACK_RATE}`));
});

test('segment generation command performs accurate trim and visual timing adjustment', () => {
    const segment = buildTimelineManifest(
        mapRecordsChronologically([records[0]], [0], 6, 2), 6, 2, 'x').segments[0];
    const args = buildSegmentFFmpegArgs('/input/source.mp4', '/job/segment.mp4', segment);
    assert.deepEqual(args.slice(0, 6), ['-ss', '0.500000', '-t', '2.000000', '-i', '/input/source.mp4']);
    assert.match(args[args.indexOf('-vf') + 1], /setpts=PTS\/2\.00000000/);
    assert.equal(args[args.length - 1], '/job/segment.mp4');
});

test('concat order is deterministic and missing or empty segments fail', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-rebuild-'));
    fs.mkdirSync(path.join(dir, 'segments'));
    const manifest = buildTimelineManifest(
        mapRecordsChronologically(records, [0], 6, 2), 6, 2, 'x');
    assert.throws(() => buildConcatManifest(manifest, dir), /missing/);
    fs.writeFileSync(getSegmentPath(dir, 0), '');
    fs.writeFileSync(getSegmentPath(dir, 1), 'video');
    assert.throws(() => buildConcatManifest(manifest, dir), /empty/);
    fs.writeFileSync(getSegmentPath(dir, 0), 'video');
    const lines = buildConcatManifest(manifest, dir).split('\n');
    assert.match(lines[0], /segment-000000/);
    assert.match(lines[1], /segment-000001/);
});

test('job output paths are isolated and include MP4 and MP3 job IDs', () => {
    assert.deepEqual(getJobOutputPaths('/outputs', 'job-123'), {
        mp4: path.join('/outputs', 'job-123.mp4'),
        mp3: path.join('/outputs', 'job-123.mp3')
    });
});

test('atempo construction chains factors outside a single filter range', () => {
    assert.equal(buildAtempoFilter(1), 'atempo=1.00000000');
    assert.equal(buildAtempoFilter(4.5), 'atempo=2.00000000,atempo=2.00000000,atempo=1.12500000');
    assert.equal(buildAtempoFilter(0.2), 'atempo=0.50000000,atempo=0.50000000,atempo=0.80000000');
});

test('final media validation requires streams, duration, size, and bounded drift', () => {
    const valid = {
        hasVideo: true, hasAudio: true,
        effectiveVideoDuration: 2, effectiveAudioDuration: 2.1
    };
    assert.equal(validateFinalMedia(valid, 100, 2).drift.toFixed(1), '0.1');
    assert.throws(() => validateFinalMedia({ ...valid, hasAudio: false }, 100, 2), /audio stream/);
    assert.throws(() => validateFinalMedia({ ...valid, effectiveAudioDuration: 2.5 }, 100, 2), /drift/);
    assert.throws(() => validateFinalMedia(valid, 0, 2), /empty/);
});

test('incompatible timeline cache is rejected', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-cache-'));
    const file = path.join(dir, 'timeline.json');
    fs.writeFileSync(file, JSON.stringify({
        workflowVersion: 1,
        algorithmVersion: 'old',
        sourceFingerprint: 'source-a',
        mediaDuration: 6,
        ttsDuration: 2,
        segments: [{}]
    }));
    assert.throws(() => readTimelineManifest(file, {
        sourceFingerprint: 'source-a', mediaDuration: 6, ttsDuration: 2
    }), /Incompatible/);
});
