import React, { useState, useRef, useEffect } from 'react';
import { SettingsModal } from './components/SettingsModal';
import { 
  UploadCloud, Video, AlertCircle, CheckCircle, Loader2, Download, 
  Settings, Play, ShieldAlert, FileVideo, RefreshCw, Menu, 
  Volume2, ArrowRight, Check 
} from 'lucide-react';
import axios from 'axios';

function App() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'analyzing' | 'complete' | 'error'>('idle');
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [progressPct, setProgressPct] = useState<number>(0);
  const [currentBackendStep, setCurrentBackendStep] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [pollTimer, setPollTimer] = useState<any>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showCompletedJobs, setShowCompletedJobs] = useState(false);
  const [completedJobsList, setCompletedJobsList] = useState<any[]>([]);
  const [voices, setVoices] = useState<any[]>([]);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [settings, setSettings] = useState<any>({});
  const [editSettings, setEditSettings] = useState<any>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [settingsSaving, setSettingsSaving] = useState(false);

  // Main page voice gender tab
  const [selectedGender, setSelectedGender] = useState<'male' | 'female'>('male');

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

  const STAGES = [
    { id: 'upload', label: 'Uploading Video & Audio', steps: ['Upload', 'Extract Video Audio', 'Extract Narration Audio', 'Detect Scenes'] },
    { id: 'transcribe_orig', label: 'Transcribing Original Video', steps: ['Transcript Original'] },
    { id: 'translate', label: 'Translating to Burmese Speech', steps: ['Translate Burmese'] },
    { id: 'tts', label: 'Generating Burmese Narration', steps: ['Generate TTS Audio'] },
    { id: 'analyze_tts', label: 'Analyzing Timing & Beats', steps: ['Transcript Narration'] },
    { id: 'match', label: 'Matching Scenes Semantically', steps: ['Semantic Matching'] },
    { id: 'timeline', label: 'Synthesizing Subtitles & Timeline', steps: ['Timeline Builder', 'Subtitle Builder'] },
    { id: 'render', label: 'Rendering Final Movie Recap', steps: ['Segment Builder', 'Concat Segments', 'Export Final', 'Cleanup'] }
  ];

  const getStageIndex = (step: string) => {
    if (!step) return 0;
    for (let i = 0; i < STAGES.length; i++) {
        if (STAGES[i].steps.includes(step)) return i;
    }
    return 0;
  };

  const currentStageIndex = getStageIndex(currentBackendStep);

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

    const formData = new FormData();
    formData.append('video', videoFile);

    const geminiKey = localStorage.getItem('GEMINI_API_KEY') || '';
    formData.append('geminiApiKey', geminiKey);

    try {
      const response = await axios.post('/api/process-recap', formData, {
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
        
        setCurrentBackendStep(job.currentStep || 'Upload');
        
        if (job.status === 'complete') {
          clearInterval(interval);
          setAnalysisData(job.result);
          setStatus('complete');
        } else if (job.status === 'error') {
          clearInterval(interval);
          setStatus('error');
          setErrorMsg(job.error || 'Processing failed');
        } else {
          setProgressMsg(job.status === 'queued' ? 'Queued for processing...' : (job.currentStep ? `Processing: ${job.currentStep}` : 'Processing...'));
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
    setCurrentBackendStep('Upload');
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
    setCurrentBackendStep('');
  };

  // Helper values for current selections on the workspace
  const currentDialogueMode = settings['DIALOGUE_MODE']?.value === 'true';
  const currentColloquialMode = settings['COLLOQUIAL_MODE']?.value === 'true';
  const currentVoiceId = settings['EDGE_TTS_VOICE']?.value || 'male-young-adult';
  const selectedVoiceName = voices.find(v => v.id === currentVoiceId)?.name || 'တက်ကြွသောလူငယ်အသံ';

  // Check if API keys are configured in local storage
  const hasGeminiKey = !!localStorage.getItem('GEMINI_API_KEY');
  const isKeysConfigured = hasGeminiKey;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans selection:bg-indigo-500/30 selection:text-white">
      
      {/* Dynamic Header */}
      <header className="border-b border-gray-900 bg-gray-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 min-h-[4rem] flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-0">
          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
                <Video className="w-5.5 h-5.5 text-white" />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-bold font-display tracking-tight text-white leading-tight">Movie Recap AI Studio</h1>
                <p className="text-[10px] sm:text-[11px] text-gray-500 font-medium">Professional Burmese Video Reconstructor</p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:hidden">
              <button
                onClick={() => setShowCompletedJobs(true)}
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 hover:bg-gray-850 text-gray-300 transition-all active:scale-95 shrink-0"
              >
                <Menu className="w-4 h-4 text-indigo-400" />
              </button>
              <button 
                onClick={() => setShowSettings(true)}
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 hover:bg-gray-850 text-gray-300 transition-all active:scale-95 shrink-0"
              >
                <Settings className="w-4 h-4 text-indigo-400" />
              </button>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-3">
            {/* Status dot warning if keys are missing */}
            {!isKeysConfigured && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/20 rounded-full text-amber-400 text-xs font-semibold animate-pulse">
                <ShieldAlert className="w-3.5 h-3.5" />
                API Keys Required
              </div>
            )}
            
            <button
              onClick={() => setShowCompletedJobs(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 hover:bg-gray-850 text-gray-300 hover:text-white font-semibold text-xs transition-all active:scale-95"
            >
              <Menu className="w-4 h-4 text-indigo-400" />
            </button>
            <button 
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 hover:bg-gray-850 text-gray-300 hover:text-white font-semibold text-xs transition-all active:scale-95"
            >
              <Settings className="w-4 h-4 text-indigo-400" />
              ဆက်တင်များ (Settings)
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Settings Modal */}
        
      {/* Completed Jobs Modal */}
      {showCompletedJobs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md transition-all duration-300">
            <div className="bg-gray-950 border border-gray-800/80 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center px-6 py-5 border-b border-gray-800/50">
                    <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
                        <Menu className="w-5 h-5 text-indigo-400" />
                        Completed Videos (Last 24h)
                    </h2>
                    <button onClick={() => setShowCompletedJobs(false)} className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                    </button>
                </div>
                <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                    {completedJobsList.length === 0 ? (
                        <div className="text-center py-10 text-gray-500">
                            No completed videos in the last 24 hours.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {completedJobsList.map(job => (
                                <div key={job.jobId} className="flex items-center justify-between p-4 bg-gray-900/50 border border-gray-800 rounded-xl">
                                    <div className="flex-1 min-w-0 pr-4">
                                        <h4 className="text-sm font-medium text-gray-200 truncate">{job.originalFilename}</h4>
                                        <div className="text-xs text-gray-500 mt-1 flex items-center gap-3">
                                            <span>{new Date(job.completedAt).toLocaleString()}</span>
                                            <span>{((job.sizeBytes || 0) / (1024 * 1024)).toFixed(2)} MB</span>
                                        </div>
                                    </div>
                                    <a 
                                        href={job.videoUrl} 
                                        download 
                                        className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors shrink-0"
                                    >
                                        <Download className="w-4 h-4" />
                                        Download
                                    </a>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
      )}

      <SettingsModal 
          showSettings={showSettings} 
          setShowSettings={setShowSettings}
          settings={settings}
          editSettings={editSettings}
          setEditSettings={setEditSettings}
          saveSetting={saveSetting}
          deleteSetting={deleteSetting}
          settingsSaving={settingsSaving}
          showKeys={showKeys}
          setShowKeys={setShowKeys}
        />

        {/* 1. IDEAL WORKSPACE (IDLE STATE) */}
        {status === 'idle' && (
          <div className="space-y-6">
            
            {/* Security Quick Alert if keys are missing */}
            {!isKeysConfigured && (
              <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex gap-3">
                  <ShieldAlert className="w-5.5 h-5.5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-sm text-amber-200 block">စနစ်အသုံးပြုရန် API Key ထည့်သွင်းပေးပါ</span>
                    <span className="text-xs text-amber-400/80">ဗီဒီယို ပြန်ဆိုခြင်း စတင်ရန်အတွက် Gemini AI API key ထည့်သွင်းပေးရန် လိုအပ်ပါသည်။</span>
                  </div>
                </div>
                <button
                  onClick={() => setShowSettings(true)}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-gray-950 font-bold text-xs rounded-lg transition-all self-start sm:self-auto shrink-0"
                >
                  Configure API Keys
                </button>
              </div>
            )}

            {/* Video Upload Area (Full width but styled elegantly as a top section) */}
            <div className="bg-gray-900/40 border border-gray-900 rounded-2xl p-6 shadow-sm max-w-3xl mx-auto">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">🎬</span>
                <h3 className="font-bold text-sm text-gray-200 uppercase tracking-wide">မူရင်းဗီဒီယို (Original Video)</h3>
              </div>
              <p className="text-xs text-gray-500 mb-5">ဇာတ်လမ်းရှင်းပြချက် ဗီဒီယိုကို ဤနေရာတွင် ထည့်သွင်းပေးပါ။</p>

              <div 
                className={`border-2 border-dashed rounded-2xl flex flex-col items-center justify-center p-10 transition-all cursor-pointer ${videoFile ? 'border-indigo-500 bg-indigo-500/5 shadow-inner' : 'border-gray-800 hover:border-gray-700 bg-gray-950/40 hover:bg-gray-950/80'}`}
                onDragOver={handleDragOver}
                onDrop={handleVideoDrop}
                onClick={() => videoInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  ref={videoInputRef} 
                  className="hidden" 
                  accept="video/*"
                  onChange={handleVideoSelect}
                />
                                
                {videoFile ? (
                  <div className="flex flex-col items-center gap-3 text-center">
                    <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                      <FileVideo className="w-8 h-8" />
                    </div>
                    <div>
                      <span className="text-sm font-semibold text-indigo-200 block truncate max-w-[280px]">{videoFile.name}</span>
                      <span className="text-xs text-gray-500">{((videoFile.size || 0) / (1024 * 1024)).toFixed(2)} MB</span>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setVideoFile(null); }}
                      className="mt-2 px-3 py-1.5 bg-gray-900 hover:bg-red-950/30 border border-gray-800 hover:border-red-900/30 text-gray-400 hover:text-red-400 font-semibold text-[11px] rounded-lg transition-all"
                    >
                      ဗီဒီယိုဖျက်ရန် (Remove)
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-center text-gray-500">
                    <UploadCloud className="w-12 h-12 text-gray-600 mb-1" />
                    <span className="text-sm font-semibold text-gray-300">ဗီဒီယို ဆွဲထည့်ပါ သို့မဟုတ် နှိပ်ပါ (Drag or Click)</span>
                    <span className="text-[10px] text-gray-600">MP4, MOV supported</span>
                  </div>
                )}
              </div>
            </div>

            {/* Reorganized Clean Two-Column Layout for Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch max-w-5xl mx-auto">
              
              {/* Left Column: ဘာသာပြန်စနစ် */}
              <div className="bg-gray-900/40 border border-gray-900 rounded-2xl p-6 flex flex-col gap-6 shadow-sm">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-lg">📝</span>
                    <h3 className="font-bold text-sm text-gray-200 uppercase tracking-wide">ဘာသာပြန်စနစ်</h3>
                  </div>
                  <p className="text-xs text-gray-500">ဇာတ်လမ်းပြောမည့်ပုံစံနှင့် လေသံပုံစံကို သတ်မှတ်ပါ။</p>
                </div>

                {/* ဘာသာပြန်ပုံစံ (Modifiers) */}
                <div>
                  <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">ဘာသာပြန်ပုံစံ (Narration Mode)</label>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => saveSetting('DIALOGUE_MODE', currentDialogueMode ? 'false' : 'true')}
                      className={`flex items-center justify-between p-3.5 rounded-xl border text-left transition-all ${currentDialogueMode ? 'bg-indigo-950/25 border-indigo-500 text-indigo-300 shadow-sm' : 'bg-gray-950/40 border-gray-900 text-gray-400 hover:border-gray-800 hover:text-gray-350'}`}
                    >
                      <div>
                        <span className="text-xs font-bold block">Dialogue (A-B)</span>
                        <span className="text-[10px] text-gray-500">သူတစ်ပြန် ကိုယ်တစ်ပြန်</span>
                      </div>
                      {currentDialogueMode && <Check className="w-4 h-4 text-indigo-400 shrink-0" />}
                    </button>
                    
                    <button
                      onClick={() => saveSetting('COLLOQUIAL_MODE', currentColloquialMode ? 'false' : 'true')}
                      className={`flex items-center justify-between p-3.5 rounded-xl border text-left transition-all ${currentColloquialMode ? 'bg-indigo-950/25 border-indigo-500 text-indigo-300 shadow-sm' : 'bg-gray-950/40 border-gray-900 text-gray-400 hover:border-gray-800 hover:text-gray-350'}`}
                    >
                      <div>
                        <span className="text-xs font-bold block">Colloquial</span>
                        <span className="text-[10px] text-gray-500">လက်သုံးစကား / သဘာဝကျကျ</span>
                      </div>
                      {currentColloquialMode && <Check className="w-4 h-4 text-indigo-400 shrink-0" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-500 mt-3 text-center opacity-70">
                    {!currentDialogueMode && !currentColloquialMode ? 'လက်ရှိ: Normal (မူရင်းအတိုင်း)' : 'နှစ်ခုလုံးတွဲသုံးနိုင်သည်'}
                  </p>
                </div>
              </div>

              {/* Right Column: မြန်မာအသံ */}
              <div className="bg-gray-900/40 border border-gray-900 rounded-2xl p-6 flex flex-col gap-5 shadow-sm">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-lg">🎙️</span>
                    <h3 className="font-bold text-sm text-gray-200 uppercase tracking-wide">မြန်မာအသံ</h3>
                  </div>
                  <p className="text-xs text-gray-500 mb-1">ဗီဒီယိုနောက်ခံပြောမည့် မြန်မာအသံနှင့် လေသံရှင်ကို ရွေးချယ်ပါ။</p>
                </div>

                {/* Selected Voice Display Badge */}
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-indigo-950/15 border border-indigo-900/30 text-indigo-300">
                  <div className="flex items-center gap-2.5">
                    <span className="text-lg">📢</span>
                    <div>
                      <span className="text-[10px] text-indigo-400 uppercase tracking-wider font-bold block">ရွေးချယ်ထားသော အသံ</span>
                      <span className="text-xs font-bold text-indigo-200">{selectedVoiceName}</span>
                    </div>
                  </div>
                  <div className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse shrink-0" />
                </div>

                {/* Voice Gender Tabs */}
                <div className="flex bg-gray-950/80 p-0.5 rounded-lg border border-gray-800/60">
                  <button 
                    onClick={() => setSelectedGender('male')}
                    className={`flex-1 text-center py-2 text-xs font-bold rounded-md transition-all ${selectedGender === 'male' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    👨 အမျိုးသားအသံ
                  </button>
                  <button 
                    onClick={() => setSelectedGender('female')}
                    className={`flex-1 text-center py-2 text-xs font-bold rounded-md transition-all ${selectedGender === 'female' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    👩 အမျိုးသမီးအသံ
                  </button>
                </div>

                {/* Voice Cards */}
                <div className="flex-1 space-y-2 max-h-[280px] overflow-y-auto pr-1 custom-scrollbar">
                  {voices.filter(v => v.gender === selectedGender).map(v => {
                    const isSelected = currentVoiceId === v.id;
                    return (
                      <div 
                        key={v.id}
                        onClick={() => saveSetting('EDGE_TTS_VOICE', v.id)}
                        className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${isSelected ? 'bg-indigo-950/30 border-indigo-500 text-indigo-300 ring-1 ring-indigo-500/20' : 'bg-gray-950/40 border-gray-900 text-gray-400 hover:border-gray-800 hover:text-gray-350'}`}
                      >
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSelected ? 'bg-indigo-400' : 'bg-gray-700'}`} />
                          <span className="text-xs font-bold truncate">{v.name}</span>
                        </div>
                        
                        <button
                          onClick={(e) => { e.stopPropagation(); handlePreviewVoice(v.id); }}
                          disabled={previewingVoice !== null}
                          className={`flex items-center justify-center w-7 h-7 rounded-lg transition-all shrink-0 ${previewingVoice === v.id ? 'bg-indigo-500 text-white' : 'bg-gray-800/80 hover:bg-gray-700 text-gray-300 active:scale-90'}`}
                        >
                          {previewingVoice === v.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>

            {/* Row 3: Prominent Center Action Button */}
            <div className="flex justify-center pt-4 max-w-xs mx-auto">
              {isKeysConfigured ? (
                <button
                  onClick={startAnalysis}
                  disabled={!videoFile}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:from-gray-800 disabled:to-gray-800 disabled:opacity-40 text-white py-3.5 px-6 rounded-xl font-bold text-sm transition-all shadow-lg shadow-indigo-950/30 active:scale-98 hover:scale-[1.02] disabled:scale-100 disabled:cursor-not-allowed"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>စတင်လုပ်ဆောင်မည်</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => setShowSettings(true)}
                  className="w-full bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 py-3.5 px-6 rounded-xl font-bold text-sm transition-all active:scale-98 flex items-center justify-center gap-2"
                >
                  <ShieldAlert className="w-4 h-4" />
                  <span>API Keys အရင်ထည့်ပေးပါ</span>
                </button>
              )}
            </div>

          </div>
        )}

        {/* 2. PROCESSING PIPELINE WORKSPACE */}
        {(status === 'uploading' || status === 'analyzing') && (
          <div className="max-w-3xl mx-auto bg-gray-900/40 border border-gray-900 rounded-2xl p-6 sm:p-8 shadow-xl">
            <div className="flex items-center justify-between mb-8 pb-5 border-b border-gray-900">
                <div>
                    <h2 className="text-lg font-bold font-display text-white mb-1">ဗီဒီယို ပြန်ဆိုနေဆဲဖြစ်ပါသည် (Processing Recap)</h2>
                    <p className="text-gray-500 text-xs">AI စနစ်များဖြင့် ဗီဒီယိုကို ခွဲခြမ်းစိတ်ဖြာပြီး အသံဖိုင်ပြန်ဆိုနေပါသည် ခဏစောင့်ပေးပါ။</p>
                </div>
                <Loader2 className="w-7 h-7 text-indigo-500 animate-spin shrink-0" />
            </div>
            
            <div className="space-y-3">
                {STAGES.map((stage, idx) => {
                    let stageStatus = 'pending';
                    if (idx < currentStageIndex) stageStatus = 'completed';
                    else if (idx === currentStageIndex) stageStatus = 'active';

                    return (
                        <div key={stage.id} className={`flex items-center gap-4.5 p-3.5 rounded-xl transition-all ${stageStatus === 'active' ? 'bg-indigo-950/20 border border-indigo-500/30 shadow-md' : 'bg-gray-950/20 border border-gray-900/60'}`}>
                            <div className="w-5.5 h-5.5 flex items-center justify-center shrink-0">
                                {stageStatus === 'completed' && <CheckCircle className="w-5 h-5 text-emerald-500" />}
                                {stageStatus === 'active' && <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />}
                                {stageStatus === 'pending' && <div className="w-1.5 h-1.5 rounded-full bg-gray-800" />}
                            </div>
                            <span className={`text-xs font-bold transition-colors ${stageStatus === 'completed' ? 'text-gray-400' : stageStatus === 'active' ? 'text-indigo-300' : 'text-gray-650'}`}>
                                {stage.label}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* Premium Interactive Progress Bar */}
            <div className="mt-8 pt-6 border-t border-gray-900">
                <div className="flex justify-between items-center mb-2.5">
                    <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">{progressMsg || 'ဘာသာပြန်စနစ် စတင်နေဆဲ...'}</span>
                    <span className="text-xs font-mono font-bold text-gray-300 bg-gray-900 px-2 py-0.5 rounded border border-gray-800">{Math.round(progressPct)}%</span>
                </div>
                <div className="w-full bg-gray-950 rounded-full h-2.5 overflow-hidden border border-gray-900 p-0.5">
                    <div 
                        className="bg-gradient-to-r from-indigo-500 to-violet-500 h-full rounded-full transition-all duration-300 ease-out shadow-sm shadow-indigo-500/30"
                        style={{ width: `${Math.max(2, progressPct)}%` }}
                    />
                </div>
            </div>
          </div>
        )}

        {/* 3. ERROR WORKSPACE */}
        {status === 'error' && (
          <div className="max-w-2xl mx-auto bg-gray-900/40 border border-red-950/30 rounded-2xl p-8 flex flex-col shadow-xl">
             <div className="flex flex-col items-center justify-center text-center mb-8">
                <div className="w-16 h-16 rounded-2xl bg-red-950/20 border border-red-900/30 flex items-center justify-center text-red-500 mb-4 animate-bounce">
                  <AlertCircle className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-bold font-display text-red-400 mb-2">ပြန်ဆိုစနစ် ချို့ယွင်းချက်ရှိပါသည် (Failed)</h2>
                <div className="px-4 py-2 bg-red-950/20 border border-red-900/30 rounded-lg max-w-lg">
                  <p className="text-red-300/80 text-xs font-mono break-words">{errorMsg}</p>
                </div>
            </div>

            <div className="flex justify-center gap-4">
                <button
                  onClick={retryAnalysis}
                  className="bg-indigo-600 hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-500/20 text-white font-bold text-xs py-2.5 px-5 rounded-xl transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>ထပ်မံကြိုးစားမည် (Retry)</span>
                </button>
                <button
                  onClick={reset}
                  className="bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-300 font-bold text-xs py-2.5 px-5 rounded-xl transition-all hover:scale-105 active:scale-95"
                >
                  မူလနေရာသို့ ပြန်သွားမည်
                </button>
            </div>
          </div>
        )}

        {/* 4. SUCCESS & EXPORT WORKSPACE */}
        {status === 'complete' && analysisData && (
          <div className="space-y-8 max-w-4xl mx-auto">
            
            {/* Banner Complete */}
            <div className="bg-gray-900/40 border border-gray-900 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
                <div className="flex items-center gap-4 text-center md:text-left flex-col md:flex-row">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                      <CheckCircle className="w-8 h-8" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold font-display text-white">ဗီဒီယိုအသစ် ပြန်ဆိုပြီးပါပြီ (Recap Complete)</h2>
                      <p className="text-emerald-300/80 text-xs mt-0.5">မြန်မာနောက်ခံစကားပြော ဗီဒီယိုအဆင်သင့်ဖြစ်ပါပြီ ဒေါင်းလုဒ်လုပ်နိုင်ပါသည်။</p>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={reset}
                        className="px-5 py-2.5 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-300 font-bold rounded-xl text-xs transition-all active:scale-95"
                    >
                      ဗီဒီယိုအသစ် ပြုလုပ်မည်
                    </button>
                </div>
            </div>

            {/* Final Video Render Screen */}
            {analysisData.videoUrl && (
              <div className="bg-gray-900/40 border border-gray-900 rounded-2xl p-6 shadow-xl">
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300 mb-4 flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-indigo-400" />
                  ရလဒ်ဗီဒီယိုကြည့်ရှုရန် (Play Final Output)
                </h3>
                <div className="flex justify-center bg-black rounded-xl overflow-hidden border border-gray-900 relative group aspect-video max-w-2xl mx-auto shadow-2xl">
                  <video 
                    src={analysisData.videoUrl} 
                    controls 
                    className="max-h-[500px] w-auto aspect-[9/16]"
                    autoPlay
                    loop
                  />
                </div>
                <div className="mt-5 flex justify-center">
                  <a 
                    href={analysisData.videoUrl} 
                    download
                    className="bg-indigo-600 hover:bg-indigo-700 hover:shadow-lg hover:shadow-indigo-500/20 text-white px-6 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-2 hover:scale-102 active:scale-98"
                  >
                    <Download className="w-4 h-4" />
                    ဗီဒီယိုဒေါင်းလုဒ်ဆွဲရန် (Download Video)
                  </a>
                </div>
              </div>
            )}

            {/* Detailed Scene Timeline Report */}
            {!import.meta.env.PROD && analysisData && (
              <div className="bg-gray-900/40 border border-gray-900 rounded-2xl p-6 shadow-xl">
                <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300 mb-4 pb-3 border-b border-gray-900">
                  စကားပြောနှင့် မြင်ကွင်း ချိတ်ဆက်မှု အစီရင်ခံစာ (Narration to Scene Mapping)
                </h3>
                
                {analysisData.mapping && analysisData.mapping.length > 0 ? (
                  <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1.5 custom-scrollbar">
                    {analysisData.mapping.map((mapItem: any, idx: number) => {
                      const startTime = mapItem.narration_start !== undefined ? mapItem.narration_start : (mapItem.timestamp ? mapItem.timestamp[0] : 0);
                      const endTime = mapItem.narration_end !== undefined ? mapItem.narration_end : (mapItem.timestamp ? mapItem.timestamp[1] : 0);
                      const text = mapItem.narration_text || mapItem.text || "";
                      const matchedSceneIndex = mapItem.matched_scene_index !== undefined ? mapItem.matched_scene_index : idx;
                      const matchedSceneStart = mapItem.matched_scene_start !== undefined ? mapItem.matched_scene_start : startTime;
                      const matchedSceneText = mapItem.matched_scene_text || "";
                      const simScore = mapItem.similarity_score !== undefined ? mapItem.similarity_score : 1;

                      return (
                      <div key={idx} className="bg-gray-950/60 border border-gray-900 rounded-xl p-4 flex flex-col md:flex-row gap-4 md:items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] text-teal-400 font-bold font-mono mb-1 uppercase tracking-wide">
                            Burmese Narration ({Number(startTime).toFixed(1)}s - {Number(endTime).toFixed(1)}s)
                          </div>
                          <p className="text-xs text-gray-200 font-medium leading-relaxed">&ldquo;{text}&rdquo;</p>
                        </div>
                        
                        <div className="hidden md:flex items-center justify-center px-2">
                          <div className="w-6 h-[1px] bg-gray-800 relative">
                            <div className="absolute -right-1 -top-1 w-2 h-2 border-t border-r border-gray-600 rotate-45"></div>
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                           <div className="text-[10px] text-indigo-400 font-bold font-mono mb-1 uppercase tracking-wide">
                            Matched Scene {matchedSceneIndex + 1} (Start: {Number(matchedSceneStart).toFixed(1)}s)
                          </div>
                          <p className="text-xs text-gray-400 leading-relaxed truncate">
                            {matchedSceneText ? `Original: "${matchedSceneText}"` : 'No original dialogue'}
                          </p>
                        </div>
                        
                        <div className="text-right border-t md:border-t-0 border-gray-900 pt-2.5 md:pt-0 shrink-0">
                          <div className="text-[9px] text-gray-500 uppercase tracking-wider font-bold mb-0.5">Similarity</div>
                          <div className={`text-sm font-bold font-mono ${(simScore * 100) > 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {(simScore * 100).toFixed(1)}%
                          </div>
                        </div>
                      </div>
                    )})}
                  </div>
                ) : (
                  <p className="text-gray-550 text-xs font-medium">No mappings generated.</p>
                )}
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}

export default App;
