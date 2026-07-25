import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { createJob, getJob, updateJob, setJobKeys } from '../services/jobManager.js';
import { addJobToQueue } from '../services/queue.js';
import { getSetting, setSetting, deleteSetting, getAllSettingsMasked } from '../services/settings.js';
import { VOICES, getVoiceConfig } from '../ai/voices.js';
import { EdgeTTS } from '@seepine/edge-tts';


const router = express.Router();

const tmpDir = path.join(process.cwd(), 'src', 'tmp');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

let maxUploadSize = 500 * 1024 * 1024; // 500 MB default
if (process.env.MAX_UPLOAD_SIZE_MB) {
    const parsed = parseInt(process.env.MAX_UPLOAD_SIZE_MB, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        maxUploadSize = parsed * 1024 * 1024;
    }
}
const upload = multer({ 
    dest: tmpDir,
    limits: { fileSize: maxUploadSize }
});

const handleUpload = (req, res, next) => {
    upload.single('video')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                if (req.file && fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                }
                return res.status(413).json({ error: `File too large. Maximum allowed size is ${maxUploadSize / (1024 * 1024)} MB.` });
            }
            return res.status(400).json({ error: err.message });
        } else if (err) {
            return res.status(500).json({ error: "Upload failed." });
        }
        next();
    });
};

router.get('/health', (req, res) => res.json({ status: 'ok' }));

router.get('/diagnostic', async (req, res) => {
    const key = (getSetting('GEMINI_API_KEY') || process.env.GEMINI_API_KEY) || '';
    const maskedKey = key.length > 8 ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : (key ? 'too-short' : 'missing');
    const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
    
    const diagData = {
        model,
        hasKey: !!key,
        maskedKey,
        serverTime: new Date().toISOString(),
        testRequestSuccess: false
    };

    if (key) {
        try {
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
            const payload = {
                contents: [{ role: 'user', parts: [{ text: 'Hello, this is a test.' }] }]
            };
            
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            diagData.actualHttpStatus = response.status;
            
            if (!response.ok) {
                const errorText = await response.text();
                diagData.actualErrorMessage = errorText;
                
                try {
                    const errObj = JSON.parse(errorText);
                    if (errObj.error) {
                        diagData.actualErrorCode = errObj.error.code;
                        diagData.actualErrorStatus = errObj.error.status;
                        
                        if (errObj.error.details) {
                            const quotaFail = errObj.error.details.find(d => d['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure');
                            if (quotaFail && quotaFail.violations && quotaFail.violations.length > 0) {
                                diagData.quotaId = quotaFail.violations[0].quotaMetric || 'unknown';
                            }
                            
                            const retryInfo = errObj.error.details.find(d => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
                            if (retryInfo) {
                                diagData.retryDelay = retryInfo.retryDelay;
                            }
                        }
                    }
                } catch(e) {}
            } else {
                diagData.testRequestSuccess = true;
            }
        } catch(e) {
            diagData.actualErrorMessage = e.message;
        }
    }
    
    res.json(diagData);
});

// Voices Routes
router.get('/voices', (req, res) => {
    res.json(VOICES);
});

router.post('/preview-voice', async (req, res) => {
    const { voiceId } = req.body;
    if (!voiceId) return res.status(400).json({ error: 'Voice ID is required' });
    
    const config = getVoiceConfig(voiceId);
    if (!config) return res.status(400).json({ error: 'Invalid Voice ID' });
    
    try {
        const previewText = "ကြိုဆိုပါတယ်။ ဒီနေ့မှာတော့ စိတ်ဝင်စားဖို့ကောင်းတဲ့ ဇာတ်လမ်းတစ်ပုဒ်ကို အတူတူကြည့်ရှုသွားကြမှာဖြစ်ပါတယ်။";
        const ttsClient = new EdgeTTS({ 
            voice: config.edgeVoice,
            pitch: config.pitch,
            rate: config.rate
        });
        
        const callPromise = ttsClient.call(previewText);
        let timeoutId;
        let resAudio;
        try {
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error("Edge TTS timeout")), 15000);
            });
            resAudio = await Promise.race([callPromise, timeoutPromise]);
        } finally {
            clearTimeout(timeoutId);
        }
        
        if (!resAudio.data || resAudio.data.length === 0) {
            throw new Error("Received empty audio data");
        }
        
        res.set({
            'Content-Type': 'audio/mpeg',
            'Content-Length': resAudio.data.length
        });
        res.send(resAudio.data);
    } catch(err) {
        console.error("[API] Preview Voice Error:", err);
        res.status(500).json({ error: 'Failed to generate preview audio' });
    }
});


