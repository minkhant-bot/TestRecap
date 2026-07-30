import type { WorkspaceJob } from './types';

export const WORKFLOW_STEPS = [
  { id: 'upload', label: 'Upload', available: true },
  { id: 'audio_extraction', label: 'Audio Extraction', available: true },
  { id: 'gemini_transcript', label: 'Gemini Transcript', available: true },
  { id: 'voice_generation', label: 'Voice Generation', available: true },
  { id: 'timeline_verification', label: 'Timeline Verification', available: true },
  { id: 'scene_rebuild', label: 'Scene Rebuild', available: true },
  { id: 'final_export', label: 'Final Export', available: true },
] as const;

export type WorkflowStepId = typeof WORKFLOW_STEPS[number]['id'];

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
  if (stepId === 'audio_extraction') {
    if (job.audioDuration || ['gemini_transcript', 'completed'].includes(job.stage)) return 'complete';
    return job.stage === 'audio_extraction' ? 'active' : 'waiting';
  }
  if (stepId === 'gemini_transcript') {
    if (job.transcriptSegmentCount !== null || job.status === 'completed') return 'complete';
    return job.stage === 'gemini_transcript' ? 'active' : 'waiting';
  }
  const stageOrder: WorkflowStepId[] = WORKFLOW_STEPS.map(step => step.id);
  const currentIndex = stageOrder.indexOf(job.stage as WorkflowStepId);
  const stepIndex = stageOrder.indexOf(stepId);
  if (job.status === 'completed' || currentIndex > stepIndex) return 'complete';
  return job.stage === stepId ? 'active' : 'waiting';
};

export const getStageLabel = (stage: WorkspaceJob['stage']) => {
  const labels: Record<WorkspaceJob['stage'], string> = {
    pending: 'Waiting',
    queued: 'Waiting',
    preparing: 'In progress',
    audio_extraction: 'Audio Extraction',
    gemini_transcript: 'Gemini Transcript',
    voice_generation: 'Voice Generation',
    timeline_verification: 'Timeline Verification',
    scene_rebuild: 'Scene Rebuild',
    final_export: 'Final Export',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  return labels[stage];
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
