import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    AUTO_COLOR_FILTER,
    COLOR_GRADING_FILTERS,
    DEFAULT_SUBTITLE_COLOR,
    SUBTITLE_COLOR_PRESETS,
    applyFinalVideoEffects,
    buildAssDocument,
    buildBlurFilter,
    normalizeVideoEffects,
    parseAuthoritativeSrt
} from './videoEffects.js';

test('video effects are optional, bounded, and disabled by default', () => {
    assert.deepEqual(normalizeVideoEffects(null), {
        colorGrading: 'original',
        flipVideoEnabled: false,
        burnSubtitlesEnabled: false,
        subtitlePosition: { xPct: 10, yPct: 78, widthPct: 80, heightPct: 12 },
        subtitleColor: 'yellow',
        blurEnabled: false,
        blurBoxes: []
    });
    const normalized = normalizeVideoEffects({
        autoColorEnabled: true,
        flipVideoEnabled: true,
        burnSubtitlesEnabled: true,
        subtitlePosition: { xPct: -5, yPct: 99, widthPct: 60, heightPct: 20 },
        subtitleColor: 'red',
        blurEnabled: true,
        blurBoxes: [{ id: 'face', xPct: 90, yPct: -4, widthPct: 30, heightPct: 0, strength: 99 }]
    });
    assert.deepEqual(normalized.subtitlePosition, { xPct: 0, yPct: 80, widthPct: 60, heightPct: 20 });
    assert.equal(normalized.colorGrading, 'auto');
    assert.equal(normalized.flipVideoEnabled, true);
    assert.equal(normalized.subtitleColor, 'red');
    assert.deepEqual(normalized.blurBoxes[0], {
        id: 'face', xPct: 70, yPct: 0, widthPct: 30, heightPct: 3, strength: 30
    });
});

test('subtitle color defaults to bright yellow and rejects unknown values', () => {
    assert.equal(DEFAULT_SUBTITLE_COLOR, 'yellow');
    assert.equal(normalizeVideoEffects({}).subtitleColor, 'yellow');
    assert.equal(normalizeVideoEffects({ subtitleColor: 'blue' }).subtitleColor, 'blue');
    assert.equal(normalizeVideoEffects({ subtitleColor: 'not-a-real-color' }).subtitleColor, 'yellow');
    assert.equal(normalizeVideoEffects({ subtitleColor: '__proto__' }).subtitleColor, 'yellow');
    assert.deepEqual(Object.keys(SUBTITLE_COLOR_PRESETS).sort(), ['blue', 'red', 'yellow']);
});

test('auto color is deterministic and intentionally subtle', () => {
    assert.equal(AUTO_COLOR_FILTER, 'eq=contrast=1.03:saturation=1.04:gamma=1.01');
    assert.equal(COLOR_GRADING_FILTERS.auto, AUTO_COLOR_FILTER);
    assert.equal(COLOR_GRADING_FILTERS.cinematic, 'eq=contrast=1.08:saturation=0.92:gamma=0.98,colorbalance=rs=-0.02:bs=0.03');
    assert.equal(COLOR_GRADING_FILTERS.warm, 'eq=contrast=1.03:saturation=1.06,colorbalance=rs=0.06:gs=0.02:bs=-0.05');
    assert.equal(COLOR_GRADING_FILTERS.cool, 'eq=contrast=1.03:saturation=1.02,colorbalance=rs=-0.04:bs=0.07');
    assert.equal(normalizeVideoEffects({ autoColorEnabled: true }).colorGrading, 'auto');
    assert.equal(normalizeVideoEffects({ autoColorEnabled: false }).colorGrading, 'original');
    assert.equal(normalizeVideoEffects({ colorGrading: 'warm', autoColorEnabled: true }).colorGrading, 'warm');
    assert.equal(normalizeVideoEffects({ subtitleEnabled: true }).burnSubtitlesEnabled, true);
});

