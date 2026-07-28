import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJobFormData } from './jobRequest.js';

test('frontend job request uses the unified pipeline and omits mode', () => {
    const payload = buildJobFormData(new Blob(['video']), 'key');
    assert.equal(payload.has('mode'), false);
    assert.equal(payload.get('geminiApiKey'), 'key');
    assert.ok(payload.get('video') instanceof Blob);
});
