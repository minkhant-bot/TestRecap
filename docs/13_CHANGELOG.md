# Changelog

## 2026-08-01 — Super Admin credit-package management

- Added gated backend create/edit/activate/deactivate/archive/reorder operations,
  active-only normal-user reads, bonus credits and optional notes, confirmation,
  idempotency, transaction-bound audit records, and a database no-delete guard.
- Existing purchase snapshots, ledger entries, plan/role separation, payment
  proof, live-job billing, UI, deployment, and Core AI Pipeline were unchanged.
- The native PostgreSQL integration suites subsequently passed 3/3.

## 2026-08-01 — 15-minute launch source-video safety limit

- Updated Blink's launch source-video safety limit to 15:00 while preserving
  30-second-block billing.
- Added authoritative backend media-duration probing before pending-job creation,
  a queue-time recheck before reservation, legacy API/retry guards, immediate
  frontend feedback, and inclusive boundary coverage for 14:59/15:00/15:01.
- The Core AI Pipeline and billing calculation were unchanged. Real
  near-15-minute E2E support remains unverified.

## 2026-07-31 — P2.3 live job billing and recovery integration

- Added a separate default-off activation gate connecting authoritative source
  duration and immutable plan/mode/rate/entitlement snapshots to locked,
  idempotent PostgreSQL reservations before workspace queue admission.
- Added explicit Trial/Normal BYOK and Pro Blink-funded enforcement without
  fallback, structured BYOK errors, usable-output settlement, pre-settlement
  release, one full compensating post-settlement refund, worker leases,
  duplicate-worker protection, checkpoint reuse, and exceptional
  `review_required` recovery.
- Added focused unit coverage and native PostgreSQL integration-test coverage
  for concurrency, queue compensation, mode/entitlement enforcement, lease
  ownership, settlement, release/refund, restart checkpoints, and duplicate
  financial transitions. The native suites subsequently passed 3/3 using an
  isolated `TEST_DATABASE_URL`.
- No commercial values were seeded; UI, deployment, global role authority, and
  Core AI Pipeline stages/output behavior were not changed.

## 2026-07-31 — PostgreSQL billing foundation

- Added explicitly gated PostgreSQL plans/policies/entitlements, Trial
  eligibility and one-time grants, integer 30-second estimates, balance/ledger,
  credit-package/bank, private screenshot-metadata, purchase, first-purchase
  bonus, adjustment, and financial audit services/APIs.
- Financial mutations require PostgreSQL Super Admin authority, transactions,
  locked rows, request-hash idempotency, and same-transaction audit records.
- Added native PostgreSQL integration-test coverage for atomic
  approval, concurrent review, idempotency, duplicate-bonus prevention,
  rejection without credits, invalid transitions, and ledger/balance
  consistency. The native suites subsequently passed 3/3 using an isolated
  `TEST_DATABASE_URL`.
- No commercial values were seeded. JSON/Firebase authority outside billing,
  encrypted BYOK data, live jobs, reservation/settlement, UI, deployment, and
  the Core AI Pipeline remain unchanged.

## 2026-07-31 — P1 verification status clarification (documentation only)

- Recorded that P1 core functionality is implemented and that one real
  30-second flow passed upload, processing, final output, preview, and download,
  including valid output enforcement and the authoritative `videoUrl` contract
  for that tested flow.
- Clarified that P1 is functionally complete for the verified short-video flow,
  but is not fully production-validated; long-duration and reliability
  verification remains pending because the available Gemini key/quota limited
  the latest real E2E test to 30 seconds.
- Classified the remaining long-job, provider-error, retry/resume,
  restart/recovery, resource-usage, and performance scope as unverified rather
  than as confirmed defects. No implementation behavior changed.

## 2026-07-30 — P2.1 database and persistence foundation

- Added centralized optional/required PostgreSQL configuration and one shared
  process pool with query, client, transaction, health, and shutdown helpers.
- Added ordered, checksummed, advisory-locked forward migrations and the initial
  constrained P2 schema with append-only and retained-record protections.
- Added foundational repositories/services and transactional, idempotent,
  pre-resolved-Firebase-UID Super Admin bootstrap scaffolding.
- Extended `/api/health` with redacted database readiness without activating
  PostgreSQL authority or changing JSON, BYOK, job, or pipeline behavior.

## Purpose

Record verified project evolution and documentation changes. This is not a substitute for Git history.

## Current Status

### Implemented

The committed Git history contains eight commits through `b70e294`. The current workspace/auth/effects architecture is newer working-tree work and is not committed.

### Planned or Placeholder