test('mocked effects flow persists Auto Color output into every later effect input', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-auto-color-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const inputPath = path.join(directory, 'final.mp4');
    const subtitleSrtPath = path.join(directory, 'authoritative.srt');
    fs.writeFileSync(inputPath, 'original');
    fs.writeFileSync(subtitleSrtPath, '1\n00:00:00,000 --> 00:00:01,000\nစာတန်း\n');
    const calls = [];
    const mediaDetails = {
        hasVideo: true,
        hasAudio: true,
        effectiveVideoDuration: 1,
        effectiveAudioDuration: 1
    };

    await applyFinalVideoEffects({
        inputPath,
        subtitleSrtPath,
        effects: {
            colorGrading: 'auto',
            flipVideoEnabled: true,
            blurEnabled: true,
            blurBoxes: [{ id: 'box', xPct: 10, yPct: 10, widthPct: 20, heightPct: 20, strength: 5 }],
            burnSubtitlesEnabled: true
        },
        inspect: async () => mediaDetails,
        run: async args => {
            const outputPath = args.at(-1);
            const input = args[args.indexOf('-i') + 1];
            const label = args.includes(AUTO_COLOR_FILTER) ? 'auto-color'
                : args.includes('hflip') ? 'flip'
                    : args.some(value => String(value).includes('boxblur=')) ? 'blur'
                        : 'subtitle';
            calls.push({ label, input, inputContent: fs.readFileSync(input, 'utf8'), args });
            fs.writeFileSync(outputPath, `${label}(${fs.readFileSync(input, 'utf8')})`);
        }
    });

    assert.deepEqual(calls.map(call => call.label), ['auto-color', 'flip', 'blur', 'subtitle']);
    assert.equal(calls[0].input, inputPath);
    assert.equal(calls[0].inputContent, 'original');
    assert.ok(calls[0].args.includes(AUTO_COLOR_FILTER));
    assert.equal(calls[1].inputContent, 'auto-color(original)');
    assert.equal(calls[2].inputContent, 'flip(auto-color(original))');
    assert.equal(calls[3].inputContent, 'blur(flip(auto-color(original)))');
    assert.equal(fs.readFileSync(inputPath, 'utf8'), 'subtitle(blur(flip(auto-color(original))))');
});

test('mocked effects flow skips Auto Color entirely when disabled', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-no-auto-color-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const inputPath = path.join(directory, 'final.mp4');
    fs.writeFileSync(inputPath, 'original');
    let runCount = 0;

    const result = await applyFinalVideoEffects({
        inputPath,
        effects: { colorGrading: 'original' },
        inspect: async () => {
            throw new Error('disabled effects must not inspect or encode media');
        },
        run: async () => { runCount += 1; }
    });

    assert.equal(result.applied, false);
    assert.equal(runCount, 0);
    assert.equal(fs.readFileSync(inputPath, 'utf8'), 'original');
});

test('empty Blur masks and disabled Subtitle do no preparation, probing, or FFmpeg work', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-disabled-effects-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const inputPath = path.join(directory, 'final.mp4');
    fs.writeFileSync(inputPath, 'original');
    const progress = [];
    const result = await applyFinalVideoEffects({
        inputPath,
        subtitleSrtPath: path.join(directory, 'missing.srt'),
        effects: {
            colorGrading: 'original',
            flipVideoEnabled: false,
            blurEnabled: true,
            blurBoxes: [],
            burnSubtitlesEnabled: false
        },
        inspect: async () => { throw new Error('must not probe'); },
        run: async () => { throw new Error('must not run FFmpeg'); },
        onProgress: substep => progress.push(substep)
    });
    assert.equal(result.applied, false);
    assert.deepEqual(progress, ['Verify Output']);
});

