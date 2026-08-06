import { useCallback, useEffect, useRef, useState } from 'react';
import { WorkspaceApiError, cancelWorkspaceJob, getWorkspaceJobStatus, getWorkspaceRetryEligibility, retryWorkspaceJob } from './api';
import type { WorkspaceJobStatus, WorkspaceRetryEligibility } from './types';

// Real SSE subscription + retry/cancel/media-fetch logic, extracted out of
// what used to be ProcessingPage.tsx's ProcessingStatusView so the new
// screen can render Processing/Completed/ErrorState however
// BlinkAutomationFull_v2.jsx's own component shapes require.
export function useJobStatus(projectId: string | null) {
  const [job, setJob] = useState<WorkspaceJobStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryEligibility, setRetryEligibility] = useState<WorkspaceRetryEligibility | null>(null);
  const [retryFeedback, setRetryFeedback] = useState<string | null>(null);
  const retryKeyRef = useRef<{ jobId: string; key: string } | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaRetry, setMediaRetry] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const pollingRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setJob(null);
      setLoading(false);
      return;
    }
    try {
      setJob(await getWorkspaceJobStatus(projectId));
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'လုပ်ဆောင်မှုအခြေအနေကို မရရှိနိုင်ပါ။');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setJob(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
    const events = new EventSource(`/api/workspace/jobs/${encodeURIComponent(projectId)}/events`, {
      withCredentials: true,
    });
    const accept = (event: MessageEvent<string>) => {
      const incoming = JSON.parse(event.data) as {
        eventType: string;
        payload?: Partial<WorkspaceJobStatus> & { position?: number };
      };
      if (!incoming.payload) return;
      const payload = incoming.payload;
      setJob(current => ({
        ...(current || {}),
        ...payload,
        queuePosition: payload.position ?? payload.queuePosition ?? current?.queuePosition ?? null,
      } as WorkspaceJobStatus));
    };
    for (const eventName of [
      'job.snapshot',
      'queue.position_changed',
      'job.processing_started',
      'job.cancellation_requested',
      'stage.started',
      'stage.progress',
      'stage.completed',
      'job.completed',
      'job.failed',
      'job.cancelled',
      'job.recovered',
      'job.retry_accepted',
    ]) events.addEventListener(eventName, accept as EventListener);
    events.onerror = () => {
      setDegraded(true);
      if (pollingRef.current === null) {
        pollingRef.current = window.setInterval(() => void refresh(), 3000);
      }
    };
    // The browser's own EventSource retries the connection automatically;
    // once it reopens (including after a temporary network loss), the
    // polling fallback above must stop -- otherwise SSE and polling both
    // keep running forever after a single transient blip.
    events.onopen = () => {
      setDegraded(false);
      if (pollingRef.current !== null) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
    return () => {
      events.close();
      if (pollingRef.current !== null) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [projectId, refresh]);

  useEffect(() => {
    if (!job || job.status !== 'failed') {
      setRetryEligibility(null);
      return;
    }
    let current = true;
    setRetryEligibility(null);
    void getWorkspaceRetryEligibility(job.id).then(result => {
      if (current) setRetryEligibility(result);
    }).catch(requestError => {
      if (current) setRetryEligibility({
        recoverable: false,
        code: requestError instanceof WorkspaceApiError ? requestError.code : 'RETRY_CHECK_FAILED',
        reason: requestError instanceof Error ? requestError.message : 'Retry availability could not be checked.',
      });
    });
    return () => { current = false; };
  }, [job?.id, job?.status, job?.updatedAt]);

  const retryFailedJob = async () => {
    if (!job || retrying || !retryEligibility?.recoverable) return;
    setRetrying(true);
    setRetryFeedback(null);
    const current = retryKeyRef.current;
    const key = current?.jobId === job.id ? current.key : crypto.randomUUID();
    retryKeyRef.current = { jobId: job.id, key };
    try {
      const result = await retryWorkspaceJob(job.id, key);
      setJob(previous => previous ? { ...previous, ...result.job } : result.job);
      setRetryFeedback(result.replayed
        ? 'This retry is already queued or processing.'
        : 'Retry accepted. Resuming your recap.');
    } catch (requestError) {
      if (requestError instanceof WorkspaceApiError && requestError.code === 'JOB_ALREADY_ACTIVE') {
        setRetryFeedback('This project is already queued or processing.');
        await refresh();
      } else {
        setRetryFeedback(requestError instanceof Error ? requestError.message : 'Retry could not be requested.');
      }
    } finally {
      setRetrying(false);
    }
  };

  const cancelJob = async () => {
    if (!job || cancelling || job.cancellationRequested) return;
    setCancelling(true);
    try {
      const cancelled = await cancelWorkspaceJob(job.id);
      setJob(current => current ? { ...current, ...cancelled } : current);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'ပယ်ဖျက်ရန် တောင်းဆို၍မရပါ။');
    } finally {
      setCancelling(false);
    }
  };

  // Independent of the inline preview fetch below: Download must remain
  // available whenever the stored, authoritative job.videoUrl is valid,
  // even when the preview blob fetch has failed (e.g. a transient network
  // error) -- the two must never share one failure state. Always uses
  // job.videoUrl verbatim; never derives or fabricates a fallback path.
  const downloadVideo = async (filename: string) => {
    if (!job?.videoUrl || downloading) return;
    setDownloading(true);
    setDownloadError(null);
    let objectUrl: string | null = null;
    try {
      const response = await fetch(job.videoUrl, { credentials: 'include' });
      if (!response.ok) throw new Error(`ဒေါင်းလုဒ်ရယူမှု HTTP ${response.status} ပြန်လာပါသည်။`);
      const blob = await response.blob();
      if (!blob.size) throw new Error('ဒေါင်းလုဒ်လုပ်ရန် ဗီဒီယိုတွင် အချက်အလက်မရှိပါ။');
      objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (requestError) {
      setDownloadError(requestError instanceof Error ? requestError.message : 'ဒေါင်းလုဒ်လုပ်၍မရပါ။');
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setDownloading(false);
    }
  };

  useEffect(() => {
    if (job?.status !== 'completed') return;
    if (!job.videoUrl) {
      setMediaUrl(null);
      setMediaError('ပြီးစီးသည့် မှတ်တမ်းတွင် နောက်ဆုံးဗီဒီယို မရှိပါ။');
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setMediaUrl(null);
    setMediaError(null);
    void fetch(job.videoUrl, {
      credentials: 'include',
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error(`ဗီဒီယိုရယူမှု HTTP ${response.status} ပြန်လာပါသည်။`);
      const blob = await response.blob();
      if (!blob.size) throw new Error('ပြီးစီးသည့်ဗီဒီယိုတွင် အချက်အလက်မရှိပါ။');
      objectUrl = URL.createObjectURL(blob);
      setMediaUrl(objectUrl);
    }).catch(requestError => {
      if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
      setMediaError(requestError instanceof Error
        ? requestError.message
        : 'ပြီးစီးသည့်ဗီဒီယိုကို ဖွင့်၍မရပါ။');
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [job?.id, job?.status, job?.videoUrl, mediaRetry]);

  return {
    job, loading, error, cancelling, retrying, retryEligibility, retryFeedback,
    mediaUrl, mediaError, setMediaRetry: () => setMediaRetry(value => value + 1),
    downloading, downloadError, downloadVideo, degraded,
    cancelJob, retryFailedJob,
  };
}
