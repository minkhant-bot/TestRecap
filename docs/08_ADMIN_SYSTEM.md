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

### Planned or Placeholder

- The shell contains admin-oriented navigation labels, but dedicated Users, Queue, Jobs, System Status, and Logs screens are not implemented.
- Durable administrative audit history is absent.
- No approved admin-completion plan is recorded in the repository.

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

## Future Work

The following are unapproved admin-system recommendations:

- Connect an approved admin UI to the admin API.
- Include workspace jobs/queue or consolidate the two job systems first.
