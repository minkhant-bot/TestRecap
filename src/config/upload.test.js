import assert from 'node:assert/strict';
import test from 'node:test';
import { getUploadConfiguration, SUPPORTED_VIDEO_EXTENSIONS } from './upload.js';

test('upload limit comes exclusively from configuration', () => {
    assert.deepEqual(getUploadConfiguration({}), {
        configured: false,
        maxMegabytes: null,
        maxBytes: null,
        supportedExtensions: SUPPORTED_VIDEO_EXTENSIONS
    });
    assert.equal(getUploadConfiguration({ MAX_UPLOAD_SIZE_MB: '25' }).maxBytes, 25 * 1024 * 1024);
    assert.equal(getUploadConfiguration({ MAX_UPLOAD_SIZE_MB: '25' }).maxMegabytes, 25);
    assert.equal(getUploadConfiguration({ MAX_UPLOAD_SIZE_MB: 'invalid' }).configured, false);
    assert.equal(getUploadConfiguration({ MAX_UPLOAD_SIZE_MB: '0' }).configured, false);
    assert.equal(getUploadConfiguration({ MAX_UPLOAD_SIZE_MB: '-1' }).configured, false);
});

test('supported upload formats are explicit and stable', () => {
    assert.deepEqual([...SUPPORTED_VIDEO_EXTENSIONS], ['mp4', 'mkv', 'mov', 'avi', 'webm']);
});
