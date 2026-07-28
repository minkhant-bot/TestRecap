import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { WORKFLOW_VERSION } from '../domain/workflow.js';

export const FASTER_WHISPER_ALGORITHM_VERSION = 'faster-whisper-small-cpu-v1';
export const FASTER_WHISPER_MODEL = 'small';
export const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 30 * 60 * 1000;

const positiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const getFasterWhisperRuntimeConfig = (env = process.env, detectedCpuCount = os.cpus().length) => {
    const cpuCount = Math.max(1, detectedCpuCount || 1);
    const safeThreadLimit = Math.min(cpuCount, 4);
    const cpuThreads = Math.min(positiveInteger(env.WHISPER_CPU_THREADS, safeThreadLimit), safeThreadLimit);
    return {
        model: env.WHISPER_MODEL || FASTER_WHISPER_MODEL,
        device: env.WHISPER_DEVICE || 'cpu',
        computeType: env.WHISPER_COMPUTE_TYPE || 'int8',
        detectedCpuCount: cpuCount,
        cpuThreads,
        numWorkers: Math.min(positiveInteger(env.WHISPER_NUM_WORKERS, 1), cpuThreads),
        beamSize: positiveInteger(env.WHISPER_BEAM_SIZE, 3),
        ompNumThreads: Math.min(positiveInteger(env.OMP_NUM_THREADS, cpuThreads), cpuCount),
        cacheDirectory: path.resolve(env.HF_HOME || path.join(process.cwd(), '.cache', 'huggingface'))
    };
};

export const formatFasterWhisperStartupConfig = config =>
    `Faster-Whisper config: model=${config.model} device=${config.device} ` +
    `compute_type=${config.computeType} detected_cpu_count=${config.detectedCpuCount} ` +
    `cpu_threads=${config.cpuThreads} num_workers=${config.numWorkers} ` +
    `beam_size=${config.beamSize} cache_dir=${config.cacheDirectory}`;

export const fingerprintFile = filePath => crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');

export const validateSourceTranscript = (records, duration) => {
    if (!Array.isArray(records)) throw new Error('Faster-Whisper output must be a JSON array.');
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Real WAV duration is invalid.');
    let previousEnd = 0;
    return records.map((record, index) => {
        if (!record || typeof record.text !== 'string' || !record.text.trim()) {
            throw new Error(`Faster-Whisper record ${index} has invalid source text.`);
        }
        if (!Array.isArray(record.timestamp) || record.timestamp.length !== 2 ||
            !record.timestamp.every(Number.isFinite)) {
            throw new Error(`Faster-Whisper record ${index} must contain finite [start, end] timestamps.`);
        }
        const [start, end] = record.timestamp;
        if (start < 0 || end <= start) {
            throw new Error(`Faster-Whisper record ${index} has invalid range ${start} -> ${end}.`);
        }
        if (start < previousEnd) {
            throw new Error(`Faster-Whisper record ${index} overlaps the previous record.`);
        }
        if (end > duration) {
            throw new Error(`Faster-Whisper record ${index} exceeds the real WAV duration.`);
        }
        previousEnd = end;
        return { timestamp: [start, end], text: record.text.trim() };
    });
};

export const parseFasterWhisperOutput = (stdout, duration) => {
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    } catch {
        throw new Error('Faster-Whisper returned malformed JSON.');
    }
    return validateSourceTranscript(parsed, duration);
};

export const resolvePythonCandidates = env => {
    const configured = [env.PYTHON_PATH, env.PYTHON].filter(Boolean);
    return [...new Set([...configured, 'python3', 'python'])];
};

const terminateProcess = child => {
    if (!child || child.killed) return;
    try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
    } catch {
        try { child.kill('SIGTERM'); } catch { }
    }
};

