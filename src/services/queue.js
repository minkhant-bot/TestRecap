import PQueue from 'p-queue';
import { processRecapPipeline } from '../workers/processor.js';
import { updateJob } from './jobManager.js';

// Concurrency limits for job processing on 8 vCPU / 8 GB RAM Railway.
// Default to 1 to preserve baseline stability, but allows scaling via QUEUE_CONCURRENCY.
let concurrencyLimit = 1;
if (process.env.QUEUE_CONCURRENCY) {
    const parsed = parseInt(process.env.QUEUE_CONCURRENCY, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
        concurrencyLimit = parsed;
    }
}

const queue = new PQueue({ concurrency: concurrencyLimit });

export const addJobToQueue = (jobId) => {
    queue.add(async () => {
        try {
            await processRecapPipeline(jobId);
        } catch (error) {
            console.error(`[Queue] Job ${jobId} failed:`, error);
            updateJob(jobId, { status: 'error', error: error.message });
        }
    });
};
