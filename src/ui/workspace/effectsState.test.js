import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeVideoEffects } from './effectsState.js';

test('rapid Flip then Color Grading changes preserve every independent effect field', () => {
  let effects = {
    colorGrading: 'original',
    flipVideoEnabled: false,
    blurEnabled: false,
    blurBoxes: [],
    burnSubtitlesEnabled: false,
    subtitlePosition: { xPct: 10, yPct: 78, widthPct: 80, heightPct: 12 },
  };

  effects = mergeVideoEffects(effects, { flipVideoEnabled: true });
  effects = mergeVideoEffects(effects, { colorGrading: 'cinematic' });

  assert.deepEqual(effects, {
    colorGrading: 'cinematic',
    flipVideoEnabled: true,
    blurEnabled: false,
    blurBoxes: [],
    burnSubtitlesEnabled: false,
    subtitlePosition: { xPct: 10, yPct: 78, widthPct: 80, heightPct: 12 },
  });
});
