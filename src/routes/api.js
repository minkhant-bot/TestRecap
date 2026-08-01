import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { clearJobKeys, createJob, deleteJob, getJob, getJobKeys, listJobs, updateJob, setJobKeys } from '../services/jobManager.js';
import { COMPLETED_JOB_ID_PATTERN, deleteCompletedJobAndRecord, resolveCompletedJobForDeletion } from '../services/completedOutputDeletion.js';
import { addJobToQueue, cancelQueuedJob } from '../services/queue.js';
import { getSetting, setSetting, deleteSetting, getAllSettingsMasked } from '../services/settings.js';
import { VOICES, getVoiceConfig } from '../ai/voices.js';
import { EdgeTTS } from '@seepine/edge-tts';
import { WORKFLOW_VERSION, isLegacyJob } from '../domain/workflow.js';
import { getRetryStartStage } from '../services/geminiRetryPolicy.js';
import { ensureStoragePaths, getStoragePaths } from '../config/runtime.js';
import { isAdminRole, requireAdmin, requireAuth, requireJobAccess } from '../middleware/auth.js';
import { recordAuditEvent } from '../services/auditLog.js';
import authRoutes from './auth.js';
import adminRoutes from './admin.js';
import workspaceRoutes from './workspace.js';
import billingRoutes from './billing.js';
import adminBillingRoutes from './adminBilling.js';
import {
    admissionService,
    createMutationAdmissionMiddleware,
    sendAdmissionError
} from '../services/admissionControl.js';
import healthRoutes from './health.js';
import { getDuration } from '../ffmpeg/index.js';
import {
    validateSourceVideoDuration,
    VIDEO_TOO_LONG_MESSAGE
} from '../config/upload.js';


const router = express.Router();
const admitMutation = endpoint => createMutationAdmissionMiddleware(admissionService, endpoint);

const storagePaths = ensureStoragePaths(getStoragePaths());
const tmpDir = storagePaths.uploads;

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

const removeUploadedVideo = req => {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
};

const enforceUploadedVideoDuration = async (req, res, next) => {
    if (!req.file) return next();
    try {
        req.authoritativeSourceDuration = validateSourceVideoDuration(
            await getDuration(req.file.path)
        );
        return next();
    } catch (error) {
        removeUploadedVideo(req);
        if (error?.code === 'SOURCE_VIDEO_TOO_LONG') {
            return res.status(422).json({ error: VIDEO_TOO_LONG_MESSAGE, code: error.code });
        }
        return res.status(422).json({
            error: 'Video duration could not be verified.',
            code: 'INVALID_SOURCE_VIDEO_DURATION'
        });
    }
};

router.use(healthRoutes);
router.get('/config/firebase', (req, res) => res.json({
    apiKey: process.env.FIREBASE_WEB_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    appId: process.env.FIREBASE_APP_ID || ''
}));
router.use('/auth', authRoutes);
router.use(requireAuth);
router.use(billingRoutes);
router.use('/admin/billing', adminBillingRoutes);
router.use('/workspace', workspaceRoutes);
router.use('/admin', adminRoutes);

router.get('/diagnostic', requireAdmin, async (req, res) => {
    const key = (getSetting('GEMINI_API_KEY') || process.env.GEMINI_API_KEY) || '';
    const maskedKey = key.length > 8 ? `${key.substring(0, 4)}...${key.substring(key.length - 4)}` : (key ? 'too-short' : 'missing');
    const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    
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
router.get('/settings', requireAdmin, (req, res) => {
    res.json(getAllSettingsMasked());
});

router.post('/settings', requireAdmin, (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'Key is required' });
    if (value === null || value === undefined || value === '') {
        deleteSetting(key);
    } else {
        setSetting(key, value);
    }
    res.json(getAllSettingsMasked());
});


