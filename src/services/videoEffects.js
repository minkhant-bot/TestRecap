import fs from 'node:fs';
import path from 'node:path';
import { getStreamsDuration, runFFmpeg } from '../ffmpeg/index.js';
import { throwIfAborted } from './cancellation.js';

export const DEFAULT_SUBTITLE_POSITION = Object.freeze({
    xPct: 10, yPct: 78, widthPct: 80, heightPct: 12
});

// One global fill color applied to every subtitle cue in the whole video --
// never per-cue, never per-speaker. Outline/shadow (readability) are a
// separate, unrelated style fields and are never changed by this selection.
export const SUBTITLE_COLOR_PRESETS = Object.freeze({
    yellow: Object.freeze({ r: 255, g: 255, b: 0 }),
    red: Object.freeze({ r: 255, g: 59, b: 48 }),
    blue: Object.freeze({ r: 51, g: 153, b: 255 })
});
export const DEFAULT_SUBTITLE_COLOR = 'yellow';

const toAssColor = ({ r, g, b }) => {
    const hex = value => value.toString(16).padStart(2, '0').toUpperCase();
    // ASS/SSA color order is &HAABBGGRR (alpha, blue, green, red); AA=00 is opaque.
    return `&H00${hex(b)}${hex(g)}${hex(r)}`;
};

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const normalizeRect = (value, fallback = DEFAULT_SUBTITLE_POSITION) => {
    const widthPct = clamp(finite(value?.widthPct, fallback.widthPct), 5, 100);
    const heightPct = clamp(finite(value?.heightPct, fallback.heightPct), 3, 100);
    return {
        xPct: clamp(finite(value?.xPct, fallback.xPct), 0, 100 - widthPct),
        yPct: clamp(finite(value?.yPct, fallback.yPct), 0, 100 - heightPct),
        widthPct,
        heightPct
    };
};

export const normalizeVideoEffects = value => ({
    colorGrading: ['original', 'auto', 'cinematic', 'warm', 'cool'].includes(value?.colorGrading)
        ? value.colorGrading
        : value?.autoColorEnabled === true ? 'auto' : 'original',
    flipVideoEnabled: value?.flipVideoEnabled === true,
    burnSubtitlesEnabled: value?.burnSubtitlesEnabled === true || value?.subtitleEnabled === true,
    subtitlePosition: normalizeRect(value?.subtitlePosition),
    // Saved as part of the same effects object as every other choice, so
    // retry/resume replays the exact color the user selected before
    // processing started (see workspaceJobs.js job.effects persistence).
    subtitleColor: Object.hasOwn(SUBTITLE_COLOR_PRESETS, value?.subtitleColor)
        ? value.subtitleColor
        : DEFAULT_SUBTITLE_COLOR,
    blurEnabled: value?.blurEnabled === true,
    blurBoxes: value?.blurEnabled === true && Array.isArray(value?.blurBoxes)
        ? value.blurBoxes.slice(0, 8).map((box, index) => ({
            id: String(box?.id || `blur-${index + 1}`).slice(0, 80),
            ...normalizeRect(box, { xPct: 35, yPct: 35, widthPct: 30, heightPct: 20 }),
            strength: clamp(Math.round(finite(box?.strength, 10)), 1, 30)
        }))
        : []
});

export const AUTO_COLOR_FILTER = 'eq=contrast=1.03:saturation=1.04:gamma=1.01';
export const COLOR_GRADING_FILTERS = Object.freeze({
    auto: AUTO_COLOR_FILTER,
    cinematic: 'eq=contrast=1.08:saturation=0.92:gamma=0.98,colorbalance=rs=-0.02:bs=0.03',
    warm: 'eq=contrast=1.03:saturation=1.06,colorbalance=rs=0.06:gs=0.02:bs=-0.05',
    cool: 'eq=contrast=1.03:saturation=1.02,colorbalance=rs=-0.04:bs=0.07'
});

const parseSrtTime = value => {
    const match = /^(\d+):(\d{2}):(\d{2}),(\d{3})$/.exec(value);
    if (!match) throw new Error(`Invalid authoritative SRT timestamp: ${value}`);
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
};

const toAssTime = seconds => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const wholeSeconds = Math.floor(seconds % 60);
    const centiseconds = Math.floor((seconds % 1) * 100);
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
};

