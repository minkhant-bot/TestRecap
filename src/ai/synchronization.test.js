import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContinuousNarrationBlocks, splitNarrationText, splitTimedNarrationBlock, waitForAllTtsWorkers, getTtsRetryDelayMs, isSpeakableTtsText, mergeOrphanTtsBlocks, buildNarrationGroups, assignNarrationGroupAnchors, mergeNarrationGroups, distributeNarrationGroupAudio, createTtsNarrationFingerprint} from './index.js';

test('keeps short timestamped narration in its original source slot', () => {
    const blocks = buildContinuousNarrationBlocks([{
        narration_text: 'မင်္ဂလာပါ', scene_start: 12.5, scene_end: 15
    }]);
    assert.deepEqual(blocks, [{
        scenes: [0], mergedText: 'မင်္ဂလာပါ', orig_start: 12.5, orig_end: 15
    }]);
});

test('splits long narration without changing word content or source duration', () => {
    const text = Array.from({ length: 50 }, (_, i) => `စကား${i}`).join(' ');
    const parts = splitNarrationText(text, 40);
    assert.ok(parts.length > 1);
    assert.equal(parts.join(' '), text);

    const blocks = buildContinuousNarrationBlocks([{
        narration_text: text, scene_start: 20, scene_end: 30
    }]);
    assert.equal(blocks[0].orig_start, 20);
    assert.equal(blocks.at(-1).orig_end, 30);
    for (let i = 1; i < blocks.length; i++) {
        assert.equal(blocks[i].orig_start, blocks[i - 1].orig_end);
    }
    assert.equal(blocks.map(block => block.mergedText).join(' '), text);
});


test('retry splitting preserves text and distributes the same timestamp window', () => {
    const original = {
        scenes: [3],
        mergedText: 'ပထမ စာသား ဒုတိယ စာသား တတိယ စာသား စတုတ္ထ စာသား',
        orig_start: 40,
        orig_end: 48
    };
    const split = splitTimedNarrationBlock(original);
    assert.ok(split.length >= 2);
    assert.equal(split.map(block => block.mergedText).join(' '), original.mergedText);
    assert.equal(split[0].orig_start, original.orig_start);
    assert.equal(split.at(-1).orig_end, original.orig_end);
    for (let i = 1; i < split.length; i++) {
        assert.equal(split[i].orig_start, split[i - 1].orig_end);
    }
});


test('waits for every TTS worker and preserves the first observed error', async () => {
    const firstError = new Error('first TTS generation error');
    let slowWorkerSettled = false;
    const slowWorker = new Promise((_, reject) => {
        setTimeout(() => {
            slowWorkerSettled = true;
            reject(new Error('later worker error'));
        }, 25);
    });
    const firstFailingWorker = new Promise((_, reject) => {
        setTimeout(() => reject(firstError), 5);
    });

    await assert.rejects(
        waitForAllTtsWorkers([slowWorker, firstFailingWorker]),
        error => {
            assert.equal(error, firstError);
            assert.equal(slowWorkerSettled, true);
            return true;
        }
    );
});


test('uses bounded exponential TTS retry backoff', () => {
    assert.deepEqual([1, 2, 3, 4, 5].map(getTtsRetryDelayMs), [500, 1000, 2000, 4000, 4000]);
});


test('attaches an orphan Burmese full stop to the previous speakable split', () => {
    const text = 'ကျန်တဲ့ငွေက ၈ ယွမ်ပဲရှိတော့တယ်။';
    const blocks = splitTimedNarrationBlock({
        scenes: [8], mergedText: text, orig_start: 34.33, orig_end: 35.8
    });
    assert.ok(blocks.every(block => isSpeakableTtsText(block.mergedText)));
    assert.equal(blocks.map(block => block.mergedText).join(' '), text);
    assert.equal(blocks[0].orig_start, 34.33);
    assert.equal(blocks.at(-1).orig_end, 35.8);
    assert.ok(blocks.at(-1).mergedText.endsWith('။'));
});

test('attaches leading punctuation to the next speakable block', () => {
    const blocks = mergeOrphanTtsBlocks([
        { mergedText: '။', orig_start: 1, orig_end: 1.1 },
        { mergedText: 'နောက်စာသား', orig_start: 1.1, orig_end: 2 }
    ]);
    assert.deepEqual(blocks, [{ mergedText: '။နောက်စာသား', orig_start: 1, orig_end: 2 }]);
    assert.ok(isSpeakableTtsText(blocks[0].mergedText));
});