const createProcessingJob = (req, res) => {
    const videoFile = req.file;
    if (!videoFile) return res.status(400).json({ error: 'Video file is required' });

    const geminiApiKey = req.body.geminiApiKey || req.headers['x-gemini-api-key'] || process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
        if (fs.existsSync(videoFile.path)) fs.unlinkSync(videoFile.path);
        return res.status(400).json({ error: 'Please configure your API Keys before starting processing. Missing: GEMINI_API_KEY' });
    }

    const jobId = uuidv4();
    try {
        admissionService.withProcessingAdmission(req.user.uid, jobId, () => {
            try {
                createJob(jobId, {
                    ownerUid: req.user.uid,
                    videoPath: videoFile.path,
                    audioPath: null,
                    originalFilename: videoFile.originalname
                });
                setJobKeys(jobId, { geminiApiKey });
                addJobToQueue(jobId);
                recordAuditEvent('project.created', { jobId, ownerUid: req.user.uid });
            } catch (error) {
                clearJobKeys(jobId);
                deleteJob(jobId);
                throw error;
            }
        });
        return res.json({ jobId });
    } catch (error) {
        if (sendAdmissionError(res, error, req.requestId)) {
            if (fs.existsSync(videoFile.path)) fs.unlinkSync(videoFile.path);
            return;
        }
        if (fs.existsSync(videoFile.path)) fs.unlinkSync(videoFile.path);
        return res.status(500).json({
            error: 'The processing job could not be created.',
            requestId: req.requestId || null
        });
    }
};

router.post(
    ['/jobs', '/process-recap'],
    requireAdmin,
    admitMutation('legacy.jobs.create'),
    handleUpload,
    enforceUploadedVideoDuration,
    createProcessingJob
);

router.post('/retry/:jobId', async (req, res) => {
    const job = getJob(req.params.jobId);
    if (!requireJobAccess(req, res, job)) return;
    if (job.status !== 'error') return res.status(400).json({ error: 'Job is not in error state' });
    if (isLegacyJob(job)) {
        return res.status(409).json({ error: 'Legacy workflow jobs cannot be resumed under workflow version ' + WORKFLOW_VERSION + '. Start a new job.' });
    }
    try {
        validateSourceVideoDuration(await getDuration(job.videoPath));
    } catch (error) {
        if (error?.code === 'SOURCE_VIDEO_TOO_LONG') {
            return res.status(422).json({ error: VIDEO_TOO_LONG_MESSAGE, code: error.code });
        }
        return res.status(422).json({
            error: 'Video duration could not be verified.',
            code: 'INVALID_SOURCE_VIDEO_DURATION'
        });
    }
    
    const geminiApiKey = req.body?.geminiApiKey || req.headers['x-gemini-api-key'] || getJobKeys(req.params.jobId).geminiApiKey || process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
        return res.status(400).json({ error: 'A Gemini API key is required to resume this workflow-v2 job.' });
    }
    setJobKeys(req.params.jobId, { geminiApiKey });
    const retryStage = getRetryStartStage(job);
    updateJob(req.params.jobId, {
        status: 'queued', error: null, stageId: retryStage, stageOutcome: null,
        stageMessage: retryStage === 'translate_burmese' ? 'Retrying Burmese translation…' : null,
        progress: retryStage === 'translate_burmese' ? 30 : 0
    });
    res.json({ message: 'Retrying job from ' + retryStage, jobId: req.params.jobId, stageId: retryStage });
    addJobToQueue(req.params.jobId);
});

router.get('/status/:jobId', (req, res) => {
    const job = getJob(req.params.jobId);
    if (!requireJobAccess(req, res, job)) return;
    const { videoPath, audioPath, ...safeJob } = job;
    res.json(safeJob);
});

router.post('/jobs/:jobId/cancel', (req, res) => {
    const job = getJob(req.params.jobId);
    if (!requireJobAccess(req, res, job)) return;
    const result = cancelQueuedJob(req.params.jobId);
    if (!result.cancelled) {
        return res.status(409).json({ error: 'Only queued jobs can be cancelled.' });
    }
    res.json({ jobId: req.params.jobId, status: 'cancelled' });
});

