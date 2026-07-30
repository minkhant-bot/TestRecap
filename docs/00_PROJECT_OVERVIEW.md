# Blink Automation — Project Overview

## Purpose

Blink Automation, whose package and repository still use the names `cinerecap-ai` and `TestRecap`, is an authenticated web application that converts an uploaded source video into a Burmese-narrated recap. It combines transcription, Burmese translation, text-to-speech, chronological scene reconstruction, final video export, and optional visual effects.

This document is the entry point for developers and AI assistants. It describes the current working tree as of 2026-07-29.

## Current Status

### Implemented

- React/Vite single-page application with a mobile-oriented workspace.
- Google sign-in through Firebase and an HTTP-only backend session cookie.
- Per-user Gemini API-key storage encrypted at rest.
- Pending-job editor and explicit Start Processing action.
- Server-enforced limit of two active workspace jobs per user.
- Durable, single-concurrency workspace queue.
- Audio extraction, Gemini audio transcription/translation, workflow-v2 TTS, timeline construction, scene rebuild, MP4/MP3 export, and final effects.
- History, authenticated preview/download, coordinated workspace/core deletion, cancellation, and restart recovery foundations.
- Coordinated 24-hour retention for completed workspace/core records and linked artifacts.
- Super-admin API/UI foundations and a credits UI placeholder; neither is complete.

### Planned or Placeholder

- The Credits page explicitly presents purchasing as “coming soon.”
- The admin shell contains placeholder navigation labels, but its operational screens are not connected to the admin APIs.
- The approved future product direction replaces mandatory BYOK with hosted credits: users purchase credits, and platform-owned AI and TTS credentials are used server-side for processing.
- Future voice support will provide a server-validated catalog, previews, and selectable voices whose availability may depend on plan, credit cost, or provider.
- These directions are not implemented and do not constitute an approved implementation plan. Database replacement and pagination also remain undefined.

### Known Issues

- The running architecture is mostly present as uncommitted or untracked work. A clean checkout of `main` does not reproduce it.
- Two job stores and two lifecycle vocabularies coexist.
- Credits, cumulative usage quotas, and request-rate limits are not enforced.
- Role mapping and deep cancellation have known defects.
- See `12_KNOWN_ISSUES.md` for the prioritized list.

## Architecture/Flow

```text
Browser
  → Firebase Google authentication
  → Backend session cookie
  → Workspace upload creates a pending job
  → User configures effects
  → Start Processing queues the job
  → WorkspaceWorker
      → extract WAV
      → Gemini audio transcript + Burmese translation
      → core workflow-v2 bridge
          → TTS
          → timeline verification
          → scene rebuild
          → canonical MP4/MP3
      → Color → Flip → Blur → Subtitle → Verify
  → History and authenticated /output download
```

The workspace layer owns user-facing state in `workspace-jobs.json`. The older core processor remains authoritative for workflow-v2 rendering and stores its state in `saas-state.json`.

## File References

- Application entry: `src/main.tsx`, `src/ui/AppFoundation.tsx`
- HTTP server: `server.js`
- API routers: `src/routes/api.js`, `src/routes/workspace.js`, `src/routes/auth.js`, `src/routes/admin.js`
- Workspace lifecycle: `src/services/workspaceJobs.js`, `src/services/workspaceWorker.js`
- Core workflow: `src/services/corePipelineBridge.js`, `src/workers/processor.js`
- Effects: `src/services/videoEffects.js`
- Authentication: `src/auth/`, `src/middleware/auth.js`, `src/services/firebaseAdmin.js`
- Deployment: `Dockerfile`, `railway.json`, `RAILWAY.md`

## Important Decisions

- Workflow version 2 is the only resumable core workflow.
- Queue concurrency is one.
- Processing starts only after upload and an explicit user action.
- The canonical result path is `/output/{jobId}.mp4`.
- Generated output is private and requires authentication and job authorization.
- Gemini keys are backend-held and encrypted; they are never returned to the UI.
- Runtime persistence must live below `DATA_DIR` in production.

## Future Work

The approved future product direction and its dependency order are recorded in `14_ROADMAP.md`. It requires durable credit accounting, platform-owned secret architecture, job settlement, payment confirmation, safe BYOK migration or removal, and then multiple-voice support. These are future roadmap items, not implemented features or approved implementation scope. Any implementation requires separate approval and must preserve workflow-v2 output behavior and the current single-voice contract until explicitly placed in scope.
