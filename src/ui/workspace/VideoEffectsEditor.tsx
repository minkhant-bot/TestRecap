import { FlipHorizontal2, Pause, Play, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../components';
import { mergeVideoEffects } from './effectsState.js';
import type { BlurBox, EffectRect, VideoEffects } from './types';

interface Props {
  jobId: string;
  effects: VideoEffects;
  onChange(effects: VideoEffects): void;
  readOnly?: boolean;
}

type DragTarget = { kind: 'subtitle' } | { kind: 'blur'; id: string };
type DragAction = 'move' | 'resize';

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const formatMediaTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
};

export const DEFAULT_VIDEO_EFFECTS: VideoEffects = {
  colorGrading: 'original',
  flipVideoEnabled: false,
  burnSubtitlesEnabled: false,
  subtitlePosition: { xPct: 10, yPct: 78, widthPct: 80, heightPct: 12 },
  subtitleColor: 'yellow',
  blurEnabled: false,
  blurBoxes: [],
};

// One color applies to every subtitle cue in the whole video -- selecting a
// swatch is a single, exclusive choice, never alternated, never per-speaker.
const SUBTITLE_COLOR_SWATCHES: Array<{ id: VideoEffects['subtitleColor']; label: string; hex: string }> = [
  { id: 'yellow', label: 'Yellow', hex: '#FFFF00' },
  { id: 'red', label: 'Red', hex: '#FF3B30' },
  { id: 'blue', label: 'Blue', hex: '#3399FF' },
];

