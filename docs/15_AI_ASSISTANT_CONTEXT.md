# AI Assistant Context

## Purpose

Give a brand-new AI assistant enough context to work safely and accurately without rediscovering the project’s goals, rules, and approval boundaries.

## Current Status

### Implemented

This file documents the current working-tree architecture as of 2026-07-29.

### Planned or Placeholder

The Credits page is a placeholder and the admin experience is an incomplete foundation. Hosted credits and later multiple selectable voices are approved future product direction, but are not implemented or approved implementation scope. The remediation phases in `14_ROADMAP.md` remain proposals.

### Known Issues

Read `12_KNOWN_ISSUES.md` before proposing work. The working application is not fully tracked, and two job/lifecycle systems coexist.

## Project Goals

- Convert an uploaded source video into a Burmese-narrated recap.
- Preserve chronological scene meaning and synchronized narration.
- Let users configure optional final visual effects before processing.
- Keep user media, outputs, sessions, and Gemini credentials private.
- Provide durable processing state, clear History, and reliable downloads.
- Operate within constrained compute using one processing job at a time.
- In the future, replace mandatory BYOK with purchased credits and server-side platform AI/TTS credentials.
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

The repository contains approved future product direction but no approved delivery plan. Remediation should continue by risk priority. When hosted-credit implementation is approved, its required order is:

1. Credit ledger and accounting.
2. Platform-owned secret/key architecture.
3. Job reservation, charge, refund, and cancellation settlement.
4. Payment integration with confirmation before credit issuance.
5. Explicit, safe BYOK migration or removal.
6. Multiple voice catalog, preview, selection, server validation, and pricing.

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
- Server: `server.js`
- Workspace lifecycle: `src/services/workspaceJobs.js`, `src/services/workspaceWorker.js`
- Core workflow: `src/services/corePipelineBridge.js`, `src/workers/processor.js`

## Important Decisions

- Documentation describes the current working tree, not merely committed `main`.
- The unresolved React Router RSC-mode advisory has a documented beta risk acceptance only while Blink remains a declarative `BrowserRouter` Vite SPA without RSC, framework-mode, data-router actions, or server actions.
- Keep `react-router` and `react-router-dom` at `7.18.1`; do not downgrade to `7.11.0` or migrate to version 8 without separate architectural approval. Re-review when a compatible patched 7.x release or supported DOM migration path exists.
- The installed `uuid@9.0.1` remains reported for GHSA-w5hq-g745-h8pq, but the reviewed application and installed Google dependency call sites use only unaffected `v4()` calls without caller-provided buffers; the loaded `gaxios@7.3.0` uses `randomUUID()`, while audited but unloaded `gaxios@6.7.1` uses unaffected `v4()`. Treat this as a scoped beta risk acceptance, not remediation. Re-review before any `v3()`, `v5()`, or `v6()` buffer/offset use or during a compatible direct/Firebase Admin upgrade.
- `firebase-admin@13.10.0` is used only through modular App/Auth imports. Firestore, Cloud Storage, `google-gax`, `retry-request`, `teeny-request`, audited `gaxios@6.7.1`, and their `uuid` path are installed but not loaded or reachable. Treat the aggregate Firebase Admin finding as an Auth-only beta risk acceptance; re-review before enabling another Admin service, importing Google Cloud directly, changing import style, or changing Firebase Admin/lockfile versions.
- P1 security and dependency work is complete for beta: `ws` is remediated, every remaining audit entry has an evidence-backed risk acceptance and re-review trigger, and 232/232 automated tests pass. It did not change the Core AI Pipeline contract, workflow, prompts, TTS behavior, timeline, FFmpeg composition, export, or accepted output quality. Authenticated staging smoke testing remains a separate pre-beta release gate.
- Hosted credits and selectable voices are approved product direction, not implemented behavior or approved implementation scope.
- Credit balances and charges are exclusively backend-authoritative; clients never issue credits or determine settlement.
- Preserve current BYOK and single-voice behavior until explicit replacement implementation is approved and verified.
- Authenticated staging smoke testing remains a separate pre-beta requirement.
- Current Railway screenshots prove only that a project and Production environment exist, a public URL exists, one replica is running, and the shown deployment succeeded. They do not establish that the deployment is Blink or verify `DATA_DIR`, a persistent volume, required variables, or startup/recovery logs. Deployment preflight remains blocked and authenticated staging smoke testing has not started.
- Never claim success solely from mocked tests.
- Safety, lifecycle integrity, and user-data correctness take precedence over cosmetic refactoring.

## Future Work

Keep this file concise and current after approved architectural decisions. Remove obsolete warnings only after the corresponding behavior is implemented, verified, and recorded in the changelog.
