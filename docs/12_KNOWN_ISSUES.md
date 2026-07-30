# Known Issues

## Purpose

Provide the current prioritized technical and production-risk register. Priorities reflect impact, not implementation order alone.

## Current Status

### Implemented

This document reflects the read-only repository audit completed 2026-07-29. It does not mean the listed issues have been fixed.

### Planned or Placeholder

Recommended remediation fixes require explicit approval and separate implementation tasks. Hosted credits and multiple selectable voices are approved future product direction, but their implementation contracts and tasks are not yet approved.

### Known Issues

#### P0 — Critical

1. **Working architecture is not reproducible from Git.** Essential workspace, auth, services, UI, and scripts are untracked; many tracked files are modified.
2. ~~**No cumulative usage quota or request-rate enforcement.**~~ Implemented in the current working tree as durable, configurable per-user rolling admission. It remains single-replica JSON storage rather than a distributed backend.

#### P1 — High

1. Cancellation does not propagate through core workflow-v2 and final effects.
2. ~~Role mapping ignores custom claims and uses one hard-coded super-admin email.~~ Replaced by validated Firebase custom claims and configured UID bootstrap.
3. ~~Admin mutation rules allow unsafe future privilege elevation if roles are repaired without hierarchy.~~ Replaced by serialized server-side hierarchy and lockout protections.
4. ~~Production dependency audit reports high and moderate advisories without disposition.~~ The audit still reports two high and eight moderate entries, but `ws` is remediated and every remaining entry has documented reachability evidence, beta risk acceptance, and re-review triggers in `09_SECURITY.md`.
5. Completed MP4s are loaded completely into browser memory.
6. FFmpeg stderr retention is unbounded; not all child processes share timeout/abort handling.
7. Fatal process errors log but may leave the process serving in an unknown state.

#### P2 — Medium

1. Two job stores, status vocabularies, and queues coexist.
2. JSON stores synchronously rewrite all state during progress.
3. Admin UI is not connected to admin APIs.
4. Credits are visual placeholders only; the approved hosted-credit direction still lacks durable balance, immutable ledger, reservation, charging, settlement, payment, adjustment, and BYOK migration implementation.
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
  → coordinated deletion/retention must span both records
```

Repository state risk is independent of runtime behavior: the working application can be lost or omitted before any runtime issue is addressed.

## File References

- Repository state: `git status`, current working tree
- Admission: `src/routes/workspace.js`
- Global settings: `src/routes/api.js`, `src/services/settings.js`
- Dual lifecycle: `src/services/workspaceJobs.js`, `src/services/jobManager.js`
- Deletion/retention: `src/services/workspaceJobDeletion.js`, `src/services/completedOutputDeletion.js`, `src/services/cleanup.js`
- Cancellation: `src/services/workspaceWorker.js`, `src/services/corePipelineBridge.js`
- Roles: `src/services/firebaseAdmin.js`, `src/routes/admin.js`
- Media client: `src/ui/pages/ProcessingPage.tsx`

## Important Decisions

- Do not treat a mocked test as proof of final media correctness.
- Do not consolidate or delete legacy code until its bridge/consumer role is established.
- Do not implement credits, billing, BYOK migration/removal, role changes, or destructive cleanup without approved contracts.
- Do not add selectable voices by exposing arbitrary TTS parameters; preserve the current single-voice behavior until a server-validated catalog, preview, eligibility, and pricing contract is approved and implemented.
- P0 issues should precede feature expansion.

## Future Work

Address issues in priority order with one approved scope at a time. For the approved hosted product direction, follow the dependency order in `14_ROADMAP.md` and treat missing accounting or settlement guarantees as blockers to payment and BYOK migration. Each implementation should add regression coverage and update `13_CHANGELOG.md` and any affected architecture/API documents.
