import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileVideo2, RefreshCw, Upload } from 'lucide-react';
import { Button, Card, ErrorPanel, Skeleton } from '../components';
import { formatDuration, formatFileSize } from '../workspace/format';
import { getUploadConfiguration, uploadWorkspaceJob } from '../workspace/api';
import type { UploadConfiguration, WorkspaceJob } from '../workspace/types';

type UploadState = 'empty' | 'uploading' | 'error' | 'complete';
type SelectedVideo = { file: File; duration: number | null };

export interface UploadLifecycle {
  state: UploadState;
  progress: number;
  filename: string | null;
}

const readDuration = (file: File) => new Promise<number | null>(resolve => {
  const video = document.createElement('video');
  const objectUrl = URL.createObjectURL(file);
  video.preload = 'metadata';
  video.onloadedmetadata = () => {
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    URL.revokeObjectURL(objectUrl);
    resolve(duration);
  };
  video.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    resolve(null);
  };
  video.src = objectUrl;
});

interface UploadPanelProps {
  geminiApiKey: string;
  onCancel(): void;
  onComplete(job: WorkspaceJob): void;
  showCancel?: boolean;
  compact?: boolean;
  hideStatus?: boolean;
  onLifecycleChange?(lifecycle: UploadLifecycle): void;
}

