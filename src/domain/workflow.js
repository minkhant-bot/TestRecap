export const WORKFLOW_VERSION = 2;

export const JOB_STATUSES = Object.freeze(['queued', 'processing', 'complete', 'error', 'cancelled']);
export const isJobStatus = status => JOB_STATUSES.includes(status);

export const WORKFLOW_STAGES = Object.freeze([
    { id: 'upload', label: 'Uploading video' },
    { id: 'extract_audio', label: 'Extracting audio' },
    { id: 'detect_scenes', label: 'Detecting scenes' },
    { id: 'transcribe_source', label: 'Transcribing with Faster-Whisper' },
    { id: 'translate_burmese', label: 'Translating to Burmese' },
    { id: 'generate_tts', label: 'Generating Burmese speech' },
    { id: 'match_scenes', label: 'Matching speech to scenes chronologically' },
    { id: 'build_timeline', label: 'Building timeline' },
    { id: 'rebuild_scenes', label: 'Rebuilding video scenes' },
    { id: 'export_final', label: 'Exporting final video' },
    { id: 'adjust_final_speed', label: 'Adjusting final playback speed' },
    { id: 'cleanup', label: 'Cleaning up' },
    { id: 'done', label: 'Complete' }
]);

export const WORKFLOW_STAGE_IDS = Object.freeze(WORKFLOW_STAGES.map(stage => stage.id));
export const WORKFLOW_STAGE = Object.freeze(Object.fromEntries(
    WORKFLOW_STAGE_IDS.map(stageId => [stageId.toUpperCase(), stageId])
));
export const WORKFLOW_STAGE_LABELS = Object.freeze(Object.fromEntries(
    WORKFLOW_STAGES.map(stage => [stage.id, stage.label])
));
const STAGE_INDEX = new Map(WORKFLOW_STAGE_IDS.map((stageId, index) => [stageId, index]));

export const isWorkflowStageId = stageId => STAGE_INDEX.has(stageId);
export const getWorkflowStageIndex = stageId => STAGE_INDEX.get(stageId) ?? 0;
export const hasCompletedStage = (currentStageId, targetStageId) => {
    const currentIndex = STAGE_INDEX.get(currentStageId);
    const targetIndex = STAGE_INDEX.get(targetStageId);
    return currentIndex !== undefined && targetIndex !== undefined && currentIndex > targetIndex;
};
export const isLegacyJob = job => job?.workflowVersion !== WORKFLOW_VERSION;

export class WorkflowVersionMismatchError extends Error {
    constructor(foundVersion) {
        super(`Incompatible workflow state: expected version ${WORKFLOW_VERSION}, found ${foundVersion ?? 'legacy/unversioned'}. Start a new job.`);
        this.name = 'WorkflowVersionMismatchError';
        this.code = 'WORKFLOW_VERSION_MISMATCH';
    }
}

export const readCompatibleWorkflowState = serializedState => {
    const state = JSON.parse(serializedState);
    if (state?.workflowVersion !== WORKFLOW_VERSION) {
        throw new WorkflowVersionMismatchError(state?.workflowVersion);
    }
    if (state.stageId !== undefined && !isWorkflowStageId(state.stageId)) {
        throw new Error(`Invalid workflow stage ID in state: ${state.stageId}`);
    }
    return state;
};

export const getFinalSpeedStageOutcome = multiplier => ({
    stageId: 'adjust_final_speed',
    stageOutcome: Number(multiplier) === 1 ? 'skipped' : 'completed'
});