export const parseAuthoritativeSrt = srtContent => {
    const normalizedNewlines = String(srtContent).replace(/\r\n/g, "\n");
    return normalizedNewlines.split(/\n\s*\n/).filter(block => block.trim().length > 0).map(block => {
        const lines = block.split("\n");
        if (lines.length < 3) throw new Error("Invalid authoritative SRT cue.");
        const timeParts = lines[1].split(" --> ");
        if (timeParts.length !== 2) throw new Error("Invalid authoritative SRT cue timing.");
        return {
            start: parseSrtTime(timeParts[0]),
            end: parseSrtTime(timeParts[1]),
            startText: timeParts[0],
            endText: timeParts[1],
            text: lines.slice(2).join("\n")
        };
    });
};

export const buildAssDocument = (
    srtContent, position = DEFAULT_SUBTITLE_POSITION, subtitleColor = DEFAULT_SUBTITLE_COLOR
) => {
    const subtitles = parseAuthoritativeSrt(srtContent);
    const normalized = normalizeRect(position);
    const marginL = Math.round((normalized.xPct / 100) * 1080);
    const marginR = Math.round(1080 - ((normalized.xPct + normalized.widthPct) / 100) * 1080);
    const marginV = Math.round((normalized.yPct / 100) * 1920);
    const fontSize = clamp(Math.round(((normalized.heightPct / 100) * 1920) * 0.6), 24, 80);
    // One fill color for the whole document's single Default style -- every
    // Dialogue event below uses Style: Default, so this is applied
    // uniformly to every subtitle cue, never alternated, never per-speaker.
    // Outline (&H00000000, strong black) and BackColour (&H80000000, subtle
    // shadow) are unrelated fields and are always preserved unchanged here.
    const primaryColour = toAssColor(
        SUBTITLE_COLOR_PRESETS[subtitleColor] || SUBTITLE_COLOR_PRESETS[DEFAULT_SUBTITLE_COLOR]
    );
    const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Padauk,${fontSize},${primaryColour},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,8,${marginL},${marginR},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    const events = subtitles.map(subtitle =>
        `Dialogue: 0,${toAssTime(subtitle.start)},${toAssTime(subtitle.end)},Default,,0,0,0,,${subtitle.text.replace(/\n/g, "\\N")}`);
    return "\uFEFF" + header + events.join("\n") + "\n";
};

export const buildBlurFilter = boxes => {
    let lastMap = '[0:v]';
    let filter = '';
    boxes.forEach((box, index) => {
        const main = `[main${index}]`;
        const region = `[blur${index}]`;
        const blurred = `[blurred${index}]`;
        const output = `[v${index}]`;
        const width = (box.widthPct / 100).toFixed(6);
        const height = (box.heightPct / 100).toFixed(6);
        const x = (box.xPct / 100).toFixed(6);
        const y = (box.yPct / 100).toFixed(6);
        filter += `${lastMap}split=2${main}${region};`;
        filter += `${region}crop=iw*${width}:ih*${height}:iw*${x}:ih*${y},boxblur=${box.strength}:${box.strength}${blurred};`;
        filter += `${main}${blurred}overlay=W*${x}:H*${y}${output};`;
        lastMap = output;
    });
    return { filter: filter.replace(/;$/, ''), output: lastMap };
};

const assertEquivalentTiming = async (before, outputPath, inspect) => {
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        throw new Error('Video effects produced no output.');
    }
    const after = await inspect(outputPath);
    if (!after.hasVideo || !after.hasAudio) throw new Error('Video effects output is missing a media stream.');
    if (Math.abs(after.effectiveVideoDuration - before.effectiveVideoDuration) > 0.08 ||
        Math.abs(after.effectiveAudioDuration - before.effectiveAudioDuration) > 0.08 ||
        Math.abs(after.effectiveVideoDuration - after.effectiveAudioDuration) > 0.3) {
        throw new Error('Video effects changed the synchronized media duration.');
    }
};

