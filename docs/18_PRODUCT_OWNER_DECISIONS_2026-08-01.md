# Product Owner Decisions — 2026-08-01

This is authoritative over conflicting older documentation. It records product
decisions, not implementation evidence. The Core AI Pipeline is unchanged.

## Product decisions

- Launch source duration is at most 15:00. This is Blink's safety limit, not a
  TikTok limit claim. Reject longer sources before queueing, processing, or
  reserving credits. Billing remains `ceil(seconds / 30)` blocks. Near-15-minute
  support is unverified until a real E2E passes.
- Manual purchase: user selects an active package, transfers directly to the
  Product Owner's bank, and uploads private screenshot/photo proof. The Product
  Owner checks the real bank outside Blink and manually adds matching credits
  only when payment is confirmed. There is no automated verification and this
  is not primarily Approve/Reject. Never credit the same proof/payment twice.
- Correct under-credit with a new credit entry and over-credit with a new debit.
  Never overwrite balances or delete original entries. Record reason, actor,
  timestamp, previous/resulting balances, optional payment reference, and audit.
- Packages are not code-locked. Owner/Super Admin can create, edit, activate,
  deactivate, archive, and reorder. Fields: name, price, credit amount, bonus
  credits, active status, display order, optional note. Users see active only.
  Changes require confirmation/audit and never rewrite historical values.
- Pro is a plan, never a role, and cannot grant administration. Roles are user,
  admin, super_admin. `min85639@gmail.com` is intended sole owner/Super Admin;
  sole-owner enforcement is not implemented.
- Required owner operations: user management, ban/unban, credit add/deduct and
  correction, packages, bank accounts, plans/rates, proof review, ledger, audit,
  and System Status. Ban/unban persistence/API and final owner UI are absent.
- API Health/internal operational details belong only in owner-only System
  Status, never normal-user/general role dashboards. Detailed per-user CPU/RAM,
  server, Gemini/cost/provider analytics are deferred, not a launch blocker,
  and not user-facing. Future owner-only basics may show processed minutes,
  credits charged, Gemini cost, and job outcomes.
- Final redesign is pending. Keep New Recap in one stable container without
  jumping/reflow and preserve terminology/functionality. Developer role/screen
  and state switches are prototype-only. Do not add blur, subtitle-position,
  font, or color controls. Use suitable mobile navigation (for example a
  hamburger drawer) and clear desktop SaaS navigation. Mark unfinished mocks.
- Railway Hobby is active. Staging was duplicated from old production but points
  to old/main and is not deploy-ready. Do not deploy it as new Blink staging;
  keep auto-deploy off until a deploy-ready branch exists. Prepare code, docs,
  tests, PostgreSQL, and deployment config first. Railway is staging/test first.
  Use a separate staging PostgreSQL database; do not blindly reuse production
  database, volume, or secrets.

## Evidence status

- **Implemented:** P1 30-second local E2E; default-off PostgreSQL P2 code.
- **Unit-tested:** recorded non-native P2 tests; see project overview results.
- **Native PostgreSQL verified:** all three integration suites passed using an
  isolated `TEST_DATABASE_URL`, including migrations and restart persistence.
- **Staging-required verification:** production migration, backup/restore,
  isolated staging infrastructure, and near-15-minute real E2E.
- **Implemented:** authoritative 15:00 upload and queue enforcement, with
  immediate frontend validation. This is code/test status, not real E2E proof.
- **Implemented behind the default-off PostgreSQL billing gate:** Super Admin
  credit-package create, edit, activate/deactivate, archive, and reorder APIs;
  active-only user reads; confirmation, idempotency, audit, and no-delete guards.
- **Not implemented:** verified near-15-minute real-world support;
  ban/unban; sole-owner enforcement; final owner UI; final redesign; complete
  manual payment-proof operations and credit-package UI.
- **Production-only:** activation/cutover and production data/secrets occur only
  after staging acceptance. Billing gates remain off pending that acceptance.