export const invokeFasterWhisper = ({
    wavPath,
    duration,
    scriptPath,
    timeoutMs = DEFAULT_TRANSCRIPTION_TIMEOUT_MS,
    signal,
    spawnImpl = spawn,
    pythonCandidates = resolvePythonCandidates(process.env),
    runtimeConfig = getFasterWhisperRuntimeConfig()
}) => new Promise((resolve, reject) => {
    let candidateIndex = 0;
    let settled = false;
    let child;
    let timeout;

    const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve(value);
    };
    const onAbort = () => {
        terminateProcess(child);
        finish(Object.assign(new Error('Faster-Whisper transcription cancelled.'), { code: 'ABORT_ERR' }));
    };

    const launch = () => {
        const python = pythonCandidates[candidateIndex++];
        if (!python) {
            finish(new Error('No usable Python interpreter found for Faster-Whisper.'));
            return;
        }
        let stdout = '';
        let stderr = '';
        child = spawnImpl(python, [scriptPath, wavPath], {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
            env: {
                ...process.env,
                WHISPER_MODEL: runtimeConfig.model,
                WHISPER_DEVICE: runtimeConfig.device,
                WHISPER_COMPUTE_TYPE: runtimeConfig.computeType,
                WHISPER_CPU_THREADS: String(runtimeConfig.cpuThreads),
                WHISPER_NUM_WORKERS: String(runtimeConfig.numWorkers),
                WHISPER_BEAM_SIZE: String(runtimeConfig.beamSize),
                OMP_NUM_THREADS: String(runtimeConfig.ompNumThreads),
                HF_HOME: runtimeConfig.cacheDirectory
            }
        });
        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.on('error', error => {
            if (error.code === 'ENOENT' && candidateIndex < pythonCandidates.length) {
                launch();
                return;
            }
            finish(new Error(`Failed to start Faster-Whisper with ${python}: ${error.message}`));
        });
        child.on('close', code => {
            if (settled) return;
            if (code !== 0) {
                const diagnostic = stderr.trim().slice(-2000);
                finish(new Error(`Faster-Whisper exited with code ${code}${diagnostic ? `: ${diagnostic}` : ''}`));
                return;
            }
            try {
                finish(null, parseFasterWhisperOutput(stdout, duration));
            } catch (error) {
                finish(error);
            }
        });
    };

    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    timeout = setTimeout(() => {
        terminateProcess(child);
        finish(Object.assign(new Error(`Faster-Whisper timed out after ${timeoutMs}ms.`), { code: 'ETIMEDOUT' }));
    }, timeoutMs);
    launch();
});

export const transcribeWithFasterWhisper = async ({
    wavPath,
    cachePath,
    duration,
    signal,
    timeoutMs,
    invoke = invokeFasterWhisper,
    sourceFingerprint = fingerprintFile(wavPath),
    scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'transcribe.py'),
    runtimeConfig = getFasterWhisperRuntimeConfig()
}) => {
    if (cachePath && fs.existsSync(cachePath)) {
        try {
            const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            if (cached.workflowVersion !== WORKFLOW_VERSION ||
                cached.algorithmVersion !== FASTER_WHISPER_ALGORITHM_VERSION ||
                cached.model !== runtimeConfig.model ||
                cached.device !== runtimeConfig.device ||
                cached.computeType !== runtimeConfig.computeType ||
                cached.sourceFingerprint !== sourceFingerprint ||
                cached.duration !== duration) {
                throw new Error('Source transcript cache fingerprint mismatch.');
            }
            return validateSourceTranscript(cached.records, duration);
        } catch (error) {
            console.warn(`[Transcription] Cache rejected: ${error.message}`);
        }
    }

    const records = await invoke({ wavPath, duration, scriptPath, timeoutMs, signal, runtimeConfig });
    const validated = validateSourceTranscript(records, duration);
    if (cachePath) {
        fs.writeFileSync(cachePath, JSON.stringify({
            workflowVersion: WORKFLOW_VERSION,
            algorithmVersion: FASTER_WHISPER_ALGORITHM_VERSION,
            model: runtimeConfig.model,
            device: runtimeConfig.device,
            computeType: runtimeConfig.computeType,
            sourceFingerprint,
            duration,
            records: validated
        }, null, 2));
    }
    return validated;
};
