import type { VideoEffects } from './types';

export function mergeVideoEffects(
  current: VideoEffects,
  patch: Partial<VideoEffects>,
): VideoEffects;

export const DEFAULT_VIDEO_EFFECTS: VideoEffects;
