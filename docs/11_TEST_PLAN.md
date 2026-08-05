# Test Plan

## Purpose

Describe the current automated tests, safe verification levels, important regression contracts, and gaps. This is a plan and inventory, not a claim that every test is run automatically.

## Current Status

### Implemented

- Node test-runner unit and service tests colocated with JavaScript modules.
- Route tests using temporary stores and local Express servers.
- Workflow persistence and restart tests.
- FFmpeg/media tests with generated temporary fixtures in selected suites.
- TypeScript validation through `npm run lint`.
- Production bundling through `npm run build`.
- Static source-contract tests for parts of the current UI.
- Billing configuration, API, calculation/mode, authorization-error, and real
  PostgreSQL transaction/concurrency integration coverage.

### Planned or Placeholder

- No approved test-program expansion is recorded in the repository.
- There is no `npm test` script, single CI test command, maintained authenticated-workspace browser E2E suite, or production load/soak/security/backup/restore/migration suite.
- The mandatory manual Railway staging plan is defined in `16_STAGING_SMOKE_TEST.md`; it has not yet been executed.

### Known Issues

- Some UI tests inspect source with regular expressions rather than render components.
- Playwright packages exist, but the tracked screenshot utility is not a product E2E test.
- Real media tests can be expensive and inappropriate on constrained devices.

## Architecture/Flow

### Test levels

1. **Pure unit tests**
   - Effect normalization/filter construction.
   - Workflow stage/version logic.
   - Timeline and duration validation.
   - Role/auth helpers.
   - Request and deletion helpers.

2. **Service tests**
   - Workspace persistence and worker lifecycle.
   - Restart recovery and explicit cancellation.
   - Abort-signal propagation into the bridged core pipeline, FFmpeg, Edge TTS, and final effects.
   - Gemini response validation using mocks.
   - Credential encryption/restart.
   - Core bridge state preparation.

3. **Route tests**
   - Authentication requirements and ownership.
   - Upload validation.
   - Key isolation.
   - Queue/effect persistence.
   - Cancellation/deletion contracts.
   - Billing authentication, idempotency propagation, and structured
     PostgreSQL-Super-Admin denial.
   - Authoritative 14:59/15:00 acceptance, 15:01 rejection, client-duration
     bypass rejection, and no queue/reservation on rejection.

4. **Media tests**
   - FFmpeg process timeout/abort.
   - Scene rebuild arguments and outputs.
   - Stream and duration validation.
   - Effects ordering with lightweight mocked files.

5. **PostgreSQL billing integration**
   - Atomic Trial/purchase/bonus/adjustment ledger and balance updates.
   - Concurrent purchase approval permits one terminal decision.
   - First-purchase bonus is issued once; rejection issues no credits.
   - Idempotent replay, invalid terminal transitions, and append-only guards.

5. **Build checks**
   - `npm run lint`
   - `npm run build`

### Mandatory regression areas

- Rapid Flip then Color selection preserves all fields.
- Disabled effects perform no setup or FFmpeg.
- Effect order and previous-output chaining.
- Explicit Cancel is the only path to Cancelled.
- Restart requeues the same job ID.
- SSE disconnect and fetch failure do not cancel.
- Authentication and owner isolation.
- Credential encryption and non-disclosure.
- Download authorization.
- Coordinated workspace/core deletion, owner mismatch, active-core blocking, orphan cleanup, and unsafe-artifact preflight.
- Active-job quota concurrency, per-user isolation, terminal release, and legacy-route bypass prevention.
- The 15:00 source limit at frontend selection, backend upload, queue recheck,
  and direct API boundaries; 30-second billing calculations remain unchanged.
- Rolling admission isolation, concurrency, restart recovery, expiry, compensation, legacy-route protection, and HTTP 429 contract.
- Retention across linked records, legacy-only records, orphan workspace records, active-state preservation, and owner mismatches.

### Latest automated verification (2026-08-04, documentation audit)

- `node --test`: 269 total, 265 passed, 0 failed, 4 skipped.
- `npm run lint` (TypeScript) and `npm run build` (production bundle) both passed.
- `git diff --check` passed clean.
- This run includes new coverage added since the 2026-08-03 cycle: the UI
  restructuring regression tests (Landing page, retired-route redirects, the
  Dialog/StatCard component rebuild, `reference.css`/`app.css` parity with
  `BlinkAutomationFull_v2.jsx`) and the new Trial-request lifecycle tests
  (`billingFoundation.trialLifecycle.test.js` and its PostgreSQL integration
  counterpart, run only when `TEST_DATABASE_URL` is set).
- These are automated/unit-level results only. Real media end-to-end
  verification of the Sawaungthin workflow-v3 pipeline remains unverified:
  blur, subtitle position, flip, subtitle rendering, and MP3/MP4 output
  correctness are not confirmed against real generated artifacts in this cycle.
- This audit performed a documentation-only review; no application code,
  tests, configuration, or migrations were changed, and no commit, push, or
  deployment occurred.

### Previous automated verification (2026-08-03, Sawaungthin workflow-v3 restoration)

- `node --test`: 255 total, 252 passed, 0 failed, 3 skipped.
- `npm run lint` (TypeScript) and `npm run build` (production bundle) both passed.
- `git diff --check` passed clean.
- These are automated/unit-level results only. Real media end-to-end
  verification of the restored Sawaungthin pipeline was intentionally not
  completed and remains unverified: blur, subtitle position, flip, subtitle
  rendering, and MP3/MP4 output correctness are not confirmed against real
  generated artifacts. That code is preserved from the prior architecture but
  its runtime output is pending verification.
- No commit, push, or deployment occurred as part of this verification.

### Constrained-device rule

Do not run real full exports, Scene Rebuild, Final Export, or full E2E on a constrained phone unless the user explicitly authorizes it. Prefer static inspection, focused tests, mocks, TypeScript, and build verification.

## File References

- Test files: `src/**/*.test.js`, `scripts/dev-watch-policy.test.mjs`
- TypeScript command: `package.json`
- Effects tests: `src/services/videoEffects.test.js`
- Worker tests: `src/services/workspaceWorker.test.js`
- Workspace routes: `src/routes/workspace.test.js`
- Sawaungthin workflow-v3 tests: `src/domain/workflow.test.js`, `src/workers/*.test.js`
- UI source-contract tests: `src/ui/newRecapFlow.test.js`
- Manual authenticated staging plan: `docs/16_STAGING_SMOKE_TEST.md`

## Important Decisions

- Tests must use temporary data roots and never mutate real user stores.
- Mocks may prove control flow but do not prove physical video pixels.
- Media integrity claims require proportionate real-media verification in an appropriate environment.
- Test failures must not be “fixed” by weakening contracts without approval.

## Future Work

The following are unapproved test recommendations:

- Add one documented `npm test` entry point and CI matrix.
- Add component tests for active UI behavior.
- Add authenticated browser tests against isolated temporary data.
- Add future credits, admin hierarchy, range downloads, and fatal-shutdown tests.
