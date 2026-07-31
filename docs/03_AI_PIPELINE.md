# AI and Media Pipeline

## Purpose

Describe the current recap-generation sequence, external AI services, artifacts, validation, and effect order.

## Current Status

### Implemented

- WAV extraction from the uploaded video.
- Direct Gemini audio upload for structured original-language transcription plus Burmese translation.
- Model discovery and selection of stable Gemini Flash models.
- Edge TTS generation with grouping, retry, timing metadata, and duration fitting.
- Chronological mapping to detected scenes.
- Workflow-v2 scene reconstruction and MP4/MP3 export.
- Optional Color, Flip, Blur, and burned Subtitle processing.
- Media duration and stream validation.

### Planned or Placeholder

- No additional AI features are defined by the current implementation.
- Pipeline changes require explicit product approval because output timing and quality are tightly coupled.

### Known Issues

- Cancellation is not propagated through all core and final-effect FFmpeg work.
- Each enabled final effect performs a separate H.264 encode.
- An older Faster-Whisper transcription plus Gemini text-translation path remains because workflow-v2 still contains legacy-compatible paths, while the workspace path supplies a Gemini audio transcript.

## Architecture/Flow

```text
Uploaded source
  → FFmpeg PCM WAV, mono, 16 kHz
  → Validate RIFF/WAVE, audio stream, duration
  → Upload WAV to Gemini Files API
  → Wait for ACTIVE
  → Structured transcript:
      start_time, end_time, original_text, burmese_text, type, speaker
  → Delete remote Gemini file
  → Prepare workflow-v2 state and scene boundaries
  → Group Burmese narration
  → Edge TTS with timing sidecars and duration fitting
  → Verify authoritative TTS timeline
  → Map narration chronologically to source scenes
  → Render scene segments
  → Concatenate video + narration audio
  → Validate canonical MP4 and export MP3
  → Optional final effects:
      Color Grading
      → horizontal Flip
      → Blur
      → unmirrored Subtitle
      → Verify Output
```

### Gemini transcript rules

- The response must be structured JSON matching the configured schema.
- Timestamps must be finite, ordered, non-overlapping, positive, and within real audio duration.
- Empty transcript content is rejected.
- The remote file is deleted in `finally`.
- Timeout defaults to `GEMINI_TRANSCRIPT_TIMEOUT_MS` or 120 seconds.

### Core workflow-v2 stages

Upload, extract audio, detect scenes, transcribe source, translate Burmese, generate TTS, match scenes, build timeline, rebuild scenes, export final, optional speed adjustment, cleanup, done.

The workspace path begins the core bridge at `generate_tts` because its Gemini artifact already contains original and Burmese segments.

### Effects behavior

- `original`: no color FFmpeg pass.
- Flip disabled: no `hflip`.
- Blur disabled or no boxes: no blur setup/probe/FFmpeg.
- Subtitle disabled: no SRT read, ASS creation, font handling, or subtitle FFmpeg.
- Blur and Subtitle consume the previous effect’s output.
- Subtitle is applied after Flip so text is readable.

## File References

- Workspace extraction: `src/services/audioExtraction.js`
- Gemini transcript: `src/services/geminiAudioTranscript.js`
- Model selection: `src/ai/geminiModelSelection.js`
- TTS and timing: `src/ai/index.js`, `src/ai/edgeTtsRequest.js`, `src/ai/durationFit.js`
- Faster-Whisper: `src/ai/fasterWhisper.js`, `src/ai/transcribe.py`
- Timeline and scene rebuild: `src/workers/sceneRebuild.js`
- Core orchestration: `src/workers/processor.js`
- Effects: `src/services/videoEffects.js`
- FFmpeg lifecycle: `src/ffmpeg/index.js`

## Important Decisions

- Workflow version is fixed at 2 for resumability.
- AI artifacts are fingerprinted or versioned before cache reuse.
- Source chronology and authoritative TTS timing are preserved.
- Final output uses H.264 video and AAC audio; MP3 is also produced.
- Approved P2 billing remains outside this pipeline. It reserves before paid admission and settles only after this pipeline and existing output validation deliver a valid usable artifact; billing must not alter prompts, stages, TTS, timing, FFmpeg, or export quality.
- Final effects modify the canonical MP4 path in place.
- Gemini transcript temperature is zero.
- The workspace worker propagates one abort signal through the bridged core pipeline, Gemini translation, Edge TTS, FFmpeg work, and final effects.
- An abort becomes `cancelled` only when the persisted workspace job has an explicit user cancellation request; shutdown interruption requeues the same job ID.

## Future Work

- Make FFprobe metadata probes directly interruptible; current cancellation is checked before and after probes.
- Bound FFmpeg stderr memory.
- Consider a single composed effects graph only after correctness tests protect ordering, coordinates, timing, and subtitles.
