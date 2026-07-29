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
- Durable, single-concurrency workspace queue.
- Audio extraction, Gemini audio transcription/translation, workflow-v2 TTS, timeline construction, scene rebuild, MP4/MP3 export, and final effects.
- History, authenticated preview/download, cancellation, deletion, and restart recovery foundations.
- Super-admin API/UI foundations and a credits UI placeholder; neither is complete.

### Planned or Placeholder

- The Credits page explicitly presents purchasing as “coming soon.”
- The admin shell contains placeholder navigation labels, but its operational screens are not connected to the admin APIs.
- No approved implementation plan for credits, database replacement, pagination, quotas, or rate limiting is recorded in the repository.

### Known Issues

- The running architecture is mostly present as uncommitted or untracked work. A clean checkout of `main` does not reproduce it.
- Two job stores and two lifecycle vocabularies coexist.
- Credits and server-side quotas are not enforced.
- Role mapping, coordinated deletion, retention, and deep cancellation have known defects.
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

Unapproved architectural recommendations are recorded in `12_KNOWN_ISSUES.md` and `14_ROADMAP.md`. The highest-risk recommendations are to establish a reproducible tracked baseline, add server-side resource controls, and remove ordinary-user access to global pipeline settings. Any implementation requires separate approval and should preserve workflow-v2 output behavior unless that behavior is explicitly placed in scope.
