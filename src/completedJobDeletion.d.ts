export function requestCompletedJobDeletion(options: {
    jobId: string;
    confirmDeletion: () => boolean;
    deleteRequest: (jobId: string) => Promise<unknown>;
}): Promise<boolean>;

export function removeCompletedJobId(storedIds: string[], jobId: string): string[];

export function getCompletedJobDeletionError(error: unknown): string;