test('attaches punctuation and whitespace to the previous neighboring text in order', () => {
    const blocks = mergeOrphanTtsBlocks([
        { mergedText: 'ရှေ့စာသား', orig_start: 2, orig_end: 3 },
        { mergedText: '!?', orig_start: 3, orig_end: 3.1 },
        { mergedText: ' ', orig_start: 3.1, orig_end: 3.2 },
        { mergedText: 'နောက်စာသား', orig_start: 3.2, orig_end: 4 }
    ]);
    assert.deepEqual(blocks, [
        { mergedText: 'ရှေ့စာသား!? ', orig_start: 2, orig_end: 3.2 },
        { mergedText: 'နောက်စာသား', orig_start: 3.2, orig_end: 4 }
    ]);
    assert.ok(blocks.every(block => isSpeakableTtsText(block.mergedText)));
    assert.equal(blocks.map(block => block.mergedText).join(''), 'ရှေ့စာသား!? နောက်စာသား');
});


test('rejects an entirely punctuation-only narration instead of sending it to TTS', () => {
    assert.throws(
        () => mergeOrphanTtsBlocks([{ mergedText: ' ။!? ', orig_start: 0, orig_end: 1 }]),
        /no speakable text/
    );
});



test('merges dense zero-gap transcript segments into one continuous narration group', () => {
    const transcript = Array.from({ length: 12 }, (_, index) => ({
        narration_text: `စာပိုဒ် ${index}။`,
        scene_start: index,
        scene_end: index + 1
    }));
    const groups = buildNarrationGroups(transcript);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].segments.length, transcript.length);
    assert.deepEqual(
        groups[0].segments.map(segment => [segment.text, segment.orig_start, segment.orig_end]),
        transcript.map(segment => [segment.narration_text, segment.scene_start, segment.scene_end])
    );
    assert.ok(isSpeakableTtsText(groups[0].mergedText));
});

test('resynchronizes only at safe narration boundaries', () => {
    const groups = buildNarrationGroups([
        { narration_text: 'ပထမစာကြောင်း။', scene_start: 1, scene_end: 3 },
        { narration_text: 'ဒုတိယစာကြောင်း။', scene_start: 3, scene_end: 5 },
        { narration_text: 'နောက်အခန်း။', scene_start: 8, scene_end: 10 }
    ]);
    const anchored = assignNarrationGroupAnchors(groups, 12);

    assert.equal(anchored.length, 2);
    assert.deepEqual(
        anchored.map(group => [group.anchor_start, group.anchor_end]),
        [[1, 8], [8, 12]]
    );
});

test('distributes group audio while preserving every original anchor metadata record', () => {
    const group = buildNarrationGroups([
        { narration_text: 'တို', scene_start: 10, scene_end: 10.2 },
        { narration_text: 'စာသားအရှည်', scene_start: 10.2, scene_end: 10.4 },
        { narration_text: '။', scene_start: 10.4, scene_end: 10.5 }
    ])[0];
    const distributed = distributeNarrationGroupAudio(group, 4, 6);

    assert.equal(distributed.length, 3);
    assert.deepEqual(
        distributed.map(segment => [segment.text, segment.orig_start, segment.orig_end]),
        [['တို', 10, 10.2], ['စာသားအရှည်', 10.2, 10.4], ['။', 10.4, 10.5]]
    );
    assert.equal(distributed[0].final_audio_start, 4);
    assert.equal(distributed.at(-1).final_audio_end, 10);
    for (let index = 1; index < distributed.length; index++) {
        assert.equal(distributed[index].final_audio_start, distributed[index - 1].final_audio_end);
    }
});

test('merges an overlong group across a narration boundary without changing text metadata', () => {
    const groups = buildNarrationGroups([
        { narration_text: 'ပထမ။', scene_start: 0, scene_end: 1 },
        { narration_text: 'ဒုတိယ။', scene_start: 4, scene_end: 5 }
    ]);
    const merged = mergeNarrationGroups(groups, 0);

    assert.equal(merged.length, 1);
    assert.deepEqual(merged[0].segments.map(segment => segment.text), ['ပထမ။', 'ဒုတိယ။']);
    assert.deepEqual(merged[0].segments.map(segment => [segment.orig_start, segment.orig_end]), [[0, 1], [4, 5]]);
    assert.ok(isSpeakableTtsText(merged[0].mergedText));
});

test('attaches punctuation-only transcript records without sending a punctuation-only group', () => {
    const groups = buildNarrationGroups([
        { narration_text: '။', scene_start: 0, scene_end: 0.1 },
        { narration_text: 'မင်္ဂလာပါ', scene_start: 2, scene_end: 3 }
    ]);

    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].segments.map(segment => segment.text), ['။', 'မင်္ဂလာပါ']);
    assert.ok(isSpeakableTtsText(groups[0].mergedText));
});