router.get('/projects', (req, res) => {
    const jobs = listJobs(isAdminRole(req.user.role) ? {} : { ownerUid: req.user.uid });
    res.json(jobs.map(job => ({
        id: job.id,
        originalFilename: job.originalFilename,
        status: job.status,
        progress: job.progress,
        stageId: job.stageId,
        createdAt: job.created_at,
        completedAt: job.completed_at || null
    })));
});

router.delete('/jobs/:jobId', (req, res) => {
    const { jobId } = req.params;
    if (!COMPLETED_JOB_ID_PATTERN.test(jobId)) {
        return res.status(400).json({ error: 'Invalid job ID.' });
    }
    const storedJob = getJob(jobId);
    if (!requireJobAccess(req, res, storedJob)) return;
    if (storedJob && storedJob.status !== 'complete') {
        return res.status(409).json({ error: 'Only completed jobs can be deleted.' });
    }

    try {
        const job = resolveCompletedJobForDeletion({ jobId, job: storedJob });
        if (!job) return res.status(404).json({ error: 'Completed output not found.' });
        deleteCompletedJobAndRecord({
            job,
            clearCredentials: clearJobKeys,
            deleteRecord: deleteJob
        });
        return res.json({ deleted: true, jobId });
    } catch (error) {
        console.error(`[API] Failed to delete completed job ${jobId}:`, error);
        return res.status(500).json({
            error: `Completed output could not be deleted: ${error.message}`
        });
    }
});

// Adding compatibility routes based on instructions
router.post('/process', requireAdmin, admitMutation('legacy.process.create'), handleUpload,
    enforceUploadedVideoDuration, (req, res) => {
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
     try {
         admissionService.withProcessingAdmission(req.user.uid, jobId, () => {
             try {
                 createJob(jobId, {
                     ownerUid: req.user.uid,
                     videoPath: videoFile.path,
                     audioPath: audioFile ? audioFile.path : null,
                     originalFilename: videoFile.originalname
                 });
                 setJobKeys(jobId, { geminiApiKey });
                 addJobToQueue(jobId);
             } catch (error) {
                 clearJobKeys(jobId);
                 deleteJob(jobId);
                 throw error;
             }
         });
         return res.json({ jobId });
     } catch (error) {
         if (sendAdmissionError(res, error, req.requestId)) {
             if (fs.existsSync(videoFile.path)) fs.unlinkSync(videoFile.path);
             return;
         }
         if (fs.existsSync(videoFile.path)) fs.unlinkSync(videoFile.path);
         return res.status(500).json({
             error: 'The processing job could not be created.',
             requestId: req.requestId || null
         });
     }
});

router.get('/play/:jobId', (req, res) => {
    const job = getJob(req.params.jobId);
    if (!requireJobAccess(req, res, job)) return;
    if (job.status !== 'complete' || !job.result || !job.result.videoUrl) {
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
        if (job && !isAdminRole(req.user.role) && job.ownerUid !== req.user.uid) continue;
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
        const outputPath = path.join(storagePaths.output, `${row.id}.mp4`);
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
    
    const includedIds = new Set(validJobs.map(job => job.jobId));
    for (const id of ids) {
        if (includedIds.has(id) || !COMPLETED_JOB_ID_PATTERN.test(id)) continue;
        const liveJob = getJob(id);
        if (!liveJob || (!isAdminRole(req.user.role) && liveJob.ownerUid !== req.user.uid)) continue;
        if (liveJob && liveJob.status !== 'complete') continue;
        const outputPath = path.join(storagePaths.output, `${id}.mp4`);
        if (!fs.existsSync(outputPath)) continue;
        const stat = fs.lstatSync(outputPath);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        const completedAt = liveJob?.completed_at || stat.mtimeMs;
        if (completedAt <= timeLimit) continue;
        validJobs.push({
            jobId: id,
            originalFilename: liveJob?.originalFilename || 'Completed video',
            completedAt,
            sizeBytes: stat.size,
            videoUrl: `/output/${id}.mp4`,
            expiresAt: completedAt + 24 * 60 * 60 * 1000
        });
    }

    res.json(validJobs);
});

export default router;
