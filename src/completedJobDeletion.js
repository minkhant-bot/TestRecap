export const requestCompletedJobDeletion = async ({
    jobId,
    confirmDeletion,
    deleteRequest
}) => {
    if (!confirmDeletion()) return false;
    await deleteRequest(jobId);
    return true;
};

export const removeCompletedJobId = (storedIds, jobId) =>
    storedIds.filter(id => id !== jobId);

export const getCompletedJobDeletionError = error =>
    error?.response?.data?.error || error?.message || 'Failed to delete completed video.';
