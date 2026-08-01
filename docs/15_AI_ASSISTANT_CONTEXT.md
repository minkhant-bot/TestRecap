# AI Assistant Context

> Read `18_PRODUCT_OWNER_DECISIONS_2026-08-01.md` first. It is authoritative for
> launch duration, manual payment/credit operations, packages, roles, owner UI,
> analytics, UI/UX, and Railway staging. Preserve the Core AI Pipeline.

Blink's launch source-video safety maximum is 15:00. Backend upload and queue
checks are authoritative; frontend metadata validation is only immediate
feedback. Billing remains in 30-second blocks. Do not claim 15-minute support
until a near-15-minute real E2E passes.

Credit-package management backend APIs are implemented behind the default-off
PostgreSQL billing gate. Super Admin can create, edit, activate/deactivate,
archive, and reorder; normal users read active packages only. Mutations require
confirmation/idempotency and audit. No package-management UI is implemented.
The native PostgreSQL integration suites passed 3/3.

## ZIP Handoff Snapshot (2026-07-31)

- Branch: `blink-baseline`
- HEAD: `5f5bfc9`
- Working tree: intentionally dirty; 50 changed or untracked paths are present.
  The changes include documentation, PostgreSQL foundation, billing, and
  workspace/live-job integration. Never reset, restore, stash, or discard them.
- This historical snapshot predated native PostgreSQL execution. The current
  evidence supersedes it: all three native suites passed using an isolated
  `TEST_DATABASE_URL`, including migration and restart-persistence coverage.
- No implementation, configuration, migration, runtime, deployment, or Core AI
  Pipeline behavior may be changed by a documentation handoff.

### Roadmap status

| Phase | Status and continuation boundary |
|---|---|
| P1 | Core functionality implemented; real 30-second upload → processing → final output → preview → download flow passed. Not fully production-validated; all longer-duration/reliability scope remains pending. |
| P2.1 | PostgreSQL configuration, pool/transactions, checksummed migrations, schema, repositories, readiness, shutdown, and bootstrap scaffolding exist. Inactive; no global authority cutover. |
| P2.2 | Trial/Normal/Pro plans/policies, entitlements, trial grants, credits/ledger/balance, packages/banks, screenshot metadata, manual purchase review, first-purchase bonus, adjustments, estimates, audit, and Super Admin financial APIs exist. Gated by `P2_BILLING_ENABLED`; no commercial values are seeded. |
| P2.3 | Live-job duration snapshots, explicit modes, reservations, settlement/release/refund, leases, checkpoint reuse, duplicate-worker protection, and reconciliation implementation exist. Unit tests and all three native PostgreSQL suites passed. Gated by `P2_LIVE_JOB_BILLING_ENABLED`; production/staging activation remains pending. |
| P3 | Lifecycle consolidation and PostgreSQL/global role authority cutover: not implemented. |
| P4 | Performance, scaling, and operational optimization: not implemented. |
| P5 | No approved implementation scope; future product expansion such as selectable voices remains deferred. |

The original detailed P2.4–P2.9 labels are retained in
`17_P2_FOUNDATION_ARCHITECTURE.md`; current repository delivery labels are the
P2.1/P2.2/P2.3 rows above.

## P2.1 Implementation Status (2026-07-30)

- PostgreSQL configuration, shared pooling, transactions, forward checksummed
  migrations, the initial schema, foundational repositories/services, redacted
  readiness, graceful shutdown, and bootstrap scaffolding exist.
- This foundation is inactive: JSON/file stores, Firebase-claim authorization,
  encrypted BYOK persistence, and current job execution remain authoritative.
  No dual-write is active.
- Native PostgreSQL verification subsequently passed in an isolated test
  database, including migrations 0001 and 0002 and restart persistence.
- JSON/BYOK and PostgreSQL restart persistence are tested.
- No ban/unban persistence schema exists. Planned ban/unban and Super Admin
  credit grant/deduction/refund/reversal UI and flows are not complete.
- Never auto-run migrations or activate `DATABASE_REQUIRED`/role authority without
  an approved, tested cutover.

## PostgreSQL Billing and Live Job Status (2026-07-31)

