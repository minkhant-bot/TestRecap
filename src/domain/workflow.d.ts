export const WORKFLOW_VERSION: 2;

export type JobStatus = 'queued' | 'processing' | 'complete' | 'error' | 'cancelled';
export type WorkflowStageId =
    | 'upload'
    | 'extract_audio'
    | 'detect_scenes'
    | 'transcribe_source'
    | 'translate_burmese'
    | 'generate_tts'
    | 'match_scenes'
    | 'build_timeline'
    | 'rebuild_scenes'
    | 'export_final'
    | 'adjust_final_speed'
    | 'cleanup'
    | 'done';

export interface WorkflowStage {
    id: WorkflowStageId;
    label: string;
}

export const JOB_STATUSES: readonly JobStatus[];
export const WORKFLOW_STAGES: readonly WorkflowStage[];
export const WORKFLOW_STAGE_IDS: readonly WorkflowStageId[];
export const WORKFLOW_STAGE: Readonly<Record<Uppercase<WorkflowStageId>, WorkflowStageId>>;
export const WORKFLOW_STAGE_LABELS: Readonly<Record<WorkflowStageId, string>>;

export function isJobStatus(status: unknown): status is JobStatus;
export function isWorkflowStageId(stageId: unknown): stageId is WorkflowStageId;
export function getWorkflowStageIndex(stageId: unknown): number;
export function hasCompletedStage(currentStageId: unknown, targetStageId: unknown): boolean;
export function isLegacyJob(job: { workflowVersion?: number } | null | undefined): boolean;

export class WorkflowVersionMismatchError extends Error {
    code: 'WORKFLOW_VERSION_MISMATCH';
}

export function readCompatibleWorkflowState(serializedState: string): {
    workflowVersion: 2;
    stageId?: WorkflowStageId;
    [key: string]: unknown;
};

export function getFinalSpeedStageOutcome(multiplier: number): {
    stageId: 'adjust_final_speed';
    stageOutcome: 'skipped' | 'completed';
};
