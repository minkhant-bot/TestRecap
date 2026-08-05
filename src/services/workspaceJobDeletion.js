import {
    deleteTerminalJobArtifacts,
    validateTerminalJobArtifacts
} from './completedOutputDeletion.js';
import { clearJobKeys, deleteJob, getJob, updateJob } from './jobManager.js';
import {
    commitWorkspaceJobDeletion,
    commitWorkspaceJobExpiry,
    getWorkspaceJobInternal,
    prepareWorkspaceJobDeletion,
    updateWorkspaceJobInternal
} from './workspaceJobs.js';

export const deleteWorkspaceJobEverywhere = (id, ownerUid) => {
    const prepared = prepareWorkspaceJobDeletion(id, ownerUid);
    if (!prepared) return false;

    const coreJob = getJob(id);
    if (coreJob?.ownerUid && coreJob.ownerUid !== ownerUid) {
        const error = new Error('Workspace and core job ownership do not match.');
        error.code = 'JOB_OWNERSHIP_MISMATCH';
        throw error;
    }

    const deletableCoreJob = coreJob || {
        id,
        ownerUid,
        status: 'complete',
        videoPath: null,
        audioPath: null
    };
    validateTerminalJobArtifacts({ job: deletableCoreJob });

    // Removing the core record first immediately revokes /output authorization.
    // All paths have already passed safety validation, and a retry can finish
    // artifact cleanup from the still-present workspace record if filesystem I/O fails.
    deleteJob(id);
    deleteTerminalJobArtifacts({ job: deletableCoreJob });
    return commitWorkspaceJobDeletion(prepared);
};

// 24-hour completed-job retention (automatic sweep only -- distinct from the
// user-initiated deleteWorkspaceJobEverywhere above, which is unchanged).
// Deletes only the generated output video and temporary artifacts and marks
// both records "expired" rather than deleting them, so:
//   - a direct link to the job/output can report "Expired" instead of a
//     bare 404 or a broken file download;
//   - billing, ledger, purchase, audit, trial, and user-account records
//     (which never lived in these job records) are untouched;
//   - re-running this on an already-expired job is a safe, cheap no-op
//     (idempotent), including across a process restart.
export const expireWorkspaceJobEverywhere = (id, ownerUid) => {
    const workspaceJob = getWorkspaceJobInternal(id);
    if (!workspaceJob || workspaceJob.ownerUid !== ownerUid) return false;
    if (workspaceJob.status !== 'completed') return false;
    if (workspaceJob.expired) return true;

    const coreJob = getJob(id);
    if (coreJob?.ownerUid && coreJob.ownerUid !== ownerUid) {
        const error = new Error('Workspace and core job ownership do not match.');
        error.code = 'JOB_OWNERSHIP_MISMATCH';
        throw error;
    }

    // Two independent artifact sets, exactly like deleteWorkspaceJobEverywhere:
    // the core-side generated output/cache, and the workspace-side uploaded
    // source (prepareWorkspaceJobDeletion/commitWorkspaceJobExpiry) -- only
    // the record-removal step differs (kept + marked, not deleted).
    const prepared = prepareWorkspaceJobDeletion(id, ownerUid);

    const deletableCoreJob = coreJob || {
        id,
        ownerUid,
        status: 'complete',
        videoPath: null,
        audioPath: null
    };
    validateTerminalJobArtifacts({ job: deletableCoreJob });
    deleteTerminalJobArtifacts({ job: deletableCoreJob });
    if (prepared) commitWorkspaceJobExpiry(prepared);
    // The cached per-job Gemini credential is temporary data tied to this
    // job's processing run; clear it the same way full deletion already
    // does (jobManager.deleteJob drops it as a side effect there).
    clearJobKeys(id);

    const expiredAt = new Date().toISOString();
    if (coreJob) updateJob(id, { expired: true, expiredAt });
    updateWorkspaceJobInternal(id, { expired: true, expiredAt, videoUrl: null, audioUrl: null });
    return true;
};
