import { clearJobKeys, deleteJob, getExpiredJobs, getJob } from './jobManager.js';
import { deleteCompletedJobAndRecord } from './completedOutputDeletion.js';
import { deleteWorkspaceJobEverywhere } from './workspaceJobDeletion.js';
import {
    getExpiredCompletedWorkspaceJobs,
    getWorkspaceJobInternal
} from './workspaceJobs.js';

const TERMINAL_WORKSPACE_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export const sweepExpiredCompletedJobs = ({
    now = Date.now(),
    maxAgeMs = 24 * 60 * 60 * 1000,
    projectRoot = process.cwd()
} = {}) => {
    const timeLimit = now - maxAgeMs;
    const expiredJobs = getExpiredJobs(timeLimit);
    const coreCandidateIds = new Set(expiredJobs.map(job => job.id));
    for (const { id: jobId } of expiredJobs) {
        const job = getJob(jobId);
        if (!job || job.status !== 'complete') continue;
        try {
            const workspaceJob = getWorkspaceJobInternal(jobId);
            if (workspaceJob) {
                if (!TERMINAL_WORKSPACE_STATUSES.has(workspaceJob.status)) {
                    console.warn(
                        `[Cleanup] Skipped expired core job ${jobId}; linked workspace job is ${workspaceJob.status}.`
                    );
                    continue;
                }
                deleteWorkspaceJobEverywhere(jobId, workspaceJob.ownerUid);
            } else {
                deleteCompletedJobAndRecord({
                    job,
                    clearCredentials: clearJobKeys,
                    deleteRecord: deleteJob,
                    projectRoot
                });
            }
            console.log(`[Cleanup] Successfully swept completed job ${jobId}.`);
        } catch (error) {
            console.error(`[Cleanup] Failed to sweep completed job ${jobId}:`, error);
        }
    }
    const orphanedWorkspaceJobs = getExpiredCompletedWorkspaceJobs(timeLimit)
        .filter(job => !coreCandidateIds.has(job.id));
    for (const { id: jobId, ownerUid } of orphanedWorkspaceJobs) {
        try {
            deleteWorkspaceJobEverywhere(jobId, ownerUid);
            console.log(`[Cleanup] Successfully swept orphaned workspace job ${jobId}.`);
        } catch (error) {
            console.error(`[Cleanup] Failed to sweep orphaned workspace job ${jobId}:`, error);
        }
    }
    return expiredJobs.length + orphanedWorkspaceJobs.length;
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
