import { clearJobKeys, getExpiredJobs, getJob, updateJob } from './jobManager.js';
import { deleteCompletedJobArtifacts } from './completedOutputDeletion.js';
import { expireWorkspaceJobEverywhere } from './workspaceJobDeletion.js';
import {
    getExpiredCompletedWorkspaceJobs,
    getWorkspaceJobInternal
} from './workspaceJobs.js';

// 24-hour completed-job retention: only ever considers jobs whose status is
// literally 'complete'/'completed' (see getExpiredJobs /
// getExpiredCompletedWorkspaceJobs) -- queued, processing, failed,
// cancelled, and recovery-required (billing review_required) jobs are never
// candidates, at any age. This sweep EXPIRES jobs (deletes only the
// generated output/temporary artifacts, keeps a minimal record for direct
// "Expired" link access) -- it never deletes billing, ledger, purchase,
// audit, trial, or user-account data, none of which lives in these records.
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
        if (job.expired) continue;
        try {
            const workspaceJob = getWorkspaceJobInternal(jobId);
            if (workspaceJob) {
                if (!TERMINAL_WORKSPACE_STATUSES.has(workspaceJob.status)) {
                    console.warn(
                        `[Cleanup] Skipped expired core job ${jobId}; linked workspace job is ${workspaceJob.status}.`
                    );
                    continue;
                }
                expireWorkspaceJobEverywhere(jobId, workspaceJob.ownerUid);
            } else {
                deleteCompletedJobArtifacts({ job, projectRoot });
                clearJobKeys(jobId);
                updateJob(jobId, { expired: true, expiredAt: new Date().toISOString() });
            }
            console.log(`[Cleanup] Successfully expired completed job ${jobId}.`);
        } catch (error) {
            console.error(`[Cleanup] Failed to expire completed job ${jobId}:`, error);
        }
    }
    const orphanedWorkspaceJobs = getExpiredCompletedWorkspaceJobs(timeLimit)
        .filter(job => !coreCandidateIds.has(job.id));
    for (const { id: jobId, ownerUid } of orphanedWorkspaceJobs) {
        try {
            expireWorkspaceJobEverywhere(jobId, ownerUid);
            console.log(`[Cleanup] Successfully expired orphaned workspace job ${jobId}.`);
        } catch (error) {
            console.error(`[Cleanup] Failed to expire orphaned workspace job ${jobId}:`, error);
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
