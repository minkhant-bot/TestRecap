import type { UploadConfiguration, VideoEffects, WorkspaceJob, WorkspaceJobStatus, WorkspaceQueue, WorkspaceRetryEligibility, WorkspaceRetryResult } from './types';

export class WorkspaceApiError extends Error {
  code?: string;
  status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'WorkspaceApiError';
    this.status = status;
    this.code = code;
  }
}

const parseResponse = async <T>(response: Response): Promise<T> => {
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('testrecap:session-expired'));
    throw new Error('Session သက်တမ်းကုန်သွားပါပြီ။ ဆက်လုပ်ရန် ပြန်ဝင်ပါ။');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new WorkspaceApiError(
    payload.error || 'တောင်းဆိုမှုကို မလုပ်ဆောင်နိုင်ပါ။', response.status, payload.code,
  );
  return payload as T;
};

export const getUploadConfiguration = async () =>
  parseResponse<UploadConfiguration>(await fetch('/api/workspace/config', { credentials: 'include' }));


export const listWorkspaceJobs = async () =>
  parseResponse<WorkspaceJob[]>(await fetch('/api/workspace/jobs', { credentials: 'include' }));

export const getWorkspaceJob = async (jobId: string) =>
  parseResponse<WorkspaceJob>(await fetch(`/api/workspace/jobs/${encodeURIComponent(jobId)}`, {
    credentials: 'include',
  }));

export const getWorkspaceJobStatus = async (jobId: string) =>
  parseResponse<WorkspaceJobStatus>(await fetch(`/api/workspace/jobs/${encodeURIComponent(jobId)}/status`, {
    credentials: 'include',
  }));

export const getWorkspaceQueue = async () =>
  parseResponse<WorkspaceQueue>(await fetch('/api/workspace/queue', { credentials: 'include' }));

export const getWorkspaceRetryEligibility = async (jobId: string) =>
  parseResponse<WorkspaceRetryEligibility>(await fetch(
    `/api/workspace/jobs/${encodeURIComponent(jobId)}/retry`,
    { credentials: 'include' },
  ));

export const retryWorkspaceJob = async (jobId: string, idempotencyKey: string) =>
  parseResponse<WorkspaceRetryResult>(await fetch(
    `/api/workspace/jobs/${encodeURIComponent(jobId)}/retry`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Idempotency-Key': idempotencyKey },
    },
  ));

// TEMPORARY diagnostics for the "Idempotency-Key is required." production
// investigation. Reports only presence/length/attempt count -- never the
// actual key value. Remove once the header-loss cause is found.
const logQueueIdempotencyDiagnostics = (idempotencyKey: string, endpoint: string, attemptNumber: number) => {
  console.info('[queueWorkspaceJob diagnostics]', JSON.stringify({
    event: 'queueWorkspaceJob.idempotency_diagnostics',
    endpoint,
    idempotencyKeyGenerated: Boolean(idempotencyKey),
    idempotencyKeyLength: idempotencyKey ? idempotencyKey.length : 0,
    attemptNumber,
  }));
};

export const queueWorkspaceJob = async (
  jobId: string, idempotencyKey: string, effects?: VideoEffects, attemptNumber = 1,
) => {
  const body = { effects };
  const url = `/api/workspace/jobs/${encodeURIComponent(jobId)}/queue`;
  logQueueIdempotencyDiagnostics(idempotencyKey, url, attemptNumber);
  try {
    return parseResponse<WorkspaceJobStatus>(await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    }));
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('ဆာဗာနှင့် ချိတ်ဆက်၍ မရပါ။ လက်ရှိရွေးချယ်မှုများကို မပျောက်စေဘဲ ထပ်စမ်းနိုင်ပါသည်။');
    }
    throw error;
  }
};

export const cancelWorkspaceJob = async (jobId: string) =>
  parseResponse<WorkspaceJob>(await fetch(`/api/workspace/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    credentials: 'include',
  }));

export const deleteWorkspaceJob = async (jobId: string) =>
  parseResponse<{ deleted: true; jobId: string }>(await fetch(`/api/workspace/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    credentials: 'include',
  }));

interface UploadCallbacks {
  onProgress: (percentage: number) => void;
  onComplete: (job: WorkspaceJob) => void;
  onError: (message: string) => void;
}

export const uploadWorkspaceJob = (
  file: File,
  duration: number | null,
  callbacks: UploadCallbacks,
) => {
  const request = new XMLHttpRequest();
  request.open('POST', '/api/workspace/jobs');
  request.withCredentials = true;
  request.responseType = 'json';
  request.upload.addEventListener('progress', event => {
    if (event.lengthComputable) callbacks.onProgress(Math.round((event.loaded / event.total) * 100));
  });
  request.addEventListener('load', () => {
    const payload = request.response as WorkspaceJob | { error?: string } | null;
    if (request.status >= 200 && request.status < 300) {
      callbacks.onComplete(payload as WorkspaceJob);
      return;
    }
    callbacks.onError(
      payload && 'error' in payload && payload.error
        ? payload.error
        : 'ဗီဒီယိုကို တင်၍မရပါ။',
    );
  });
  request.addEventListener('error', () => callbacks.onError('ကွန်ရက်ပြတ်တောက်၍ ဗီဒီယိုတင်ခြင်း ရပ်သွားပါသည်။'));
  request.addEventListener('abort', () => callbacks.onError('ဗီဒီယိုတင်ခြင်း ပယ်ဖျက်ပြီး။'));

  const body = new FormData();
  body.append('video', file);
  if (duration !== null) body.append('duration', String(duration));
  request.send(body);
  return () => request.abort();
};
