# Known Issues

## Purpose

Provide the current prioritized technical and production-risk register. Priorities reflect impact, not implementation order alone.

## Current Status

### Implemented

This document reflects the read-only repository audit completed 2026-07-29. It does not mean the listed issues have been fixed.

### Planned or Placeholder

Recommended fixes require explicit approval and separate implementation tasks.

### Known Issues

#### P0 — Critical

1. **Working architecture is not reproducible from Git.** Essential workspace, auth, services, UI, and scripts are untracked; many tracked files are modified.
2. **No server-side quota or credits enforcement.** Authenticated users can bypass frontend limits and consume upload storage, Gemini, TTS, and FFmpeg resources.
3. **Ordinary users can mutate global legacy settings.** `/api/settings` is authenticated but not admin-restricted or user-scoped.

#### P1 — High

1. Workspace deletion leaves the core job, cache, output, and downloadable record.
2. The legacy 24-hour cleanup can remove output while workspace History remains Completed.
3. Cancellation does not propagate through core workflow-v2 and final effects.
4. Role mapping ignores custom claims and uses one hard-coded super-admin email.
5. Admin mutation rules allow unsafe future privilege elevation if roles are repaired without hierarchy.
6. Production dependency audit reports high and moderate advisories.
7. Completed MP4s are loaded completely into browser memory.
8. FFmpeg stderr retention is unbounded; not all child processes share timeout/abort handling.
9. Fatal process errors log but may leave the process serving in an unknown state.

#### P2 — Medium

1. Two job stores, status vocabularies, and queues coexist.
2. JSON stores synchronously rewrite all state during progress.
3. Admin UI is not connected to admin APIs.
4. Credits are visual placeholders only.
5. Audit events are in-memory and incomplete.
6. History reloads all jobs every three seconds.
7. Each final effect performs a separate full H.264 encode.
8. Inactive frontend and legacy compatibility APIs remain.
9. Unused dependencies and obsolete scripts/artifacts remain.
10. Documentation historically contradicted Google-only authentication and role bootstrap.
11. No single automated test command exists.

#### P3 — Low

1. Dead exports/components remain.
2. Naming differs across architecture generations.
3. Development request logging includes every Vite asset.

## Architecture/Flow

The most consequential dependency chain is:

```text
Unrestricted API admission
  → persistent JSON job
  → expensive single worker
  → bridged core job
  → output owned by core record
  → workspace History owned by separate record
  → deletion/retention divergence
```

Repository state risk is independent of runtime behavior: the working application can be lost or omitted before any runtime issue is addressed.

## File References

- Repository state: `git status`, current working tree
- Admission: `src/routes/workspace.js`
- Global settings: `src/routes/api.js`, `src/services/settings.js`
- Dual lifecycle: `src/services/workspaceJobs.js`, `src/services/jobManager.js`
- Deletion/retention: `src/services/workspaceJobs.js`, `src/services/cleanup.js`
- Cancellation: `src/services/workspaceWorker.js`, `src/services/corePipelineBridge.js`
- Roles: `src/services/firebaseAdmin.js`, `src/routes/admin.js`
- Media client: `src/ui/pages/ProcessingPage.tsx`

## Important Decisions

- Do not treat a mocked test as proof of final media correctness.
- Do not consolidate or delete legacy code until its bridge/consumer role is established.
- Do not implement credits, billing, role changes, or destructive cleanup without approved contracts.
- P0 issues should precede feature expansion.

## Future Work

Address issues in priority order with one approved scope at a time. Each fix should add regression coverage and update `13_CHANGELOG.md` and any affected architecture/API documents.
