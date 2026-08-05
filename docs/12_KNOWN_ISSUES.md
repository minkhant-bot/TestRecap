# Known Issues

> Launch verification also requires a real near-15-minute E2E and isolated
> native PostgreSQL. Blink's 15:00 safety limit is enforced before queueing,
> processing, or credit reservation, but real near-limit support is unverified.

## Purpose

Provide the current prioritized technical and production-risk register. Priorities reflect impact, not implementation order alone.

## Current Status

### Implemented

This document reflects the repository audit and subsequent verification status
through 2026-07-31. It does not mean every confirmed issue has been fixed or
every implemented path has been production-validated.

### Planned or Placeholder

Recommended remediation fixes require explicit approval and separate
implementation tasks. The P2.1 infrastructure, P2.2 billing foundation, and
P2.3 live-job reservation/settlement/recovery implementation exist but are
disabled by default. Object-storage integration, global role cutover,
production activation, and multiple selectable voices remain future scope.

### Known Issues

The numbered priority lists below are confirmed defects or gaps. Pending
verification is tracked separately and must not be described as a known failure.

#### P0 — Critical

1. ~~**Working architecture is not reproducible from Git.**~~ Resolved by the reviewed `blink-baseline` commit; push, merge, and deployment remain separate approvals.
2. ~~**No cumulative usage quota or request-rate enforcement.**~~ Implemented in the current working tree as durable, configurable per-user rolling admission. It remains single-replica JSON storage rather than a distributed backend.

#### P1 — High

1. Direct interruption of FFprobe metadata probes remains incomplete;
   cancellation is checked before and after those probes.
2. ~~Role mapping ignores custom claims and uses one hard-coded super-admin email.~~ Replaced by validated Firebase custom claims and configured UID bootstrap.
3. ~~Admin mutation rules allow unsafe future privilege elevation if roles are repaired without hierarchy.~~ Replaced by serialized server-side hierarchy and lockout protections.
4. ~~Production dependency audit reports high and moderate advisories without disposition.~~ The audit still reports two high and eight moderate entries, but `ws` is remediated and every remaining entry has documented reachability evidence, beta risk acceptance, and re-review triggers in `09_SECURITY.md`.
5. Completed MP4s are loaded completely into browser memory.
6. FFmpeg stderr retention is unbounded; not all child processes share timeout/abort handling.
7. Fatal process errors log but may leave the process serving in an unknown state.

### P1 verification status

P1 core functionality is implemented and a real 30-second end-to-end flow has
passed from upload through processing, final output, preview, and download.
Valid output enforcement and the authoritative `videoUrl` contract are verified
for that tested flow. P1 is functionally complete for the verified short-video
flow, but is not yet fully production-validated. Long-duration and reliability
verification remains pending because the available Gemini key/quota limited the
latest real E2E test to 30 seconds.

This real-E2E result predates the Sawaungthin workflow-v3 restoration (the
prior Gemini direct-audio-transcript hybrid path has since been removed;
Faster-Whisper now owns transcript timestamps and Gemini performs Burmese
text-only translation). It does not verify the restored v3 pipeline. A real
media end-to-end run of workflow-v3 was intentionally not completed and
remains unverified as of 2026-08-04; automated/unit coverage (269 total, 265
passed, 0 failed, 4 skipped) plus TypeScript, build, and `git diff --check`
passed, but blur, subtitle position, flip, subtitle rendering, and MP3/MP4
output correctness are not confirmed against real generated artifacts for
workflow-v3.

#### Pending verification — not confirmed defects

- Longer source videos.
- Long-running timeline behavior.
- Long-running final export behavior.
- Gemini quota and provider-error paths.
- Retry/resume behavior.
- Restart/recovery behavior.
- Memory usage under longer jobs.
- Storage usage under longer jobs.
- Performance under longer jobs.

None of these items was shown to fail by the latest 30-second E2E test. The
current documentation contains no newly reproduced resume/checkpoint failure
from that test cycle; retry/resume and restart/recovery remain unverified in
this real-E2E scope.

#### P2 — Medium

1. Two job stores, status vocabularies, and queues coexist.
2. JSON stores synchronously rewrite all state during progress.
3. Admin and Credits production screens are connected to the existing APIs;
   authenticated staging behavior remains unverified.
4. PostgreSQL plans, Trial grants,
   purchase review, immutable ledger/balance, bonus, adjustments, estimates,
   live reservations, settlement/release/refund, and worker recovery exist
   behind separate explicit gates; the UI, commercial configuration,
   production activation and operational reconciliation remain incomplete. A
   private single-replica `DATA_DIR` payment-proof adapter and authenticated
   preview are implemented but not yet Railway volume/backup verified.