- `P2_BILLING_ENABLED=true` activates only plans, Trial, estimates,
  balance/ledger, catalog/banks, screenshot metadata, purchases, bonus,
  adjustments, and financial audit APIs.
- No commercial values are seeded. Missing policy/catalog/storage configuration
  fails closed.
- Financial mutations use PostgreSQL Super Admin authority. Other application
  roles, JSON jobs, encrypted BYOK, and runtime data remain under their existing
  authorities.
- `P2_LIVE_JOB_BILLING_ENABLED=true` separately enables authoritative-duration
  snapshots, locked reservations before queue admission, explicit BYOK/Pro
  execution, usable-output settlement, release/full-refund compensation,
  worker leases, and checkpoint-aware recovery. It is disabled by default.
- Keep both gates disabled until isolated Railway staging acceptance.
- Object-upload adapters, UI activation, global role cutover, production
  activation, and the Core AI Pipeline remain unchanged.

### Super Admin and bootstrap boundary

Roles remain exactly `user`, `admin`, and `super_admin`; Trial/Normal/Pro are
plans, never roles. Current application requests derive role authority from
validated Firebase claims and configured bootstrap UIDs. The approved P2
PostgreSQL design uses Firebase for identity, synchronizes the user, and gives
financial mutations only to PostgreSQL `super_admin`. Bootstrap is a temporary
server-only approved Firebase UID resolved through Firebase Admin, inserted in a
locked one-time PostgreSQL transaction as a protected bootstrap role, audited,
and then disabled/removed. Protected bootstrap demotion/deletion/disablement
requires an approved recovery procedure and another active Super Admin.

Super Admin financial permissions include plan/policy/entitlement/promotion
configuration, Trial decisions, package/bank configuration, purchase
approve/reject, manual grant/deduction, approved full reversal/refund, and
financial/audit review. Generic `admin` does not receive credit-changing
authority. The current admin UI is not connected to these PostgreSQL screens.
`min85639@gmail.com` is the intended sole Product Owner/Super Admin account;
sole-owner enforcement is not proven by the current repository. PostgreSQL
must become the backend role authority before claiming that guarantee.

## Purpose

Give a brand-new AI assistant enough context to work safely and accurately without rediscovering the project’s goals, rules, and approval boundaries.

## Current Status

### P1 verification status

P1 core functionality is implemented and a real 30-second end-to-end flow has
passed from upload through processing, final output, preview, and download.
Valid output enforcement and the authoritative `videoUrl` contract are verified
for that tested flow. P1 is functionally complete for the verified short-video
flow, but is not yet fully production-validated. Long-duration and reliability
verification remains pending because the available Gemini key/quota limited the
latest real E2E test to 30 seconds.

Treat the longer-job, Gemini error/quota, retry/resume, restart/recovery,
resource-usage, and performance items in `12_KNOWN_ISSUES.md` as pending
verification, not confirmed defects. Do not claim that long videos fail or that
retry/recovery is fixed without new repository evidence.

### Implemented

This file documents the current working-tree architecture as of 2026-07-31.

### Planned or Placeholder

The Credits and Super Admin UI use the existing billing/admin APIs, including
private `DATA_DIR` payment-proof upload and authenticated streaming. The
PostgreSQL billing API and live-job integration remain behind separate explicit
activation gates; global role cutover, synchronized database/proof-volume
backup/restore, and staging validation remain pending.

### Known Issues

Read `12_KNOWN_ISSUES.md` and `17_P2_FOUNDATION_ARCHITECTURE.md` before P2 work. Two job/lifecycle systems still coexist.

## Project Goals

- Convert an uploaded source video into a Burmese-narrated recap.
- Preserve chronological scene meaning and synchronized narration.
- Let users configure optional final visual effects before processing.
- Keep user media, outputs, sessions, and Gemini credentials private.
- Provide durable processing state, clear History, and reliable downloads.
- Operate within constrained compute using one processing job at a time.
- In P2, preserve BYOK for Trial/Normal, add Blink-funded Pro, and charge configurable duration-based Blink credits for every plan.
- In the future, support server-validated selectable voices with preview and plan, credit-cost, or provider eligibility.

## Architecture/Flow

