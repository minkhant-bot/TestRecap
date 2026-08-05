// Subtitle layout and chunking.
//
// Root cause this fixes: processor.js previously wrote one SRT cue per
// authoritative TTS-grouped narration segment, using that segment's full,
// unsplit text verbatim. A TTS group can span up to 12s (60s in dialogue
// mode) of narration, so its text could be a full paragraph. videoEffects.js
// burns subtitles with ASS WrapStyle=1 (automatic wrapping, no line-count
// cap), so a long cue could render as 3+ lines, or a short-box/long-line
// combination could produce very long lines -- neither is bounded.
//
// This module only decides how a narration segment's TEXT is split into
// display-ready subtitle CUES and how that segment's existing [start,end]
// window is subdivided among them. It never changes segment start/end
// totals (contiguous, sums exactly to the source window), never touches
// TTS audio, scene rebuild, or export -- those stay driven entirely by the
// authoritative TTS timeline, unchanged.

import { DEFAULT_SUBTITLE_POSITION } from './videoEffects.js';

export const MAX_LINES_PER_CUE = 2;

// Mirrors buildAssDocument's font-size derivation in videoEffects.js so the
// budget matches the default rendered subtitle box. No real Padauk
// font-metrics measurement is available server-side; AVERAGE_GLYPH_WIDTH_RATIO
// is a deliberately conservative (narrow) estimate of a Burmese glyph's
// average rendered width as a fraction of font size. Underestimating here
// only produces shorter, safer lines -- never overflowing ones.
const VIDEO_WIDTH_PX = 1080;
const VIDEO_HEIGHT_PX = 1920;
const AVERAGE_GLYPH_WIDTH_RATIO = 0.62;
const boxWidthPx = (DEFAULT_SUBTITLE_POSITION.widthPct / 100) * VIDEO_WIDTH_PX;
const fontSizePx = Math.min(80, Math.max(24,
  Math.round(((DEFAULT_SUBTITLE_POSITION.heightPct / 100) * VIDEO_HEIGHT_PX) * 0.6)));
export const MAX_CHARS_PER_LINE = Math.max(10, Math.floor(boxWidthPx / (fontSizePx * AVERAGE_GLYPH_WIDTH_RATIO)));
const MAX_CHARS_PER_CUE = MAX_CHARS_PER_LINE * MAX_LINES_PER_CUE;
// A cue this short (grapheme clusters, excluding line breaks) reads as an
// isolated one-/two-word fragment and should be merged into a neighbor when
// the merge still fits the cue budget.
const MIN_CUE_CHARS = 6;

const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

// Counts visual characters (grapheme clusters), not UTF-16 code units, so
// Burmese combining marks (medials, vowel signs, tone marks) are not
// overcounted as separate characters.
export const visualLength = text => segmenter
  ? [...segmenter.segment(String(text))].length
  : [...String(text)].length;

// Strong boundary: sentence-ending punctuation. Medium boundary: clause
// punctuation. Both are kept attached to the preceding text.
const STRONG_BOUNDARY = /(?<=[။!?.])\s*/u;
const MEDIUM_BOUNDARY = /(?<=[၊,])\s*/u;

const splitKeepingBoundary = (text, pattern) =>
  text.split(pattern).map(part => part.trim()).filter(part => part.length > 0);

// Greedily wraps a single chunk of text (already known to be a reasonable
// unit to keep together) into <= MAX_LINES_PER_CUE lines, breaking at word
// (space) boundaries. If a single word alone exceeds a full line, it is
// placed alone on its own line rather than broken mid-grapheme -- the one
// deliberately accepted "reasonably short" exception, for text with no
// natural break available.
const wrapIntoLines = text => {
  const tokens = text.trim().split(/(\s+)/).filter(token => token.length > 0);
  const lines = [];
  let current = '';
  let currentLen = 0;
  for (const token of tokens) {
    if (/^\s+$/.test(token)) {
      if (current.length > 0) current += token;
      continue;
    }
    const tokenLen = visualLength(token);
    if (current.length === 0) {
      current = token;
      currentLen = tokenLen;
      continue;
    }
    const projected = currentLen + tokenLen;
    if (projected <= MAX_CHARS_PER_LINE) {
      current += token;
      currentLen = projected;
    } else {
      lines.push(current.trimEnd());
      current = token;
      currentLen = tokenLen;
    }
  }
  if (current.length > 0) lines.push(current.trimEnd());
  return lines;
};

// Wraps arbitrarily long text into one or more cue TEXT blocks, each
// containing at most MAX_LINES_PER_CUE lines joined by "\n". Used both for
// a single oversized boundary unit and as the final per-cue line-fill step.
const wrapIntoCueBlocks = text => {
  const lines = wrapIntoLines(text);
  const blocks = [];
  for (let index = 0; index < lines.length; index += MAX_LINES_PER_CUE) {
    blocks.push(lines.slice(index, index + MAX_LINES_PER_CUE).join('\n'));
  }
  return blocks.length > 0 ? blocks : [''];
};

