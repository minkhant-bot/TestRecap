import fs from 'fs';
import path from 'path';

const resolveOwnedPath = (root, candidate) => {
    const resolvedRoot = path.resolve(root);
    const resolved = path.resolve(candidate);
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
        throw new Error(`Unsafe cleanup path outside job ownership: ${resolved}`);
    }
    return resolved;
};

const removeFile = (filePath, fsImpl) => {
    if (!fsImpl.existsSync(filePath)) return;
    const stat = fsImpl.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`Unsafe cleanup artifact: ${filePath}`);
    }
    fsImpl.unlinkSync(filePath);
};

export const cleanupPipelineArtifacts = ({
    cacheDir,
    uploadRoot,
    videoPath,
    audioPath,
    lifecycleStatus,
    fsImpl = fs
}) => {
    const removed = [];
    const retainedForRetry = lifecycleStatus === 'error' || lifecycleStatus === 'queued';
    const removeOwnedFile = (root, candidate) => {
        if (!candidate) return;
        const safePath = resolveOwnedPath(root, candidate);
        if (fsImpl.existsSync(safePath)) {
            removeFile(safePath, fsImpl);
            removed.push(safePath);
        }
    };

    if (fsImpl.existsSync(cacheDir)) {
        const cacheStat = fsImpl.lstatSync(cacheDir);
        if (cacheStat.isSymbolicLink() || !cacheStat.isDirectory()) {
            throw new Error('Unsafe job cache directory.');
        }
        const removePartialFiles = directory => {
            for (const entry of fsImpl.readdirSync(directory, { withFileTypes: true })) {
                const candidate = resolveOwnedPath(cacheDir, path.join(directory, entry.name));
                if (entry.isSymbolicLink()) throw new Error(`Unsafe symlink in job cache: ${candidate}`);
                if (entry.isDirectory()) removePartialFiles(candidate);
                else if (entry.name.includes('.tmp') || entry.name.endsWith('.partial')) {
                    fsImpl.unlinkSync(candidate);
                    removed.push(candidate);
                }
            }
        };
        removePartialFiles(cacheDir);

        if (!retainedForRetry) {
            for (const name of ['video.wav', 'audio.wav']) {
                removeOwnedFile(cacheDir, path.join(cacheDir, name));
            }
            for (const name of ['tts_chunks', 'tts_chunks_scene', 'media-work']) {
                const directory = resolveOwnedPath(cacheDir, path.join(cacheDir, name));
                if (!fsImpl.existsSync(directory)) continue;
                if (fsImpl.lstatSync(directory).isSymbolicLink()) {
                    throw new Error(`Unsafe cleanup directory: ${directory}`);
                }
                fsImpl.rmSync(directory, { recursive: true, force: false });
                removed.push(directory);
            }
        }
    }

    if (!retainedForRetry) {
        removeOwnedFile(uploadRoot, videoPath);
        removeOwnedFile(uploadRoot, audioPath);
    }
    return { removed, retainedForRetry };
};
