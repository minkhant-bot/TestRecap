# Admin System

> Product decision: internal health is owner-only System Status. Ban/unban and
> the final operational UI are not implemented. Required owner capabilities are
> listed in `18_PRODUCT_OWNER_DECISIONS_2026-08-01.md`.

## Purpose

Describe the current administrative authorization, backend endpoints, UI exposure, and known gaps.

## Current Status

### Implemented

- Role strings: `super_admin`, `admin`, `user`.
- Backend `requireAdmin` accepts admin and super-admin.
- Validated Firebase custom claims are the authoritative role source.
- `FIREBASE_SUPER_ADMIN_UIDS` provides server-side initial super-admin bootstrap.
- Admin endpoints can list Firebase users, update role/status, inspect the core queue/jobs, view in-memory logs, and return process/system metrics.
- Super-admin receives a single "Super Admin" navigation item pointing at `/admin`, rendering a tab-based console (`src/ui/pages/SuperAdminPage.tsx`): Overview, Users, Trial Requests, Purchases, Packages, Credits, Audit Log, and System Status. The former separate Dashboard and Projects pages/navigation items were removed; `/dashboard` and `/projects` now redirect to `/admin` and `/new-recap`.
- Role and status mutations enforce `user < admin < super_admin`, revalidate the actor, and serialize concurrent changes.
- Administrators cannot change roles, modify peers/higher roles, or change their own role/status.
- Bootstrap and last-active-super-admin protections prevent administrative lockout.
- When the billing foundation is explicitly enabled, PostgreSQL
  `super_admin`—not generic Firebase `admin`—is required for purchase decisions,
  plan/catalog/promotion policy, Trial assessments, Trial-request review/approval,
  adjustments, screenshot metadata verification, and financial/audit reads.
- A second, simplified Trial pathway now exists alongside the original
  eligibility-assessment flow: an authenticated user can submit one lifetime
  `POST /api/trial/request`, and PostgreSQL `super_admin` reviews it through
  `GET /api/admin/billing/trial-requests` and approves with
  `POST /api/admin/billing/trial-requests/{id}/approve` (idempotent, no
  rejection state). Approval grants a fixed 12 credits expiring 120 hours
  later. See `07_CREDITS_SYSTEM.md` for the full rule.
- `min85639@gmail.com` is the intended sole Product Owner/Super Admin account;
  the repository does not prove sole-owner enforcement. Planned ban/unban and
  reasoned, audited grant/deduction/refund/reversal operations are not complete.

### Planned or Placeholder

- The shell contains admin-oriented navigation labels, but dedicated Users, Queue, Jobs, System Status, and Logs screens are not implemented.
- Durable administrative audit history is absent.
- P2 moves application role/permission authority to PostgreSQL while Firebase remains identity authority.
- PostgreSQL role authority and restart-persistent role/ban state are not yet
  active. Backend PostgreSQL authorization is required for the cutover; a
  frontend email check cannot establish authorization.
- Live-job billing/recovery and financial refund/reversal operations are present
  only in the separately gated PostgreSQL billing domain. Normal Admin receives
  no credit-changing permission.
- The protected bootstrap and role migration contract is in `17_P2_FOUNDATION_ARCHITECTURE.md`.

### Known Issues

- The Super Admin console's Overview tab still reads the ordinary user-facing
  workspace-jobs API (via `useWorkspaceJobs`/`JobList`) rather than a dedicated
  admin queue view, even though its other tabs (Users, Trial Requests,
  Purchases, Packages, Credits, Audit Log) now call real admin/billing APIs.

## Architecture/Flow

Current backend flow:

```text
Session cookie
  → Firebase verification
  → req.user.role
  → requireAdmin
  → /api/admin/*
```

Role derivation:

```text
Configured bootstrap UID
  → super_admin
otherwise validated Firebase custom role claim
  → user | admin | super_admin
missing claim
  → user
malformed or unsupported claim
  → authentication rejected
```

Every authenticated request reads the current Firebase user record rather than
trusting role data from the browser or session token. Administrative mutations
re-read the actor inside the serialized mutation boundary so a concurrently
demoted or disabled administrator cannot continue with stale authority.

### Admin endpoints

- Users: Firebase `listUsers`.
- User update: hierarchy-checked custom role claim plus Firebase disabled status.
- Queue and jobs: legacy/core `p-queue` and `saas-state.json`, not the workspace queue/store.
- Logs: last 500 in-memory audit events.
- System: uptime, Node/platform/CPU/memory, and core queue snapshot.

## File References

- Role mapping and Firebase operations: `src/services/firebaseAdmin.js`
- Authorization middleware: `src/middleware/auth.js`
- Admin API: `src/routes/admin.js`
- Audit events: `src/services/auditLog.js`
- Admin route wrappers: `src/ui/AppFoundation.tsx`
- Current Super Admin console: `src/ui/pages/SuperAdminPage.tsx`

## Important Decisions

- Client-provided roles are never trusted.
- Account-disabled state is checked by Firebase Admin.
- Backend authorization, not hidden navigation, must protect admin operations.
- Only super-admins may change roles.
- Configured bootstrap super-admins cannot be demoted or disabled through the API.
- At least one active super-admin must always remain.
- The current admin foundation is not production-complete.
- Trial and Pro are the currently implemented commercial plans and must never
  enter `user_roles` (Normal remains architecturally defined in
  `17_P2_FOUNDATION_ARCHITECTURE.md` but is not selectable through any
  current code path — see `07_CREDITS_SYSTEM.md` "Plan model").

## Future Work

The following remain unimplemented:

- Connect an approved admin UI to the admin API.
- Include workspace jobs/queue or consolidate the two job systems first.
- Complete global PostgreSQL role authority cutover, protected bootstrap
  activation, and production audit/financial operations after isolated
  verification; the gated financial boundaries already exist.
