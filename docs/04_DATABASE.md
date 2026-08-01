# Persistence and Database

## Purpose

Document all current durable stores, schemas, ownership, and limitations.

## Current Status

### Implemented

- P2.1 PostgreSQL configuration, shared pool, transaction helpers, deterministic
  checksummed migrations, readiness checks, and graceful shutdown.
- The initial P2 schema and repository/service boundaries. They are scaffolded,
  not authoritative for live application domains.
- An explicitly activated PostgreSQL billing foundation for plans/policies,
  entitlements, trial assessment/grants, credit balances and immutable ledger,
  purchase catalog/banks, private screenshot metadata, manual purchase review,
  one-time first-purchase bonuses, adjustments, and financial audit reads.
- Atomic-style JSON persistence using write-to-temporary-file then rename.
- AES-GCM encryption for job and user Gemini credentials.
- Filesystem persistence for uploads, caches, transcripts, media, and outputs.
- Restart loading and recovery for workspace and core jobs.

### Controlled activation

- `0001_p2_foundation.sql` creates the approved tables, constraints, indexes,
  append-only ledger/audit triggers, retained-financial deletion guards, and
  protected bootstrap Super Admin guard.
- `0002_credit_package_management.sql` adds package bonus/note fields and a
  database trigger that forbids deleting package records, preserving purchase
  foreign keys and immutable purchase/ledger history.
- `P2_BILLING_ENABLED=true` activates only the billing APIs and requires
  `DATABASE_URL`. Billing requests synchronize the authenticated Firebase
  identity into PostgreSQL. Financial mutations require PostgreSQL
  `super_admin`; other application role checks remain Firebase-authoritative.
- Existing JSON job stores, encrypted BYOK files, and workspace/core pipeline
  stage state remain authoritative.
- `P2_LIVE_JOB_BILLING_ENABLED=true` separately enables PostgreSQL job billing
  snapshots, reservations, ledger settlement/refund, and worker leases without
  replacing the JSON lifecycle store. It is disabled by default. Global role
  cutover, proof-volume backup/restore verification, legacy backfill, and
  production activation remain pending.

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
  payment-proofs/{ownerUuid}/{yyyy}/{mm}/{opaqueFileId}.{jpg|png|webp}
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
- Private payment-proof storage: `src/services/paymentProofStorage.js`

## Important Decisions

- PostgreSQL is opt-in when `DATABASE_URL` is present. `DATABASE_REQUIRED=true`
  makes missing/invalid configuration and failed readiness blocking.
- Production startup applies configured migrations after HTTP bind and before
  workspace processing starts. Local/manual operation remains available with
  `npm run db:migrate`. Applied checksums are immutable, concurrent startup is
  advisory-locked, and there is no ordinary rollback command.
- JSON/file persistence remains authoritative until an explicitly tested domain
  cutover. The billing domain fails closed when disabled or unavailable and has
  no JSON dual-write or silent fallback.

- Persistent files use schema version 1.
- Corrupt or incompatible stores fail during module loading rather than being silently replaced.
- Sensitive credential files are created with mode `0600` where implemented.
- Only one process/replica may safely write these files.
- Internal filesystem paths are not returned in public workspace job objects.
- Workspace deletion validates both ownership domains and linked paths, revokes the core record/credentials, deletes linked artifacts, and then removes the workspace record.
- The 24-hour sweep removes linked terminal workspace/core records and artifacts together; it also discovers expired orphan workspace records.

## Future Work

The following remain incomplete or gated after the P2.1–P2.3 implementation:

- Keep Firebase as identity authority while PostgreSQL becomes authoritative for roles and permissions.
- Keep roles separate from Trial/Normal/Pro plan assignments and entitlements.
- Production-enable immutable job pricing/entitlement snapshots and transactionally linked reservations only after isolated verification.
- Complete global role/authority cutover for users, roles, settings, and audit; billing-domain PostgreSQL authority is already gated.
- Verify synchronized PostgreSQL/proof-volume backup and restore, integrity
  reconciliation, retention, and recovery procedures.
