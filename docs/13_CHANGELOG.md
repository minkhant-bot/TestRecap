# Changelog

## Purpose

Record verified project evolution and documentation changes. This is not a substitute for Git history.

## Current Status

### Implemented

The committed Git history contains eight commits through `b70e294`. The current workspace/auth/effects architecture is newer working-tree work and is not committed.

### Planned or Placeholder

Future entries should be added only when behavior actually changes. Unapproved remediation proposals belong in `14_ROADMAP.md`, not in the implemented changelog.

### Known Issues

- There are no version tags or formal releases.
- Much current functionality cannot be tied to a commit because it is uncommitted/untracked.

## Architecture/Flow

### Committed history

- `a535021` — Initial commit.
- `d9ec9b8` — Added Docker and deployment configuration.
- `3f4fca1` — Installed Vite development dependencies during Docker build.
- `96f28a5` — Corrected TTS timeline alignment.
- `40352b9` — Prepared workflow-v2 for Railway.
- `483028a` — Resolved Railway PyAV dependency conflict.
- `8ae5864` — Added missing Python `requests` dependency.
- `b70e294` — Limited FFmpeg encoder threads to avoid Railway SIGKILL.

### Current uncommitted implementation

The working tree currently adds or changes:

- Firebase Google authentication and session-cookie backend.
- Workspace UI and job lifecycle.
- Per-user Gemini key storage.
- Gemini direct-audio transcript service.
- Core workflow bridge.
- Final effects editor and processor.
- Workspace SSE, History, cancellation, and restart recovery.
- Admin API/UI foundations and a credits UI placeholder.
- Scoped development watcher and structured diagnostics.

### Documentation entry

- **2026-07-29 — Documentation only:** Added the `/docs` current-state project documentation set. No application code changed.

## File References

- Git history: repository commit log.
- Current state: current `git status`.
- Workflow version history: `src/domain/workflow.js`
- Deployment history context: `Dockerfile`, `RAILWAY.md`
- This documentation set: `docs/`

## Important Decisions

- “Implemented” means observable in the current working tree, even when not committed.
- A changelog entry must not claim deployment or production validation without evidence.
- Known defects belong in Known Issues rather than being omitted from feature entries.

## Future Work

- Establish a reviewed baseline commit only after user approval.
- Introduce release identifiers/tags when deployment practices require them.
- Update this file alongside approved behavior changes.
