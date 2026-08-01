import assert from 'node:assert/strict';
import test from 'node:test';
import {
    getUploadConfiguration,
    MAX_SOURCE_VIDEO_DURATION_SECONDS,
    SUPPORTED_VIDEO_EXTENSIONS,
    validateSourceVideoDuration,
    VIDEO_TOO_LONG_MESSAGE
} from './upload.js';

test('upload limit comes exclusively from configuration', () => {
    assert.deepEqual(getUploadConfiguration({}), {
        configured: false,
        maxMegabytes: null,
        maxBytes: null,
        maxSourceDurationSeconds: MAX_SOURCE_VIDEO_DURATION_SECONDS,
        supportedExtensions: SUPPORTED_VIDEO_EXTENSIONS
    });
    assert.equal(getUploadConfiguration({ MAX_UPLOAD_SIZE_MB: '25' }).maxBytes, 25 * 1024 * 1024);
    assert.equal(getUploadConfiguration({ MAX_UPLOAD_SIZE_MB: '25' }).maxMegabytes, 25);
    assert.equal(getUploadConfiguration({ MAX_UPLOAD_SIZE_MB: 'invalid' }).configured, false);
    assert.equal(getUploadConfiguration({ MAX_UPLOAD_SIZE_MB: '0' }).configured, false);
    assert.equal(getUploadConfiguration({ MAX_UPLOAD_SIZE_MB: '-1' }).configured, false);
});

test('15-minute source duration boundary is inclusive', () => {
    assert.equal(validateSourceVideoDuration(14 * 60 + 59), 899);
    assert.equal(validateSourceVideoDuration(15 * 60), 900);
    assert.throws(
        () => validateSourceVideoDuration(15 * 60 + 1),
        error => error.code === 'SOURCE_VIDEO_TOO_LONG' && error.message === VIDEO_TOO_LONG_MESSAGE
    );
});

test('supported upload formats are explicit and stable', () => {
    assert.deepEqual([...SUPPORTED_VIDEO_EXTENSIONS], ['mp4', 'mkv', 'mov', 'avi', 'webm']);
});
