import { clearJobKeys, deleteJob, getExpiredJobs, getJob } from './jobManager.js';
import { deleteCompletedJobAndRecord } from './completedOutputDeletion.js';

export const sweepExpiredCompletedJobs = ({
    now = Date.now(),
    maxAgeMs = 24 * 60 * 60 * 1000,
    projectRoot = process.cwd()
} = {}) => {
    const expiredJobs = getExpiredJobs(now - maxAgeMs);
    for (const { id: jobId } of expiredJobs) {
        const job = getJob(jobId);
        if (!job || job.status !== 'complete') continue;
        try {
            deleteCompletedJobAndRecord({
                job,
                clearCredentials: clearJobKeys,
                deleteRecord: deleteJob,
                projectRoot
            });
            console.log(`[Cleanup] Successfully swept completed job ${jobId}.`);
        } catch (error) {
            console.error(`[Cleanup] Failed to sweep completed job ${jobId}:`, error);
        }
    }
    return expiredJobs.length;
};

export const startCleanupSweep = () => {
    const sweep = () => {
        try {
            sweepExpiredCompletedJobs();
        } catch (error) {
            console.error('[Cleanup] Sweep failed:', error);
        }
    };
    sweep();
    return setInterval(sweep, 30 * 60 * 1000);
};
