# Roadmap

## Purpose

Record an architect’s dependency-ordered remediation proposal without presenting it as an approved product or delivery plan. Items here are derived from implemented foundations and known issues.

## Current Status

### Implemented

- Authenticated workspace recap flow.
- Durable single-concurrency processing.
- Workflow-v2 AI/media core.
- Optional effects.
- History/download foundations.
- Placeholder admin and credits surfaces.

### Planned or Placeholder

The repository contains no approved roadmap. The sequence below is an unapproved remediation proposal derived from the current repository; it is not implementation scope, a delivery commitment, or evidence that a feature is planned.

### Known Issues

See `12_KNOWN_ISSUES.md`. P0 work blocks safe feature expansion.

## Architecture/Flow

### Proposed Phase 0 — Stabilize the repository

1. Review current modified/untracked files.
2. Separate source from runtime/generated artifacts.
3. Establish a reproducible tracked baseline.
4. Define the supported test command and release checks.

### Proposed Phase 1 — Protect production resources and authorization

1. Remove ordinary-user access to global settings/diagnostic behavior.
2. Enforce backend upload, pending-job, queue, and request limits.
3. Repair role authority and privilege hierarchy.
4. Resolve high-risk dependency findings.

### Proposed Phase 2 — Unify lifecycle ownership

1. Select one canonical job aggregate.
2. Coordinate workspace/core completion, failure, cancellation, deletion, and retention.
3. Propagate cancellation through every AI/FFmpeg stage.
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

## File References

- Priority source: `docs/12_KNOWN_ISSUES.md`
- Architecture: `docs/02_SYSTEM_ARCHITECTURE.md`
- Persistence: `docs/04_DATABASE.md`
- Security: `docs/09_SECURITY.md`
- Credits: `docs/07_CREDITS_SYSTEM.md`
- Admin: `docs/08_ADMIN_SYSTEM.md`

## Important Decisions

- Roadmap items require explicit user approval before code changes.
- Workflow-v2, output quality, Timeline Verification, Scene Rebuild, Gemini, and TTS behavior must not be casually rewritten.
- Correctness and lifecycle consistency precede performance refactors.
- Credits work requires an approved financial contract.

## Future Work

If this proposal is adopted, the next action would be user selection of a bounded P0 scope. Documentation should be updated after each approved implementation, verification, and deployment decision.