```text
React workspace
  → Express workspace API
  → workspace-jobs.json + WorkspaceWorker
  → audio extraction
  → Gemini audio transcript/Burmese translation
  → workflow-v2 core bridge
  → saas-state.json + core processor
  → TTS/timeline/scene rebuild/export
  → final effects
  → authenticated canonical output
```

The workspace and core records share the job ID. Do not assume either can be deleted independently.

## Architecture Rules

1. Workflow-v2 is the current rendering core.
2. Queue concurrency remains one unless architecture and capacity are explicitly redesigned.
3. Upload creates `pending`; only explicit Start Processing queues it.
4. The canonical video is `/output/{jobId}.mp4`.
5. Effects order is Color → Flip → Blur → Subtitle → Verify.
6. Subtitle must remain unmirrored; Blur must use the previous/flipped output.
7. Disabled effects must perform no setup or FFmpeg work.
8. Only explicit user Cancel may request cancellation.
9. Fetch failure, SSE disconnect, refresh, and restart must never mean Cancel.
10. Authentication and ownership are backend responsibilities.
11. `DATA_DIR` owns production state and media.
12. One process/replica is assumed by current JSON persistence.

## Development Workflow

1. Read relevant docs and source before acting.
2. Inspect `git status`; existing changes belong to the user.
3. Distinguish diagnosis, proposal, and authorized implementation.
4. Make the smallest scoped change that satisfies an approved task.
5. Add focused tests proportional to risk.
6. Prefer lightweight verification on constrained devices.
7. Run TypeScript/build only when appropriate and authorized.
8. Report exact files changed and verification results.
9. Do not commit unless explicitly requested.
10. Update affected documentation after approved behavior changes.

### Safe local commands

```bash
npm install
cp .env.example .env.local
npm run dev
node --test
npm run lint
npm run build
npm run db:status
npm run db:migrate
```

There is no `npm test` script. Database status/migrations require an isolated
PostgreSQL connection and must never run automatically.

## Coding Rules

- Preserve unrelated dirty-worktree changes.
- Use `apply_patch` for source/document edits.
- Use `rg` for repository search.
- Keep API failures structured and preserve request IDs.
- Never log or return API keys, tokens, session cookies, or credentials.
- Normalize external input at boundaries.
- Validate filesystem paths before deletion or media operations.
- Do not silently weaken workflow/media validation.
- Keep frontend types aligned with backend public serializers.
- Treat mocks as control-flow proof, not final media proof.
- Avoid destructive Git and filesystem commands.

## Approval Workflow

- Read-only investigation requires no code mutation.
- Diagnosis does not authorize a fix.
- Code changes require an explicit implementation request.
- Billing/credits, authentication design, authorization hierarchy, destructive cleanup, data migrations, and external deployment require clear approval.
- If a required choice materially changes architecture or user data, stop and ask.
- No commit, push, PR, or deployment without explicit authorization.

## Current Risk Priorities

The repository contains approved P2 implementation behind inactive gates. Follow
the remaining operational boundaries in `17_P2_FOUNDATION_ARCHITECTURE.md`:

1. Production migration verification using isolated Railway staging resources.
2. Private screenshot object storage and content-verification adapters.
3. Backup/restore, reconciliation deadlines, and authenticated staging smoke.
4. Global PostgreSQL role/authority cutover only after approved migration.
5. Lifecycle consolidation, scaling, and later product scope.

## Things AI Must Never Change Without Approval

- Gemini behavior, prompts, model-selection policy, or provider contract.
- TTS voices, timing, retry, grouping, or duration-fit behavior.
- Timeline Verification or chronological mapping rules.
- Scene Rebuild or workflow-v2 semantics.
- Final export quality, codecs, synchronization tolerances, or download contract.
- Authentication provider/design, session lifetime, role authority, or admin bootstrap.
- Credits, billing, prices, ledger, payments, or refunds.
- BYOK migration/removal, platform-owned provider secrets, voice catalog eligibility, or arbitrary TTS parameters.
- Super-admin access rules.
- User-data retention, deletion, migrations, encryption, or storage roots.
- Queue concurrency or deployment replica model.
- Production deployment or secrets.
- Existing user changes in a dirty worktree.
- Commits, pushes, PRs, or deployments.