// Splits segment text into candidate cue text blocks, preferring to break
// at sentence boundaries, then clause boundaries, then word boundaries --
// never inside a word unless a single word alone cannot fit one line.
const splitIntoCandidateBlocks = text => {
  const sentences = splitKeepingBoundary(text, STRONG_BOUNDARY);
  const blocks = [];
  let current = '';
  const flush = () => {
    if (current.length > 0) {
      blocks.push(...wrapIntoCueBlocks(current));
      current = '';
    }
  };
  for (const sentence of sentences) {
    const projected = current.length > 0 ? `${current} ${sentence}` : sentence;
    if (visualLength(projected) <= MAX_CHARS_PER_CUE) {
      current = projected;
      continue;
    }
    // The running accumulation plus this sentence would overflow. Flush what
    // we have, then decide how to place this sentence on its own.
    flush();
    if (visualLength(sentence) <= MAX_CHARS_PER_CUE) {
      current = sentence;
      continue;
    }
    // This single sentence alone is too long for one cue: fall back to
    // clause boundaries within it before falling back further to raw
    // word-wrapping (handled inside wrapIntoCueBlocks).
    const clauses = splitKeepingBoundary(sentence, MEDIUM_BOUNDARY);
    let clauseAccumulator = '';
    for (const clause of clauses) {
      const projectedClause = clauseAccumulator.length > 0
        ? `${clauseAccumulator} ${clause}` : clause;
      if (visualLength(projectedClause) <= MAX_CHARS_PER_CUE) {
        clauseAccumulator = projectedClause;
        continue;
      }
      if (clauseAccumulator.length > 0) {
        blocks.push(...wrapIntoCueBlocks(clauseAccumulator));
      }
      clauseAccumulator = clause;
    }
    if (clauseAccumulator.length > 0) blocks.push(...wrapIntoCueBlocks(clauseAccumulator));
  }
  flush();
  return blocks.filter(block => block.length > 0);
};

// A block reads as an isolated fragment -- and should be merged into a
// neighbor when possible -- if it is one or two words (Burmese words are
// often single unspaced tokens, so word-count, not just character count, is
// the literal "one-word/two-word" signal), or if it is simply very short.
const isFragment = block => {
  const flat = block.replace(/\n/g, ' ').trim();
  const words = flat.split(/\s+/).filter(Boolean);
  return words.length <= 2 || visualLength(flat) < MIN_CUE_CHARS;
};

// Merges two adjacent blocks only when re-wrapping the combined text
// collapses to exactly one block -- never a heuristic character-count
// guess -- so the 2-line cap can never be violated by a merge.
const tryMerge = (first, second) => {
  const combined = `${first.replace(/\n/g, ' ')} ${second.replace(/\n/g, ' ')}`;
  if (visualLength(combined) > MAX_CHARS_PER_CUE) return null;
  const rewrapped = wrapIntoCueBlocks(combined);
  return rewrapped.length === 1 ? rewrapped[0] : null;
};

// Merges an isolated short fragment into a neighboring block -- preferring
// the preceding cue to keep reading order stable, falling back to the next
// cue for a leading fragment -- so a lone one-/two-word cue only ever
// remains when merging is genuinely not possible. Every successful merge
// strictly reduces the block count by one, so this always terminates.
const mergeShortFragments = blocks => {
  const merged = [...blocks];
  let changed = true;
  while (changed && merged.length > 1) {
    changed = false;
    for (let index = 0; index < merged.length; index += 1) {
      if (!isFragment(merged[index])) continue;
      if (index > 0) {
        const result = tryMerge(merged[index - 1], merged[index]);
        if (result) {
          merged.splice(index - 1, 2, result);
          changed = true;
          break;
        }
      }
      if (index < merged.length - 1) {
        const result = tryMerge(merged[index], merged[index + 1]);
        if (result) {
          merged.splice(index, 2, result);
          changed = true;
          break;
        }
      }
    }
  }
  return merged;
};

// Splits one authoritative narration segment ({ text, timestamp: [start,end] })
// into one or more subtitle cues. Cue text blocks may contain a single "\n"
// for a two-line cue. Cue time slices are contiguous, proportional to each
// block's visual text length, and sum exactly to the source [start,end].
export const splitSegmentIntoCues = segment => {
  const text = String(segment?.text ?? '').trim();
  const [start, end] = segment?.timestamp || [];
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) {
    return text ? [{ text, timestamp: [start, end] }] : [];
  }
  const blocks = mergeShortFragments(splitIntoCandidateBlocks(text));
  if (blocks.length <= 1) {
    return [{ text: blocks[0] ?? text, timestamp: [start, end] }];
  }
  const weights = blocks.map(block => Math.max(1, visualLength(block.replace(/\n/g, ' '))));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const duration = end - start;
  const cues = [];
  let cursor = start;
  blocks.forEach((block, index) => {
    const isLast = index === blocks.length - 1;
    const cueEnd = isLast ? end : cursor + (duration * weights[index]) / totalWeight;
    cues.push({ text: block, timestamp: [cursor, cueEnd] });
    cursor = cueEnd;
  });
  return cues;
};

// Applies splitSegmentIntoCues across a full narration transcript (the
// authoritative per-TTS-group segments), preserving order and yielding the
// flat list of subtitle cues to write into the SRT.
export const buildSubtitleCues = narrationTranscript =>
  (narrationTranscript || []).flatMap(segment => splitSegmentIntoCues(segment));
