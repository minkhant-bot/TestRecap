import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// generateNarrationTTS itself drives a real Edge TTS websocket connection
// and ffmpeg, so it isn't practical to execute end-to-end here (no existing
// test in this file does that either -- see synchronization.test.js, which
// tests the pure helpers directly). This locks in the integration wiring at
// the source level instead: TTS synthesis must run on Burmese-number-
// normalized text, while the timeline's `text` field (which becomes the
// subtitle/transcript, see processor.js) must be restored to the original,
// un-normalized narration text.
const source = fs.readFileSync(new URL('./sawaungthinTts.js', import.meta.url), 'utf8');

test('narration is normalized into a separate TTS-only copy before blocks are built for synthesis', () => {
    assert.match(source, /import \{ normalizeNumbersForBurmeseTts \} from '\.\/burmeseNumberNormalization\.js';/);
    assert.match(
        source,
        /const ttsSceneNarration = sceneNarration\.map\(scene => \(\{\s*\.\.\.scene,\s*narration_text: normalizeNumbersForBurmeseTts\(scene\.narration_text\)\s*\}\)\);/,
    );
    // The blocks actually sent to synthesizeEdgeTts must come from the
    // normalized copy, not the original sceneNarration.
    assert.match(source, /buildSawaungthinTtsBlocks\(ttsSceneNarration, isDialogue\)/);
    assert.doesNotMatch(source, /buildSawaungthinTtsBlocks\(sceneNarration, isDialogue\)/);
});

test('the authoritative timeline restores each entry\'s text to the original, un-normalized narration', () => {
    // Character-index timing math must use ttsSceneNarration (the lengths
    // EdgeTTS actually spoke), not the original sceneNarration.
    assert.match(source, /sceneNarration: ttsSceneNarration, chunkDuration: actualFinalDur, runningAudioTime, charToTime/);
    // But the emitted `text` field -- which processor.js turns directly
    // into subtitle cues and the SRT file -- must come back from the
    // original sceneNarration, keyed by chunk_index, so a viewer never
    // sees "တစ်ဆယ့်ရှစ်" where the translated transcript said "18".
    assert.match(
        source,
        /\.map\(entry => \(\{ \.\.\.entry, text: sceneNarration\[entry\.chunk_index\]\.narration_text \}\)\)/,
    );
});

test('the cache algorithm version was bumped so pre-fix cached audio (raw digits) is never reused', () => {
    assert.match(source, /SAWAUNGTHIN_TTS_ALGORITHM_VERSION = 'sawaungthin-edge-tts-continuous-v2'/);
});

test('sceneNarration itself (used for the cache fingerprint) is never mutated by the normalization step', () => {
    // ttsSceneNarration must be built via .map() producing new objects, not
    // by mutating sceneNarration in place -- otherwise the narrationFingerprint
    // hash (computed from sceneNarration above this point in the file) and
    // any other consumer of the original array would see normalized text.
    const ttsCopyIndex = source.indexOf('const ttsSceneNarration');
    const fingerprintIndex = source.indexOf('narrationFingerprint');
    assert.ok(fingerprintIndex !== -1 && ttsCopyIndex !== -1 && fingerprintIndex < ttsCopyIndex,
        'the fingerprint must be computed from the original sceneNarration, before any TTS-only copy exists');
});