export function VideoEffectsEditor({ jobId, effects, onChange, readOnly = false }: Props) {
  const latestEffectsRef = useRef(effects);
  latestEffectsRef.current = effects;
  const commitEffects = (update: (current: VideoEffects) => VideoEffects) => {
    const nextEffects = update(latestEffectsRef.current);
    latestEffectsRef.current = nextEffects;
    onChange(nextEffects);
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoPaused, setVideoPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoAspectRatio, setVideoAspectRatio] = useState('16 / 9');
  const [videoRect, setVideoRect] = useState({ left: 0, top: 0, width: 0, height: 0 });

  const updateVideoRect = () => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container || !video?.videoWidth || !video.videoHeight) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const videoRatio = video.videoWidth / video.videoHeight;
    const containerRatio = width / height;
    const renderedWidth = videoRatio > containerRatio ? width : height * videoRatio;
    const renderedHeight = videoRatio > containerRatio ? width / videoRatio : height;
    setVideoRect({
      left: (width - renderedWidth) / 2,
      top: (height - renderedHeight) / 2,
      width: renderedWidth,
      height: renderedHeight,
    });
  };

  useEffect(() => {
    const observer = new ResizeObserver(updateVideoRect);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const updateTarget = (target: DragTarget, updater: (rect: EffectRect) => EffectRect) => {
    if (target.kind === 'subtitle') {
      commitEffects(current => ({
        ...current,
        subtitlePosition: updater(current.subtitlePosition),
      }));
      return;
    }
    commitEffects(current => ({
      ...current,
      blurBoxes: current.blurBoxes.map(box =>
        box.id === target.id ? { ...box, ...updater(box) } : box),
    }));
  };

  const beginDrag = (
    event: React.PointerEvent,
    target: DragTarget,
    action: DragAction,
    initial: EffectRect,
  ) => {
    if (readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const width = videoRect.width || 1;
    const height = videoRect.height || 1;
    const move = (pointer: PointerEvent) => {
      const dx = ((pointer.clientX - startX) / width) * 100;
      const dy = ((pointer.clientY - startY) / height) * 100;
      updateTarget(target, () => action === 'move'
        ? {
            ...initial,
            xPct: clamp(initial.xPct + dx, 0, 100 - initial.widthPct),
            yPct: clamp(initial.yPct + dy, 0, 100 - initial.heightPct),
          }
        : {
            ...initial,
            widthPct: clamp(initial.widthPct + dx, 5, 100 - initial.xPct),
            heightPct: clamp(initial.heightPct + dy, 3, 100 - initial.yPct),
          });
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end, { once: true });
  };

  const addBlurBox = () => {
    if (readOnly) return;
    const box: BlurBox = {
      id: `blur-${Date.now()}`,
      xPct: 35,
      yPct: 35,
      widthPct: 30,
      heightPct: 20,
      strength: 10,
    };
    commitEffects(current => ({
      ...current,
      blurEnabled: true,
      blurBoxes: [...current.blurBoxes, box],
    }));
  };

  return (
    <div className={`effects-editor ${readOnly ? 'effects-editor--readonly' : ''}`}>
      <div
        className="effects-editor__preview"
        ref={containerRef}
        style={{ aspectRatio: videoAspectRatio }}
      >
        <video
          ref={videoRef}
          className={[
            effects.flipVideoEnabled ? 'effects-editor__video--flipped' : '',
            effects.colorGrading !== 'original' ? `effects-editor__video--${effects.colorGrading}` : '',
          ].filter(Boolean).join(' ')}
          src={`/api/workspace/jobs/${encodeURIComponent(jobId)}/source`}
          preload="metadata"
          playsInline
          onPlay={() => setVideoPaused(false)}
          onPause={() => setVideoPaused(true)}
          onEnded={() => setVideoPaused(true)}
          onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}
          onLoadedMetadata={event => {
            setVideoAspectRatio(`${event.currentTarget.videoWidth} / ${event.currentTarget.videoHeight}`);
            setDuration(event.currentTarget.duration);
            updateVideoRect();
          }}
        />
        <div className="effects-editor__overlay" style={videoRect}>
          {effects.blurEnabled && effects.blurBoxes.map(box => (
            <div
              key={box.id}
              className="effects-box effects-box--blur"
              style={{
                left: `${box.xPct}%`,
                top: `${box.yPct}%`,
                width: `${box.widthPct}%`,
                height: `${box.heightPct}%`,
                backdropFilter: `blur(${box.strength}px)`,
              }}
              onPointerDown={readOnly ? undefined : event => beginDrag(event, { kind: 'blur', id: box.id }, 'move', box)}
            >
            </div>
          ))}
          {effects.burnSubtitlesEnabled && (
            <div
              className="effects-box effects-box--subtitle"
              style={{
                left: `${effects.subtitlePosition.xPct}%`,
                top: `${effects.subtitlePosition.yPct}%`,
                width: `${effects.subtitlePosition.widthPct}%`,
                height: `${effects.subtitlePosition.heightPct}%`,
              }}
              onPointerDown={readOnly ? undefined : event => beginDrag(event, { kind: 'subtitle' }, 'move', effects.subtitlePosition)}
            >
              <span>နမူနာ စာတန်း</span>
            </div>
          )}
          {!readOnly && effects.blurEnabled && effects.blurBoxes.map(box => (
            <div key={`${box.id}-handles`} className="effects-handles">
              <button
                type="button"
                aria-label="မှုန်ဝါးဧရိယာ ဖျက်မည်"
                className="effects-handle effects-handle--delete"
                style={{
                  left: `${box.xPct + box.widthPct}%`,
                  top: `${box.yPct}%`,
                }}
                onClick={event => {
                  event.stopPropagation();
                  commitEffects(current => ({
                    ...current,
                    blurBoxes: current.blurBoxes.filter(item => item.id !== box.id),
                  }));
                }}
              >
                <Trash2 />
              </button>
              <button
                type="button"
                aria-label="မှုန်ဝါးဧရိယာ အရွယ်ပြောင်းမည်"
                className="effects-handle effects-handle--resize"
                style={{
                  left: `${box.xPct + box.widthPct}%`,
                  top: `${box.yPct + box.heightPct}%`,
                }}
                onPointerDown={event => beginDrag(event, { kind: 'blur', id: box.id }, 'resize', box)}
              />
            </div>
          ))}
          {!readOnly && effects.burnSubtitlesEnabled && (
            <div className="effects-handles">
              <button
                type="button"
                aria-label="စာတန်းထိုးနေရာ အရွယ်ပြောင်းမည်"
                className="effects-handle effects-handle--resize"
                style={{
                  left: `${effects.subtitlePosition.xPct + effects.subtitlePosition.widthPct}%`,
                  top: `${effects.subtitlePosition.yPct + effects.subtitlePosition.heightPct}%`,
                }}
                onPointerDown={event => beginDrag(event, { kind: 'subtitle' }, 'resize', effects.subtitlePosition)}
              />
            </div>
          )}
        </div>
        <div className="effects-editor__media-controls">
          <button
            type="button"
            aria-label={videoPaused ? 'ဗီဒီယို ဖွင့်မည်' : 'ဗီဒီယို ခေတ္တရပ်မည်'}
            onClick={() => {
              const video = videoRef.current;
              if (!video) return;
              if (video.paused) void video.play();
              else video.pause();
            }}
          >
            {videoPaused ? <Play fill="currentColor" /> : <Pause fill="currentColor" />}
          </button>
          <span>{formatMediaTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max={duration || 0}
            step="0.01"
            value={Math.min(currentTime, duration || 0)}
            aria-label="ဗီဒီယို အချိန်နေရာ"
            onChange={event => {
              const nextTime = Number(event.target.value);
              if (videoRef.current) videoRef.current.currentTime = nextTime;
              setCurrentTime(nextTime);
            }}
          />
          <span>{formatMediaTime(duration)}</span>
        </div>
      </div>

      {/* Explicit grid rows (not flex-wrap's unpredictable wrapping) so the
          required mobile grouping is guaranteed at every width: Color
          Grading alone; Flip Video + Burn Subtitles as a two-column row;
          Subtitle Color beneath Burn Subtitles only when enabled; Blur
          Masks alone; Add Blur Box + Blur Strength stacked full-width
          beneath it. */}
      <div className="effects-editor__controls">
        <label className="effects-editor__grading effects-editor__row--full">
          <span><Sparkles size={14} />Color Grading</span>
          <select
            value={effects.colorGrading}
            disabled={readOnly}
            onChange={event => {
              const colorGrading = event.target.value as VideoEffects['colorGrading'];
              commitEffects(current => mergeVideoEffects(current, { colorGrading }));
            }}
          >
            <option value="original">Original</option>
            <option value="auto">Auto</option>
            <option value="cinematic">Cinematic</option>
            <option value="warm">Warm</option>
            <option value="cool">Cool</option>
          </select>
        </label>

        <div className="effects-editor__row effects-editor__row--two-col">
          <label className="effects-editor__toggle">
            <input
              type="checkbox"
              checked={effects.flipVideoEnabled}
              disabled={readOnly}
              onChange={event => {
                const nextEffects = mergeVideoEffects(latestEffectsRef.current, {
                  flipVideoEnabled: event.target.checked,
                });
                commitEffects(() => nextEffects);
              }}
            />
            <FlipHorizontal2 size={14} />
            Flip Video
          </label>
          <label className="effects-editor__toggle">
            <input
              type="checkbox"
              checked={effects.burnSubtitlesEnabled}
              disabled={readOnly}
              onChange={event => {
                const enabled = event.target.checked;
                commitEffects(current => mergeVideoEffects(current, { burnSubtitlesEnabled: enabled }));
              }}
            />
            Burn subtitles
          </label>
        </div>

        {effects.burnSubtitlesEnabled && (
          <div className="effects-editor__subtitle-color effects-editor__row--full" role="radiogroup" aria-label="Subtitle color">
            <span className="hint">Subtitle color</span>
            <div className="row" style={{ gap: 8 }}>
              {SUBTITLE_COLOR_SWATCHES.map(swatch => (
                <button
                  key={swatch.id}
                  type="button"
                  role="radio"
                  aria-checked={effects.subtitleColor === swatch.id}
                  aria-label={swatch.label}
                  title={swatch.label}
                  disabled={readOnly}
                  onClick={() => commitEffects(current => mergeVideoEffects(current, { subtitleColor: swatch.id }))}
                  className="effects-editor__swatch"
                  style={{
                    background: swatch.hex,
                    border: effects.subtitleColor === swatch.id ? '3px solid var(--accent, #333)' : '2px solid var(--line2, #999)',
                    cursor: readOnly ? 'default' : 'pointer',
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <label className="effects-editor__toggle effects-editor__row--full">
          <input
            type="checkbox"
            checked={effects.blurEnabled}
            disabled={readOnly}
            onChange={event => {
              const enabled = event.target.checked;
              commitEffects(current => mergeVideoEffects(current, { blurEnabled: enabled }));
            }}
          />
          Blur masks
        </label>
        {effects.blurEnabled && (
          <Button
            type="button"
            variant="secondary"
            icon={<Plus size={15} />}
            disabled={readOnly}
            onClick={addBlurBox}
            className="effects-editor__row--full"
          >
            Add blur box
          </Button>
        )}
        {effects.blurEnabled && effects.blurBoxes.map(box => (
          <label key={`${box.id}-strength`} className="effects-editor__strength effects-editor__row--full">
            Blur strength
            <input
              type="range"
              min="1"
              max="30"
              value={box.strength}
              disabled={readOnly}
              onChange={event => commitEffects(current => ({
                ...current,
                blurBoxes: current.blurBoxes.map(item =>
                  item.id === box.id ? { ...item, strength: Number(event.target.value) } : item),
              }))}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