test('mocked effects flow includes hflip only when Flip Video is enabled', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-flip-toggle-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const mediaDetails = {
        hasVideo: true,
        hasAudio: true,
        effectiveVideoDuration: 1,
        effectiveAudioDuration: 1
    };
    const runCase = async (name, flipVideoEnabled) => {
        const inputPath = path.join(directory, `${name}.mp4`);
        fs.writeFileSync(inputPath, 'original');
        const calls = [];
        await applyFinalVideoEffects({
            inputPath,
            effects: { colorGrading: 'auto', flipVideoEnabled },
            inspect: async () => mediaDetails,
            run: async args => {
                calls.push(args);
                fs.writeFileSync(args.at(-1), 'processed');
            }
        });
        return calls;
    };

    const enabledCalls = await runCase('enabled', true);
    const disabledCalls = await runCase('disabled', false);
    assert.equal(enabledCalls.filter(args => args.includes('hflip')).length, 1);
    assert.equal(disabledCalls.filter(args => args.includes('hflip')).length, 0);
});

test('Flip-only processing skips grading, Blur, and Subtitle work', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-flip-only-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const inputPath = path.join(directory, 'final.mp4');
    fs.writeFileSync(inputPath, 'original');
    const calls = [];
    const mediaDetails = {
        hasVideo: true,
        hasAudio: true,
        effectiveVideoDuration: 1,
        effectiveAudioDuration: 1
    };

    await applyFinalVideoEffects({
        inputPath,
        effects: {
            colorGrading: 'original',
            flipVideoEnabled: true,
            blurEnabled: false,
            blurBoxes: [],
            burnSubtitlesEnabled: false
        },
        inspect: async () => mediaDetails,
        run: async args => {
            calls.push(args);
            fs.writeFileSync(args.at(-1), 'flipped');
        }
    });

    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('hflip'));
    assert.equal(calls[0].some(value => String(value).includes('boxblur=')), false);
    assert.equal(calls[0].some(value => String(value).includes("ass='")), false);
    assert.equal(calls[0].some(value => Object.values(COLOR_GRADING_FILTERS).includes(value)), false);
});

test('final effects forwards cancellation to FFmpeg and never advances to a later pass', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blink-effects-cancel-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const inputPath = path.join(directory, 'final.mp4');
    fs.writeFileSync(inputPath, 'original');
    const controller = new AbortController();
    const calls = [];
    const mediaDetails = {
        hasVideo: true,
        hasAudio: true,
        effectiveVideoDuration: 1,
        effectiveAudioDuration: 1
    };

    await assert.rejects(applyFinalVideoEffects({
        inputPath,
        effects: { colorGrading: 'cinematic', flipVideoEnabled: true },
        signal: controller.signal,
        inspect: async () => mediaDetails,
        run: async (args, _cwd, _progress, _timeout, options) => {
            calls.push({ args, signal: options.signal });
            if (calls.length === 1) {
                fs.writeFileSync(args.at(-1), 'graded');
                return;
            }
            controller.abort();
            throw Object.assign(new Error('interrupted'), { name: 'AbortError', code: 'ABORT_ERR' });
        }
    }), error => error.name === 'AbortError');

    assert.equal(calls.length, 2);
    assert.equal(calls[0].signal, controller.signal);
    assert.equal(calls[1].args.includes('hflip'), true);
    assert.equal(fs.readFileSync(inputPath, 'utf8'), 'original');
});

test('reused Sawaungthin blur chain crops, box-blurs, and overlays percentage regions', () => {
    const chain = buildBlurFilter(normalizeVideoEffects({
        blurEnabled: true,
        blurBoxes: [
            { id: 'one', xPct: 10, yPct: 20, widthPct: 30, heightPct: 40, strength: 12 },
            { id: 'two', xPct: 50, yPct: 50, widthPct: 20, heightPct: 20, strength: 8 }
        ]
    }).blurBoxes);
    assert.match(chain.filter, /\[0:v\]split=2\[main0\]\[blur0\]/);
    assert.match(chain.filter, /crop=iw\*0\.300000:ih\*0\.400000:iw\*0\.100000:ih\*0\.200000,boxblur=12:12/);
    assert.match(chain.filter, /\[main1\]\[blurred1\]overlay=W\*0\.500000:H\*0\.500000\[v1\]/);
    assert.equal(chain.output, '[v1]');
});

