# AI and Media Pipeline

## Source of truth

The accepted `Sawaungthin2.0-main (11) (1).zip` workflow is the media-processing source of truth. Blink authentication, ownership, persistence, SSE, retry leases, admission, billing wrappers, authenticated delivery, and the current workspace UI wrap that workflow but do not replace its timing or output behavior.

Workflow version 3 identifies Sawaungthin-compatible checkpoints. Direct-Gemini-audio and workflow-v2 artifacts are incompatible and restart at source extraction. They are never used as transcript or timestamp authority.

## Authoritative flow

```text
Owned uploaded video
  → FFmpeg PCM WAV (mono, 16 kHz)
  → FFmpeg scene detection (threshold 0.2)
  → Faster-Whisper small/CPU transcription
      beam size 3, word timestamps, VAD,
      condition_on_previous_text=false
      (CPU threads overridable by WHISPER_CPU_THREADS, capped by
      WHISPER_CPU_THREADS_MAX, default ceiling 4)
  → Validate Whisper timestamps against the real WAV duration
  → Gemini text translation to Burmese in batches of 40
      input/output contain index and text only
      application code reattaches the original Whisper timestamps
  → ZIP TTS grouping (gap <0.75s and span <=12s;
      dialogue mode gap <3s and span <=60s)
  → Edge TTS (three workers by default, overridable by TTS_CONCURRENCY
      up to 20; three bounded attempts per chunk, 30s request timeout)
  → Normalize chunks to mono 24 kHz PCM
  → Build the authoritative TTS timeline from Edge subtitle timing,
      with the ZIP proportional fallback
  → Verify concatenated TTS duration within 0.05s
  → Merge authoritative timeline records using the ZIP 0.75s/12s rules
  → Select scene boundaries while retaining original Whisper visual windows
  → Render 1080x1920, 30fps MPEG-TS segments with crop, speed, and freeze padding
      (encoder threads overridable by FFMPEG_VIDEO_THREADS, default 2)
  → Concatenate video with TTS-only AAC audio, loudnorm, and faststart
  → Verify streams and A/V drift within 0.3s
  → Optional final speed adjustment (ADJUST_FINAL_SPEED stage; atempo/setpts
      driven by an OUTPUT_SPEED_MULTIPLIER setting; no-op when unset)
  → Generate the required MP3
  → Apply existing Blink final-effect settings
  → Require nonempty regular MP4 and MP3 artifacts before completion
  → Clean transient artifacts
```

## Stage granularity

`src/domain/workflow.js` defines 13 internal `WORKFLOW_STAGES` (`upload`,
`extract_audio`, `detect_scenes`, `transcribe_source`, `translate_burmese`,
`generate_tts`, `match_scenes`, `build_timeline`, `rebuild_scenes`,
`export_final`, `adjust_final_speed`, `cleanup`, `done`), not seven. The
seven user-facing workflow stages described in `01_PRODUCT_REQUIREMENTS.md`
(Upload, Audio & Scene Analysis, Whisper + Burmese, Voice Generation,
Timeline Verification, Scene Rebuild, Final Export) are a presentation-layer
grouping defined in `src/ui/workspace/workflowPresentation.ts` and produced
from the 13 backend stage IDs via a `CORE_STAGE_MAP` in
`src/services/workspaceWorker.js` (for example `extract_audio` +
`detect_scenes` collapse into "Audio & Scene Analysis"; `export_final` +
`adjust_final_speed` + `cleanup` collapse into "Final Export").

The second timeline-merge pass in `src/workers/sceneRebuild.js` (chronological
record mapping ahead of scene-boundary selection) always applies the ZIP
0.75s-gap/12s-span constants; unlike the earlier TTS-grouping step in
`src/ai/sawaungthinTts.js`, it does not branch on dialogue mode (3s/60s).

## Timestamp contract

Faster-Whisper owns source timestamps. The ZIP validator requires finite `[start,end]` pairs, nonnegative starts, `end > start`, starts within WAV duration, and no overlap beyond 0.05 seconds. An end that exceeds WAV duration by at most 1.5 seconds is clamped to that duration; larger overflows fail. Gemini never receives timestamp fields and cannot create or replace them.

## Checkpoints and retry

- Each core artifact includes workflow/version and source identity where applicable.
- Retry resumes at the earliest incomplete compatible v3 stage.
- Valid earlier Faster-Whisper, translation, TTS, timeline, and rendered-segment artifacts may be reused only after their schema/identity checks pass.
- A workflow-v2/direct-Gemini checkpoint is deleted from the job-scoped cache and restarted from the owned source. Its encrypted job credential is retained.
- One active workspace worker is assumed for filesystem-backed execution; worker leases and cancellation remain in the Blink shell.

## Blink adaptations

- All paths are rooted below `DATA_DIR`; no repository-local media paths are authoritative.
- Job IDs and ownership isolate uploads, caches, and outputs.
- The existing abort signal is propagated through Python, Edge TTS, and FFmpeg work.
- Gemini model/key selection and redaction remain platform responsibilities.
- MP3 generation is required by Blink although the ZIP itself only exposes MP4.
- The accepted exclusions do not restore ZIP blur, subtitle-position, font, or color customization features.

## File references

- Orchestration: `src/workers/processor.js`
- Faster-Whisper: `src/ai/fasterWhisper.js`, `src/ai/transcribe.py`
- Translation: `src/ai/geminiTranslation.js`, `src/ai/translation.js`
- TTS/timing: `src/ai/sawaungthinTts.js`, `src/ai/edgeTtsRequest.js`
- Timeline/rebuild/export rules: `src/workers/sceneRebuild.js`
- Workspace integration: `src/services/corePipelineBridge.js`, `src/services/workspaceWorker.js`
- Cleanup: `src/workers/workflowCleanup.js`
- FFmpeg lifecycle: `src/ffmpeg/index.js`

Billing gates and Core AI output behavior are independent: billing may wrap admission and settlement, but it cannot change prompts, timestamps, TTS, timeline, render, or export rules.