test('dialogue grouping never merges different speakers or narration records', () => {
    const transcript = [
        { narration_text: 'မင်း ဘယ်သွားမလို့လဲ။', scene_start: 0, scene_end: 1, kind: 'dialogue', speaker: 'a' },
        { narration_text: 'ငါ အိမ်ပြန်မလို့။', scene_start: 1, scene_end: 2, kind: 'dialogue', speaker: 'b' },
        { narration_text: 'သူတို့ ထွက်သွားကြတယ်။', scene_start: 2, scene_end: 3, kind: 'narration', speaker: 'narrator' },
        { narration_text: 'ခဏစောင့်ဦး။', scene_start: 3, scene_end: 4, kind: 'dialogue', speaker: 'a' }
    ];
    const groups = buildNarrationGroups(transcript, { mode: 'dialogue' });
    assert.equal(groups.length, 4);
    assert.deepEqual(groups.map(group => [group.kind, group.speaker]), [
        ['dialogue', 'a'], ['dialogue', 'b'], ['narration', 'narrator'], ['dialogue', 'a']
    ]);
    assert.ok(groups.every(group => new Set(group.segments.map(segment => segment.speaker)).size === 1));
});

test('unified grouping keeps adjacent same-speaker dialogue and uses their original window', () => {
    const groups = buildNarrationGroups([
        { narration_text: 'ပထမစကား။', scene_start: 5, scene_end: 6, kind: 'dialogue', speaker: 'a' },
        { narration_text: 'ဒုတိယစကား။', scene_start: 6.2, scene_end: 7.5, kind: 'dialogue', speaker: 'a' }
    ]);
    assert.equal(groups.length, 1);
    const [anchored] = assignNarrationGroupAnchors(groups, 20);
    assert.deepEqual([anchored.anchor_start, anchored.anchor_end], [4, 8.5]);
});

test('TTS cache fingerprint isolates kind, speaker, timing, voice, and duration', () => {
    const args = {
        sceneNarration: [{ narration_text: 'စာသား', scene_start: 0, scene_end: 2, kind: 'dialogue', speaker: 'a' }],
        edgeVoice: 'voice', pitch: '+0Hz', rate: '+0%', videoDuration: 2
    };
    const original = createTtsNarrationFingerprint(args);
    assert.notEqual(original, createTtsNarrationFingerprint({ ...args, sceneNarration: [{ ...args.sceneNarration[0], speaker: 'b' }] }));
    assert.notEqual(original, createTtsNarrationFingerprint({ ...args, sceneNarration: [{ ...args.sceneNarration[0], narration_text: 'အခြားစာသား' }] }));
    assert.notEqual(original, createTtsNarrationFingerprint({ ...args, sceneNarration: [{ ...args.sceneNarration[0], scene_start: 0.1 }] }));
    assert.notEqual(original, createTtsNarrationFingerprint({ ...args, pitch: '+2Hz' }));
    assert.notEqual(original, createTtsNarrationFingerprint({ ...args, rate: '+5%' }));
    assert.notEqual(original, createTtsNarrationFingerprint({ ...args, sourceFingerprint: 'different-source' }));
    assert.notEqual(original, createTtsNarrationFingerprint({ ...args, videoDuration: 3 }));
    assert.notEqual(original, createTtsNarrationFingerprint({ ...args, edgeVoice: 'other' }));
});


test('uses Edge subtitle boundaries instead of proportional text weights for segment slices', () => {
    const group = {
        mergedText: 'ပထမ ဒုတိယ တို',
        segments: [
            { index: 0, text: 'ပထမ', orig_start: 0, orig_end: 1, kind: 'narration', speaker: 'narrator' },
            { index: 1, text: 'ဒုတိယ', orig_start: 1, orig_end: 2, kind: 'dialogue', speaker: 'a' },
            { index: 2, text: 'တို', orig_start: 2, orig_end: 3, kind: 'dialogue', speaker: 'b' }
        ]
    };
    const spokenText = group.mergedText;
    const secondOffset = spokenText.indexOf('ဒုတိယ');
    const thirdOffset = spokenText.indexOf('တို');
    const subtitleParts = [
        { part: spokenText.slice(0, secondOffset), start: 100, end: 900 },
        { part: spokenText.slice(secondOffset, thirdOffset), start: 1300, end: 2100 },
        { part: spokenText.slice(thirdOffset), start: 2600, end: 3200 }
    ];
    const distributed = distributeNarrationGroupAudio(group, 10, 4, {
        subtitleParts, spokenText, requireSubtitleBoundaries: true
    });
    assert.deepEqual(distributed.map(item => [item.final_audio_start, item.final_audio_end]), [
        [10, 11.3], [11.3, 12.6], [12.6, 14]
    ]);
    assert.deepEqual(distributed.map(item => [item.index, item.kind, item.speaker]), [
        [0, 'narration', 'narrator'], [1, 'dialogue', 'a'], [2, 'dialogue', 'b']
    ]);
});

test('rejects missing Edge subtitle boundaries in authoritative pipeline mode', () => {
    const group = buildNarrationGroups([
        { narration_text: 'စာသား', scene_start: 0, scene_end: 1, kind: 'narration' }
    ])[0];
    assert.throws(() => distributeNarrationGroupAudio(group, 0, 1, {
        subtitleParts: [], spokenText: group.mergedText, requireSubtitleBoundaries: true
    }), /subtitle boundaries are missing or invalid/);
});
