import { useEffect, useRef, useState } from 'react';
import { formatFileSize } from './format';
import { getUploadConfiguration, uploadWorkspaceJob } from './api';
import type { UploadConfiguration, WorkspaceJob } from './types';

export type UploadState = 'empty' | 'uploading' | 'error' | 'complete';
export type SelectedVideo = { file: File; duration: number | null };
const VIDEO_TOO_LONG_MESSAGE = 'Video is too long. Maximum supported duration is 15 minutes.';

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

// Real upload validation/XHR-progress logic, extracted out of what used to
// be UploadPage.tsx's UploadPanel component so the new screen can render it
// however BlinkAutomationFull_v2.jsx's NewRecap screen shape requires.
export function useUploadPanel(onComplete: (job: WorkspaceJob) => void) {
  const [configuration, setConfiguration] = useState<UploadConfiguration | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [videos, setVideos] = useState<SelectedVideo[]>([]);
  const [state, setState] = useState<UploadState>('empty');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const cancelRef = useRef<(() => void) | null>(null);

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
          cancelRef.current = uploadWorkspaceJob(video.file, video.duration, {
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
    if (selected.some(video => video.duration !== null &&
      video.duration > configuration.maxSourceDurationSeconds)) {
      setState('error');
      setError(VIDEO_TOO_LONG_MESSAGE);
      return;
    }
    void uploadVideos(selected);
  };

  const cancelUpload = () => {
    cancelRef.current?.();
    cancelRef.current = null;
    setProgress(0);
    setVideos([]);
    setState('empty');
    setError(null);
  };

  return { configuration, configurationError, videos, state, error, progress, validateAndUpload, cancelUpload };
}
