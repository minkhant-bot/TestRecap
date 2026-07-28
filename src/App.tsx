import React, { useState, useRef, useEffect } from 'react';
import { SettingsModal } from './components/SettingsModal';
import { 
  UploadCloud, AlertCircle, Loader2, Download, Settings, Play,
  FileVideo, RefreshCw, Menu, ArrowRight, Check, Trash2
} from 'lucide-react';
import axios from 'axios';
import { buildJobFormData } from './jobRequest.js';
import { getCompletedJobDeletionError, removeCompletedJobId, requestCompletedJobDeletion } from './completedJobDeletion.js';
import { WORKFLOW_STAGES } from './domain/workflow.js';

function App() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'analyzing' | 'complete' | 'error'>('idle');
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [progressPct, setProgressPct] = useState<number>(0);
  const [currentStageId, setCurrentStageId] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pollTimer, setPollTimer] = useState<any>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showCompletedJobs, setShowCompletedJobs] = useState(false);
  const [completedJobsList, setCompletedJobsList] = useState<any[]>([]);
  const [deletingCompletedJobId, setDeletingCompletedJobId] = useState<string | null>(null);
  const [completedJobDeleteError, setCompletedJobDeleteError] = useState('');
  const [voices, setVoices] = useState<any[]>([]);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [settings, setSettings] = useState<any>({});
  const [editSettings, setEditSettings] = useState<any>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [settingsSaving, setSettingsSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchVoices();
  }, []);
  
  const fetchVoices = async () => {
    try {
      const res = await axios.get('/api/voices');
      setVoices(res.data);
    } catch (e) {
      console.error("Failed to load voices", e);
    }
  };
  
  const handlePreviewVoice = async (voiceId: string) => {
    setPreviewingVoice(voiceId);
    try {
        const response = await axios.post('/api/preview-voice', { voiceId }, { responseType: 'blob' });
        const url = URL.createObjectURL(response.data);
        if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
        setAudioPreviewUrl(url);
        
        const audio = new Audio(url);
        audio.play();
        audio.onended = () => setPreviewingVoice(null);
        audio.onerror = () => setPreviewingVoice(null);
    } catch(err) {
        console.error("Voice preview failed", err);
        setPreviewingVoice(null);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await axios.get('/api/settings');
      const backendSettings = { ...res.data };
      
      const geminiKey = localStorage.getItem('GEMINI_API_KEY') || '';
      
      if (geminiKey) {
        backendSettings['GEMINI_API_KEY'] = {
          configured: true,
          masked: '•'.repeat(16) + geminiKey.slice(-4),
          value: geminiKey
        };
      } else {
        backendSettings['GEMINI_API_KEY'] = { configured: false };
      }
      
      setSettings(backendSettings);
    } catch (e) {
      console.error("Failed to load settings", e);
    }
  };

  const saveSetting = async (key: string, value: string) => {
    if (key === 'GEMINI_API_KEY' ) {
      localStorage.setItem(key, value);
      setSettings((prev: any) => ({
        ...prev,
        [key]: {
          configured: true,
          masked: '•'.repeat(16) + value.slice(-4),
          value: value
        }
      }));
      setEditSettings({ ...editSettings, [key]: undefined });
      return;
    }

    // Optimistic UI update
    const previousSettings = { ...settings };
    setSettings({ ...settings, [key]: { configured: true, value } });
    
    setSettingsSaving(true);
    try {
      const res = await axios.post('/api/settings', { key, value });
      const backendSettings = { ...res.data };
      
      const geminiKey = localStorage.getItem('GEMINI_API_KEY') || '';
      
      backendSettings['GEMINI_API_KEY'] = geminiKey ? {
        configured: true,
        masked: '•'.repeat(16) + geminiKey.slice(-4),
        value: geminiKey
      } : { configured: false };

      setSettings(backendSettings);
      setEditSettings({ ...editSettings, [key]: undefined });
    } catch (e) {
      console.error("Failed to save setting", e);
      setSettings(previousSettings); // Revert on failure
    } finally {
      setSettingsSaving(false);
    }
  };

  const deleteSetting = async (key: string) => {
    if (key === 'GEMINI_API_KEY' ) {
      localStorage.removeItem(key);
      setSettings((prev: any) => ({
        ...prev,
        [key]: { configured: false }
      }));
      setEditSettings({ ...editSettings, [key]: undefined });
      return;
    }

    setSettingsSaving(true);
    try {
      const res = await axios.post('/api/settings', { key, value: null });
      const backendSettings = { ...res.data };
      
      const geminiKey = localStorage.getItem('GEMINI_API_KEY') || '';
      
      backendSettings['GEMINI_API_KEY'] = geminiKey ? {
        configured: true,
        masked: '•'.repeat(16) + geminiKey.slice(-4),
        value: geminiKey
      } : { configured: false };

      setSettings(backendSettings);
      setEditSettings({ ...editSettings, [key]: undefined });
    } catch (e) {
      console.error("Failed to delete setting", e);
    } finally {
      setSettingsSaving(false);
    }
  };

  const videoInputRef = useRef<HTMLInputElement>(null);

  const STAGES = WORKFLOW_STAGES;

  const getStageIndex = (stageId: string) => {
    const index = STAGES.findIndex(stage => stage.id === stageId);
    return index >= 0 ? index : 0;
  };

  const currentStageIndex = getStageIndex(currentStageId);

  useEffect(() => {
    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [pollTimer]);

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setVideoFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleVideoDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('video/')) {
        setVideoFile(file);
      }
    }
  };

  
  const fetchCompletedJobs = async () => {
    try {
      const stored = JSON.parse(localStorage.getItem('completedJobsIds') || '[]');
      if (stored.length === 0) {
        setCompletedJobsList([]);
        return;
      }
      const res = await axios.post('/api/completed-jobs', { ids: stored });
      setCompletedJobsList(res.data);
    } catch (e) {
      console.error('Failed to fetch completed jobs', e);
    }
  };

  const handleDeleteCompletedJob = async (selectedJobId: string) => {
    setCompletedJobDeleteError('');
    setDeletingCompletedJobId(selectedJobId);
    try {
      const deleted = await requestCompletedJobDeletion({
        jobId: selectedJobId,
        confirmDeletion: () => window.confirm(
          'Delete this completed video, MP3, transcript, timeline, and cached files? This cannot be undone.'
        ),
        deleteRequest: id => axios.delete(`/api/jobs/${encodeURIComponent(id)}`)
      });
      if (!deleted) return;

      setCompletedJobsList(previous =>
        previous.filter(item => item.jobId !== selectedJobId)
      );
      try {
        const parsed = JSON.parse(localStorage.getItem('completedJobsIds') || '[]');
        const stored = Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
        localStorage.setItem(
          'completedJobsIds',
          JSON.stringify(removeCompletedJobId(stored, selectedJobId))
        );
      } catch (storageError) {
        console.warn('Completed job was deleted, but local history could not be updated.', storageError);
      }
    } catch (error) {
      setCompletedJobDeleteError(getCompletedJobDeletionError(error));
    } finally {
      setDeletingCompletedJobId(null);
    }
  };

  useEffect(() => {
    if (showCompletedJobs) {
      fetchCompletedJobs();
    }
  }, [showCompletedJobs]);

  const startAnalysis = async () => {
    if (!videoFile) return;

    setStatus('uploading');
    setProgressMsg('Uploading video to server...');
    setProgressPct(5);

    const geminiKey = localStorage.getItem('GEMINI_API_KEY') || '';
    let formData;
    try { formData = buildJobFormData(videoFile, geminiKey); }
    catch (error: any) { setStatus('error'); setErrorMsg(error.message); return; }

    try {
      const response = await axios.post('/api/jobs', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const newJobId = response.data.jobId;
      
      // Track in localstorage
      try {
        const stored = JSON.parse(localStorage.getItem('completedJobsIds') || '[]');
        stored.push(newJobId);
        // keep last 200
        while (stored.length > 200) stored.shift();
        localStorage.setItem('completedJobsIds', JSON.stringify(stored));
      } catch (e) {}

      setJobId(newJobId);
      setStatus('analyzing');
      startPolling(newJobId);

    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.response?.data?.error || err.message || 'Upload failed');
    }
  };

  const startPolling = (id: string) => {
    let pollErrors = 0;
    setPollTimer((prev: any) => { if (prev) clearInterval(prev); return null; });

    const interval = setInterval(async () => {
      try {
        const statusRes = await axios.get(`/api/status/${id}`);
        const job = statusRes.data;
        
        setCurrentStageId(job.stageId || 'upload');
        
        if (job.status === 'complete') {
          clearInterval(interval);
          setAnalysisData(job.result);
          setStatus('complete');
        } else if (job.status === 'error') {
          clearInterval(interval);
          setStatus('error');
          setErrorMsg(job.error || 'Processing failed');
        } else {
          setProgressMsg(job.stageMessage || (job.status === 'queued' ? 'Queued for processing...' : (WORKFLOW_STAGES.find(stage => stage.id === job.stageId)?.label || 'Processing...')));
          setProgressPct(job.progress || 0);
        }
      } catch (e) {
         console.warn('Polling error (transient)', e);
         pollErrors++;
         if (pollErrors > 20) {
            clearInterval(interval);
            setStatus('error');
            setErrorMsg('Polling failed after multiple retries.');
         }
      }
    }, 5000);

    setPollTimer(interval);
  };

  const retryAnalysis = async () => {
    if (!jobId) return;
    setStatus('analyzing');
    setErrorMsg('');
    setCurrentStageId('upload');
    setProgressPct(0);
    
    try {
        await axios.post(`/api/retry/${jobId}`);
        startPolling(jobId);
    } catch(err: any) {
        setStatus('error');
        setErrorMsg('Failed to retry: ' + (err.message || ''));
    }
  };

  const reset = () => {
    if (pollTimer) clearInterval(pollTimer);
    setVideoFile(null);
    setStatus('idle');
    setAnalysisData(null);
    setJobId(null);
    setCurrentStageId('');
  };

  // Helper values for current selections on the workspace
  const currentColloquialMode = settings['COLLOQUIAL_MODE']?.value === 'true';
  const currentVoiceId = settings['EDGE_TTS_VOICE']?.value || 'male-young-adult';
  const selectedVoiceName = voices.find(v => v.id === currentVoiceId)?.name || 'တက်ကြွသောလူငယ်အသံ';

  // Check if API keys are configured in local storage
  const hasGeminiKey = !!localStorage.getItem('GEMINI_API_KEY');
  const isKeysConfigured = hasGeminiKey;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <button className="brand" onClick={reset} aria-label="Return to upload">
            <span className="brand-mark">R</span>
            <span>
              <strong>Recap</strong>
              <small>မြန်မာ ဗီဒီယိုပြန်ဆိုမှု</small>
            </span>
          </button>
          <div className="header-actions">
            <button className="icon-button" onClick={() => setShowCompletedJobs(true)} aria-label="Completed videos">
              <Menu size={19} />
            </button>
            <button className="icon-button" onClick={() => setShowSettings(true)} aria-label="Settings">
              <Settings size={19} />
            </button>
          </div>
        </div>
      </header>

      <main className="page-wrap">
        <nav className="flow-steps" aria-label="Progress">
          {['Upload', 'Processing', 'Output'].map((label, index) => {
            const activeIndex = status === 'idle' ? 0 : status === 'complete' ? 2 : 1;
            return (
              <React.Fragment key={label}>
                {index > 0 && <span className={`flow-line ${index <= activeIndex ? 'is-done' : ''}`} />}
                <span className={`flow-step ${index === activeIndex ? 'is-active' : ''} ${index < activeIndex ? 'is-done' : ''}`}>
                  <span>{index + 1}</span>{label}
                </span>
              </React.Fragment>
            );
          })}
        </nav>

        {showCompletedJobs && (
          <div className="modal-backdrop" onMouseDown={() => setShowCompletedJobs(false)}>
            <section className="sheet wide-sheet" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Completed videos">
              <div className="sheet-header">
                <div><h2>Completed videos</h2><p>Available for 24 hours</p></div>
                <button className="icon-button" onClick={() => setShowCompletedJobs(false)} aria-label="Close">×</button>
              </div>
              <div className="sheet-content job-list custom-scrollbar">
                {completedJobDeleteError && (
                  <p className="completed-delete-error" role="alert">
                    <AlertCircle size={14} /> {completedJobDeleteError}
                  </p>
                )}
                {completedJobsList.length === 0 ? <p className="empty-state">No completed videos yet.</p> : completedJobsList.map(job => (
                  <div key={job.jobId} className="job-row">
                    <div><strong>{job.originalFilename}</strong><small>{new Date(job.completedAt).toLocaleString()} · {((job.sizeBytes || 0) / (1024 * 1024)).toFixed(2)} MB</small></div>
                    <div className="completed-job-actions">
                      <a href={job.videoUrl} download className="text-action">Download</a>
                      <button type="button" className="completed-delete-button" aria-label={`Delete ${job.originalFilename}`} disabled={deletingCompletedJobId !== null} onClick={() => handleDeleteCompletedJob(job.jobId)}>
                        {deletingCompletedJobId === job.jobId ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        <SettingsModal
          showSettings={showSettings} setShowSettings={setShowSettings}
          settings={settings} editSettings={editSettings} setEditSettings={setEditSettings}
          saveSetting={saveSetting} deleteSetting={deleteSetting} settingsSaving={settingsSaving}
          showKeys={showKeys} setShowKeys={setShowKeys}
        />

        {status === 'idle' && (
          <section className="workspace">
            <div className="intro">
              <p className="eyebrow">Upload</p>
              <h1>ဗီဒီယိုကို မြန်မာအသံဖြင့်<br />ပြန်လည်ဖန်တီးပါ</h1>
              <p>မူရင်းဗီဒီယိုကို ရွေးချယ်ပြီး စကားပြောပုံနှင့် အသံကို သတ်မှတ်ပါ။</p>
            </div>

            {!isKeysConfigured && (
              <div className="inline-notice warning">
                <span>Gemini API key လိုအပ်ပါသည်။</span>
                <button onClick={() => setShowSettings(true)}>ဆက်တင်ဖွင့်ရန်</button>
              </div>
            )}

            <div className="section-block">
              <div
                className={`upload-zone ${videoFile ? 'has-file' : ''}`}
                onDragOver={handleDragOver} onDrop={handleVideoDrop}
                onClick={() => videoInputRef.current?.click()}
              >
                <input type="file" ref={videoInputRef} className="hidden" accept="video/*" onChange={handleVideoSelect} />
                {videoFile ? (
                  <>
                    <FileVideo size={26} />
                    <div className="file-copy"><strong>{videoFile.name}</strong><span>{((videoFile.size || 0) / (1024 * 1024)).toFixed(2)} MB</span></div>
                    <button className="quiet-button" onClick={e => { e.stopPropagation(); setVideoFile(null); }}>ဖယ်ရှားရန်</button>
                  </>
                ) : (
                  <>
                    <UploadCloud size={28} />
                    <div className="file-copy"><strong>ဗီဒီယိုရွေးချယ်ရန်</strong><span>နှိပ်ပါ သို့မဟုတ် ဖိုင်ကို ဆွဲထည့်ပါ · MP4, MOV</span></div>
                  </>
                )}
              </div>
            </div>

            <div className="section-block settings-list">
              <div className="section-heading"><div><h2>Automatic speech detection</h2><p>Dialogue and narration are detected for every segment</p></div></div>
              <div className="section-heading language-heading"><div><h2>Language Style</h2><p>သဘာဝကျသော မြန်မာစကားပြောပုံ</p></div></div>
              <button className="setting-row" onClick={() => saveSetting('COLLOQUIAL_MODE', currentColloquialMode ? 'false' : 'true')}>
                <span><strong>Colloquial</strong><small>သဘာဝကျသော လက်သုံးစကား</small></span><span className={`switch ${currentColloquialMode ? 'on' : ''}`}><i /></span>
              </button>
            </div>

            <div className="voice-control">
              <label htmlFor="voice-select"><span>မြန်မာအသံ</span><small>Voice</small></label>
              <div>
                <select id="voice-select" value={currentVoiceId} onChange={e => saveSetting('EDGE_TTS_VOICE', e.target.value)} aria-label="မြန်မာအသံ ရွေးချယ်ရန်">
                  {voices.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                <button className="preview-button" onClick={() => handlePreviewVoice(currentVoiceId)} disabled={previewingVoice !== null} aria-label={`Preview ${selectedVoiceName}`}>
                  {previewingVoice === currentVoiceId ? <Loader2 size={16} className="spin" /> : <Play size={15} />}
                </button>
              </div>
            </div>

            {isKeysConfigured ? (
              <button className="primary-button" onClick={startAnalysis} disabled={!videoFile}>စတင်လုပ်ဆောင်မည် <ArrowRight size={18} /></button>
            ) : (
              <button className="primary-button" onClick={() => setShowSettings(true)}>API key ထည့်ရန်</button>
            )}
          </section>
        )}

        {(status === 'uploading' || status === 'analyzing') && (
          <section className="workspace processing-view">
            <div className="intro compact"><p className="eyebrow">Processing</p><span className="mode-badge">Automatic dialogue / narration detection</span><h1>ဗီဒီယို ပြန်ဆိုနေပါသည်</h1><p>စာမျက်နှာကို ဖွင့်ထားပြီး ခဏစောင့်ပေးပါ။</p></div>
            <div className="progress-summary">
              <div className="progress-meta"><span>{STAGES[currentStageIndex]?.label || progressMsg || 'စတင်နေပါသည်…'}</span><strong>{Math.round(progressPct)}%</strong></div>
              <div className="progress-track"><span style={{ width: `${Math.max(2, progressPct)}%` }} /></div>
              <p>{progressMsg}</p>
            </div>
            <details className="process-details">
              <summary>လုပ်ဆောင်မှု အသေးစိတ် <small>{currentStageIndex + 1}/{STAGES.length}</small></summary>
              <ol className="stage-list">
                {STAGES.map((stage, idx) => {
                  const stageStatus = idx < currentStageIndex ? 'done' : idx === currentStageIndex ? 'active' : 'pending';
                  return <li key={stage.id} className={stageStatus}><span>{stageStatus === 'done' ? <Check size={13} /> : idx + 1}</span><p>{stage.label}</p></li>;
                })}
              </ol>
            </details>
          </section>
        )}

        {status === 'error' && (
          <section className="workspace status-view">
            <AlertCircle size={30} />
            <h1>လုပ်ဆောင်မှု မပြီးဆုံးပါ</h1><p>{errorMsg}</p>
            <button className="primary-button" onClick={retryAnalysis}><RefreshCw size={17} /> ထပ်မံကြိုးစားရန်</button>
            <button className="quiet-button standalone" onClick={reset}>မူလနေရာသို့ ပြန်ရန်</button>
          </section>
        )}

        {status === 'complete' && analysisData && (
          <section className="workspace output-view">
            <div className="intro compact"><p className="eyebrow">Output</p><span className="mode-badge">Automatically classified</span><h1>ဗီဒီယို အဆင်သင့်ဖြစ်ပါပြီ</h1><p>ကြည့်ရှုပြီး ဖိုင်ကို ဒေါင်းလုဒ်လုပ်နိုင်ပါသည်။</p></div>
            {analysisData.videoUrl && (
              <>
                <div className="video-frame"><video src={analysisData.videoUrl} controls autoPlay loop /></div>
                <a href={analysisData.videoUrl} download className="primary-button"><Download size={18} /> ဗီဒီယိုဒေါင်းလုဒ်လုပ်ရန်</a>
                {analysisData.audioUrl && <a href={analysisData.audioUrl} download className="quiet-button standalone"><Download size={18} /> MP3 ဒေါင်းလုဒ်လုပ်ရန်</a>}
              </>
            )}
            <button className="quiet-button standalone" onClick={reset}>ဗီဒီယိုအသစ် ပြုလုပ်ရန်</button>
            {!import.meta.env.PROD && analysisData.mapping && (
              <details className="debug-details"><summary>နောက်ခံစကားနှင့် မြင်ကွင်း အချက်အလက်</summary><div className="debug-list custom-scrollbar">{analysisData.mapping.map((item: any, idx: number) => <div key={idx}><span>{Number(item.timestamp?.[0] || 0).toFixed(1)}s</span><p>{item.narration_text || item.text || ''}</p></div>)}</div></details>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