export function UploadPanel({
  geminiApiKey,
  onCancel,
  onComplete,
  showCancel = true,
  compact = false,
  hideStatus = false,
  onLifecycleChange,
}: UploadPanelProps) {
  const [configuration, setConfiguration] = useState<UploadConfiguration | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [videos, setVideos] = useState<SelectedVideo[]>([]);
  const [state, setState] = useState<UploadState>('empty');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onLifecycleChange?.({
      state,
      progress,
      filename: videos[0]?.file.name || null,
    });
  }, [onLifecycleChange, progress, state, videos]);

  useEffect(() => {
    getUploadConfiguration()
      .then(setConfiguration)
      .catch(requestError => setConfigurationError(
        requestError instanceof Error ? requestError.message : 'ဗီဒီယိုတင်ရန် ဆက်တင်များ မရရှိနိုင်ပါ။',
      ));
  }, []);

  const uploadVideos = async (selected: SelectedVideo[]) => {
    setState('uploading');
    setProgress(0);
    setError(null);
    try {
      const createdJobs: WorkspaceJob[] = [];
      for (let index = 0; index < selected.length; index += 1) {
        const video = selected[index];
        const job = await new Promise<WorkspaceJob>((resolve, reject) => {
          cancelRef.current = uploadWorkspaceJob(video.file, video.duration, geminiApiKey, {
            onProgress: fileProgress => setProgress(Math.round(
              ((index + (fileProgress / 100)) / selected.length) * 100,
            )),
            onComplete: resolve,
            onError: reject,
          });
        });
        createdJobs.push(job);
      }
      cancelRef.current = null;
      setProgress(100);
      setState('complete');
      onComplete(createdJobs[createdJobs.length - 1]);
    } catch (uploadError) {
      cancelRef.current = null;
      setError(typeof uploadError === 'string' ? uploadError : 'ဗီဒီယိုကို တင်၍မရပါ။');
      setState('error');
    }
  };

  const validateAndUpload = async (candidates: File[]) => {
    if (!candidates.length || !configuration) return;
    setError(null);
    if (candidates.length !== 1) {
      setVideos([]);
      setState('error');
      setError('Recap တစ်ခုအတွက် ဗီဒီယိုတစ်ခုသာ ရွေးပါ။');
      return;
    }
    for (const candidate of candidates) {
      const extension = candidate.name.split('.').pop()?.toLowerCase() || '';
      if (!configuration.supportedExtensions.includes(extension)) {
        setVideos([]);
        setState('error');
        setError(`.${extension || 'အမျိုးအစားမသိ'} ဖိုင်ကို အသုံးမပြုနိုင်ပါ။ ${configuration.supportedExtensions.map(item => `.${item}`).join(', ')} ကို ရွေးပါ။`);
        return;
      }
      if (candidate.size > configuration.maxUploadSizeBytes) {
        setVideos([]);
        setState('error');
        setError(`${candidate.name} သည် ${formatFileSize(configuration.maxUploadSizeBytes)} ကန့်သတ်ချက်ထက် ကျော်လွန်နေပါသည်။`);
        return;
      }
    }
    setVideos(candidates.map(file => ({ file, duration: null })));
    setState('uploading');
    setProgress(0);
    const selected = await Promise.all(candidates.map(async file => ({
      file,
      duration: await readDuration(file),
    })));
    setVideos(selected);
    void uploadVideos(selected);
  };

  const cancelUpload = () => {
    cancelRef.current?.();
    cancelRef.current = null;
    setProgress(0);
    setVideos([]);
    setState('empty');
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  if (!configuration && !configurationError) {
    return <Skeleton height="28rem" label="ဗီဒီယိုတင်ရန် ဆက်တင်များ ရယူနေသည်" />;
  }

  return (
    configurationError ? (
      <ErrorPanel title="ဗီဒီယိုတင်ရန် မသတ်မှတ်ရသေးပါ" description={configurationError} />
    ) : (
      <Card className={compact ? 'workspace-upload-card workspace-upload-card--compact' : 'workspace-upload-card'}>
          <input
            ref={inputRef}
            className="ds-sr-only"
            type="file"
            accept={configuration?.supportedExtensions.map(extension => `.${extension}`).join(',')}
            onChange={event => void validateAndUpload(Array.from(event.target.files || []))}
          />

          {videos.length === 0 && state !== 'uploading' && (
            <button
              className={`workspace-dropzone ${dragging ? 'workspace-dropzone--active' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragEnter={event => { event.preventDefault(); setDragging(true); }}
              onDragOver={event => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={event => {
                event.preventDefault();
                setDragging(false);
                void validateAndUpload(Array.from(event.dataTransfer.files));
              }}
            >
              <span><Upload size={25} /></span>
              <strong>ဗီဒီယိုကို ဒီနေရာတွင် ရွေးချယ်ပါ</strong>
              <p>သင့်စက်မှ ဗီဒီယိုတစ်ခု ရွေးပါ</p>
              <small>
                {configuration?.supportedExtensions.map(extension => extension.toUpperCase()).join(' · ')}
                {' '}· {formatFileSize(configuration?.maxUploadSizeBytes || 0)} အထိ
              </small>
            </button>
          )}

          {videos.length > 0 && !(compact && hideStatus) && (
            <div className="workspace-selected-files">
              {videos.map(({ file, duration }) => (
                <div className="workspace-selected-file" key={`${file.name}-${file.size}-${file.lastModified}`}>
                  <span className="workspace-selected-file__icon"><FileVideo2 size={25} /></span>
                  <div>
                    <strong>{file.name}</strong>
                    <span>{formatFileSize(file.size)} · {formatDuration(duration)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {state === 'uploading' && !hideStatus && (
            <div className="workspace-upload-progress" aria-live="polite">
              <div><span>လုံခြုံစွာ တင်နေသည်…</span><strong>{progress}%</strong></div>
              <progress max="100" value={progress}>{progress}%</progress>
              <Button variant="secondary" size="sm" onClick={cancelUpload}>ပယ်ဖျက်မည်</Button>
            </div>
          )}

          {state === 'complete' && !hideStatus && (
            <div className="workspace-upload-success" role="status"><CheckCircle2 size={18} />ဗီဒီယိုတင်ပြီးပါပြီ</div>
          )}

          {error && (
            <div className="workspace-upload-error" role="alert"><AlertCircle size={18} /><span>{error}</span></div>
          )}

          <div className="workspace-upload-actions">
            {showCancel && state === 'empty' && <Button variant="ghost" onClick={onCancel}>ပယ်ဖျက်မည်</Button>}
            {state === 'error' && (
              <Button variant="secondary" icon={<RefreshCw size={15} />} onClick={() => inputRef.current?.click()}>ပြန်ရွေးမည်</Button>
            )}
          </div>
      </Card>
    )
  );
}
