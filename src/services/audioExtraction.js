import fs from 'node:fs';
import path from 'node:path';
import { getStreamsDuration, runFFmpeg } from '../ffmpeg/index.js';

const AUDIO_FILENAME = 'audio.wav';
const PARTIAL_AUDIO_FILENAME = 'audio.partial.wav';
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

const assertRegularFile = (target, label) => {
    if (!target || !fs.existsSync(target)) {
        throw new Error(`${label} is missing.`);
    }
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`${label} is not a safe regular file.`);
    }
    return stat;
};

const validateWavHeader = audioPath => {
    const descriptor = fs.openSync(audioPath, 'r');
    try {
        const header = Buffer.alloc(12);
        const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
        if (bytesRead !== 12 ||
            header.toString('ascii', 0, 4) !== 'RIFF' ||
            header.toString('ascii', 8, 12) !== 'WAVE') {
            throw new Error('Extracted audio is not a readable WAV file.');
        }
    } finally {
        fs.closeSync(descriptor);
    }
};

const removeIfPresent = target => {
    if (target && fs.existsSync(target)) fs.unlinkSync(target);
};

export const getWorkspaceAudioPaths = sourcePath => {
    const directory = path.dirname(sourcePath);
    return {
        audioPath: path.join(directory, AUDIO_FILENAME),
        partialPath: path.join(directory, PARTIAL_AUDIO_FILENAME)
    };
};

export const cleanupWorkspaceAudioPartials = sourcePath => {
    if (!sourcePath) return;
    const { partialPath } = getWorkspaceAudioPaths(sourcePath);
    removeIfPresent(partialPath);
};

export const cleanupWorkspaceAudioArtifacts = sourcePath => {
    if (!sourcePath) return;
    const { audioPath, partialPath } = getWorkspaceAudioPaths(sourcePath);
    removeIfPresent(partialPath);
    removeIfPresent(audioPath);
};

export const validateExtractedAudio = async audioPath => {
    const stat = assertRegularFile(audioPath, 'Extracted audio');
    if (stat.size <= 44) throw new Error('Extracted audio is empty.');
    validateWavHeader(audioPath);
    const streams = await getStreamsDuration(audioPath);
    if (!streams.hasAudio || !Number.isFinite(streams.effectiveAudioDuration) ||
        streams.effectiveAudioDuration <= 0) {
        throw new Error('Extracted audio duration is invalid.');
    }
    fs.accessSync(audioPath, fs.constants.R_OK);
    return streams.effectiveAudioDuration;
};

export const extractWorkspaceAudio = async ({
    sourcePath,
    signal,
    onProgress = () => {},
    timeoutMs = Number(process.env.AUDIO_EXTRACTION_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    run = runFFmpeg,
    validate = validateExtractedAudio
}) => {
    assertRegularFile(sourcePath, 'Source video');
    const directory = path.dirname(sourcePath);
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
    const { audioPath, partialPath } = getWorkspaceAudioPaths(sourcePath);
    removeIfPresent(partialPath);
    removeIfPresent(audioPath);

    try {
        await run(['-version'], directory, null, 30000, { signal });
        await run([
            '-y',
            '-i', sourcePath,
            '-map', '0:a:0',
            '-vn',
            '-c:a', 'pcm_s16le',
            '-ar', '16000',
            '-ac', '1',
            '-f', 'wav',
            partialPath
        ], directory, onProgress, timeoutMs, { signal });
        const duration = await validate(partialPath);
        fs.renameSync(partialPath, audioPath);
        return { audioPath, audioDuration: duration };
    } catch (error) {
        removeIfPresent(partialPath);
        removeIfPresent(audioPath);
        if (error?.code === 'ABORT_ERR') {
            const cancellation = new Error('Audio extraction cancelled.');
            cancellation.name = 'AbortError';
            throw cancellation;
        }
        throw error;
    }
};
