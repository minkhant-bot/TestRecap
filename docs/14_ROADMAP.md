# Roadmap

## Purpose

Record both the approved future product direction and the architect’s dependency-ordered remediation proposal. Approval of product direction does not approve implementation scope, delivery timing, or architecture changes.

## Current Status

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

### Planned or Placeholder

The hosted-credit and multiple-voice direction below is approved future product direction. It is not implemented, an approved implementation plan, or a delivery commitment. The remediation phases remain an unapproved proposal derived from the current repository.

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

Phase 1 is complete for beta. Authenticated staging smoke testing remains a release gate rather than unfinished Phase 1 implementation.

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

### Approved Future Product Direction — Hosted credits and voices

Blink Automation will move away from mandatory BYOK. Users will purchase credits, processing will use platform-owned AI and TTS credentials held server-side, and credits will be consumed for processing jobs. Migration or removal of existing BYOK behavior and stored credentials must be explicit, safe, and separately approved.

Required credit controls:

1. Durable per-user credit balance.
2. Immutable credit ledger and user-visible history.
3. Atomic credit reservation before processing.
4. Idempotent charging.
5. Defined success, failure, and explicit-cancellation settlement.
6. Documented refund or reservation-release rules.
7. Authorized admin credit adjustments with durable audit history.
8. Verified payment confirmation before credit issuance.
9. No client-side authority over balances, reservations, charges, settlement, or adjustments.

Future voice support will offer multiple selectable voices through a server-owned catalog. Availability and pricing may depend on plan, credit cost, or provider. Selection requires voice preview and server-side validation. Clients must not receive authority to submit arbitrary TTS parameters. The current single-voice behavior remains authoritative until this feature is separately approved and implemented.

Recommended implementation order:

1. Credit ledger and accounting.
2. Platform-owned secret/key architecture.
3. Job reservation, charge, refund, and cancellation settlement.
4. Payment integration.
5. BYOK migration or removal.
6. Multiple voice catalog, preview, selection, and pricing.

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
- Hosted credits and multiple selectable voices are approved future product direction only; each implementation scope and contract still requires explicit approval.
- Workflow-v2, output quality, Timeline Verification, Scene Rebuild, Gemini, and TTS behavior must not be casually rewritten.
- Correctness and lifecycle consistency precede performance refactors.
- Credits work requires an approved financial contract, settlement rules, payment-confirmation contract, and migration plan.
- Current BYOK and single-voice behavior must remain unchanged until their replacements are explicitly approved and implemented.

## Future Work

The next product-design task is a bounded credit-ledger and accounting contract covering units, balances, immutable entries, reservations, idempotency, settlement, refunds/releases, administrative adjustments, and reconciliation. Documentation should be updated after each approved implementation, verification, and deployment decision.
