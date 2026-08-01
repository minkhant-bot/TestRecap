import { AlertCircle, Download, KeyRound, SlidersHorizontal, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Input, Modal, Skeleton } from '../components';
import { queueWorkspaceJob } from '../workspace/api';
import { useGeminiKey } from '../workspace/GeminiKeyContext';
import type { WorkspaceJob } from '../workspace/types';
import type { VideoEffects } from '../workspace/types';
import { useWorkspaceJobs } from '../workspace/useWorkspaceJobs';
import { DEFAULT_VIDEO_EFFECTS, VideoEffectsEditor } from '../workspace/VideoEffectsEditor';
import { ProcessingStatusView } from './ProcessingPage';
import { UploadPanel } from './UploadPage';
import type { UploadLifecycle } from './UploadPage';

const ACTIVE_STATUSES = new Set(['uploading', 'ready', 'pending', 'queued', 'processing']);

export function NewRecapPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { jobs, loading, error, refresh } = useWorkspaceJobs();
  const { hasApiKey, loading: keyLoading, saveApiKey } = useGeminiKey();
  const [submittedJob, setSubmittedJob] = useState<WorkspaceJob | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(() => searchParams.get('job'));
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [draftKey, setDraftKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [uploadLifecycle, setUploadLifecycle] = useState<UploadLifecycle>({
    state: 'empty', progress: 0, filename: null,
  });
  const [effects, setEffects] = useState<VideoEffects>(DEFAULT_VIDEO_EFFECTS);
  const latestEffectsRef = useRef<VideoEffects>(DEFAULT_VIDEO_EFFECTS);
  const activeJobCount = jobs.filter(job => ACTIVE_STATUSES.has(job.status)).length;
  const activeLimitReached = activeJobCount >= 2;
  const displayedJob = submittedJob || jobs.find(job => job.id === activeJobId) || null;

  useEffect(() => {
    if (!keyLoading && !hasApiKey) setKeyDialogOpen(true);
    if (hasApiKey) setKeyDialogOpen(false);
  }, [hasApiKey, keyLoading]);

  const saveKey = async () => {
    setSavingKey(true);
    setKeyError(null);
    try {
      await saveApiKey(draftKey);
      setDraftKey('');
      setKeyDialogOpen(false);
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : 'Gemini API Key ကို သိမ်း၍ မရပါ။');
    } finally {
      setSavingKey(false);
    }
  };

  const beginProcessing = async (job: WorkspaceJob) => {
    setStarting(true);
    setStartError(null);
    try {
      console.info('[Blink effects]', {
        boundary: 'start.latestEffects',
        jobId: job.id,
        effects: latestEffectsRef.current,
      });
      await queueWorkspaceJob(job.id, '', latestEffectsRef.current);
      setActiveJobId(job.id);
      setSubmittedJob(null);
      await refresh();
    } catch (requestError) {
      setStartError(requestError instanceof Error
        ? requestError.message
        : 'ဤ Recap ကို စတင်လုပ်ဆောင်၍ မရပါ။');
    } finally {
      setStarting(false);
    }
  };

  const handleUploadComplete = (job: WorkspaceJob) => {
    setSubmittedJob(job);
    setActiveJobId(job.id);
    setSearchParams({ job: job.id }, { replace: true });
  };

  const resetView = () => {
    setSubmittedJob(null);
    setActiveJobId(null);
    setSearchParams({}, { replace: true });
    setStartError(null);
    setEffects(DEFAULT_VIDEO_EFFECTS);
    latestEffectsRef.current = DEFAULT_VIDEO_EFFECTS;
    void refresh();
  };

  return (
    <div className="ds-page-container workspace-page workspace-new-recap-page">
      <header className="workspace-page-header new-recap-page-header">
        <span className="workspace-eyebrow">Workspace</span>
        <h1>New Recap</h1>
        <p>ဗီဒီယိုတင်ခြင်းမှ export အထိ စာမျက်နှာခုန်ခြင်းမရှိဘဲ တစ်နေရာတည်းတွင် လုပ်ဆောင်ပါ။</p>
      </header>
      <ProcessingStatusView
        projectId={activeJobId}
        onReset={resetView}
        uploadLifecycle={uploadLifecycle}
        setupContent={displayedJob ? (
          <VideoEffectsEditor
            jobId={displayedJob.id}
            effects={effects}
            onChange={nextEffects => {
              console.info('[Blink effects]', {
                boundary: 'editor.onEffectsChange',
                jobId: displayedJob.id,
                effects: nextEffects,
              });
              latestEffectsRef.current = nextEffects;
              setEffects(nextEffects);
            }}
            readOnly={starting || displayedJob.status !== 'pending'}
          />
        ) : null}
        onStart={displayedJob?.status === 'pending' ? () => void beginProcessing(displayedJob) : undefined}
        starting={starting}
        uploadContent={displayedJob ? null : keyLoading || loading ? (
        <Skeleton height="8rem" />
      ) : !hasApiKey ? (
          <div className="new-recap-upload-slot new-recap-limit" role="status">
            <KeyRound size={22} />
            <strong>Recap ဖန်တီးရန် Gemini API Key ထည့်ပေးပါ။</strong>
            <Button onClick={() => setKeyDialogOpen(true)}>API Key ထည့်မည်</Button>
          </div>
      ) : activeLimitReached ? (
          <div className="new-recap-upload-slot new-recap-limit" role="status">
            <AlertCircle size={22} />
            <strong>လက်ရှိ Recap ၂ ခု လုပ်ဆောင်နေပါသည်။<br />တစ်ခုပြီးဆုံးမှ Recap အသစ် ဖန်တီးနိုင်ပါမည်။</strong>
          </div>
      ) : (
        <>
          {error && <div className="workspace-upload-error" role="alert">{error}</div>}
          <UploadPanel
            geminiApiKey=""
            onCancel={() => undefined}
            onComplete={handleUploadComplete}
            onLifecycleChange={setUploadLifecycle}
            showCancel={false}
            compact
            hideStatus
          />
          {!uploadLifecycle.filename && (
            <section className="new-recap-how" aria-labelledby="new-recap-how-title">
              <h2 id="new-recap-how-title">Blink အသုံးပြုပုံ</h2>
              <ol>
                <li><span><Upload size={15} /></span><strong>ဗီဒီယိုတင်ပါ</strong></li>
                <li><span><SlidersHorizontal size={15} /></span><strong>စာတန်းထိုး၊ မှုန်ဝါးမှုနှင့် Effect များကို ချိန်ညှိပါ</strong></li>
                <li><span><Download size={15} /></span><strong>ဖန်တီးပြီး ဒေါင်းလုဒ်လုပ်ပါ</strong></li>
              </ol>
              <p>500 MB အထိ <i>•</i> စတင်လုပ်ဆောင်မည်ကို နှိပ်မှသာ စတင်ပါမည်</p>
            </section>
          )}
        </>
        )}
      />
      {startError && (
        <div className="workspace-upload-error" role="alert">
          <AlertCircle size={18} />
          <span>{startError}</span>
        </div>
      )}

      <Modal
        open={keyDialogOpen && !hasApiKey}
        title="Gemini API Key လိုအပ်ပါသည်"
        onClose={() => {
          if (!savingKey) {
            setKeyDialogOpen(false);
            setDraftKey('');
            setKeyError(null);
          }
        }}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={savingKey}
              onClick={() => {
                setKeyDialogOpen(false);
                setDraftKey('');
                setKeyError(null);
              }}
            >
              မလုပ်တော့ပါ
            </Button>
            <Button
              loading={savingKey}
              disabled={!draftKey.trim() || savingKey}
              onClick={() => void saveKey()}
            >
              သိမ်းပြီး ဆက်လုပ်မည်
            </Button>
          </>
        }
      >
        <p className="ds-modal-copy">ပထမဆုံး Recap ဖန်တီးရန် Gemini API Key ထည့်ပေးပါ။</p>
        <Input
          label="Gemini API Key"
          type="password"
          autoComplete="off"
          leadingIcon={<KeyRound size={17} />}
          value={draftKey}
          onChange={event => {
            setDraftKey(event.target.value);
            setKeyError(null);
          }}
        />
        {keyError && (
          <div className="workspace-upload-error" role="alert" style={{ whiteSpace: 'pre-wrap' }}>
            {keyError}
          </div>
        )}
      </Modal>
    </div>
  );
}
