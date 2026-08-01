export interface WorkspaceJob {
  id: string;
  filename: string;
  thumbnailUrl?: string | null;
  fileSize: number;
  duration: number | null;
  status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  stage: 'pending' | 'queued' | 'preparing' | 'audio_extraction' | 'gemini_transcript' |
    'voice_generation' | 'timeline_verification' | 'scene_rebuild' | 'final_export' |
    'completed' | 'failed' | 'cancelled';
  progress: number;
  createdAt: string;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
  workerId: string | null;
  error: string | null;
  retry: {
    attempts: number;
    maxAttempts: number;
    lastAttemptAt: string | null;
    resumeStage: string | null;
  };
  recoveryCount: number;
  audioDuration: number | null;
  extractionStartedAt: string | null;
  extractionCompletedAt: string | null;
  transcriptSegmentCount: number | null;
  transcriptionStartedAt: string | null;
  transcriptionCompletedAt: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  cancellationRequested: boolean;
  effects: VideoEffects;
}

export interface WorkspaceRetryEligibility {
  recoverable: boolean;
  resumeStage?: string;
  resumeProgress?: number;
  code?: string;
  reason?: string;
}

export interface WorkspaceRetryResult {
  status: 'accepted' | 'duplicate' | 'already_active';
  replayed: boolean;
  code: string;
  resumeStage: string | null;
  job: WorkspaceJobStatus;
}

export interface EffectRect {
  id?: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
}

export interface BlurBox extends EffectRect {
  id: string;
  strength: number;
}

export interface VideoEffects {
  colorGrading: 'original' | 'auto' | 'cinematic' | 'warm' | 'cool';
  flipVideoEnabled: boolean;
  burnSubtitlesEnabled: boolean;
  subtitlePosition: EffectRect;
  blurEnabled: boolean;
  blurBoxes: BlurBox[];
}

export interface WorkspaceJobStatus extends WorkspaceJob {
  queuePosition: number | null;
}

export interface WorkspaceQueue {
  concurrency: 1;
  worker: {
    workerId: string;
    running: boolean;
    concurrency: 1;
    activeJobId: string | null;
  };
  jobs: Array<WorkspaceJob & { position: number }>;
}

export interface UploadConfiguration {
  configured: true;
  maxUploadSizeMb: number;
  maxUploadSizeBytes: number;
  maxSourceDurationSeconds: number;
  supportedExtensions: string[];
}
