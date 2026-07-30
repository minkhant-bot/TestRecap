# Product Requirements

## Purpose

Define the behavior the current product actually implements, while separating placeholders and known gaps from working requirements.

## Current Status

### Implemented

- A signed-in user can store and verify a Gemini API key.
- A user can upload one supported video up to the configured size limit.
- Upload creates a pending project; processing does not start automatically.
- The user can preview and configure Color Grading, Flip Video, Blur masks, and burned subtitles before starting.
- Start Processing submits the complete effects object and queues the same job.
- The UI reports seven user-facing workflow stages: Upload, Audio Extraction, Gemini Transcript, Voice Generation, Timeline Verification, Scene Rebuild, and Final Export.
- Completed recaps appear in History and can be previewed or downloaded.
- Pending, queued, processing, completed, failed, and cancelled states are displayed.
- A user can explicitly cancel an active workspace job and delete a non-active workspace record together with its linked core record, credentials, source, cache, and canonical outputs.
- The backend permits at most two `pending`, `queued`, or `processing` workspace jobs per user.
- Completed workspace/core records and linked artifacts expire together after the existing 24-hour retention window.

### Planned or Placeholder

- The Credits page explicitly marks purchasing as “coming soon.”
- The admin shell exposes placeholder destinations for operational screens that are not implemented.
- No approved requirements for credit-based admission, billing, support, or durable notifications are recorded in the repository.

### Known Issues

- Cancellation does not interrupt every deep pipeline operation.
- Admin and credit behavior is incomplete.

## Architecture/Flow

### Primary user journey

1. Sign in with a Google account.
2. Add a Gemini API key if none is stored.
3. Select exactly one video.
4. Wait for upload and pending-job creation.
5. Configure optional effects in the pending editor.
6. Press Start Processing.
7. Observe live SSE progress with polling fallback.
8. Preview or download the completed recap from History.

### Supported upload contract

- Extensions: MP4, MKV, MOV, AVI, WEBM.
- Maximum size: configured by positive `MAX_UPLOAD_SIZE_MB`; the workspace upload endpoint fails closed if configuration is invalid.
- Client and server both check extension and size.
- Server additionally checks a video-like MIME type, but does not deeply validate the container until media processing.

### Effects contract

```json
{
  "colorGrading": "original | auto | cinematic | warm | cool",
  "flipVideoEnabled": false,
  "blurEnabled": false,
  "blurBoxes": [],
  "burnSubtitlesEnabled": false,
  "subtitlePosition": {
    "xPct": 10,
    "yPct": 78,
    "widthPct": 80,
    "heightPct": 12
  }
}
```

## File References

- New recap journey: `src/ui/pages/NewRecapPage.tsx`
- Upload behavior: `src/ui/pages/UploadPage.tsx`
- Processing presentation: `src/ui/pages/ProcessingPage.tsx`
- Effects editor: `src/ui/workspace/VideoEffectsEditor.tsx`
- History: `src/ui/pages/HistoryPage.tsx`
- Product types: `src/ui/workspace/types.ts`
- Upload configuration: `src/config/upload.js`

## Important Decisions

- The normal user’s home is New Recap; super-admin currently lands on Dashboard.
- Upload and processing are separate actions.
- Effects become read-only after the job leaves `pending`.
- Processing is FIFO and single-concurrency.
- User-facing stages intentionally aggregate many internal workflow-v2 stages.
- Gemini BYOK is a product prerequisite for recap creation.

## Future Work

The following are unapproved requirements recommendations derived from current gaps:

- Define measurable product limits and enforce them server-side.
- Confirm the existing 24-hour retention expectation as an explicit product policy before changing it.
- Decide whether failed jobs are retryable in the workspace product.
- Specify credits only after ledger semantics and failure compensation are approved.
