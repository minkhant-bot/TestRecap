import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildGroupedNarrationAudioComposition } from './groupedAudioComposition.js';
import { runFFmpeg, getStreamsDuration } from '../ffmpeg/index.js';
import { execFileSync } from 'node:child_process';

const rmsBetween = (pcm, sampleRate, start, end) => {
    const firstSample = Math.floor(start * sampleRate);
    const lastSample = Math.min(Math.floor(end * sampleRate), pcm.length / 2);
    let sumSquares = 0;
    for (let index = firstSample; index < lastSample; index++) {
        const sample = pcm.readInt16LE(index * 2) / 32768;
        sumSquares += sample * sample;
    }
    return Math.sqrt(sumSquares / Math.max(1, lastSample - firstSample));
};

test('keeps grouped narration audible near the beginning, middle, and end', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grouped-audio-regression-'));
    try {
        const narrationPath = path.join(tempDir, 'narration.wav');
        const mixedPath = path.join(tempDir, 'mixed.wav');
        const rawPath = path.join(tempDir, 'mixed.s16le');
        await runFFmpeg([
            '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=24000:duration=3',
            '-acodec', 'pcm_s16le', '-ar', '24000', '-ac', '1',
            '-y', narrationPath
        ], tempDir);

        const timeline = [0, 1, 2].map(index => ({
            final_audio_start: index,
            final_audio_end: index + 1,
            anchor_start: index * 4,
            anchor_end: (index + 1) * 4,
            text: `segment `,
            segments: [{ index, text: `segment `, kind: 'narration', speaker: 'narrator', orig_start: index * 4, orig_end: index * 4 + 1, final_audio_start: index, final_audio_end: index + 1 }]
        }));
        const composition = buildGroupedNarrationAudioComposition(timeline, 12);
        assert.equal(composition.groupMappings.length, 3);
        assert.deepEqual(
            composition.segmentMappings.map(segment => segment.output_label),
            ['tts_g0_s0', 'tts_g1_s1', 'tts_g2_s2']
        );
        assert.match(composition.filterComplex, /atrim=start=1\.000000:end=2\.000000,asetpts=PTS-STARTPTS/);
        assert.doesNotMatch(composition.filterComplex, /first_pts=0/);

        await runFFmpeg([
            '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=1:d=12',
            '-i', narrationPath,
            '-f', 'lavfi', '-t', '12', '-i', 'anullsrc=r=24000:cl=mono',
            '-filter_complex', composition.filterComplex,
            '-map', '[aout]', '-acodec', 'pcm_s16le', '-ar', '24000', '-ac', '1',
            '-t', '12', '-y', mixedPath
        ], tempDir);
        await runFFmpeg([
            '-i', mixedPath, '-f', 's16le', '-acodec', 'pcm_s16le',
            '-ar', '24000', '-ac', '1', '-y', rawPath
        ], tempDir);

        const pcm = fs.readFileSync(rawPath);
        const windows = [
            { name: 'beginning', start: 0.1, end: 0.9 },
            { name: 'middle', start: 4.1, end: 4.9 },
            { name: 'end', start: 8.1, end: 8.9 }
        ];
        for (const window of windows) {
            const rms = rmsBetween(pcm, 24000, window.start, window.end);
            assert.ok(rms > 0.005, `${window.name} narration RMS ${rms} should be audible`);
        }
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

const videoStreamMd5 = file => execFileSync('ffmpeg', [
    '-v', 'error', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'md5', '-'
], { encoding: 'utf8' }).trim();

for (const mode of ['recap', 'dialogue']) {
    test(`${mode} video export preserves original frames, duration, and ending audio`, async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${mode}-video-regression-`));
        try {
            const source = path.join(tempDir, 'source.mp4');
            const narration = path.join(tempDir, 'narration.wav');
            const final = path.join(tempDir, 'final.mp4');
            await runFFmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=15:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-y', source], tempDir);
            await runFFmpeg(['-f', 'lavfi', '-i', 'sine=frequency=700:sample_rate=24000:duration=3', '-acodec', 'pcm_s16le', '-y', narration], tempDir);
            const timeline = [0, 1, 2].map(index => {
                const kind = mode === 'dialogue' ? 'dialogue' : 'narration';
                const speaker = mode === 'dialogue' ? `speaker_` : 'narrator';
                return {
                    final_audio_start: index, final_audio_end: index + 1,
                    anchor_start: index * 2, anchor_end: (index + 1) * 2,
                    text: `segment `, kind, speaker,
                    segments: [{ index, text: `segment `, kind, speaker, orig_start: index * 2, orig_end: index * 2 + 1, final_audio_start: index, final_audio_end: index + 1 }]
                };
            });
            const composition = buildGroupedNarrationAudioComposition(timeline, 6);
            assert.ok(composition.segmentMappings.every(segment => segment.tempo <= 1.25));
            await runFFmpeg([
                '-i', source, '-i', narration,
                '-f', 'lavfi', '-t', '6', '-i', 'anullsrc=r=24000:cl=mono',
                '-filter_complex', composition.filterComplex,
                '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac',
                '-t', '6', '-movflags', '+faststart', '-y', final
            ], tempDir);
            const streams = await getStreamsDuration(final);
            assert.equal(videoStreamMd5(final), videoStreamMd5(source));
            assert.ok(Math.abs(streams.effectiveVideoDuration - 6) < 0.05);
            assert.ok(Math.abs(streams.effectiveAudioDuration - 6) < 0.05);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
}


test('places authoritative segments 29-30 and 49-51 at original timestamps without premature silence', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'segment-placement-regression-'));
    try {
        const narrationPath = path.join(tempDir, 'narration.wav');
        const mixedPath = path.join(tempDir, 'mixed.wav');
        const rawPath = path.join(tempDir, 'mixed.s16le');
        await runFFmpeg([
            '-f', 'lavfi', '-i', 'sine=frequency=720:sample_rate=24000:duration=28',
            '-acodec', 'pcm_s16le', '-ar', '24000', '-ac', '1',
            '-y', narrationPath
        ], tempDir);
        const segment = (index, speaker, origStart, origEnd, audioStart, audioEnd) => ({
            index, text: `segment ${index}`, kind: 'dialogue', speaker,
            orig_start: origStart, orig_end: origEnd,
            final_audio_start: audioStart, final_audio_end: audioEnd
        });
        const timeline = [
            { group_index: 3, text: 'segments 29-30', segments: [
                segment(29, 'narrator', 91, 101, 0, 10),
                segment(30, 'Chef', 101, 108, 10, 17)
            ] },
            { group_index: 6, text: 'segments 49-51', segments: [
                segment(49, 'Xiufen', 189, 194, 17, 22),
                segment(50, 'Xiufen', 194, 198, 22, 26),
                segment(51, 'Son', 198, 200, 26, 28)
            ] }
        ];
        timeline[0].segments[0].kind = 'narration';
        const composition = buildGroupedNarrationAudioComposition(timeline, 212);
        assert.deepEqual(
            composition.segmentMappings.map(item => [item.segment_index, item.target_start, item.target_duration]),
            [[29, 91, 10], [30, 101, 7], [49, 189, 5], [50, 194, 4], [51, 198, 2]]
        );
        assert.equal(composition.segmentMappings.length, 5);
        assert.match(composition.filterComplex, /tts_g0_s29/);
        assert.match(composition.filterComplex, /adelay=101000:all=1\[tts_g0_s30\]/);
        assert.match(composition.filterComplex, /adelay=198000:all=1\[tts_g1_s51\]/);

        await runFFmpeg([
            '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=1:d=212',
            '-i', narrationPath,
            '-f', 'lavfi', '-t', '212', '-i', 'anullsrc=r=24000:cl=mono',
            '-filter_complex', composition.filterComplex,
            '-map', '[aout]', '-acodec', 'pcm_s16le',
            '-ar', '24000', '-ac', '1', '-t', '212', '-y', mixedPath
        ], tempDir);
        await runFFmpeg([
            '-i', mixedPath, '-f', 's16le', '-acodec', 'pcm_s16le',
            '-ar', '24000', '-ac', '1', '-y', rawPath
        ], tempDir);
        const pcm = fs.readFileSync(rawPath);
        for (const [name, start, end] of [
            ['segment 29', 91.2, 100.8], ['segment 30', 101.2, 107.8],
            ['segment 49', 189.2, 193.8], ['segment 50', 194.2, 197.8],
            ['segment 51', 198.2, 199.8]
        ]) assert.ok(rmsBetween(pcm, 24000, start, end) > 0.005, `${name} must be audible across its original window`);
        for (const [name, start, end] of [
            ['gap 108-116', 108.2, 115.8], ['gap 200-205', 200.2, 204.8]
        ]) assert.ok(rmsBetween(pcm, 24000, start, end) < 0.0001, `${name} must remain silent`);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
