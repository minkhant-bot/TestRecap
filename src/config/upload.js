export const SUPPORTED_VIDEO_EXTENSIONS = Object.freeze(['mp4', 'mkv', 'mov', 'avi', 'webm']);
export const MAX_SOURCE_VIDEO_DURATION_SECONDS = 15 * 60;
export const VIDEO_TOO_LONG_MESSAGE = 'Video is too long. Maximum supported duration is 15 minutes.';

export const validateSourceVideoDuration = duration => {
    const seconds = Number(duration);
    if (!Number.isFinite(seconds) || seconds <= 0) {
        const error = new Error('Video duration could not be verified.');
        error.code = 'INVALID_SOURCE_VIDEO_DURATION';
        throw error;
    }
    if (seconds > MAX_SOURCE_VIDEO_DURATION_SECONDS) {
        const error = new Error(VIDEO_TOO_LONG_MESSAGE);
        error.code = 'SOURCE_VIDEO_TOO_LONG';
        throw error;
    }
    return seconds;
};

export const getUploadConfiguration = (env = process.env) => {
    const megabytes = Number(env.MAX_UPLOAD_SIZE_MB);
    if (!Number.isFinite(megabytes) || megabytes <= 0) {
        return {
            configured: false,
            maxMegabytes: null,
            maxBytes: null,
            maxSourceDurationSeconds: MAX_SOURCE_VIDEO_DURATION_SECONDS,
            supportedExtensions: SUPPORTED_VIDEO_EXTENSIONS
        };
    }
    return {
        configured: true,
        maxMegabytes: megabytes,
        maxBytes: Math.floor(megabytes * 1024 * 1024),
        maxSourceDurationSeconds: MAX_SOURCE_VIDEO_DURATION_SECONDS,
        supportedExtensions: SUPPORTED_VIDEO_EXTENSIONS
    };
};
