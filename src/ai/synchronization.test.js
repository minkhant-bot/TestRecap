import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildSawaungthinTimelineEntries,
    buildSawaungthinTtsBlocks
} from './sawaungthinTts.js';

const narration = [
    { narration_text: 'တစ်', scene_start: 0, scene_end: 2 },
    { narration_text: 'နှစ်နှစ်', scene_start: 2.5, scene_end: 5 },
    { narration_text: 'သုံး', scene_start: 13, scene_end: 15 }
];

test('Sawaungthin TTS grouping uses the accepted gap and span thresholds', () => {
    const normal = buildSawaungthinTtsBlocks(narration, false);
    assert.deepEqual(normal.map(block => block.scenes), [[0, 1], [2]]);
    const dialogue = buildSawaungthinTtsBlocks(narration, true);
    assert.deepEqual(dialogue.map(block => block.scenes), [[0, 1], [2]]);
    assert.deepEqual(buildSawaungthinTtsBlocks([
        narration[0], { ...narration[1], scene_start: 4, scene_end: 7 }
    ], false).map(block => block.scenes), [[0], [1]]);
    assert.deepEqual(buildSawaungthinTtsBlocks([
        narration[0], { ...narration[1], scene_start: 4, scene_end: 7 }
    ], true).map(block => block.scenes), [[0, 1]]);
});

test('authoritative timeline uses Edge timing and preserves original Whisper windows', () => {
    const block = buildSawaungthinTtsBlocks(narration.slice(0, 2))[0];
    const charToTime = [0, 0.5, 0.9, 1.2, 1.5, 1.8, 2.2, 2.6, 3];
    const timeline = buildSawaungthinTimelineEntries({
        block, sceneNarration: narration, chunkDuration: 4, runningAudioTime: 7,
        charToTime
    });
    assert.deepEqual(timeline.map(item => [item.orig_start, item.orig_end]), [[0, 2], [2.5, 5]]);
    assert.equal(timeline[0].final_audio_start, 7);
    assert.equal(timeline.at(-1).final_audio_end, 11);
});

test('authoritative timeline proportional fallback consumes the entire normalized chunk', () => {
    const block = buildSawaungthinTtsBlocks(narration.slice(0, 2))[0];
    const timeline = buildSawaungthinTimelineEntries({
        block, sceneNarration: narration, chunkDuration: 6, runningAudioTime: 0
    });
    assert.equal(timeline[0].final_dur + timeline[1].final_dur, 6);
    assert.equal(
        timeline[0].final_dur / timeline[1].final_dur,
        narration[0].narration_text.length / narration[1].narration_text.length
    );
    assert.equal(timeline.at(-1).final_audio_end, 6);
});
