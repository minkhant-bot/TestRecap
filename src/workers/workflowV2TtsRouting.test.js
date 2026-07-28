import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('workflow v2 bypasses legacy per-segment TTS duration fitting', () => {
    const processorSource = fs.readFileSync(new URL('./processor.js', import.meta.url), 'utf8');
    const ttsSource = fs.readFileSync(new URL('../ai/index.js', import.meta.url), 'utf8');

    assert.match(
        processorSource,
        /generateNarrationTTS\([\s\S]*enableLegacyDurationFit:\s*false[\s\S]*?\);/
    );
    assert.match(ttsSource, /enableLegacyDurationFit\s*=\s*true/);
    assert.match(ttsSource, /while\s*\(enableLegacyDurationFit\)/);
});
