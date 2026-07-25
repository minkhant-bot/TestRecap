import { getExpiredJobs, deleteJob } from './jobManager.js';
import fs from 'fs';
import path from 'path';

export const startCleanupSweep = () => {
    const sweep = () => {
        try {
            const timeLimit = Date.now() - 24 * 60 * 60 * 1000;
            const expiredJobs = getExpiredJobs(timeLimit);

            if (expiredJobs.length > 0) {
                console.log(`[Cleanup] Found ${expiredJobs.length} expired completed jobs.`);
            }

            for (const job of expiredJobs) {
                const jobId = job.id;
                let freedBytes = 0;

                // Delete output file
                const outputPath = path.join(process.cwd(), 'public', 'output', `${jobId}.mp4`);
                try {
                    if (fs.existsSync(outputPath)) {
                        const stat = fs.statSync(outputPath);
                        freedBytes += stat.size;
                        fs.unlinkSync(outputPath);
                    }
                } catch (e) {
                    console.error(`[Cleanup] Failed to delete output for ${jobId}:`, e);
                }

                // Delete cache directory
                const cacheDir = path.join(process.cwd(), 'data', 'cache', jobId);
                try {
                    if (fs.existsSync(cacheDir)) {
                        fs.rmSync(cacheDir, { recursive: true, force: true });
                    }
                } catch (e) {
                    console.error(`[Cleanup] Failed to delete cache for ${jobId}:`, e);
                }

                // Delete from DB
                try {
                    deleteJob(jobId);
                    console.log(`[Cleanup] Successfully swept job ${jobId}. Freed ~${(freedBytes / 1024 / 1024).toFixed(2)} MB.`);
                } catch (e) {
                    console.error(`[Cleanup] Failed to delete DB row for ${jobId}:`, e);
                }
            }
        } catch (e) {
            console.error(`[Cleanup] Sweep failed:`, e);
        }
    };

    // Run once on startup
    sweep();

    // Run every 30 minutes
    setInterval(sweep, 30 * 60 * 1000);
};
