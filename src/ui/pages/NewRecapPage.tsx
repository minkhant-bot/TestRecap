import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Dialog, Input } from '../components';
import { formatDuration, formatFileSize } from '../workspace/format';
import { queueWorkspaceJob } from '../workspace/api';
import { useGeminiKey } from '../workspace/GeminiKeyContext';
import { useJobStatus } from '../workspace/useJobStatus';
import { useUploadPanel } from '../workspace/useUploadPanel';
import type { WorkspaceJob, WorkspaceJobStatus, VideoEffects } from '../workspace/types';
import { useWorkspaceJobs } from '../workspace/useWorkspaceJobs';
import { DEFAULT_VIDEO_EFFECTS, VideoEffectsEditor } from '../workspace/VideoEffectsEditor';
import { getDisplayedProgress, getWorkflowStepState, WORKFLOW_STEPS } from '../workspace/workflowPresentation';

const ACTIVE_STATUSES = new Set(['uploading', 'ready', 'pending', 'queued', 'processing']);

const finalExportSubLabel = (progress: number) => (
  progress >= 99 ? 'Verify Output'
    : progress >= 98 ? 'Subtitle'
      : progress >= 96 ? 'Blur'
        : progress >= 94 ? 'Flip'
          : progress >= 92 ? 'Color Grading'
            : 'Finalizing'
);

/* ---------------------------------------------------------------------- *
 * Pipeline — reference's exact .pipeline / .stageRow markup, including its
 * plain-text status glyphs (✓ / ● / ! / —, no icon library — the reference
 * imports nothing but React itself).
 * ---------------------------------------------------------------------- */
