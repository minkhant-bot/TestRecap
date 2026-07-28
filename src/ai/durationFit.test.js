import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildDurationFitPrompt,
    DURATION_FIT_RESPONSE_SCHEMA,
    fitTtsSegmentDuration,
    MAX_TTS_TEMPO,
    rewriteBurmeseSegmentForDuration
} from './durationFit.js';

const dialogue = {
    index: 1,
    text: 'မင်း အခုချက်ချင်း အိမ်ပြန်လာခဲ့။',
    kind: 'dialogue',
    speaker: 'speaker_a',
    orig_start: 10,
    orig_end: 12
};

test('fits a 1.253x overflow with one serial rewrite and measured regeneration', async () => {
    const calls = [];
    const result = await fitTtsSegmentDuration({
        segment: dialogue,
        generatedDuration: 2.506,
        rewriteText: async request => {
            calls.push(request);
            return 'အခု အိမ်ပြန်လာခဲ့။';
        },
        synthesizeAndMeasure: async () => 2.48
    });
    assert.equal(calls.length, 1);
    assert.equal(result.generatedDuration, 2.48);
    assert.equal(result.appliedTempo, 1.24);
    assert.ok(result.appliedTempo <= MAX_TTS_TEMPO);
});

test('fits a 1.584x overflow within the three-attempt bound', async () => {
    const measured = [2.9, 2.6, 2.4];
    const result = await fitTtsSegmentDuration({
        segment: dialogue,
        generatedDuration: 3.168,
        rewriteText: async ({ attempt }) => `အဓိပ္ပါယ်ပြည့် စာသား ${attempt}`,
        synthesizeAndMeasure: async () => measured.shift()
    });
    assert.equal(result.diagnostics.length, 3);
    assert.equal(result.appliedTempo, 1.2);
    assert.deepEqual(result.diagnostics.map(item => item.accepted), [false, false, true]);
});

test('fails with complete diagnostics after exactly three unsuccessful rewrites', async () => {
    let syntheses = 0;
    await assert.rejects(
        fitTtsSegmentDuration({
            segment: dialogue,
            generatedDuration: 3,
            rewriteText: async ({ attempt }) => `မတိုသေးသော စာသား ${attempt}`,
            synthesizeAndMeasure: async () => {
                syntheses++;
                return 2.51;
            }
        }),
        error => {
            assert.equal(error.code, 'TTS_DURATION_FIT_FAILED');
            assert.equal(error.diagnostics.length, 3);
            assert.equal(error.segment.speaker, 'speaker_a');
            return true;
        }
    );
    assert.equal(syntheses, 3);
});

test('alternating dialogue speakers retain immutable speaker, kind, order, and timestamps', async () => {
    const segments = [
        dialogue,
        { ...dialogue, index: 2, speaker: 'speaker_b', orig_start: 12, orig_end: 14 }
    ];
    const results = [];
    for (const segment of segments) {
        results.push(await fitTtsSegmentDuration({
            segment,
            generatedDuration: 2.6,
            rewriteText: async ({ segment: received }) => {
                assert.equal(received.speaker, segment.speaker);
                return `${received.text} တို`;
            },
            synthesizeAndMeasure: async () => 2.4
        }));
    }
    assert.deepEqual(results.map(result => [
        result.segment.index,
        result.segment.kind,
        result.segment.speaker,
        result.segment.orig_start,
        result.segment.orig_end
    ]), [
        [1, 'dialogue', 'speaker_a', 10, 12],
        [2, 'dialogue', 'speaker_b', 12, 14]
    ]);
});

test('dialogue followed by narration is rewritten independently without type merging', async () => {
    const narration = {
        ...dialogue,
        index: 2,
        text: 'ထို့နောက် သူသည် အိမ်သို့ ပြန်သွားသည်။',
        kind: 'narration',
        speaker: 'narrator',
        orig_start: 12,
        orig_end: 14
    };
    const seen = [];
    for (const segment of [dialogue, narration]) {
        await fitTtsSegmentDuration({
            segment,
            generatedDuration: 2.6,
            rewriteText: async ({ segment: received }) => {
                seen.push([received.index, received.kind, received.speaker]);
                return received.text;
            },
            synthesizeAndMeasure: async () => 2.4
        });
    }
    assert.deepEqual(seen, [
        [1, 'dialogue', 'speaker_a'],
        [2, 'narration', 'narrator']
    ]);
});

test('duration-fit prompt requires complete meaning, intent, tone, and speaker preservation', () => {
    const prompt = buildDurationFitPrompt({
        segment: dialogue,
        targetDuration: 2,
        generatedDuration: 3.168,
        attempt: 1
    });
    for (const phrase of [
        'complete meaning',
        'every fact',
        'intent',
        'question',
        'command',
        'reply',
        'conversational tone',
        'Keep dialogue as direct dialogue',
        'Preserve the speaker'
    ]) assert.match(prompt, new RegExp(phrase));
});


const createGeminiRewrite = (responses, requests = []) => async request =>
    rewriteBurmeseSegmentForDuration({
        ...request,
        apiKey: 'AIza-secret-must-never-appear',
        generateContent: async geminiRequest => {
            requests.push(geminiRequest);
            return responses.shift();
        }
    });

