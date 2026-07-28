import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildGeminiTranscriptionPrompt,
    buildNarrationGroups,
    parseGeminiTranscriptResponse
} from './index.js';
import { buildGroupedNarrationAudioComposition } from '../workers/groupedAudioComposition.js';

const longSpeechClauses = [
    {
        timestamp: [10, 13.2],
        text: 'When the door opened, I looked inside.',
        translatedText: 'တံခါးပွင့်လာတော့ ကျွန်တော် အထဲကို ကြည့်လိုက်တယ်။',
        kind: 'dialogue',
        speaker: 'speaker_1'
    },
    {
        timestamp: [13.2, 17],
        text: 'The room was empty, but the light was still on.',
        translatedText: 'အခန်းက ဗလာဖြစ်နေပေမယ့် မီးကတော့ လင်းနေတုန်းပဲ။',
        kind: 'dialogue',
        speaker: 'speaker_1'
    },
    {
        timestamp: [17, 21.5],
        text: 'So I called your name and waited for an answer.',
        translatedText: 'ဒါကြောင့် မင်းနာမည်ကို ခေါ်ပြီး အဖြေပြန်လာမလား စောင့်နေခဲ့တယ်။',
        kind: 'dialogue',
        speaker: 'speaker_1'
    }
];

test('Gemini prompt requires independently source-timed natural clauses', () => {
    const prompt = buildGeminiTranscriptionPrompt(30);
    assert.match(prompt, /normally 2–6 seconds each/);
    assert.match(prompt, /independently by listening to the source audio/);
    assert.match(prompt, /Never calculate sub-segment timestamps proportionally/);
    assert.match(prompt, /gap between consecutive records must not exceed 2 seconds/);
    assert.match(prompt, /Preserve Burmese Unicode grapheme clusters intact/);
    assert.match(prompt, /Never emit punctuation-only/);
});

test('long multi-clause speech retains independent timestamps, order, meaning, kind, speaker, and Burmese graphemes', () => {
    const parsed = parseGeminiTranscriptResponse(JSON.stringify(longSpeechClauses), 30);
    assert.deepEqual(parsed, longSpeechClauses);
    assert.deepEqual(parsed.map(segment => segment.timestamp), [[10, 13.2], [13.2, 17], [17, 21.5]]);
    assert.deepEqual(parsed.map(segment => segment.kind), ['dialogue', 'dialogue', 'dialogue']);
    assert.deepEqual(parsed.map(segment => segment.speaker), ['speaker_1', 'speaker_1', 'speaker_1']);
    assert.equal(parsed[2].translatedText, longSpeechClauses[2].translatedText);
});

test('Gemini parser rejects an unsplit long record and punctuation-only records', () => {
    assert.throws(() => parseGeminiTranscriptResponse(JSON.stringify([{
        ...longSpeechClauses[0],
        timestamp: [10, 16.31]
    }]), 30), /exceeds the maximum natural clause duration/);

    assert.throws(() => parseGeminiTranscriptResponse(JSON.stringify([{
        timestamp: [0, 1],
        text: '...',
        translatedText: '…။',
        kind: 'narration'
    }]), 30), /punctuation-only text/);
});

test('short natural utterances remain valid clause records', () => {
    const shortReply = [{
        timestamp: [2, 2.8],
        text: 'Yes.',
        translatedText: 'ဟုတ်ကဲ့။',
        kind: 'dialogue',
        speaker: 'speaker_2'
    }];
    assert.deepEqual(parseGeminiTranscriptResponse(JSON.stringify(shortReply), 10), shortReply);
});

test('synchronization resets at every source-derived clause timestamp', () => {
    const parsed = parseGeminiTranscriptResponse(JSON.stringify(longSpeechClauses), 30);
    const groups = buildNarrationGroups(parsed.map(segment => ({
        scene_start: segment.timestamp[0],
        scene_end: segment.timestamp[1],
        narration_text: segment.translatedText,
        kind: segment.kind,
        speaker: segment.speaker
    })));
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].segments.map(segment => [segment.orig_start, segment.orig_end]), [[10, 13.2], [13.2, 17], [17, 21.5]]);

    let sourceCursor = 0;
    const authoritativeTimeline = [{
        text: groups[0].text,
        segments: groups[0].segments.map((segment, index) => {
            const duration = segment.orig_end - segment.orig_start;
            const mapped = {
                index,
                text: segment.text,
                kind: segment.kind,
                speaker: segment.speaker,
                orig_start: segment.orig_start,
                orig_end: segment.orig_end,
                final_audio_start: sourceCursor,
                final_audio_end: sourceCursor + duration
            };
            sourceCursor += duration;
            return mapped;
        })
    }];

    const composition = buildGroupedNarrationAudioComposition(authoritativeTimeline, 30);
    assert.deepEqual(
        composition.segmentMappings.map(segment => segment.final_placement_timestamp),
        [10, 13.2, 17]
    );
    assert.match(composition.filterComplex, /adelay=10000:all=1/);
    assert.match(composition.filterComplex, /adelay=13200:all=1/);
    assert.match(composition.filterComplex, /adelay=17000:all=1/);
});
