import { Check, ChevronDown, Circle, Download, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, ErrorPanel, Skeleton, StatusBadge } from '../components';
import { formatDuration } from '../workspace/format';
import { cancelWorkspaceJob, getWorkspaceJobStatus } from '../workspace/api';
import {
  getWorkflowStepState,
  getDisplayedProgress,
  WORKFLOW_STEPS,
} from '../workspace/workflowPresentation';
import type { WorkspaceJobStatus } from '../workspace/types';
import type { UploadLifecycle } from './UploadPage';

interface ProcessingStatusViewProps {
  projectId: string | null;
  onReset(): void;
  uploadContent: ReactNode;
  uploadLifecycle?: UploadLifecycle;
  setupContent?: ReactNode;
  onStart?(): void;
  starting?: boolean;
}

export function ProcessingStatusView({
  projectId,
  onReset,
  uploadContent,
  uploadLifecycle = { state: 'empty', progress: 0, filename: null },
  setupContent,
  onStart,
  starting = false,
}: ProcessingStatusViewProps) {
  const [job, setJob] = useState<WorkspaceJobStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaRetry, setMediaRetry] = useState(0);
  const [expandedWorkflowJobId, setExpandedWorkflowJobId] = useState<string | null>(null);
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
    ]) events.addEventListener(eventName, accept as EventListener);
    events.onerror = () => {
      if (pollingRef.current === null) {
        pollingRef.current = window.setInterval(() => void refresh(), 3000);
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

  const terminal = job ? ['completed', 'failed', 'cancelled'].includes(job.status) : false;
  const workflowStarted = Boolean(projectId || job);
  const showEditor = job?.status === 'pending' && setupContent;
  useEffect(() => {
    setExpandedWorkflowJobId(null);
  }, [projectId, job?.status]);

  const pipeline = workflowStarted ? (
    <section className="new-recap-workspace__pipeline" aria-label="Workflow">
      <ol className="processing-stages">
      {WORKFLOW_STEPS.map(stage => {
        const state = getWorkflowStepState(job, stage.id, uploadLifecycle.state);
        const complete = state === 'complete';
        const active = state === 'active';
        return (
          <li
            key={stage.id}
            className={active
              ? 'processing-stage processing-stage--active'
              : complete
                ? 'processing-stage processing-stage--complete'
                : 'processing-stage'}
          >
            <span>{complete ? <Check size={14} /> : active ? <LoaderCircle size={14} className="processing-spinner" /> : <Circle size={8} />}</span>
            <div className="processing-stage__content">
              <strong>{stage.label}</strong>
              <small>{complete ? 'Complete' : active ? 'In progress' : 'Waiting'}</small>
              {stage.id === 'final_export' && active && (
                <small className="processing-stage__helper">
                  {job && job.progress >= 99 ? 'Verify Output'
                    : job && job.progress >= 98 ? 'Subtitle'
                      : job && job.progress >= 96 ? 'Blur'
                        : job && job.progress >= 94 ? 'Flip'
                          : job && job.progress >= 92 ? 'Color Grading'
                            : 'Final Export'}
                </small>
              )}
            </div>
          </li>
        );
      })}
      </ol>
    </section>
  ) : null;

  return (
    <div className={`new-recap-workspace ${workflowStarted ? 'new-recap-workspace--active' : 'new-recap-workspace--upload-only'}`}>
      {!workflowStarted && <div className="new-recap-workspace__upload">{uploadContent}</div>}

      {workflowStarted && job && !showEditor && job.status !== 'completed' && pipeline}

      {showEditor && (
        <section className="new-recap-workspace__editor">
          {setupContent}
          <div className="processing-actions processing-actions--start">
            {onStart && (
              <Button loading={starting} disabled={starting} onClick={onStart}>
                Start Processing
              </Button>
            )}
          </div>
        </section>
      )}

      {((job && job.status !== 'pending') || error || (loading && projectId)) && <section className="new-recap-workspace__actions">
      {job?.status === 'completed' && (
        <>
          <div className="processing-preview">
            {mediaUrl
              ? (
                  <video controls preload="metadata" src={mediaUrl}>
                    သင့်ဘရောက်ဇာတွင် ဗီဒီယိုဖွင့်၍မရပါ။
                  </video>
                )
              : mediaError
                ? <ErrorPanel title="ဗီဒီယို မရရှိနိုင်ပါ" description={mediaError} action={{ label: 'ထပ်ကြိုးစားမည်', onClick: () => setMediaRetry(value => value + 1) }} />
                : <Skeleton height="20rem" label="ပြီးစီးသည့်ဗီဒီယို ဖွင့်နေသည်" />}
          </div>
          <div className="completed-recap-summary">
            <div>
              <strong title={job.filename}>{job.filename}</strong>
              <span>{formatDuration(job.duration)}</span>
            </div>
            <StatusBadge status="complete">Completed</StatusBadge>
          </div>
        </>
      )}

      {job && ['queued', 'processing'].includes(job.status) && (
        <div className="processing-current-progress" aria-label={`Current progress ${getDisplayedProgress(job)}%`}>
          <div>
            <span>
              {job.stage === 'final_export'
                ? job.progress >= 99 ? 'Verify Output'
                  : job.progress >= 98 ? 'Subtitle'
                    : job.progress >= 96 ? 'Blur'
                      : job.progress >= 94 ? 'Flip'
                        : job.progress >= 92 ? 'Color Grading'
                          : 'Final Export'
                : 'Current progress'}
            </span>
            <strong>{getDisplayedProgress(job)}%</strong>
          </div>
          <span><i style={{ width: `${getDisplayedProgress(job)}%` }} /></span>
        </div>
      )}

      <div className="processing-actions">
        {job?.status === 'completed' && (
          <div className="processing-output-actions">
            {mediaUrl && (
              <a className="ds-button ds-button--primary" href={mediaUrl} download={`${job.filename.replace(/\.[^.]+$/, '')}-recap.mp4`}>
                <Download size={16} />Download Video
              </a>
            )}
          </div>
        )}
        {job?.status === 'failed' && (
          <div className="new-recap-action-state new-recap-action-state--failed">
            <strong>Recap မအောင်မြင်ပါ</strong>
            <span>{job.error || 'ဤ Recap ကို ပြီးစီးအောင် မလုပ်ဆောင်နိုင်ပါ။'}</span>
            <Button onClick={onReset}>ထပ်ကြိုးစားမည်</Button>
          </div>
        )}
        {job?.status === 'cancelled' && (
          <div className="new-recap-action-state">
            <strong>Recap ပယ်ဖျက်ပြီး</strong>
            <Button onClick={onReset}>ထပ်ကြိုးစားမည်</Button>
          </div>
        )}
        {job && ['queued', 'processing'].includes(job.status) && !terminal && (
          <Button
            variant="danger"
            loading={cancelling || job.cancellationRequested}
            disabled={cancelling || job.cancellationRequested}
            onClick={async () => {
              if (cancelling || job.cancellationRequested) return;
              setCancelling(true);
              try {
                const cancelled = await cancelWorkspaceJob(job.id);
                setJob(current => current ? { ...current, ...cancelled } : current);
              } catch (requestError) {
                setError(requestError instanceof Error ? requestError.message : 'ပယ်ဖျက်ရန် တောင်းဆို၍မရပါ။');
              } finally {
                setCancelling(false);
              }
            }}
          >
            {job.cancellationRequested ? 'Cancelling' : 'ပယ်ဖျက်မည်'}
          </Button>
        )}
      </div>
      {job?.status === 'completed' && (
        <div className="completed-workflow-details">
          <button
            type="button"
            aria-expanded={expandedWorkflowJobId === job.id}
            onClick={() => setExpandedWorkflowJobId(current =>
              current === job.id ? null : job.id)}
          >
            <span>View workflow details</span>
            <ChevronDown className={expandedWorkflowJobId === job.id ? 'is-expanded' : ''} size={18} />
          </button>
          {expandedWorkflowJobId === job.id && pipeline}
        </div>
      )}
      {error && <div className="workspace-upload-error" role="alert">{error}</div>}
      {loading && projectId && <div className="new-recap-workspace__loading"><LoaderCircle className="processing-spinner" size={18} />အခြေအနေ အပ်ဒိတ်လုပ်နေသည်…</div>}
      </section>}
    </div>
  );
}
