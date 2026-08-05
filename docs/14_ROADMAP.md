# Roadmap

> Sequencing is constrained by `18_PRODUCT_OWNER_DECISIONS_2026-08-01.md`:
> finish docs/code/tests/config, preserve the verified native PostgreSQL baseline,
> verify near-15-minute E2E, then stage on isolated Railway resources. Advanced
> analytics is not a blocker.

## Purpose

Record both the approved future product direction and the architect’s dependency-ordered remediation proposal. Approval of product direction does not approve implementation scope, delivery timing, or architecture changes.

## Current Status

### Official P1–P6 roadmap mapping (2026-08-04 documentation audit)

The repository's internal delivery labels (below, and the P2.1–P2.9 sub-phases
in `17_P2_FOUNDATION_ARCHITECTURE.md`) predate this six-phase stakeholder
roadmap. This table maps current, evidence-based status onto it; it does not
replace the internal labels used throughout the rest of this document set.

| Phase | Status |
|---|---|
| P1 — Core Platform & AI Foundation | Functionally complete for a verified 30-second real end-to-end flow (upload → processing → output → preview → download). Not fully production-validated: long-duration, reliability, retry/resume, and restart/recovery behavior remain unverified. Automated suite passes (269 total, 265 passed, 4 skipped); real media E2E of the current Sawaungthin workflow-v3 pipeline is unverified. |
| P2 — Billing & Beta Readiness | PostgreSQL billing foundation (plans, credits, ledger, purchases, packages, and a newly added simplified Trial request/Owner-approval lifecycle) is implemented and passes native PostgreSQL integration tests, but remains behind inactive `P2_BILLING_ENABLED`/`P2_LIVE_JOB_BILLING_ENABLED` gates with no commercial values seeded. Beta readiness is blocked: the mandatory authenticated Railway staging smoke test (`16_STAGING_SMOKE_TEST.md`) has not been executed, Railway deployment attribution/volume/`DATA_DIR` are unverified, and near-15-minute real E2E support is unverified. |
| P3 — Beta QA & Customer Validation | Not started. No executed staging smoke test, no verified staging deployment, and no recorded customer-facing beta process exist in the repository. |
| P4 — Production Hardening | Partially addressed: P1 security/dependency review is complete for beta (documented risk acceptances for React Router, `uuid`, Firebase Admin advisories), and durable per-user rolling admission/rate limiting is implemented. Broader hardening — HTTP security headers, an explicit CORS policy, distributed (multi-replica) admission enforcement, secret rotation, and a documented CSRF strategy — remains an absent recommendation, not implemented. |
| P5 — Operations & Administration | Substantially implemented: a tab-based Super Admin console (`/admin`: Overview, Users, Trial Requests, Purchases, Packages, Credits, Audit Log, System Status) is connected to real backend admin/billing APIs, with role hierarchy, actor revalidation, and last-super-admin protection enforced server-side. Ban/unban persistence/API, sole-owner (`min85639@gmail.com`) enforcement, and a durable (non-in-memory) audit trail remain unimplemented. |
| P6 — Production Launch | Not started. Railway is explicitly a staging/test target, not production; deployment preflight is blocked pending Blink attribution and storage/variable/log evidence. Launch requires completing P2's staging verification and P1's long-duration validation first. |

### P1–P5 handoff summary

| Phase | Status |
|---|---|
| P1 — Core recap/beta hardening | Implemented for the verified 30-second flow; not fully production-validated. Long-duration and reliability verification is pending. |
| P2 — Billing foundation/live integration | P2.1, P2.2, and P2.3 implementation exists behind inactive gates; unit tests and all three native PostgreSQL integration suites passed. Production activation, backup/restore, reconciliation operations, and staging verification remain pending. |
| P3 — Lifecycle/authority consolidation | Not implemented; JSON workspace/core stores and Firebase role claims remain compatible authorities. |
| P4 — Performance/scale | Not implemented; preserve workflow/output contracts before optimization. |
| P5 — Future product expansion | No approved implementation scope; selectable voices and other expansion remain deferred. |

These P1–P5 labels are the current ZIP handoff grouping. The detailed original
P2.4–P2.9 dependency labels remain in `17_P2_FOUNDATION_ARCHITECTURE.md`.

### P1 verification status

