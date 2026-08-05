import type { WorkspaceJob } from './types';

// Simple product-facing stages only. Internal pipeline implementation
// details (Faster-Whisper transcription, Gemini translation, Edge-TTS
// synthesis, scene-rebuild/timeline algorithms, retry checkpoints, etc.)
// are intentionally never named here -- this is the single place that maps
// every real backend job.stage value to what a user (or Owner/Admin, who
// only ever sees sanitized operational status, never raw pipeline detail)
// is shown.
// "upload" has no real job.stage value -- it is complete as soon as a job
// exists (special-cased below) -- so its stageIds is empty, typed as real
// WorkspaceJob['stage'] values like every other step for STAGE_ORDER below.
const EMPTY_STAGES: WorkspaceJob['stage'][] = [];
export const WORKFLOW_STEPS = [
  { id: 'upload', label: 'Uploading', stageIds: EMPTY_STAGES },
  { id: 'preparing', label: 'Preparing', stageIds: ['preparing', 'audio_extraction'] as WorkspaceJob['stage'][] },
  { id: 'narration', label: 'Generating narration', stageIds: ['transcript_translation', 'voice_generation'] as WorkspaceJob['stage'][] },
  { id: 'building', label: 'Building video', stageIds: ['timeline_verification', 'scene_rebuild'] as WorkspaceJob['stage'][] },
  { id: 'finalizing', label: 'Finalizing', stageIds: ['final_export'] as WorkspaceJob['stage'][] },
] as const;

export type WorkflowStepId = typeof WORKFLOW_STEPS[number]['id'];

const STAGE_ORDER: WorkspaceJob['stage'][] = WORKFLOW_STEPS.flatMap(step => step.stageIds);

export const getWorkflowStepState = (
  job: WorkspaceJob | null,
  stepId: WorkflowStepId,
  uploadState: 'empty' | 'uploading' | 'error' | 'complete' = 'complete',
) => {
  if (stepId === 'upload') {
    if (!job) return uploadState === 'uploading' ? 'active' : uploadState === 'complete' ? 'complete' : 'waiting';
    return 'complete';
  }
  if (!job) return 'waiting';
  const step = WORKFLOW_STEPS.find(item => item.id === stepId);
  if (!step) return 'waiting';
  const currentIndex = STAGE_ORDER.indexOf(job.stage);
  const stepStartIndex = STAGE_ORDER.indexOf(step.stageIds[0]);
  const stepEndIndex = STAGE_ORDER.indexOf(step.stageIds[step.stageIds.length - 1]);
  if (job.status === 'completed' || currentIndex > stepEndIndex) return 'complete';
  if (currentIndex >= stepStartIndex && currentIndex <= stepEndIndex) return 'active';
  return 'waiting';
};

export const getStageLabel = (stage: WorkspaceJob['stage']) => {
  if (stage === 'pending' || stage === 'queued') return 'Waiting';
  if (stage === 'completed') return 'Completed';
  if (stage === 'failed') return 'Failed';
  if (stage === 'cancelled') return 'Cancelled';
  const step = WORKFLOW_STEPS.find(item => (item.stageIds as readonly string[]).includes(stage));
  return step ? step.label : 'Preparing';
};

export const getJobStatusLabel = (job: WorkspaceJob) => {
  if (job.status === 'pending') return 'Waiting';
  if (job.status === 'queued') return 'Waiting';
  if (job.status === 'processing') return getStageLabel(job.stage);
  if (job.status === 'completed') return 'Completed';
  if (job.status === 'failed') return 'Failed';
  return 'Cancelled';
};

export const getJobStatusTone = (job: WorkspaceJob) => {
  if (job.status === 'completed') return 'complete' as const;
  if (job.status === 'failed') return 'failed' as const;
  if (job.status === 'cancelled') return 'cancelled' as const;
  if (job.status === 'processing') return 'processing' as const;
  return 'queued' as const;
};

export const getDisplayedProgress = (job: WorkspaceJob) => {
  if (job.status === 'completed') return 100;
  return Math.max(0, Math.min(99, Math.round(job.progress)));
};
