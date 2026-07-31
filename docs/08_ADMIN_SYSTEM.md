# Admin System

## Purpose

Describe the current administrative authorization, backend endpoints, UI exposure, and known gaps.

## Current Status

### Implemented

- Role strings: `super_admin`, `admin`, `user`.
- Backend `requireAdmin` accepts admin and super-admin.
- Validated Firebase custom claims are the authoritative role source.
- `FIREBASE_SUPER_ADMIN_UIDS` provides server-side initial super-admin bootstrap.
- Admin endpoints can list Firebase users, update role/status, inspect the core queue/jobs, view in-memory logs, and return process/system metrics.
- Super-admin receives Dashboard and Projects navigation in the current UI.
- Role and status mutations enforce `user < admin < super_admin`, revalidate the actor, and serialize concurrent changes.
- Administrators cannot change roles, modify peers/higher roles, or change their own role/status.
- Bootstrap and last-active-super-admin protections prevent administrative lockout.
- When the billing foundation is explicitly enabled, PostgreSQL
  `super_admin`—not generic Firebase `admin`—is required for purchase decisions,
  plan/catalog/promotion policy, Trial assessments, adjustments, screenshot
  metadata verification, and financial/audit reads.
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

- The current dashboard and projects pages call user workspace APIs, not admin APIs.

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
- Current dashboard/projects: `src/ui/pages/DashboardPage.tsx`, `src/ui/pages/ProjectsPage.tsx`

## Important Decisions

- Client-provided roles are never trusted.
- Account-disabled state is checked by Firebase Admin.
- Backend authorization, not hidden navigation, must protect admin operations.
- Only super-admins may change roles.
- Configured bootstrap super-admins cannot be demoted or disabled through the API.
- At least one active super-admin must always remain.
- The current admin foundation is not production-complete.
- Trial, Normal, and Pro are commercial plans and must never enter `user_roles`.

## Future Work

The following remain unimplemented:

- Connect an approved admin UI to the admin API.
- Include workspace jobs/queue or consolidate the two job systems first.
- Complete global PostgreSQL role authority cutover, protected bootstrap
  activation, and production audit/financial operations after isolated
  verification; the gated financial boundaries already exist.
