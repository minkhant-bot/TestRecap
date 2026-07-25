const jobsStore = new Map();
const jobKeys = new Map();

export const setJobKeys = (id, keys) => {
    jobKeys.set(id, keys);
};

export const getJobKeys = (id) => {
    return jobKeys.get(id) || {};
};

export const clearJobKeys = (id) => {
    jobKeys.delete(id);
};

export const createJob = (id, data) => {
    const job = {
        id,
        videoPath: data.videoPath,
        audioPath: data.audioPath,
        status: 'uploading',
        progress: 0,
        currentStep: 'Upload',
        created_at: Date.now(),
        originalFilename: data.originalFilename || null
    };
    jobsStore.set(id, job);
    return getJob(id);
};

export const getJob = (id) => {
    const row = jobsStore.get(id);
    if (!row) return null;
    const cloned = { ...row };
    if (typeof cloned.result === 'string') {
        try { cloned.result = JSON.parse(cloned.result); } catch (e) {}
    }
    return cloned;
};

export const updateJob = (id, updates) => {
    const existing = jobsStore.get(id);
    if (!existing) return;
    
    const updated = { ...existing };
    for (const [k, v] of Object.entries(updates)) {
        if (k === 'result' && typeof v !== 'string') {
            updated[k] = JSON.stringify(v);
        } else {
            updated[k] = v;
        }
    }
    jobsStore.set(id, updated);
};

export const getExpiredJobs = (timeLimit) => {
    const expired = [];
    for (const [id, job] of jobsStore.entries()) {
        if (job.status === 'complete' && job.completed_at != null && job.completed_at < timeLimit) {
            expired.push({ id });
        }
    }
    return expired;
};

export const deleteJob = (id) => {
    jobsStore.delete(id);
};

export const recoverStuckJobs = () => {
    for (const [id, job] of jobsStore.entries()) {
        if (['processing', 'pending', 'uploading'].includes(job.status)) {
            job.status = 'error';
            job.error = 'Job interrupted due to server restart.';
            jobsStore.set(id, job);
        }
    }
};
