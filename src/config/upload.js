export const SUPPORTED_VIDEO_EXTENSIONS = Object.freeze(['mp4', 'mkv', 'mov', 'avi', 'webm']);

export const getUploadConfiguration = (env = process.env) => {
    const megabytes = Number(env.MAX_UPLOAD_SIZE_MB);
    if (!Number.isFinite(megabytes) || megabytes <= 0) {
        return {
            configured: false,
            maxMegabytes: null,
            maxBytes: null,
            supportedExtensions: SUPPORTED_VIDEO_EXTENSIONS
        };
    }
    return {
        configured: true,
        maxMegabytes: megabytes,
        maxBytes: Math.floor(megabytes * 1024 * 1024),
        supportedExtensions: SUPPORTED_VIDEO_EXTENSIONS
    };
};