function Pipeline({ job, uploadState }: { job: WorkspaceJobStatus | null; uploadState: 'empty' | 'uploading' | 'error' | 'complete' }) {
  return (
    <div className="pipeline" aria-label="Workflow">
      {WORKFLOW_STEPS.map((stage, index) => {
        const state = getWorkflowStepState(job, stage.id, uploadState);
        const complete = state === 'complete';
        const active = state === 'active';
        const failed = job?.status === 'failed' && active;
        return (
          <div
            key={stage.id}
            aria-current={active ? 'step' : undefined}
            className={`stageRow ${complete ? 'done' : ''} ${active && !failed ? 'active' : ''}`}
          >
            <span className="stageIndex">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <b>{stage.label}</b>
              <div className="stageStatus">
                {failed ? 'Failed'
                  : complete ? 'Done'
                    : active ? (stage.id === 'finalizing' && job ? finalExportSubLabel(job.progress) : 'In progress')
                      : 'Waiting'}
              </div>
            </div>
            <span>{complete ? '✓' : failed ? '!' : active ? '●' : '—'}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------- *
 * NewRecap — idle/upload screen, matches the reference's NewRecap layout
 * ---------------------------------------------------------------------- */
function NewRecapUpload({
  uploadPanel, onFileChosen, geminiKeyMissing, onOpenKeySetup, limitReached,
}: {
  uploadPanel: ReturnType<typeof useUploadPanel>;
  onFileChosen(files: File[]): void;
  geminiKeyMissing: boolean;
  onOpenKeySetup(): void;
  limitReached: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { configuration, configurationError, videos, state, error, progress, cancelUpload } = uploadPanel;

  if (geminiKeyMissing) {
    return (
      <div className="alert error">
        <b>Recap ဖန်တီးရန် Gemini API Key ထည့်ပေးပါ။</b>
        <div style={{ marginTop: 10 }}><Button onClick={onOpenKeySetup}>API Key ထည့်မည်</Button></div>
      </div>
    );
  }

  if (limitReached) {
    return (
      <div className="alert error">
        <b>လက်ရှိ Recap ၂ ခု လုပ်ဆောင်နေပါသည်။</b>
        <div style={{ marginTop: 6 }}>တစ်ခုပြီးဆုံးမှ Recap အသစ် ဖန်တီးနိုင်ပါမည်။</div>
      </div>
    );
  }

  if (!configuration && !configurationError) {
    return <div className="panel uploadpanel">…</div>;
  }
  if (configurationError) {
    return <div className="alert error" role="alert">{configurationError}</div>;
  }
  if (!configuration) return null;

  return (
    <>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept={configuration?.supportedExtensions.map(extension => `.${extension}`).join(',')}
        onChange={event => onFileChosen(Array.from(event.target.files || []))}
      />

      {videos.length === 0 && state !== 'uploading' && (
        <div
          className={`panel uploadpanel ${dragging ? 'is-dragging' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click(); }}
          onDragEnter={event => { event.preventDefault(); setDragging(true); }}
          onDragOver={event => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={event => {
            event.preventDefault();
            setDragging(false);
            onFileChosen(Array.from(event.dataTransfer.files));
          }}
        >
          <div>
            <div className="bigicon">↑</div>
            <b>ဗီဒီယိုကို ဒီနေရာမှာ တင်ပါ</b>
            <p className="muted">{configuration.supportedExtensions.map(extension => extension.toUpperCase()).join(', ')} · အများဆုံး {formatFileSize(configuration.maxUploadSizeBytes)}</p>
            <Button variant="primary">ဗီဒီယိုရွေးမည်</Button>
          </div>
        </div>
      )}

      {videos.length > 0 && (
        <div className="panel row wrap between">
          <div>
            <b>{videos[0].file.name}</b>
            <div className="muted">{formatFileSize(videos[0].file.size)} · {formatDuration(videos[0].duration)}</div>
          </div>
          {state === 'error' && (
            <Button variant="secondary" onClick={() => inputRef.current?.click()}>ပြန်ရွေးမည်</Button>
          )}
        </div>
      )}

      {state === 'uploading' && (
        <div className="panel">
          <div className="row between"><span className="muted">လုံခြုံစွာ တင်နေသည်…</span><b>{progress}%</b></div>
          <div className="progress"><span style={{ width: `${progress}%` }} /></div>
          <div style={{ marginTop: 12 }}><Button variant="secondary" onClick={cancelUpload}>ပယ်ဖျက်မည်</Button></div>
        </div>
      )}

      {state === 'complete' && <div className="alert success">✓ ဗီဒီယိုတင်ပြီးပါပြီ</div>}
      {error && <div className="alert error" role="alert">{error}</div>}

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Blink အသုံးပြုပုံ</h3>
        <div className="statsgrid">
          <div className="stat"><b>01</b><span>ဗီဒီယိုတင်ပါ</span></div>
          <div className="stat"><b>02</b><span>စာတန်းထိုး၊ မှုန်ဝါးမှုနှင့် Effect များကို ချိန်ညှိပါ</span></div>
          <div className="stat"><b>03</b><span>ဖန်တီးပြီး ဒေါင်းလုဒ်လုပ်ပါ</span></div>
        </div>
        <p className="muted" style={{ marginTop: 16, marginBottom: 0, fontSize: 13 }}>{formatFileSize(configuration.maxUploadSizeBytes)} အထိ · စတင်လုပ်ဆောင်မည်ကို နှိပ်မှသာ စတင်ပါမည်</p>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------------- *
 * NewRecapPage — orchestrates real state, switches between the reference's
 * NewRecap / (setup) / Processing / Completed / ErrorState screens
 * ---------------------------------------------------------------------- */
export function NewRecapPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { jobs, loading, refresh } = useWorkspaceJobs();
  const { hasApiKey, loading: keyLoading, saveApiKey } = useGeminiKey();
  const [activeJobId, setActiveJobId] = useState<string | null>(() => searchParams.get('job'));
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [keySetupOpen, setKeySetupOpen] = useState(false);
  const [draftKey, setDraftKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [effects, setEffects] = useState<VideoEffects>(DEFAULT_VIDEO_EFFECTS);
  const latestEffectsRef = useRef<VideoEffects>(DEFAULT_VIDEO_EFFECTS);

  const activeJobCount = jobs.filter(job => ACTIVE_STATUSES.has(job.status)).length;
  const activeLimitReached = activeJobCount >= 2;

  const handleUploadComplete = (job: WorkspaceJob) => {
    setActiveJobId(job.id);
    setSearchParams({ job: job.id }, { replace: true });
  };
  const uploadPanel = useUploadPanel('', handleUploadComplete);
  // Single source of truth for the active job: real REST fetch + SSE
  // subscription (see useJobStatus), same as the rest of the app.
  const status = useJobStatus(activeJobId);
  const job = status.job;

  useEffect(() => {
    if (!keyLoading && !hasApiKey) setKeySetupOpen(true);
    if (hasApiKey) setKeySetupOpen(false);
  }, [hasApiKey, keyLoading]);

  const saveKey = async () => {
    setSavingKey(true);
    setKeyError(null);
    try {
      await saveApiKey(draftKey);
      setDraftKey('');
      setKeySetupOpen(false);
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : 'Gemini API Key ကို သိမ်း၍ မရပါ။');
    } finally {
      setSavingKey(false);
    }
  };

  const beginProcessing = async () => {
    if (!job) return;
    setStarting(true);
    setStartError(null);
    try {
      await queueWorkspaceJob(job.id, '', latestEffectsRef.current);
      await refresh();
    } catch (requestError) {
      setStartError(requestError instanceof Error ? requestError.message : 'ဤ Recap ကို စတင်လုပ်ဆောင်၍ မရပါ။');
    } finally {
      setStarting(false);
    }
  };

  const resetView = () => {
    setActiveJobId(null);
    setSearchParams({}, { replace: true });
    setStartError(null);
    setEffects(DEFAULT_VIDEO_EFFECTS);
    latestEffectsRef.current = DEFAULT_VIDEO_EFFECTS;
    void refresh();
  };

  const activeProgress = job ? getDisplayedProgress(job) : 0;
  const chip = job?.status === 'completed'
    ? formatDuration(job.duration)
    : job && ['queued', 'processing'].includes(job.status) ? `${activeProgress}%`
      : job?.status === 'pending' ? undefined
        : null;

  return (
    <>
      <div className="pagetitle">
        <div><span className="kicker">NEW RECAP</span><h1>Recap အသစ်</h1><p>ဗီဒီယိုတင်ခြင်းမှ export အထိ တစ်နေရာတည်းတွင် လုပ်ဆောင်ပါ။</p></div>
        {chip && <span className="chip">{chip}</span>}
      </div>

      {!job && (
        keyLoading || loading ? (
          <div className="panel uploadpanel">…</div>
        ) : (
          <NewRecapUpload
            uploadPanel={uploadPanel}
            geminiKeyMissing={!hasApiKey}
            onOpenKeySetup={() => setKeySetupOpen(true)}
            limitReached={activeLimitReached}
            onFileChosen={files => void uploadPanel.validateAndUpload(files)}
          />
        )
      )}

      <Dialog
        open={keySetupOpen && !hasApiKey}
        onClose={() => { if (!savingKey) setKeySetupOpen(false); }}
        busy={savingKey}
        title="Gemini API Key လိုအပ်ပါသည်"
      >
        <p className="muted">ပထမဆုံး Recap ဖန်တီးရန် Gemini API Key ထည့်ပေးပါ။</p>
        <Input
          label="Gemini API Key"
          type="password"
          autoComplete="off"
          value={draftKey}
          onChange={event => { setDraftKey(event.target.value); setKeyError(null); }}
        />
        {keyError && <div className="alert error" role="alert" style={{ whiteSpace: 'pre-wrap' }}>{keyError}</div>}
        <div className="row wrap" style={{ marginTop: 12 }}>
          <Button loading={savingKey} disabled={!draftKey.trim() || savingKey} onClick={() => void saveKey()}>သိမ်းပြီး ဆက်လုပ်မည်</Button>
        </div>
      </Dialog>

      {job?.status === 'pending' && (
        <div className="panel">
          <VideoEffectsEditor
            jobId={job.id}
            effects={effects}
            onChange={nextEffects => {
              latestEffectsRef.current = nextEffects;
              setEffects(nextEffects);
            }}
            readOnly={starting}
          />
          <div className="row wrap" style={{ marginTop: 18 }}>
            <Button loading={starting} disabled={starting} onClick={() => void beginProcessing()}>Recap စတင်ဖန်တီးမည် →</Button>
          </div>
        </div>
      )}
      {startError && <div className="alert error" role="alert">{startError}</div>}

      {job && ['queued', 'processing'].includes(job.status) && (
        <div className="panel">
          <div className="row between"><b title={job.filename}>{job.filename}</b><span className="muted">{job.stage === 'final_export' ? finalExportSubLabel(job.progress) : 'Processing'}</span></div>
          <div className="progress"><span style={{ width: `${activeProgress}%` }} /></div>
          <Pipeline job={job} uploadState={uploadPanel.state} />
          <div className="row wrap" style={{ marginTop: 18 }}>
            <Button variant="danger" loading={status.cancelling || job.cancellationRequested} disabled={status.cancelling || job.cancellationRequested} onClick={() => void status.cancelJob()}>
              {job.cancellationRequested ? 'Cancelling' : 'ပယ်ဖျက်မည်'}
            </Button>
          </div>
        </div>
      )}

      {job?.status === 'completed' && job.expired && (
        <>
          <div className="panel">
            <div className="row" style={{ gap: 8 }}>
              <b title={job.filename}>{job.filename}</b>
              <span className="chip">Expired</span>
            </div>
            <div className="alert error" role="alert" style={{ marginTop: 12 }}>
              This recap has expired. Completed videos are available for 24 hours after completion.
            </div>
          </div>
          <button className="btn" style={{ marginTop: 16 }} onClick={resetView}>နောက်တစ်ပုဒ် ဖန်တီးမည်</button>
        </>
      )}

      {job?.status === 'completed' && !job.expired && (
        <>
          <div className="panel">
            <div className="videoBox videoBox--portrait">
              {status.mediaUrl
                ? <video controls preload="metadata" src={status.mediaUrl}>သင့်ဘရောက်ဇာတွင် ဗီဒီယိုဖွင့်၍မရပါ။</video>
                : status.mediaError
                  ? <div className="alert error" role="alert">{status.mediaError} <button className="btn ghost" onClick={status.setMediaRetry}>ထပ်ကြိုးစားမည်</button></div>
                  : '▶'}
            </div>
            <div className="row between wrap" style={{ marginTop: 18 }}>
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <b title={job.filename}>{job.filename}</b>
                  <span className="chip">Completed</span>
                </div>
                <div className="muted">{formatDuration(job.duration)}</div>
              </div>
              <div className="row wrap">
                {status.mediaUrl && <a className="btn" href={status.mediaUrl} target="_blank" rel="noreferrer">Preview</a>}
                {job.videoUrl && (
                  <button
                    className="btn accent"
                    disabled={status.downloading}
                    onClick={() => void status.downloadVideo(`${job.filename.replace(/\.[^.]+$/, '')}-recap.mp4`)}
                  >
                    {status.downloading ? 'ဒေါင်းလုဒ်လုပ်နေသည်...' : 'Download Video'}
                  </button>
                )}
              </div>
              {status.downloadError && <div className="alert error" role="alert" style={{ marginTop: 8 }}>{status.downloadError}</div>}
            </div>
            <p className="hint" style={{ marginTop: 12 }}>Completed videos are available for 24 hours.</p>
          </div>
          <button className="btn" style={{ marginTop: 16 }} onClick={resetView}>နောက်တစ်ပုဒ် ဖန်တီးမည်</button>
        </>
      )}

      {job?.status === 'failed' && (
        <>
          <div className="alert error">
            <b>Recap failed</b>
            <div style={{ marginTop: 6 }}>This recap could not be completed.</div>
          </div>
          <div className="panel">
            <Pipeline job={job} uploadState={uploadPanel.state} />
            <div className="row wrap" style={{ marginTop: 18 }}>
              {status.retryEligibility === null ? <small className="hint">Checking recovery options…</small>
                : status.retryEligibility.recoverable ? (
                  <button className="btn accent" disabled={status.retrying} onClick={() => void status.retryFailedJob()}>Retry</button>
                ) : <small className="hint">This project is not currently recoverable.</small>}
              <button className="btn" disabled={status.retrying} onClick={resetView}>Cancel</button>
            </div>
            {status.retryFeedback && <p className="hint" role="status" style={{ marginTop: 10 }}>{status.retryFeedback}</p>}
          </div>
        </>
      )}

      {job?.status === 'cancelled' && (
        <div className="panel row between">
          <span>Recap ပယ်ဖျက်ပြီး</span>
          <Button onClick={resetView}>Recap အသစ် စမည်</Button>
        </div>
      )}

      {status.error && <div className="alert error" role="alert">{status.error}</div>}
    </>
  );
}
