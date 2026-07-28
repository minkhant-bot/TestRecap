import fs from 'fs';
import path from 'path';
import { getStoragePaths } from '../config/runtime.js';

export const COMPLETED_JOB_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const resolveInside = (root, target, label) => {
    const resolvedRoot = path.resolve(root);
    const resolvedTarget = path.resolve(target);
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
        throw new Error(`Unsafe ${label} path is outside its owned directory.`);
    }
    return resolvedTarget;
};

export const resolveCompletedJobForDeletion = ({ jobId, job, projectRoot = process.cwd(), fsImpl = fs }) => {
    if (!COMPLETED_JOB_ID_PATTERN.test(jobId)) throw new Error('Invalid job ID.');
    if (job) return job;
    const outputRoot = getStoragePaths(process.env, projectRoot).output;
    const outputPath = resolveInside(outputRoot, path.join(outputRoot, `${jobId}.mp4`), 'MP4');
    if (!fsImpl.existsSync(outputPath)) return null;
    const stat = fsImpl.lstatSync(outputPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('Completed MP4 is not a safe regular file.');
    }
    return { id: jobId, status: 'complete', videoPath: null, audioPath: null };
};

export const collectCompletedJobArtifactPaths = ({
    job,
    projectRoot = process.cwd(),
    fsImpl = fs
}) => {
    if (!job || !COMPLETED_JOB_ID_PATTERN.test(job.id)) {
        throw new Error('Invalid job ID.');
    }
    if (job.status !== 'complete') {
        throw new Error('Only completed jobs can be deleted.');
    }

    const storagePaths = getStoragePaths(process.env, projectRoot);
    const outputRoot = storagePaths.output;
    const cacheRoot = storagePaths.cache;
    const temporaryRoot = storagePaths.uploads;
    const files = [
        resolveInside(outputRoot, path.join(outputRoot, `${job.id}.mp4`), 'MP4'),
        resolveInside(outputRoot, path.join(outputRoot, `${job.id}.mp3`), 'MP3')
    ];
    const directories = [
        resolveInside(cacheRoot, path.join(cacheRoot, job.id), 'cache')
    ];

    for (const recordedPath of [job.videoPath, job.audioPath]) {
        if (!recordedPath) continue;
        files.push(resolveInside(temporaryRoot, recordedPath, 'temporary artifact'));
    }

    if (fsImpl.existsSync(temporaryRoot)) {
        for (const name of fsImpl.readdirSync(temporaryRoot)) {
            const belongsToJob = name === job.id ||
                name.startsWith(`${job.id}_`) ||
                name.startsWith(`${job.id}.`);
            if (belongsToJob) {
                files.push(resolveInside(temporaryRoot, path.join(temporaryRoot, name), 'temporary artifact'));
            }
        }
    }

    return {
        files: [...new Set(files)],
        directories: [...new Set(directories)]
    };
};

export const deleteCompletedJobArtifacts = options => {
    const fsImpl = options.fsImpl || fs;
    const targets = collectCompletedJobArtifactPaths({ ...options, fsImpl });

    for (const target of [...targets.files, ...targets.directories]) {
        if (!fsImpl.existsSync(target)) continue;
        const stat = fsImpl.lstatSync(target);
        if (targets.directories.includes(target) && stat.isSymbolicLink()) {
            throw new Error('Unsafe cache path is a symbolic link.');
        }
    }

    const deleted = [];
    for (const target of targets.files) {
        if (!fsImpl.existsSync(target)) continue;
        const stat = fsImpl.lstatSync(target);
        if (stat.isDirectory() && !stat.isSymbolicLink()) {
            throw new Error(`Expected a file but found a directory: ${path.basename(target)}`);
        }
        fsImpl.unlinkSync(target);
        deleted.push(target);
    }
    for (const target of targets.directories) {
        if (!fsImpl.existsSync(target)) continue;
        fsImpl.rmSync(target, { recursive: true, force: false });
        deleted.push(target);
    }
    return deleted;
};
export const deleteCompletedJobAndRecord = ({ job, deleteRecord, clearCredentials, ...artifactOptions }) => {
    if (typeof deleteRecord !== 'function' || typeof clearCredentials !== 'function') {
        throw new Error('Completed-job record deletion callbacks are required.');
    }
    const deletedArtifacts = deleteCompletedJobArtifacts({ ...artifactOptions, job });
    clearCredentials(job.id);
    deleteRecord(job.id);
    return deletedArtifacts;
};
