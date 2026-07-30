# Persistence and Database

## Purpose

Document all current durable stores, schemas, ownership, and limitations. The project does not currently use a relational database.

## Current Status

### Implemented

- Atomic-style JSON persistence using write-to-temporary-file then rename.
- AES-GCM encryption for job and user Gemini credentials.
- Filesystem persistence for uploads, caches, transcripts, media, and outputs.
- Restart loading and recovery for workspace and core jobs.

### Planned or Placeholder

- No database replacement or migration is approved or represented as an implementation placeholder.
- SQLite or another transactional store, migrations, backups, pagination, locking, a credits ledger, and durable auditing are recommendations only.

### Known Issues

- Two independent job records describe the same processing job.
- Every progress update synchronously rewrites the complete relevant store.
- No transaction spans workspace state, core state, files, and credentials.

## Architecture/Flow

### `workspace-jobs.json`

Schema version 1. Stores user-facing jobs:

- Identity/owner: `id`, `ownerUid`
- Source metadata: `filename`, `fileSize`, `duration`, `storedPath`
- Lifecycle: `status`, `stage`, `progress`, timestamps, `workerId`
- Recovery/cancellation: `recoveryCount`, `cancellationRequested`
- Intermediate artifacts: audio/transcript paths and metadata
- Results: `videoUrl`, `audioUrl`
- Normalized effects object
- Failure diagnostic internally; the public serializer omits it

### `saas-state.json`

Schema version 1. Stores workflow-v2 core jobs and encrypted per-job credentials:

- Core lifecycle uses `queued`, `processing`, `complete`, `error`, `cancelled`.
- Internal stage uses workflow-v2 `stageId`.
- `result` is serialized as JSON and includes transcripts, timeline, media URLs, and metadata.
- A bridged workspace job uses the same ID in this store.

### Credential stores

- `user-gemini-credentials.json`: encrypted Gemini key per Firebase UID.
- `saas-state.json.credentials`: encrypted job-scoped Gemini key.
- `encryption.key`: shared 32-byte local key used by these AES-GCM stores.

### Other stores

- `auth-users.json`: local profile snapshot written on sign-in.
- Global legacy settings are currently held only in memory by `settings.js`.
- Audit events are in memory only.

### Storage layout

With `DATA_DIR`:

```text
DATA_DIR/
  workspace-jobs.json
  saas-state.json
  auth-users.json
  user-gemini-credentials.json
  encryption.key
  uploads/
  cache/{jobId}/
  output/{jobId}.mp4
  output/{jobId}.mp3
```

Without `DATA_DIR`, local paths are repository-relative under `src/tmp`, `data/cache`, `public/output`, and `data`.

## File References

- Workspace persistence: `src/services/workspaceJobs.js`
- Core persistence and encryption: `src/services/jobManager.js`
- User Gemini credentials: `src/services/userGeminiKeys.js`
- Auth profile snapshot: `src/services/authUserStore.js`
- Legacy settings: `src/services/settings.js`
- Runtime paths: `src/config/runtime.js`

## Important Decisions

- Persistent files use schema version 1.
- Corrupt or incompatible stores fail during module loading rather than being silently replaced.
- Sensitive credential files are created with mode `0600` where implemented.
- Only one process/replica may safely write these files.
- Internal filesystem paths are not returned in public workspace job objects.
- Workspace deletion validates both ownership domains and linked paths, revokes the core record/credentials, deletes linked artifacts, and then removes the workspace record.
- The 24-hour sweep removes linked terminal workspace/core records and artifacts together; it also discovers expired orphan workspace records.

## Future Work

The following are unapproved persistence recommendations:

- Select one canonical job schema.
- Move lifecycle, users, audit events, and future credits into transactions.
- Add migration, backup, integrity-check, configurable-retention, and recovery procedures.