P1 core functionality is implemented and a real 30-second end-to-end flow has
passed from upload through processing, final output, preview, and download.
Valid output enforcement and the authoritative `videoUrl` contract are verified
for that tested flow. P1 is functionally complete for the verified short-video
flow, but is not yet fully production-validated. Long-duration and reliability
verification remains pending because the available Gemini key/quota limited the
latest real E2E test to 30 seconds.

The explicit pending verification item is longer-job and reliability validation,
covering longer sources, long-running timeline/final export behavior, Gemini
quota/provider errors, retry/resume, restart/recovery, and longer-job memory,
storage, and performance. These are unverified areas, not confirmed failures;
see `12_KNOWN_ISSUES.md` for the authoritative list.

### Implemented

- Authenticated workspace recap flow.
- Durable single-concurrency processing.
- Workflow-v2 AI/media core.
- Optional effects.
- History/download foundations.
- Placeholder admin and credits surfaces.
- Administrator-only global settings and diagnostic operations.
- Server-enforced two-active-workspace-job admission quota.
- Coordinated workspace/core deletion and linked-artifact cleanup.
- Coordinated 24-hour workspace/core retention with orphan-state recovery.
- Validated Firebase role authority and administrative privilege hierarchy.
- Opt-in PostgreSQL billing foundation for the approved plan, Trial, catalog,
  purchase-review, immutable-ledger/balance, bonus, adjustment, estimate, and
  financial-audit scope.
- Default-off live-job billing and recovery integration covering immutable
  pricing/entitlement snapshots, reservations, explicit provider mode,
  settlement/release/refund, leases, duplicate-worker protection, and
  checkpoint-aware recovery.

### Planned or Placeholder

The P2 architecture below and in `17_P2_FOUNDATION_ARCHITECTURE.md` is approved.
P2.1 infrastructure is implemented but inactive; later phases and authority
cutovers still need explicit authorization.
Multiple-voice work remains a separate future direction and delivery is not
committed.

### Known Issues

See `12_KNOWN_ISSUES.md`. P0 work blocks safe feature expansion.

## Architecture/Flow

### Proposed Phase 0 — Stabilize the repository

1. Review current modified/untracked files.
2. Separate source from runtime/generated artifacts.
3. Establish a reproducible tracked baseline.
4. Define the supported test command and release checks.

### Proposed Phase 1 — Protect production resources and authorization

1. ~~Define and enforce cumulative usage and request-rate limits.~~ Implemented with durable single-replica admission storage.
2. ~~Repair role authority and privilege hierarchy.~~ Implemented with validated custom claims, protected UID bootstrap, and serialized lockout-safe mutations.
3. ~~Resolve or formally disposition high-risk dependency findings.~~ Completed for beta: `ws` was remediated and all remaining audit entries have documented unreachable-path risk acceptances and re-review triggers.

The current React Router RSC-mode advisory has a documented beta risk acceptance because Blink’s declarative `BrowserRouter` Vite SPA cannot reach the affected path. This does not mark the advisory fixed. Keep both router packages at `7.18.1`, reject the `7.11.0` downgrade, and require separate architectural approval for version 8. Re-review when a compatible patched 7.x release or supported DOM migration path becomes available.

The current `uuid` buffer-bounds advisory also has a scoped beta risk acceptance: the reviewed application and installed Google call sites use `v4()` without caller-provided buffers, while the affected APIs are buffered `v3()`, `v5()`, and `v6()`. This does not mark the audit finding fixed. Re-review before using those APIs and when a compatible direct/Firebase Admin dependency upgrade is evaluated.

This proposed Phase 1 security/dependency implementation scope is complete for
beta. That does not mean P1 is fully production-validated: the long-duration
and reliability verification item above and authenticated staging smoke testing
remain release gates rather than unfinished implementation in this proposed
phase.

### Proposed Phase 2 — Unify lifecycle ownership

1. Select one canonical job aggregate.
2. Coordinate workspace/core completion, failure, and cancellation.
3. ~~Propagate explicit user cancellation through the bridged AI/FFmpeg/final-effects stages.~~ Implemented; direct interruption of FFprobe metadata probes remains.
4. Replace synchronous JSON persistence with transactions and migrations.

### Proposed Phase 3 — Complete existing foundations

1. Connect approved admin screens to correct admin data.
2. Define and implement credits ledger/admission only after billing approval.
3. Add durable audit events.
4. Add pagination and scalable progress/history delivery.