// Settings Routes
router.get('/settings', (req, res) => {
    res.json(getAllSettingsMasked());
});

router.post('/settings', (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'Key is required' });
    if (value === null || value === undefined || value === '') {
        deleteSetting(key);
    } else {
        setSetting(key, value);
    }
    res.json(getAllSettingsMasked());
});


router.post('/process-recap', handleUpload, (req, res) => {
    const videoFile = req.file;

    if (!videoFile) {
        return res.status(400).json({ error: 'Video file is required' });
    }

    const geminiApiKey = req.body.geminiApiKey || req.headers['x-gemini-api-key'] || process.env.GEMINI_API_KEY;
    
    if (!geminiApiKey) {
        const missing = [];
                if (!geminiApiKey) missing.push('GEMINI_API_KEY');
        return res.status(400).json({ error: 'Please configure your API Keys before starting processing. Missing: ' + missing.join(', ') });
    }

    const jobId = uuidv4();
    createJob(jobId, {
        videoPath: videoFile.path,
        audioPath: null,
        originalFilename: videoFile.originalname
    });
    setJobKeys(jobId, { geminiApiKey });
    
    res.json({ jobId });

    addJobToQueue(jobId);
});

router.post('/retry/:jobId', (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'error') return res.status(400).json({ error: 'Job is not in error state' });
    
    updateJob(req.params.jobId, { status: 'queued', error: null });
    res.json({ message: 'Retrying job', jobId: req.params.jobId });
    addJobToQueue(req.params.jobId);
});

router.get('/status/:jobId', (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
});

// Adding compatibility routes based on instructions
router.post('/process', handleUpload, (req, res) => {
     // Forward to process-recap logic
     const videoFile = req.file;
     const audioFile = null;
     if (!videoFile) return res.status(400).json({ error: 'Video file required' });
     
     const geminiApiKey = req.body.geminiApiKey || req.headers['x-gemini-api-key'] || process.env.GEMINI_API_KEY;
     
     if (!geminiApiKey) {
         const missing = [];
                  if (!geminiApiKey) missing.push('GEMINI_API_KEY');
         return res.status(400).json({ error: 'Please configure your API Keys before starting processing. Missing: ' + missing.join(', ') });
     }
     
     const jobId = uuidv4();
     createJob(jobId, { videoPath: videoFile.path, audioPath: audioFile ? audioFile.path : null, originalFilename: videoFile.originalname });
     setJobKeys(jobId, { geminiApiKey });
     res.json({ jobId });
     
     addJobToQueue(jobId);
});

router.get('/play/:jobId', (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job || job.status !== 'complete' || !job.result || !job.result.videoUrl) {
        return res.status(404).send('Video not found or not ready');
    }
    res.redirect(job.result.videoUrl);
});


router.all('/completed-jobs', (req, res) => {
    const idsParam = req.method === 'POST' ? (Array.isArray(req.body?.ids) ? req.body.ids.join(',') : req.body?.ids) : req.query.ids;
    if (!idsParam) return res.json([]);
    const ids = idsParam.split(',').slice(0, 200).filter(id => typeof id === 'string' && id.trim().length > 0);
    if (ids.length === 0) return res.json([]);
    
    const timeLimit = Date.now() - 24 * 60 * 60 * 1000;
    const rows = [];
    for (const id of ids) {
        const job = getJob(id);
        if (job && job.status === 'complete' && job.completed_at != null && job.completed_at > timeLimit) {
            rows.push({
                id: job.id,
                originalFilename: job.originalFilename,
                completed_at: job.completed_at
            });
        }
    }
    
    const validJobs = [];
    for (const row of rows) {
        const outputPath = path.join(process.cwd(), 'public', 'output', `${row.id}.mp4`);
        if (fs.existsSync(outputPath)) {
            const stat = fs.statSync(outputPath);
            validJobs.push({
                jobId: row.id,
                originalFilename: row.originalFilename || 'Untitled video',
                completedAt: row.completed_at,
                sizeBytes: stat.size,
                videoUrl: `/output/${row.id}.mp4`,
                expiresAt: row.completed_at + 24 * 60 * 60 * 1000
            });
        }
    }
    
    res.json(validJobs);
});

export default router;
