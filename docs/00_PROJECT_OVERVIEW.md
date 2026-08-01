# Blink Automation — Project Overview

> Current Product Owner decisions: `18_PRODUCT_OWNER_DECISIONS_2026-08-01.md`.
> Its duration, purchase, administration, UI, and staging rules supersede older
> conflicting design text. Fifteen-minute support remains unverified until a
> near-15-minute real E2E passes.

## Purpose

Blink Automation, whose package and repository still use the names `cinerecap-ai` and `TestRecap`, is an authenticated web application that converts an uploaded source video into a Burmese-narrated recap. It combines transcription, Burmese translation, text-to-speech, chronological scene reconstruction, final video export, and optional visual effects.

This document is the entry point for developers and AI assistants. It describes the current working tree as of 2026-07-31.

## Current Status

### P1 verification status

P1 core functionality is implemented and a real 30-second end-to-end flow has
passed from upload through processing, final output, preview, and download.
Valid output enforcement and the authoritative `videoUrl` contract are verified
for that tested flow. P1 is functionally complete for the verified short-video
flow, but is not yet fully production-validated. Long-duration and reliability
verification remains pending because the available Gemini key/quota limited the
latest real E2E test to 30 seconds. The exact unverified scope is listed in
`12_KNOWN_ISSUES.md`; those items are pending verification, not confirmed
defects.

### PostgreSQL/P2 verification status

The P2.1/P2.2/P2.3 PostgreSQL schemas, repositories, services, and integration
test code are present in the working tree. Implementation and verification are
separate:

- **Implemented:** PostgreSQL persistence boundaries cover users, roles, plans,
  credits, ledger, purchases, banks, reservations, leases, and Super Admin
  bootstrap. No ban/unban persistence schema exists.
- **Unit-tested:** the latest full Node inventory passed 327 tests, failed 0,
  and skipped 3.
- **Verified against PostgreSQL:** all three native suites passed using an
  isolated `TEST_DATABASE_URL`. Migrations 0001 and 0002, restart persistence,
  reserve/settle/release/refund/recovery, locking, transactions, concurrency,
  idempotency, and duplicate prevention were exercised successfully.
- **Pending:** production migration and backup/restore, reconciliation
  operations, and Railway/staging activation.

Keep both billing gates disabled until isolated Railway staging acceptance. The
intended sole Product Owner/Super Admin is `min85639@gmail.com`;
sole-owner enforcement is not currently proven. Backend authorization must use
PostgreSQL-backed roles after cutover; frontend email checks are insufficient.
Railway main is initially a test/staging deployment, not production, and final
UI/UX plus Super Admin operational UI remain pending.

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
- Explicitly gated PostgreSQL billing services/APIs for plans, Trial grants,
  credit catalog/purchases, immutable ledger/balance, first-purchase bonus,
  estimates, adjustments, and financial audit.
- Separately gated live-job billing/recovery integration: authoritative-duration
  immutable snapshots, atomic reservations, explicit BYOK/Blink-funded modes,
  usable-output settlement, release/full-refund compensation, worker leases,
  and checkpoint-aware restart recovery.
- Planned Super Admin ban/unban and reasoned, audited grant/deduction/refund/
  reversal operations are not yet implemented end to end.

### Planned or Placeholder

- The Credits and Super Admin screens use their existing production APIs,
  including private payment-proof upload and authenticated preview.
- Global PostgreSQL role cutover remains planned. Billing and live-job integration seed no commercial values and are
  disabled by default.
- Future voice support will provide a server-validated catalog, previews, and selectable voices whose availability may depend on plan, credit cost, or provider.
- Remaining directions and phased boundaries are defined in
  `17_P2_FOUNDATION_ARCHITECTURE.md`; each later scope requires explicit approval.

### Known Issues

- The reviewed Blink baseline is committed on `blink-baseline`; deployment and merge/push status remain separate operational decisions.
- Two job stores and two lifecycle vocabularies coexist.
- Billing and live job billing remain inactive by default; the connected UI
  reports the gated/unavailable state accurately.
- Current roles still use Firebase custom claims; approved P2 architecture moves application role authority to PostgreSQL while retaining Firebase identity.
- P1 long-duration and reliability behavior remains unverified beyond the
  passed 30-second real E2E flow; this is not evidence that longer videos fail.
- See `12_KNOWN_ISSUES.md` for the prioritized list.

### ZIP handoff status

The repository is on branch `blink-baseline` at HEAD `5f5bfc9`. The working
tree is intentionally dirty: 50 paths are changed or untracked, including
documentation, the PostgreSQL foundation, billing services, and live-job
integration. Existing changes belong to the project; do not reset, restore,
stash, or assume a clean baseline. No deployment or authority cutover has been
performed.

| Roadmap grouping | Current status |
|---|---|
| P1 — core recap and beta hardening | Functionally complete for the verified 30-second flow; not fully production-validated. Long-duration/reliability verification remains pending. |
| P2 — PostgreSQL billing foundation and live-job integration | P2.1 infrastructure, P2.2 billing foundation, and P2.3 live billing/recovery implementation exist behind gates. PostgreSQL/production activation and staging verification remain pending. |
| P3 — lifecycle and authority consolidation | Not implemented; JSON workspace/core stores, Firebase role authority, and single-replica assumptions remain. |
| P4 — performance and operational scaling | Not implemented; optimization must preserve output contracts. |
| P5 — future product expansion | No approved implementation scope; selectable voices and other expansion remain future work. |

Repository delivery labels P2.1/P2.2/P2.3 are the current implementation
labels. The detailed P2.4–P2.9 architecture mapping remains in
`17_P2_FOUNDATION_ARCHITECTURE.md`; implementation presence is not production
activation.

### Local command handoff

```bash
npm install
cp .env.example .env.local
npm run dev                 # local watcher + Vite; Ctrl+C stops it
node --test                 # no npm test script exists
npm run lint                # TypeScript validation
npm run build               # production SPA bundle
npm run db:status           # requires DATABASE_URL for PostgreSQL inspection
npm run db:migrate          # manual local forward migration; production startup also applies it
```

Set Firebase, Gemini, upload, admission, and `DATA_DIR` values in the ignored
`.env.local`. `P2_BILLING_ENABLED=false` and
`P2_LIVE_JOB_BILLING_ENABLED=false` are the safe defaults. The second gate
requires the first and PostgreSQL. PostgreSQL integration tests require an
isolated `TEST_DATABASE_URL`; never point it at production data.

Before editing, another AI must read all files under `docs/`, inspect
`git status`, preserve unrelated dirty-worktree changes, keep Trial/Normal/Pro
as plans rather than roles, and preserve the Core AI Pipeline and output
contract. Do not modify billing, role/bootstrap, credentials, migrations,
runtime stores, deployment, or pipeline behavior without explicit scope.

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
- Authentication identity, authorization role, commercial plan, billing mode, and feature entitlement are distinct.
- A completed paid job settles only after the existing valid usable-output contract succeeds.

## Future Work

The approved P2 contract is in `17_P2_FOUNDATION_ARCHITECTURE.md`; sequencing is summarized in `14_ROADMAP.md`. It preserves BYOK for Trial and Normal, introduces Blink-funded Pro, and requires PostgreSQL accounting, private screenshot storage, manual Super Admin payment review, immutable ledger entries, atomic reservation, usable-output settlement, and full system-failure compensation. Any implementation requires separate approval and must preserve workflow-v2 output behavior and the current single-voice contract.
