export const GEMINI_RETRY_STAGE_MESSAGE = 'Gemini is busy. Retrying translation…';

export const getRetryStartStage = job =>
    job?.retryable === true && job?.resumeStage === 'translate_burmese'
        ? 'translate_burmese'
        : 'upload';

export const getGeminiFailureJobUpdate = error => {
    if (error?.retryable !== true || error?.resumeStage !== 'translate_burmese') return null;
    return {
        status: 'error',
        stageId: 'translate_burmese',
        stageOutcome: null,
        stageMessage: 'Gemini is temporarily unavailable. Retry will resume translation without restarting earlier stages.',
        retryable: true,
        resumeStage: 'translate_burmese',
        error: error.message
    };
};
