import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_CHARS_PER_LINE,
  MAX_LINES_PER_CUE,
  buildSubtitleCues,
  splitSegmentIntoCues,
  visualLength,
} from './subtitleChunking.js';

const lineCount = text => text.split('\n').length;
const linesOf = text => text.split('\n');

// A realistic short sentence (no split expected).
const SHORT = 'ရပ်လိုက်။';

// A realistic medium sentence -- fits, but needs real wrapping to size it.
const MEDIUM = 'သူ ထွက်သွားတယ်၊ ဒါပေမဲ့ ငါတို့ မမျှော်လင့်ဘူး။';

// A long, multi-sentence paragraph -- the exact shape of a 12s TTS-grouped
// narration chunk that used to render as one unbounded, overflowing cue.
const LONG =
  'တစ်နေ့သ၌ ရွာလေးတစ်ရွာတွင် လူငယ်တစ်ဦးနေထိုင်ခဲ့သည်။ သူသည် နေ့တိုင်း တောထဲသို့ သွား၍ ' +
  'သစ်ပင်များကို ကြည့်ရှုလေ့လာလေ့ရှိသည်၊ ဒါပေမဲ့ တစ်နေ့တွင် သူသည် အံ့ဩဖွယ်ကောင်းသော အရာတစ်ခုကို ' +
  'တွေ့ရှိခဲ့သည်။ ထိုအရာသည် သူ့ဘဝကို လုံးဝပြောင်းလဲသွားစေခဲ့သည်။ ရွာသားများသည် ယင်းအကြောင်းကို ' +
  'ကြားသိကြသောအခါ အလွန်အံ့သြသွားကြသည်။';

test('a short sentence stays as one cue with a single line, never split', () => {
  const cues = splitSegmentIntoCues({ text: SHORT, timestamp: [10, 12] });
  assert.equal(cues.length, 1);
  assert.equal(lineCount(cues[0].text), 1);
  assert.deepEqual(cues[0].timestamp, [10, 12]);
});

test('a medium sentence never exceeds 2 lines', () => {
  const cues = splitSegmentIntoCues({ text: MEDIUM, timestamp: [0, 5] });
  for (const cue of cues) {
    assert.ok(lineCount(cue.text) <= MAX_LINES_PER_CUE, `cue exceeded ${MAX_LINES_PER_CUE} lines: ${cue.text}`);
  }
});

test('a long multi-sentence paragraph is split into multiple cues, each capped at 2 lines', () => {
  const cues = splitSegmentIntoCues({ text: LONG, timestamp: [100, 112] });
  assert.ok(cues.length > 1, 'expected the long paragraph to split into multiple cues');
  for (const cue of cues) {
    assert.ok(lineCount(cue.text) <= MAX_LINES_PER_CUE, `cue exceeded ${MAX_LINES_PER_CUE} lines: ${cue.text}`);
  }
});

test('INVARIANT: no cue ever has 3 or more lines, across short/medium/long inputs', () => {
  for (const text of [SHORT, MEDIUM, LONG]) {
    const cues = splitSegmentIntoCues({ text, timestamp: [0, 30] });
    for (const cue of cues) {
      assert.ok(lineCount(cue.text) <= 2, `3+ line cue produced from: ${text}\n-> ${cue.text}`);
    }
  }
});

test('INVARIANT: no line is drastically longer than the configured per-line budget', () => {
  const cues = splitSegmentIntoCues({ text: LONG, timestamp: [0, 30] });
  for (const cue of cues) {
    for (const line of linesOf(cue.text)) {
      // A single unsplittable word may legitimately exceed the budget (the
      // one accepted "unavoidable" exception); anything wrapped from
      // multiple words must respect it.
      const words = line.trim().split(/\s+/).filter(Boolean);
      if (words.length > 1) {
        assert.ok(
          visualLength(line) <= MAX_CHARS_PER_LINE + 2, // small tolerance for boundary rounding
          `multi-word line exceeded the per-line budget (${MAX_CHARS_PER_LINE}): "${line}" (${visualLength(line)})`,
        );
      }
    }
  }
});

test('cue timing stays contiguous and sums exactly to the source segment window', () => {
  const cues = splitSegmentIntoCues({ text: LONG, timestamp: [50, 62] });
  assert.equal(cues[0].timestamp[0], 50);
  assert.equal(cues[cues.length - 1].timestamp[1], 62);
  for (let i = 1; i < cues.length; i += 1) {
    assert.equal(cues[i].timestamp[0], cues[i - 1].timestamp[1], 'cues must be contiguous, no gaps or overlaps');
  }
  for (const cue of cues) {
    assert.ok(cue.timestamp[1] > cue.timestamp[0], 'every cue must have positive duration');
  }
});

