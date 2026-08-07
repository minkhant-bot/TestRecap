export const mergeVideoEffects = (current, patch) => ({
  ...current,
  ...patch,
});

// Lives here (not in VideoEffectsEditor.tsx) so pages that need a starting
// value before the editor itself has mounted -- e.g. NewRecapPage's initial
// state, reachable well before a job reaches `pending` -- don't have to
// import the whole lazy-loaded editor component just for this constant.
export const DEFAULT_VIDEO_EFFECTS = {
  colorGrading: 'original',
  flipVideoEnabled: false,
  burnSubtitlesEnabled: false,
  subtitlePosition: { xPct: 10, yPct: 78, widthPct: 80, heightPct: 12 },
  subtitleColor: 'yellow',
  blurEnabled: false,
  blurBoxes: [],
};
