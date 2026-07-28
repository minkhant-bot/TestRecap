import fs from 'fs';
import path from 'path';
import { WORKFLOW_VERSION } from '../domain/workflow.js';

export const TIMELINE_ALGORITHM_VERSION = 'chronological-scene-timeline-v1';
export const MIN_VISUAL_PLAYBACK_RATE = 0.25;
export const MAX_VISUAL_PLAYBACK_RATE = 4;
export const MAX_AV_DRIFT_SECONDS = 0.3;
export const FFMPEG_VIDEO_THREADS = 2;

const finite = (value, label) => {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${label} must be finite.`);
    return number;
};

const validateInterval = (start, end, duration, label) => {
    start = finite(start, `${label} start`);
    end = finite(end, `${label} end`);
    if (start < 0 || end <= start || end > duration + 1e-6) {
        throw new Error(`${label} range ${start} -> ${end} is outside media duration ${duration}.`);
    }
    return [start, Math.min(end, duration)];
};

const validateOrderedIntervals = (records, startKey, endKey, label) => {
    for (let index = 1; index < records.length; index += 1) {
        if (records[index][startKey] < records[index - 1][endKey] - 1e-6) {
            throw new Error(`${label} records ${index - 1} and ${index} overlap or are out of order.`);
        }
    }
};

export const validateSceneBoundaries = (boundaries, mediaDuration) => {
    if (!Array.isArray(boundaries) || boundaries.length === 0) {
        throw new Error('Detected scene boundaries are missing.');
    }
    const normalized = boundaries.map((value, index) =>
        finite(value, `Scene boundary ${index}`));
    for (let index = 0; index < normalized.length; index += 1) {
        if (normalized[index] < 0 || normalized[index] > mediaDuration ||
            (index > 0 && normalized[index] <= normalized[index - 1])) {
            throw new Error(`Invalid detected scene boundary at index ${index}.`);
        }
    }
    if (normalized[0] !== 0) throw new Error('Detected scene boundaries must begin at 0.');
    return normalized;
};

export const mapRecordsChronologically = (records, sceneBoundaries, mediaDuration, ttsDuration) => {
    mediaDuration = finite(mediaDuration, 'Source media duration');
    ttsDuration = finite(ttsDuration, 'TTS duration');
    if (mediaDuration <= 0 || ttsDuration <= 0 || !Array.isArray(records) || records.length === 0) {
        throw new Error('Chronological mapping requires records and positive source/TTS durations.');
    }
    const boundaries = validateSceneBoundaries(sceneBoundaries, mediaDuration);
    const mapped = records.map((record, index) => {
        const [sourceStart, sourceEnd] = validateInterval(
            record.orig_start, record.orig_end, mediaDuration, `Source record ${index}`);
        const [ttsStart, ttsEnd] = validateInterval(
            record.final_audio_start, record.final_audio_end, ttsDuration, `TTS record ${index}`);
        let matchedSceneIndex = 0;
        for (let sceneIndex = 1; sceneIndex < boundaries.length; sceneIndex += 1) {
            if (boundaries[sceneIndex] <= sourceStart + 0.1) matchedSceneIndex = sceneIndex;
            else break;
        }
        return {
            source_start: sourceStart,
            source_end: sourceEnd,
            source_scene_index: matchedSceneIndex,
            matched_scene_index: matchedSceneIndex,
            tts_start: ttsStart,
            tts_end: ttsEnd,
            text: String(record.text || '')
        };
    });
    validateOrderedIntervals(mapped, 'source_start', 'source_end', 'Source');
    validateOrderedIntervals(mapped, 'tts_start', 'tts_end', 'TTS');
    return mapped;
};

export const validateTimelineManifest = (manifest, mediaDuration, ttsDuration) => {
    if (!manifest || manifest.workflowVersion !== WORKFLOW_VERSION ||
        manifest.algorithmVersion !== TIMELINE_ALGORITHM_VERSION) {
        throw new Error('Incompatible timeline manifest cache.');
    }
    if (!Array.isArray(manifest.segments) || manifest.segments.length === 0) {
        throw new Error('Timeline manifest has no segments.');
    }
    const outputRanges = [];
    manifest.segments.forEach((segment, index) => {
        if (segment.output_order !== index) throw new Error(`Invalid output order at segment ${index}.`);
        validateInterval(segment.source_start, segment.source_end, mediaDuration, `Timeline source ${index}`);
        validateInterval(segment.tts_start, segment.tts_end, ttsDuration, `Timeline TTS ${index}`);
        const target = finite(segment.target_output_duration, `Target duration ${index}`);
        const playbackRate = finite(segment.playback_rate, `Playback rate ${index}`);
        if (target <= 0) throw new Error(`Target duration ${index} must be positive.`);
        if (Math.abs(target - (segment.tts_end - segment.tts_start)) > 1e-6) {
            throw new Error(`Target duration ${index} does not match its TTS interval.`);
        }
        if (playbackRate < MIN_VISUAL_PLAYBACK_RATE || playbackRate > MAX_VISUAL_PLAYBACK_RATE) {
            throw new Error(
                `Segment ${index} requires visual playback rate ${playbackRate.toFixed(3)}x; ` +
                `supported range is ${MIN_VISUAL_PLAYBACK_RATE}x-${MAX_VISUAL_PLAYBACK_RATE}x.`);
        }
        outputRanges.push({ start: segment.tts_start, end: segment.tts_end });
    });
    validateOrderedIntervals(manifest.segments, 'source_start', 'source_end', 'Timeline source');
    validateOrderedIntervals(manifest.segments, 'tts_start', 'tts_end', 'Timeline TTS');
    validateOrderedIntervals(outputRanges, 'start', 'end', 'Timeline output');
    return manifest;
};

export const buildTimelineManifest = (mappedRecords, mediaDuration, ttsDuration, sourceFingerprint) => {
    const manifest = {
        workflowVersion: WORKFLOW_VERSION,
        algorithmVersion: TIMELINE_ALGORITHM_VERSION,
        sourceFingerprint,
        mediaDuration,
        ttsDuration,
        segments: mappedRecords.map((record, index) => {
            const targetDuration = record.tts_end - record.tts_start;
            return {
                source_start: record.source_start,
                source_end: record.source_end,
                source_scene_index: record.source_scene_index,
                matched_scene_index: record.matched_scene_index,
                tts_start: record.tts_start,
                tts_end: record.tts_end,
                target_output_duration: targetDuration,
                playback_rate: (record.source_end - record.source_start) / targetDuration,
                output_order: index,
                text: record.text
            };
        })
    };
    return validateTimelineManifest(manifest, mediaDuration, ttsDuration);
};

export const readTimelineManifest = (manifestPath, expected) => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.sourceFingerprint !== expected.sourceFingerprint ||
        manifest.mediaDuration !== expected.mediaDuration ||
        manifest.ttsDuration !== expected.ttsDuration) {
        throw new Error('Timeline manifest cache identity mismatch.');
    }
    return validateTimelineManifest(manifest, expected.mediaDuration, expected.ttsDuration);
};

export const assertSafeJobPath = (candidatePath, jobDirectory) => {
    const root = path.resolve(jobDirectory);
    const candidate = path.resolve(candidatePath);
    if (candidate === root || !candidate.startsWith(root + path.sep)) {
        throw new Error(`Unsafe job artifact path: ${candidate}`);
    }
    let cursor = candidate;
    while (cursor.startsWith(root + path.sep)) {
        if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
            throw new Error(`Symlink job artifact path is not allowed: ${cursor}`);
        }
        cursor = path.dirname(cursor);
    }
    return candidate;
};

export const getSegmentPath = (jobDirectory, outputOrder) =>
    assertSafeJobPath(path.join(jobDirectory, 'segments', `segment-${String(outputOrder).padStart(6, '0')}.mp4`), jobDirectory);

export const buildSegmentFFmpegArgs = (sourceVideo, outputPath, segment) => [
    '-ss', segment.source_start.toFixed(6),
    '-t', (segment.source_end - segment.source_start).toFixed(6),
    '-i', path.resolve(sourceVideo),
    '-an',
    '-vf', `setpts=PTS/${segment.playback_rate.toFixed(8)},fps=30,setsar=1,format=yuv420p`,
    '-t', segment.target_output_duration.toFixed(6),
    '-c:v', 'libx264',
    '-threads', String(FFMPEG_VIDEO_THREADS),
    '-preset', 'fast',
    '-crf', '20',
    '-movflags', '+faststart',
    '-y', outputPath
];

export const buildConcatManifest = (manifest, jobDirectory) =>
    [...manifest.segments]
        .sort((left, right) => left.output_order - right.output_order)
        .map(segment => {
            const segmentPath = getSegmentPath(jobDirectory, segment.output_order);
            if (!fs.existsSync(segmentPath)) throw new Error(`Segment file is missing: ${segmentPath}`);
            if (fs.lstatSync(segmentPath).isSymbolicLink()) throw new Error(`Segment is a symlink: ${segmentPath}`);
            if (fs.statSync(segmentPath).size === 0) throw new Error(`Segment file is empty: ${segmentPath}`);
            return `file '${segmentPath.replaceAll("'", "'\\''")}'`;
        })
        .join('\n');

export const buildAtempoFilter = multiplier => {
    multiplier = finite(multiplier, 'Final speed multiplier');
    if (multiplier <= 0) throw new Error('Final speed multiplier must be positive.');
    const factors = [];
    while (multiplier > 2) {
        factors.push(2);
        multiplier /= 2;
    }
    while (multiplier < 0.5) {
        factors.push(0.5);
        multiplier /= 0.5;
    }
    factors.push(multiplier);
    return factors.map(value => `atempo=${value.toFixed(8)}`).join(',');
};

export const getJobOutputPaths = (outputDirectory, jobId) => ({
    mp4: path.join(outputDirectory, `${jobId}.mp4`),
    mp3: path.join(outputDirectory, `${jobId}.mp3`)
});

export const validateFinalMedia = (details, fileSize, expectedDuration) => {
    if (!Number.isFinite(fileSize) || fileSize <= 0) throw new Error('Final output is missing or empty.');
    if (!details?.hasVideo) throw new Error('Final output is missing a video stream.');
    if (!details?.hasAudio) throw new Error('Final output is missing an audio stream.');
    const videoDuration = finite(details.effectiveVideoDuration, 'Final video duration');
    const audioDuration = finite(details.effectiveAudioDuration, 'Final audio duration');
    if (videoDuration <= 0 || audioDuration <= 0) throw new Error('Final output duration is invalid.');
    const drift = Math.abs(videoDuration - audioDuration);
    if (drift > MAX_AV_DRIFT_SECONDS) {
        throw new Error(`Final A/V drift ${drift.toFixed(3)}s exceeds ${MAX_AV_DRIFT_SECONDS}s.`);
    }
    if (Math.abs(videoDuration - expectedDuration) > MAX_AV_DRIFT_SECONDS) {
        throw new Error(`Final duration ${videoDuration.toFixed(3)}s does not match expected ${expectedDuration.toFixed(3)}s.`);
    }
    return { videoDuration, audioDuration, drift };
};