test('valid Gemini schema response succeeds with unchanged model configuration', async () => {
    const requests = [];
    const text = await rewriteBurmeseSegmentForDuration({
        segment: dialogue,
        targetDuration: 2,
        generatedDuration: 3,
        attempt: 1,
        apiKey: 'secret',
        generateContent: async request => {
            requests.push(request);
            return { text: '{"text":"အခု အိမ်ပြန်လာခဲ့။"}' };
        }
    });
    assert.equal(text, 'အခု အိမ်ပြန်လာခဲ့။');
    assert.equal(requests[0].model, process.env.GEMINI_MODEL || 'gemini-3.5-flash');
    assert.equal(requests[0].config.responseMimeType, 'application/json');
    assert.equal(requests[0].config.temperature, 0.1);
    assert.deepEqual(requests[0].config.responseSchema, DURATION_FIT_RESPONSE_SCHEMA);
    assert.deepEqual(DURATION_FIT_RESPONSE_SCHEMA, {
        type: 'OBJECT',
        properties: { text: { type: 'STRING', minLength: '1' } },
        required: ['text'],
        minProperties: '1',
        maxProperties: '1'
    });
});

for (const [name, response, expectedError] of [
    ['malformed JSON retries', { text: '{"text":' }, /malformed or empty structured JSON/],
    ['empty response retries', { text: '' }, /malformed or empty structured JSON/],
    ['missing text retries', { text: '{}' }, /exactly an object/],
    ['wrong text type retries', { text: '{"text":42}' }, /exactly an object/]
]) {
    test(name, async () => {
        let calls = 0;
        let syntheses = 0;
        const rewriteText = async request => {
            calls++;
            try {
                return await createGeminiRewrite([{ ...response }])(request);
            } catch (error) {
                assert.match(error.message, expectedError);
                assert.ok(error.diagnostic.error);
                throw error;
            }
        };
        await assert.rejects(
            fitTtsSegmentDuration({
                segment: dialogue,
                generatedDuration: 3,
                rewriteText,
                synthesizeAndMeasure: async () => {
                    syntheses++;
                    return 2.4;
                }
            }),
            error => {
                assert.equal(error.code, 'TTS_DURATION_FIT_GEMINI_FAILED');
                assert.equal(error.diagnostics.length, 3);
                return true;
            }
        );
        assert.equal(calls, 3);
        assert.equal(syntheses, 0);
    });
}

test('attempt 2 can succeed after attempt 1 has an invalid Gemini response', async () => {
    const responses = [
        { text: '{"text":' },
        { text: '{"text":"အခု အိမ်ပြန်လာခဲ့။"}' }
    ];
    const result = await fitTtsSegmentDuration({
        segment: dialogue,
        generatedDuration: 3,
        rewriteText: createGeminiRewrite(responses),
        synthesizeAndMeasure: async () => 2.4
    });
    assert.equal(result.segment.text, 'အခု အိမ်ပြန်လာခဲ့။');
    assert.equal(result.diagnostics.length, 2);
    assert.equal(result.diagnostics[0].response_error.attempt, 1);
    assert.equal(result.diagnostics[1].attempt, 2);
    assert.equal(result.diagnostics[1].accepted, true);
});

test('all three invalid responses produce one clear final failure', async () => {
    const responses = [
        { text: 'null' },
        { text: '[]' },
        { text: '{"text":"","extra":"invalid"}' }
    ];
    await assert.rejects(
        fitTtsSegmentDuration({
            segment: dialogue,
            generatedDuration: 3,
            rewriteText: createGeminiRewrite(responses),
            synthesizeAndMeasure: async () => 2.4
        }),
        error => {
            assert.equal(error.code, 'TTS_DURATION_FIT_GEMINI_FAILED');
            assert.match(error.message, /segment 1 on all 3 attempts/);
            assert.deepEqual(
                error.diagnostics.map(record => record.response_error.attempt),
                [1, 2, 3]
            );
            return true;
        }
    );
});

test('invalid-response diagnostics are truncated, include response metadata, and redact secrets', async () => {
    const secret = 'AIza-abcdefghijklmnopqrstuvwxyz123456';
    const response = {
        text: `{"token":"${secret}","authorization":"Bearer private-token","bad":"${'x'.repeat(600)}"}`,
        candidates: [{
            finishReason: 'MAX_TOKENS',
            safetyRatings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'LOW' }]
        }],
        promptFeedback: { blockReason: 'SAFETY' }
    };
    await assert.rejects(
        fitTtsSegmentDuration({
            segment: dialogue,
            generatedDuration: 3,
            rewriteText: createGeminiRewrite([response, response, response]),
            synthesizeAndMeasure: async () => 2.4
        }),
        error => {
            const diagnostic = error.diagnostics[0].response_error;
            assert.equal(diagnostic.attempt, 1);
            assert.equal(diagnostic.finish_reason, 'MAX_TOKENS');
            assert.equal(diagnostic.block_reason, 'SAFETY');
            assert.deepEqual(diagnostic.safety_metadata, response.candidates[0].safetyRatings);
            assert.ok(diagnostic.raw_response.length <= 500);
            const serialized = JSON.stringify(error.diagnostics);
            assert.doesNotMatch(serialized, /AIza-abcdefghijklmnopqrstuvwxyz123456/);
            assert.doesNotMatch(serialized, /private-token/);
            assert.doesNotMatch(serialized, /secret-must-never-appear/);
            assert.match(serialized, /REDACTED/);
            assert.match(diagnostic.error, /exactly an object/);
            return true;
        }
    );
});