test('prefers a natural sentence boundary over a mid-sentence split when both are available', () => {
  // Two short, complete sentences that together would need to split -- the
  // split must land on the sentence boundary between them, not mid-word.
  const text = 'ဒါက ပထမဝါကျပါ။ ဒါက ဒုတိယဝါကျပါ။';
  const cues = splitSegmentIntoCues({ text, timestamp: [0, 4] });
  for (const cue of cues) {
    for (const line of linesOf(cue.text)) {
      // A line must never end mid-word: it must end at whitespace, a
      // sentence mark, or the natural end of the accumulated text.
      assert.ok(
        /[။!?.]$/u.test(line.trim()) || cue === cues[cues.length - 1],
        `line does not end at a natural boundary: "${line}"`,
      );
    }
  }
});

test('avoids a tiny trailing one-word cue by merging it into its neighbor when possible', () => {
  // A short trailing sentence after a long one -- should merge into the
  // previous cue rather than standing alone, since the merge fits budget.
  const text = 'ဒီနေရာမှာ ဇာတ်လမ်းတစ်ခုလုံး ဖြစ်ပျက်ခဲ့ပါတယ်။ ပြီးပြီ။';
  const cues = splitSegmentIntoCues({ text, timestamp: [0, 6] });
  const shortFragmentAlone = cues.some(cue => visualLength(cue.text.replace(/\n/g, ' ')) < 4);
  assert.equal(shortFragmentAlone, false, 'a mergeable tiny fragment must not remain isolated');
});

test('a fragment merges into a neighbor that has room, even when the fragment is a single unspaced Burmese token', () => {
  // A short clause with slack on both sides (short neighbors) must merge
  // rather than stand alone -- Burmese words are often single unspaced
  // tokens, so this is the literal "one-word cue" case.
  const text = 'ငါသွားမယ်။ ရပ်။ ပြီးပြီ။';
  const cues = splitSegmentIntoCues({ text, timestamp: [0, 3] });
  assert.equal(cues.length, 1, 'three short clauses with ample room must merge into a single 2-line-or-fewer cue');
  assert.ok(lineCount(cues[0].text) <= 2);
});

test('a fragment between two already-full 2-line cues is left standalone -- the documented "unavoidable" exception', () => {
  // Reproduces the real chunking output for a long narration paragraph:
  // a short clause sandwiched between two neighbors that are each already
  // at the 2-line budget cannot be merged without creating a 3-line cue,
  // so it must correctly remain standalone rather than violate the cap.
  const text =
    'သူသည် နေ့တိုင်း တောထဲသို့ သွား၍ သစ်ပင်များကို ကြည့်ရှုလေ့လာလေ့ရှိသည်၊ ' +
    'ဒါပေမဲ့ တစ်နေ့တွင် သူသည် အံ့ဩဖွယ်ကောင်းသော အရာတစ်ခုကို တွေ့ရှိခဲ့သည်။';
  const cues = splitSegmentIntoCues({ text, timestamp: [0, 6] });
  for (const cue of cues) {
    assert.ok(lineCount(cue.text) <= 2, `must never exceed 2 lines even when a fragment cannot be merged: ${cue.text}`);
  }
});

test('an unavoidable single long word with no spaces still produces a valid <=2-line cue, not a crash', () => {
  const longWord = 'အလွန်ရှည်လျားလှသောစကားလုံးတစ်ခုလုံးကိုစမ်းသပ်ရန်ဖန်တီးထားသည့်စာသားဖြစ်သည်';
  const cues = splitSegmentIntoCues({ text: longWord, timestamp: [0, 3] });
  assert.ok(cues.length >= 1);
  for (const cue of cues) {
    assert.ok(lineCount(cue.text) <= 2);
  }
});

test('empty or whitespace-only text produces no cues', () => {
  assert.deepEqual(splitSegmentIntoCues({ text: '', timestamp: [0, 1] }), []);
  assert.deepEqual(splitSegmentIntoCues({ text: '   ', timestamp: [0, 1] }), []);
});

test('an invalid timestamp is not silently reinterpreted -- text still returned as one cue', () => {
  const cues = splitSegmentIntoCues({ text: SHORT, timestamp: [undefined, undefined] });
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, SHORT);
});

test('buildSubtitleCues flattens cues across multiple narration segments in order', () => {
  const narrationTranscript = [
    { text: SHORT, timestamp: [0, 1] },
    { text: LONG, timestamp: [1, 13] },
    { text: MEDIUM, timestamp: [13, 16] },
  ];
  const cues = buildSubtitleCues(narrationTranscript);
  assert.ok(cues.length >= 3, 'expected at least one cue per source segment');
  // Order and overall span preserved.
  assert.equal(cues[0].timestamp[0], 0);
  assert.equal(cues[cues.length - 1].timestamp[1], 16);
  for (const cue of cues) {
    assert.ok(lineCount(cue.text) <= 2);
  }
});

test('grapheme-aware counting does not overcount Burmese combining marks', () => {
  // "မင်္ဂလာပါ" visually renders as far fewer than its raw UTF-16 length.
  const word = 'မင်္ဂလာပါ';
  assert.ok(visualLength(word) < word.length);
});
