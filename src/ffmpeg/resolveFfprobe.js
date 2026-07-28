import fs from 'fs';
import { execFileSync } from 'child_process';

export const resolveFfprobePath = (staticPath, dependencies = {}) => {
    const runSystemProbe = dependencies.execFileSync || execFileSync;
    const checkAccess = dependencies.accessSync || fs.accessSync;

    try {
        runSystemProbe('ffprobe', ['-version'], { stdio: 'ignore' });
        return 'ffprobe';
    } catch (_) {
        // Fall through to the packaged binary only when system ffprobe is unavailable.
    }

    if (typeof staticPath === 'string' && staticPath.length > 0) {
        try {
            checkAccess(staticPath, fs.constants.X_OK);
            return staticPath;
        } catch (_) {
            // The final error below identifies both attempted sources.
        }
    }

    throw new Error(
        `ffprobe is unavailable: system command "ffprobe" could not be executed and ` +
        `ffprobe-static is missing or not executable at "${staticPath || '<unresolved>'}".`
    );
};
