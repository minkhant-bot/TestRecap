# Admin System

## Purpose

Describe the current administrative authorization, backend endpoints, UI exposure, and known gaps.

## Current Status

### Implemented

- Role strings: `super_admin`, `admin`, `user`.
- Backend `requireAdmin` accepts admin and super-admin.
- Admin endpoints can list Firebase users, update role/status, inspect the core queue/jobs, view in-memory logs, and return process/system metrics.
- Super-admin receives Dashboard and Projects navigation in the current UI.
- An administrator cannot disable their own account through the update route.

### Planned or Placeholder

- The shell contains admin-oriented navigation labels, but dedicated Users, Queue, Jobs, System Status, and Logs screens are not implemented.
- Durable administrative audit history and custom-claim-based role authority are absent.
- No approved admin-completion plan is recorded in the repository.

### Known Issues

- Role mapping currently ignores custom claims.
- One hard-coded email becomes super-admin; everyone else becomes user.
- Documented `FIREBASE_ADMIN_UIDS` bootstrap is absent.
- The current dashboard and projects pages call user workspace APIs, not admin APIs.
- An admin update endpoint accepts promotion to super-admin without a privilege hierarchy.

## Architecture/Flow

Current intended backend flow:

```text
Session cookie
  → Firebase verification
  → req.user.role
  → requireAdmin
  → /api/admin/*
```

Current actual role derivation:

```text
Firebase user email == hard-coded email
  → super_admin
otherwise
  → user
```

Although `PATCH /api/admin/users/{uid}` writes Firebase custom claims, later profile mapping does not read those claims.

### Admin endpoints

- Users: Firebase `listUsers`.
- User update: custom role claim plus Firebase disabled status.
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
- The current admin foundation is not production-complete.

## Future Work

The following are unapproved admin-system recommendations:

- Select and implement one authoritative role source.
- Remove the hard-coded super-admin identity.
- Add privilege hierarchy, self-elevation prevention, and last-super-admin protection.
- Connect an approved admin UI to the admin API.
- Include workspace jobs/queue or consolidate the two job systems first.