### Proposed Phase 4 — Optimize without changing output contracts

1. Stream/range-serve output instead of full Blob loading.
2. Bound child-process diagnostics.
3. Evaluate effects filter composition with strict regression protection.
4. Remove proven-dead frontend, routes, dependencies, and artifacts.

### Approved P2 Foundation — plans, BYOK, Blink-funded processing, and credits

The complete approved architecture is `17_P2_FOUNDATION_ARCHITECTURE.md`.
That document's design preserves Trial and Normal on BYOK with Pro on
Blink-owned Gemini credentials, as three commercial plans, not roles. The
currently implemented `billingFoundation.js` accepts only Trial and Pro as
selectable/configurable plan codes; self-service plan selection
(`POST /api/plans/me/select`) always returns HTTP 410, and Normal — while
still defined in the architecture document and the database `plans.code`
constraint — is not reachable through any current API or UI path. User-facing
charges use integer credits in duration-based 30-second blocks with versioned
plan rates.

Required credit controls:

1. Durable per-user credit balance.
2. Immutable credit ledger and user-visible history.
3. Atomic credit reservation before processing.
4. Idempotent charging.
5. Settlement only after the valid usable-output milestone.
6. Release before settlement; full refund only after an existing settlement debit. Reconcile checkpoint/output first and use `review_required` only for genuinely indeterminate recovery.
7. Authorized admin credit adjustments with durable audit history.
8. Manual Super Admin bank confirmation before purchase credit issuance.
9. No client-side authority over balances, reservations, charges, settlement, or adjustments.
10. Separate immutable first-purchase purchased-credit and bonus entries.
11. No silent fallback between BYOK and Blink-funded modes.

Future voice support will offer multiple selectable voices through a server-owned catalog. Availability and pricing may depend on plan, credit cost, or provider. Selection requires voice preview and server-side validation. Clients must not receive authority to submit arbitrary TTS parameters. The current single-voice behavior remains authoritative until this feature is separately approved and implemented.

Recommended implementation order:

1. ~~PostgreSQL infrastructure and migrations.~~ P2.1 implemented as inactive
   infrastructure; isolated database verification and deployment remain gated.
2. Billing-domain identity synchronization, PostgreSQL Super Admin financial
   authority, plans, policies, entitlements, promotions, assignments, private
   screenshot metadata, manual purchase requests, immutable ledger/balance,
   and approval/rejection transactions. Implemented behind explicit activation;
   global role cutover and object-storage adapters remain pending.
3. ~~Job billing snapshots and reservations (detailed architecture P2.7).~~
   Implemented behind the separate default-off live-job gate.
4. ~~Explicit BYOK/Blink-funded selection and settlement (detailed P2.8).~~
   Implemented behind the same gate.
5. Recovery integration is implemented for leases, checkpoints, idempotent
   financial transitions, and exceptional review. Migration, backup/restore,
   production activation, and staging verification (remaining P2.9) are pending.
6. Multiple voice catalog, preview, selection, and pricing only under separate approval.

Authenticated staging smoke testing remains a separate pre-beta requirement and is not satisfied by completing roadmap development.

## File References

- Priority source: `docs/12_KNOWN_ISSUES.md`
- Architecture: `docs/02_SYSTEM_ARCHITECTURE.md`
- Persistence: `docs/04_DATABASE.md`
- Security: `docs/09_SECURITY.md`
- Credits: `docs/07_CREDITS_SYSTEM.md`
- Admin: `docs/08_ADMIN_SYSTEM.md`

## Important Decisions

- Roadmap items require explicit user approval before code changes.
- P2.1 is implemented as an inactive compatibility foundation. Later phases and
  every authority cutover still require explicit approval.
- Workflow-v2, output quality, Timeline Verification, Scene Rebuild, Gemini, and TTS behavior must not be casually rewritten.
- Correctness and lifecycle consistency precede performance refactors.
- Remaining values and user-cancellation/review operations listed in `17_P2_FOUNDATION_ARCHITECTURE.md` require approval before their dependent phases activate.
- Current BYOK and single-voice behavior must remain unchanged until their replacements are explicitly approved and implemented.

## Future Work

The next implementation work, when separately authorized, is operational:
global role cutover, object-storage adapters, backup/restore, migration/cutover
tooling, UI activation, and authenticated staging validation. These remain
gated; the live-job integration itself is also disabled by default.