export const applyFinalVideoEffects = async ({
    inputPath,
    effects,
    subtitleSrtPath,
    run = runFFmpeg,
    inspect = getStreamsDuration,
    signal,
    onProgress = () => {}
}) => {
    throwIfAborted(signal);
    const normalized = normalizeVideoEffects(effects);
    console.info('[Blink effects]', JSON.stringify({
        boundary: 'processor.normalized',
        inputPath,
        effects: normalized
    }));
    const hasBlur = normalized.blurEnabled && normalized.blurBoxes.length > 0;
    if (normalized.colorGrading === 'original' && !normalized.flipVideoEnabled &&
        !hasBlur && !normalized.burnSubtitlesEnabled) {
        onProgress('Verify Output');
        return { applied: false, effects: normalized };
    }
    const before = await inspect(inputPath);
    throwIfAborted(signal);
    const directory = path.dirname(inputPath);
    const basename = path.basename(inputPath, path.extname(inputPath));
    const recoveryPath = path.join(directory, `.${basename}.effects-recovery.${process.pid}.mp4`);
    let temporaryIndex = 0;
    const nextTemporary = label => path.join(directory, `.${basename}.${label}.${process.pid}.${temporaryIndex++}.mp4`);
    const replaceFromTemporary = async temporary => {
        throwIfAborted(signal);
        await assertEquivalentTiming(before, temporary, inspect);
        throwIfAborted(signal);
        fs.renameSync(temporary, inputPath);
    };
    await fs.promises.copyFile(inputPath, recoveryPath);
    try {
        if (normalized.colorGrading !== 'original') {
            onProgress('Color Grading');
            const temporary = nextTemporary('color-grading');
            await run([
                '-i', inputPath,
                '-map', '0:v:0', '-map', '0:a:0',
                '-vf', COLOR_GRADING_FILTERS[normalized.colorGrading],
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
                '-c:a', 'copy', '-movflags', '+faststart', '-y', temporary
            ], directory, null, 600000, { signal });
            await replaceFromTemporary(temporary);
        }
        if (normalized.flipVideoEnabled) {
            onProgress('Flip');
            const temporary = nextTemporary('flip');
            const command = [
                '-i', inputPath,
                '-map', '0:v:0', '-map', '0:a:0',
                '-vf', 'hflip',
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
                '-c:a', 'copy', '-movflags', '+faststart', '-y', temporary
            ];
            console.info('[Blink effects]', JSON.stringify({
                boundary: 'processor.hflip',
                inputPath,
                outputPath: temporary,
                command
            }));
            await run(command, directory, null, 600000, { signal });
            await replaceFromTemporary(temporary);
        }
        if (hasBlur) {
            onProgress('Blur');
            const temporary = nextTemporary('blur');
            const chain = buildBlurFilter(normalized.blurBoxes);
            await run([
                '-i', inputPath,
                '-filter_complex', chain.filter,
                '-map', chain.output, '-map', '0:a:0',
                '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
                '-c:a', 'copy', '-movflags', '+faststart', '-y', temporary
            ], directory, null, 600000, { signal });
            await replaceFromTemporary(temporary);
        }
        if (normalized.burnSubtitlesEnabled) {
            throwIfAborted(signal);
            onProgress('Subtitle');
            if (!subtitleSrtPath || !fs.existsSync(subtitleSrtPath)) {
                throw new Error("Subtitle burn requested without the authoritative SRT artifact.");
            }
            const srtContent = fs.readFileSync(subtitleSrtPath, "utf8");
            const assPath = path.join(directory, `.${basename}.${process.pid}.ass`);
            const temporary = nextTemporary("subtitles");
            fs.writeFileSync(
                assPath,
                buildAssDocument(srtContent, normalized.subtitlePosition, normalized.subtitleColor),
                "utf8"
            );
            try {
                const escapedAssPath = assPath.replaceAll("\\", "/").replaceAll(":", "\\:").replaceAll("'", "\\'");
                await run([
                    "-i", inputPath,
                    "-filter_complex", `[0:v]ass='${escapedAssPath}'[v]`,
                    "-map", "[v]", "-map", "0:a:0",
                    "-c:v", "libx264", "-preset", "fast", "-crf", "20",
                    "-c:a", "copy", "-movflags", "+faststart", "-y", temporary
                ], directory, null, 600000, { signal });
                await replaceFromTemporary(temporary);
            } finally {
                if (fs.existsSync(assPath)) fs.unlinkSync(assPath);
            }
        }
        onProgress('Verify Output');
        return { applied: true, effects: normalized };
    } catch (error) {
        if (fs.existsSync(recoveryPath)) await fs.promises.copyFile(recoveryPath, inputPath);
        throw error;
    } finally {
        for (const label of ['color-grading', 'flip', 'blur', 'subtitles']) {
            for (let index = 0; index <= temporaryIndex; index += 1) {
                const candidate = path.join(directory, `.${basename}.${label}.${process.pid}.${index}.mp4`);
                if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
            }
        }
        if (fs.existsSync(recoveryPath)) fs.unlinkSync(recoveryPath);
    }
};