Future implementation entries should be added only when behavior actually changes. Approved future product direction and unapproved remediation proposals belong in `14_ROADMAP.md`, not in the implemented changelog.

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
- Administrator-only authorization for global legacy settings and diagnostic routes.
- Atomic two-active-workspace-job quota with structured HTTP 429 responses and admin-only legacy creation routes.
- Coordinated workspace/core deletion with ownership checks, active-core protection, and safe linked-artifact cleanup.
- Coordinated 24-hour retention for linked and orphaned workspace/core state while preserving active or mismatched jobs.
- Durable per-user rolling mutation and processing-start admission, including legacy-route protection and structured HTTP 429 responses.
- Validated Firebase custom-claim role authority, protected UID bootstrap, serialized privilege hierarchy, immediate actor revalidation, and last-super-admin protection.

### Documentation entry

- **2026-07-29 — Documentation only:** Added the `/docs` current-state project documentation set. No application code changed.
- **2026-07-30 — Authorization hardening:** Removed hard-coded email authority; added validated Firebase role claims, protected super-admin bootstrap, hierarchy/lockout controls, concurrent mutation protection, and consistent legacy admin checks. Live authenticated staging smoke testing remains a pre-beta requirement.
- **2026-07-30 — Future product direction, documentation only:** Approved a future move from mandatory BYOK to hosted credits using server-side platform AI/TTS credentials, durable and auditable credit accounting, payment-confirmed issuance, explicit BYOK migration or removal, and later server-validated selectable voices. No product behavior or Core AI Pipeline code changed. Authenticated staging smoke testing remains a separate pre-beta requirement.
- **2026-07-30 — Edge TTS WebSocket security remediation:** Overrode the Edge TTS dependency paths from vulnerable `ws@8.13.0` to patched `ws@8.21.1`. The production audit no longer reports `ws` or Edge TTS advisories. Focused tests, the complete automated suite, TypeScript, production build, and an isolated replay of a previously accepted real fixture passed without changing pipeline behavior or output-quality settings.
- **2026-07-30 — React Router risk acceptance, documentation only:** Accepted the unresolved RSC-mode CSRF advisory for beta under Blink’s current Vite SPA and declarative `BrowserRouter` architecture because the affected RSC/framework/data-action path is not reachable. This is not a vulnerability remediation. Keep `react-router` and `react-router-dom` at `7.18.1`; do not downgrade to `7.11.0` or migrate to version 8 without separate architectural approval. Re-review when a compatible patched 7.x release or supported DOM migration path exists.
- **2026-07-30 — uuid advisory review, documentation only:** Confirmed that the installed `uuid@9.0.1` is reported for GHSA-w5hq-g745-h8pq, but the defect is limited to buffered `v3()`, `v5()`, and `v6()` calls. Blink and the reviewed installed Google transitive call sites use only `v4()` without caller-provided buffers, while the loaded `gaxios@7.3.0` uses `randomUUID()`, while audited but unloaded `gaxios@6.7.1` uses unaffected `v4()`. Accepted this unreachable-path risk for beta without changing dependencies; re-review before introducing affected APIs or during the next compatible dependency upgrade.
- **2026-07-30 — Firebase Admin advisory review, documentation only:** Confirmed that Blink uses only modular Firebase Admin App and Auth functionality. Firestore, Cloud Storage, and their audited Google transitive chains are installed but not loaded or reachable; the aggregate moderate findings propagate from the separately reviewed `uuid` advisory. Accepted the Auth-only configuration for beta with explicit service, import-style, and dependency-change re-review triggers.
- **2026-07-30 — Final P1 security and dependency review, documentation only:** Confirmed `ws@8.21.1` across production Edge TTS paths, re-ran the production audit, verified complete evidence and re-review triggers for all remaining advisory entries, and passed 232/232 automated tests. P1 security work did not change the Core AI Pipeline contract, workflow, prompts, TTS behavior, timeline, FFmpeg composition, export, or accepted output quality. Authenticated staging smoke testing remains a separate pre-beta release requirement.
- **2026-07-30 — Authenticated staging smoke-test plan, documentation only:** Defined the mandatory real-Railway pre-beta checks for authentication, role enforcement, admission controls, restart and volume persistence, protected jobs/outputs, deployment configuration, evidence, blocking failures, and cleanup. No smoke test was executed and no application or deployment behavior changed.
- **2026-07-30 — Railway evidence correction, documentation only:** Rejected previously shown screenshots because they belonged to another person's Railway project. Blink's deployment target, staging URL, replica count, volume, effective `DATA_DIR`, and production-variable presence remain unverified; deployment preflight is blocked and authenticated staging smoke testing has not started.
- **2026-07-30 — P2 plan, credit, BYOK, and Blink-funded architecture approval, documentation only:** Added the complete PostgreSQL/object-storage target, Trial/Normal/Pro separation, duration billing in 30-second blocks, immutable ledger, manual purchase review, first-purchase bonus, usable-output settlement, full system-failure compensation, `review_required` recovery, PostgreSQL role authority, protected bootstrap, explicit mode selection, APIs, transactions, security, tests, and phased delivery contract. No runtime, dependency, test, deployment, or Core AI Pipeline behavior changed.

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
