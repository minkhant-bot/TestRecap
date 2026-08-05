# System Architecture

## Purpose

Explain the current runtime components and ownership boundaries without requiring source inspection.

## Current Status

### Implemented

- One Node/Express process serves APIs, protected output, and either Vite middleware or the production SPA.
- One React client uses same-origin APIs.
- One workspace worker and one legacy `p-queue` instance exist in the same process.
- JSON files provide durable local persistence.
- Python Faster-Whisper and FFmpeg run as child processes.
- Google Gemini and Edge TTS are external services.

### Planned or Placeholder

- Managed PostgreSQL is implemented as the opt-in authority for the billing API
  domain. Operational jobs remain JSON-authoritative. Private payment proofs use
  an authenticated single-replica adapter below the persistent `DATA_DIR`.
- The complete P2 target architecture is `17_P2_FOUNDATION_ARCHITECTURE.md`.

### Known Issues

- Workspace and core lifecycle ownership is split.
- JSON persistence has no cross-process locking.
- Only one Railway replica is safe.
- Some legacy APIs and inactive frontend code remain.

## Architecture/Flow

```text
React SPA
  │
  ├── /api/auth/* ───── Firebase Admin
  ├── /api/workspace/* ─ Workspace job store + WorkspaceWorker
  ├── /api/admin/* ───── Admin foundation
  ├── legacy /api/* ──── Core job store + p-queue
  └── /output/* ──────── Authenticated filesystem delivery

WorkspaceWorker
  ├── corePipelineBridge
  │     └── processRecapPipeline (Sawaungthin workflow-v3)
  │           ├── Faster-Whisper timestamp authority
  │           ├── Gemini Burmese translation only
  │           └── TTS/timeline/rebuild/MP4+MP3 export
  ├── videoEffects
  └── liveJobBilling (only when P2_LIVE_JOB_BILLING_ENABLED)
        lease acquire/heartbeat/release, paid-provider-start marker,
        settle/release/mark-review-required on completion/cancel/failure
```

When the separately gated live-job billing integration is active, each
`WorkspaceWorker` tick interleaves PostgreSQL worker-lease and
reserve/settle/release calls around pipeline execution; when it is inactive
(the default), the worker runs exactly as shown without that dependency.

```text
Persistent DATA_DIR
  ├── admission-state.json
  ├── workspace-jobs.json
  ├── saas-state.json
  ├── user-gemini-credentials.json
  ├── encryption.key
  ├── auth-users.json
  ├── uploads/
  ├── cache/
  └── output/
```

### Runtime startup

1. Resolve and create storage paths.
2. Recover stuck core jobs.
3. Restore the core queue.
4. Reconcile rolling processing-start usage from durable core and workspace jobs.
5. Start and recover the workspace worker.
6. Start the 24-hour coordinated workspace/core retention sweep.
7. Mount Vite middleware in development or serve `dist` in production.
8. Listen on the configured host/port.

### Development restart model

`scripts/dev-server.mjs` launches `server.js` and watches backend source directories selected by `scripts/dev-watch-policy.mjs`. Runtime uploads, outputs, data, caches, logs, and build products are outside the restart set.

## File References

- Server composition: `server.js`
- Runtime paths: `src/config/runtime.js`
- Development watcher: `scripts/dev-server.mjs`, `scripts/dev-watch-policy.mjs`
- Workspace store/worker: `src/services/workspaceJobs.js`, `src/services/workspaceWorker.js`
- Core store/queue: `src/services/jobManager.js`, `src/services/queue.js`
- Admission policy/store: `src/config/admission.js`, `src/services/admissionControl.js`
- Bridge: `src/services/corePipelineBridge.js`
- Core processor: `src/workers/processor.js`

## Important Decisions

- One process and one replica are assumed.
- The workspace job ID is reused as the core job ID.
- The accepted Sawaungthin ZIP pipeline is the authoritative workflow-v3 media engine.
- Filesystem paths are rooted beneath a configured storage root.
- JSON writes generally use temporary-file plus rename semantics.
- Admission state is durable and single-writer; policy is user-scoped and independent of billing.
- P2 billing wraps job admission and completion outside the Core AI Pipeline: reserve before paid processing and settle only after the existing valid-output milestone.

## Future Work

The following remain implementation or activation work:

- Consolidate the two job aggregates and queues.
- Verify and activate the approved PostgreSQL schema/transactions in an isolated
  environment; add private object storage, backup/restore, reconciliation, and
  production authority cutover from `17_P2_FOUNDATION_ARCHITECTURE.md`.
- Consolidate lifecycle ownership further; explicit workspace cancellation is propagated through the bridged core workflow, but workspace and core records remain separate.
- Separate web and media-worker processes only after durable coordination exists.
