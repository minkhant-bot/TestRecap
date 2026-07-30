import {
    deleteTerminalJobArtifacts,
    validateTerminalJobArtifacts
} from './completedOutputDeletion.js';
import { deleteJob, getJob } from './jobManager.js';
import {
    commitWorkspaceJobDeletion,
    prepareWorkspaceJobDeletion
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