5. Audit events are in-memory and incomplete.
6. History reloads all jobs every three seconds.
7. Each final effect performs a separate full H.264 encode.
8. Inactive frontend and legacy compatibility APIs remain.
9. Unused dependencies and obsolete scripts/artifacts remain.
10. Documentation historically contradicted Google-only authentication and role bootstrap.
11. No single `npm test` command exists; the repository uses `node --test`.

12. PostgreSQL integration coverage requires an isolated
    `TEST_DATABASE_URL`; it is not production migration, backup/restore, or
    staging verification.

13. The three native PostgreSQL integration suites passed using an isolated
    `TEST_DATABASE_URL`, including restart-persistence coverage. This does not
    replace production migration, backup/restore, or staging verification.
    Ban/unban persistence is not implemented; planned Super Admin ban/unban and
    operational credit reversal flows remain pending.
14. Workflow-v2 job checkpoints are incompatible with the restored Sawaungthin
    workflow-v3 pipeline. Any in-flight or resumable job recorded under v2 is
    discarded and restarted from source rather than resumed; there is no
    migration path that preserves v2 progress.
15. **Confirmed real implementation gap (investigated 2026-08-05), not a
    documentation-only issue or an intentional/documented limitation:**
    `listRecoverableLiveJobIds` in `src/services/liveJobBilling.js:286-287`
    (backed by `listRecoverableBillingJobs` in `src/db/repositories/jobs.js:95-103`,
    which selects `jobs` rows where `billing_status IN
    ('reserved','settled','review_required')` and `status IN
    ('queued','processing','failed','cancelled')`) is exported and covered by
    a real assertion in `liveJobBilling.postgres.integration.test.js:147`
    (confirming the underlying query itself works), but no startup path,
    scheduled sweep, or any other production code calls it — confirmed by
    grepping `server.js`, `cleanup.js`, and every script for its name or its
    repository function.

    The only automatic restart reconciliation that exists is inside
    `WorkspaceWorker.start()` (`src/services/workspaceWorker.js:115-146`),
    and it only (a) considers jobs that `recoverWorkspaceJobs()` found stuck
    in the JSON store's `processing` status, and (b) among those, only
    reconciles the ones whose `billing.billingStatus === 'settled'`. A job
    whose Postgres reservation is still `reserved` (not yet `settled`) is not
    specially reconciled — it is implicitly retried through the ordinary
    JSON-requeue-and-reprocess path, which works correctly for a **graceful**
    shutdown/restart. However, `WorkspaceWorker.tick()`
    (`workspaceWorker.js:272-323`) writes the JSON terminal status
    (`completed`/`failed`) and calls the Postgres `settle`/`fail` billing
    call as two separate, non-transactional steps. If the process is killed
    (crash, OOM, `SIGKILL`) in the narrow window between the JSON write and
    the Postgres call, the JSON store ends up in a terminal state
    (`failed`/`cancelled`, which `recoverWorkspaceJobs()` never revisits)
    while the Postgres reservation is permanently stuck `reserved` (money
    reserved, never released or settled) with no automatic process to notice
    or fix it — exactly the scenario `listRecoverableBillingJobs`'s query is
    shaped to find. This crash-consistency gap is consistent with, and a
    concrete instance of, the already-documented "No transaction spans
    workspace state, core state, files, and credentials" issue in
    `04_DATABASE.md`. It only matters once `P2_LIVE_JOB_BILLING_ENABLED=true`,
    which remains off by default, and is tracked as pending work under P2.9
    in `17_P2_FOUNDATION_ARCHITECTURE.md` ("Worker lease/reconciliation").

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
- Media client: `src/ui/workspace/useJobStatus.ts` (consumed by `src/ui/pages/NewRecapPage.tsx`; formerly `src/ui/pages/ProcessingPage.tsx`, now deleted)

## Important Decisions

- Do not treat a mocked test as proof of final media correctness.
- Do not consolidate or delete legacy code until its bridge/consumer role is established.
- Implement credits, billing, role-authority migration, and BYOK/Blink-funded behavior only through the approved `17_P2_FOUNDATION_ARCHITECTURE.md` phases and separate implementation authorization.
- Do not add selectable voices by exposing arbitrary TTS parameters; preserve the current single-voice behavior until a server-validated catalog, preview, eligibility, and pricing contract is approved and implemented.
- P0 issues should precede feature expansion.

## Future Work

Address issues in priority order with one approved scope at a time. For P2,
follow `17_P2_FOUNDATION_ARCHITECTURE.md` and `14_ROADMAP.md`; missing
accounting, settlement, proof-volume backup/restore, role-authority, or recovery
guarantees block activation. Each implementation should add regression coverage and update
`13_CHANGELOG.md` and affected architecture/API documents.