test("reused Sawaungthin SRT-to-ASS flow preserves authoritative text, timing, and Padauk style", () => {
    const srt = "1\n00:00:01,250 --> 00:00:02,750\nမင်္ဂလာပါ\nဒုတိယလိုင်း\n\n";
    const parsed = parseAuthoritativeSrt(srt);
    assert.deepEqual(parsed.map(({ startText, endText, text }) => ({ startText, endText, text })), [{
        startText: "00:00:01,250",
        endText: "00:00:02,750",
        text: "မင်္ဂလာပါ\nဒုတိယလိုင်း"
    }]);
    const ass = buildAssDocument(srt, { xPct: 15, yPct: 70, widthPct: 70, heightPct: 10 });
    assert.match(ass, /PlayResX: 1080/);
    assert.match(ass, /PlayResY: 1920/);
    assert.match(ass, /Style: Default,Padauk,80,[^\n]+,8,162,162,1344,1/);
    assert.match(ass, /Dialogue: 0,0:00:01\.25,0:00:02\.75,[^\n]+မင်္ဂလာပါ\\Nဒုတိယလိုင်း/);
});

test('buildAssDocument defaults to bright yellow when no color is given', () => {
    const srt = '1\n00:00:00,000 --> 00:00:01,000\nတစ်\n\n';
    const ass = buildAssDocument(srt, { xPct: 10, yPct: 78, widthPct: 80, heightPct: 12 });
    // &H00BBGGRR for RGB(255,255,0): B=00, G=FF, R=FF.
    assert.match(ass, /Style: Default,Padauk,\d+,&H0000FFFF,/);
});

test('each preset (yellow/red/blue) renders its exact ASS color and leaves outline/shadow untouched', () => {
    const srt = '1\n00:00:00,000 --> 00:00:01,000\nတစ်\n\n';
    const position = { xPct: 10, yPct: 78, widthPct: 80, heightPct: 12 };
    const expected = {
        yellow: '&H0000FFFF', // RGB(255,255,0)
        red: '&H00303BFF',    // RGB(255,59,48)
        blue: '&H00FF9933',   // RGB(51,153,255)
    };
    for (const [color, assColor] of Object.entries(expected)) {
        const ass = buildAssDocument(srt, position, color);
        assert.match(
            ass,
            new RegExp(`Style: Default,Padauk,\\d+,${assColor},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,8,`),
            `color=${color} must set PrimaryColour to ${assColor} and preserve SecondaryColour/OutlineColour/BackColour/Outline(3)/Shadow(0) unchanged`,
        );
    }
});

test('an unrecognized subtitleColor falls back to the bright yellow default rather than an invalid style', () => {
    const srt = '1\n00:00:00,000 --> 00:00:01,000\nတစ်\n\n';
    const ass = buildAssDocument(srt, { xPct: 10, yPct: 78, widthPct: 80, heightPct: 12 }, 'not-a-color');
    assert.match(ass, /Style: Default,Padauk,\d+,&H0000FFFF,/);
});

test('the selected color applies uniformly to every subtitle cue -- never alternated, never per-speaker', () => {
    const srt =
        '1\n00:00:00,000 --> 00:00:01,000\nပထမစာကြောင်း\n\n' +
        '2\n00:00:01,000 --> 00:00:02,000\nဒုတိယစာကြောင်း\n\n' +
        '3\n00:00:02,000 --> 00:00:03,000\nတတိယစာကြောင်း\n\n';
    const ass = buildAssDocument(srt, { xPct: 10, yPct: 78, widthPct: 80, heightPct: 12 }, 'blue');
    const dialogueLines = ass.split('\n').filter(line => line.startsWith('Dialogue:'));
    assert.equal(dialogueLines.length, 3);
    // Every Dialogue event references the single "Default" style -- there is
    // only one style defined in the whole document, so there is no
    // mechanism by which different cues (or "speakers") could differ.
    assert.equal((ass.match(/^Style: /gm) || []).length, 1);
    for (const line of dialogueLines) {
        assert.match(line, /^Dialogue: 0,[^,]+,[^,]+,Default,/);
    }
});