## File References

- Start here: `docs/00_PROJECT_OVERVIEW.md`
- Architecture: `docs/02_SYSTEM_ARCHITECTURE.md`
- Pipeline: `docs/03_AI_PIPELINE.md`
- API: `docs/05_API_CONTRACT.md`
- Known issues: `docs/12_KNOWN_ISSUES.md`
- Roadmap: `docs/14_ROADMAP.md`
- P2 foundation: `docs/17_P2_FOUNDATION_ARCHITECTURE.md`
- Server: `server.js`
- Workspace lifecycle: `src/services/workspaceJobs.js`, `src/services/workspaceWorker.js`
- Core workflow: `src/services/corePipelineBridge.js`, `src/workers/processor.js`

## Important Decisions

- Documentation describes the current working tree, not merely committed `main`.
- The unresolved React Router RSC-mode advisory has a documented beta risk acceptance only while Blink remains a declarative `BrowserRouter` Vite SPA without RSC, framework-mode, data-router actions, or server actions.
- Keep `react-router` and `react-router-dom` at `7.18.1`; do not downgrade to `7.11.0` or migrate to version 8 without separate architectural approval. Re-review when a compatible patched 7.x release or supported DOM migration path exists.
- The installed `uuid@9.0.1` remains reported for GHSA-w5hq-g745-h8pq, but the reviewed application and installed Google dependency call sites use only unaffected `v4()` calls without caller-provided buffers; the loaded `gaxios@7.3.0` uses `randomUUID()`, while audited but unloaded `gaxios@6.7.1` uses unaffected `v4()`. Treat this as a scoped beta risk acceptance, not remediation. Re-review before any `v3()`, `v5()`, or `v6()` buffer/offset use or during a compatible direct/Firebase Admin upgrade.
- `firebase-admin@13.10.0` is used only through modular App/Auth imports. Firestore, Cloud Storage, `google-gax`, `retry-request`, `teeny-request`, audited `gaxios@6.7.1`, and their `uuid` path are installed but not loaded or reachable. Treat the aggregate Firebase Admin finding as an Auth-only beta risk acceptance; re-review before enabling another Admin service, importing Google Cloud directly, changing import style, or changing Firebase Admin/lockfile versions.
- P1 security and dependency implementation work is complete for beta: `ws` is
  remediated, every remaining audit entry has an evidence-backed risk acceptance
  and re-review trigger, and 232/232 automated tests passed in that recorded
  cycle. This does not claim full P1 production validation; real E2E verification
  is currently limited to the documented 30-second flow, and the pending scope
  is authoritative in `12_KNOWN_ISSUES.md`. The work did not change the Core AI
  Pipeline contract, workflow, prompts, TTS behavior, timeline, FFmpeg
  composition, export, or accepted output quality. Authenticated staging smoke
  testing remains a separate pre-beta release gate.
- Trial/Normal/Pro policies, estimates, manual purchase review,
  first-purchase bonus, PostgreSQL financial Super Admin authority, and the
  gated live BYOK/Pro job admission/reservation/settlement implementation exist.
  The gates remain off and global role cutover is not complete.
- Credit balances and charges are exclusively backend-authoritative; clients never issue credits or determine settlement.
- Trial/Normal/Pro are plans, never roles. Firebase verifies identity; PostgreSQL is the approved future role/permission authority.
- Preserve current BYOK and single-voice behavior until the applicable P2 phase is explicitly approved and verified.
- Authenticated staging smoke testing remains a separate pre-beta requirement.
- Current Railway screenshots prove only that a project and Production environment exist, a public URL exists, one replica is running, and the shown deployment succeeded. They do not establish that the deployment is Blink or verify `DATA_DIR`, a persistent volume, required variables, or startup/recovery logs. Deployment preflight remains blocked and authenticated staging smoke testing has not started.
- Never claim success solely from mocked tests.
- Safety, lifecycle integrity, and user-data correctness take precedence over cosmetic refactoring.

## Future Work

Keep this file concise and current after approved architectural decisions. Remove obsolete warnings only after the corresponding behavior is implemented, verified, and recorded in the changelog.
