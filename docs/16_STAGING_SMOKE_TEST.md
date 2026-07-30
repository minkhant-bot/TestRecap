# Authenticated Railway Staging Smoke-Test Plan

## Purpose

Define the mandatory, manual pre-beta checks against the real Railway staging deployment. This document is a plan only; it does not record execution or approval.

## Current verification status

New Railway screenshots confirm that a Railway project and Production environment exist, a public URL exists, one replica is running, and the shown deployment succeeded. The screenshots do not verify that the deployment is Blink and do not provide evidence for `DATA_DIR`, a persistent volume or mount, required variables, or startup/recovery logs. Deployment preflight remains **BLOCKED**, and full authenticated staging smoke testing has not started.

## Required staging inputs

- `[STAGING_BASE_URL]`; `[RAILWAY_PROJECT/SERVICE/ENVIRONMENT]`; read-only access to deployment settings, replica count, volume configuration, and logs.
- Controlled Google/Firebase accounts `[USER_A]`, `[USER_B]`, `[ADMIN]`, `[SUPER_ADMIN_A]`, and `[SUPER_ADMIN_B]`, with their UIDs recorded privately. At least one super-admin must be outside the target of lockout tests.
- A controlled prior `[EXPIRED_SESSION_COOKIE]` or an approved five-day expiry observation window; never fabricate or publish a cookie.
- `[SMALL_VALID_VIDEO]` and valid per-user `[GEMINI_TEST_KEY]` inputs; use low-cost, non-sensitive media.
- Expected staging values, recorded without secret contents: `[DATA_DIR]`, volume mount path, admission limits/windows, upload limit, Firebase project identifiers, and configured bootstrap UID membership.
- A private evidence folder `[EVIDENCE_DIR]` and test run ID `[RUN_ID]`. Redact cookies, bearer tokens, API keys, service-account material, and complete environment values.

`DATA_DIR` and the Railway mount path must be identical. The repository default is `/data`, not `/app/data`; if staging intentionally uses `/app/data`, both the variable and mounted volume must use `/app/data`.

## Execution record

For every case record UTC time, tester, deployment ID, application version/source identifier, account role/UID alias, request method/path, status, relevant response headers/body, log correlation/request ID, evidence filenames, cleanup outcome, and Pass/Fail. Never run destructive role tests without `[SUPER_ADMIN_B]` verified active.

## Smoke-test checklist

| ID | Preconditions | Exact action | Expected result and evidence | Pass/fail and cleanup |
|---|---|---|---|---|
| DEP-1 | Railway access | Inspect service, deployment, variables, and volume; verify `DATA_DIR`, `MAX_UPLOAD_SIZE_MB`, all four admission variables, Firebase web/Admin configuration, `FIREBASE_SUPER_ADMIN_UIDS`, and Railway `PORT`; request `GET /api/health`; restart once and inspect startup logs | Exactly one replica; required variables present; bootstrap UID list nonempty; `DATA_DIR` equals mount; health 200 `{"status":"ok"}`; clean startup/recovery | Pass only if all match. Screenshot redacted settings, volume, health, logs. No cleanup. |
| DEP-2 | Browser/devtools | Inspect built frontend, `/api/config/firebase`, auth/workspace/admin responses, and logs | Only public Firebase web config is exposed; no service account, Gemini key, cookie, encryption key, or bootstrap UID list | Fail on any secret disclosure. Capture redacted network/log screenshots; remove downloaded artifacts. |
| AUTH-1 | `[USER_A]` signed out | Complete real Google popup sign-in, then call `GET /api/auth/me` | Session POST succeeds; Secure, HttpOnly, SameSite=Lax `__session`; `/me` 200 with User A and authoritative role | Capture UI/network without token/cookie values. Logout afterward unless reused. |
| AUTH-2 | No cookie, malformed cookie, wrong-provider/invalid ID token where safely available | Call `/api/auth/me`; attempt `/api/auth/session` with missing/malformed/invalid token | Protected call 401; session request 400 when missing and 401 when invalid; no session established | Capture status/body/log. Clear test cookies. |
| AUTH-3 | Valid User A session | Revoke refresh tokens by logout or Firebase control, then reuse the old cookie | `POST /api/auth/logout` 200 and clears cookie; old revoked session is rejected on next protected request | Capture logout headers and subsequent 401. Sign in again if needed. |
| AUTH-4 | `[EXPIRED_SESSION_COOKIE]` or approved expiry window | Call `/api/auth/me` with the expired cookie | 401; UI returns to sign-in; no protected data returned | Capture status/UI. Delete retained cookie securely. |
| ROLE-1 | Sessions for all roles | Call `/api/admin/system`, `/api/admin/users`, and `/api/admin/jobs`; exercise ordinary workspace reads | User receives 403 from admin APIs; admin/super-admin receive 200; all retain owner-scoped workspace access | Capture role-specific request matrix. No mutation cleanup. |
| ROLE-2 | Super-admin plus disposable User A | Through `PATCH /api/admin/users/{uid}`, promote/demote User A; reuse User A’s existing session immediately | Only super-admin may change role; existing session reflects current Firebase record on next request; demoted/disabled access stops immediately | Capture before/after `/me`, API result, audit log. Restore User A role/status. |
| ROLE-3 | Admin, super-admins, disposable targets | Admin attempts elevation, peer/higher modification, and role change; each actor attempts own role/status change; attempt demotion/disable of bootstrap and sole-active-super-admin conditions | Policy rejects with 403/409 and documented code; no partial mutation; at least one active super-admin remains | Capture responses, Firebase user state, audit logs. Restore every target and verify both super-admins active. |
| ADM-1 | Admission counters known; User A | Upload two valid jobs, then a third | First two create pending jobs; third is 429 `ACTIVE_JOB_QUOTA_EXCEEDED` with count/limit; User B remains independent | Capture requests/UI/logs. Cancel/delete created jobs when terminal. |
| ADM-2 | Processing limit/window recorded | Sequentially queue controlled jobs until the configured processing limit, allowing terminal cleanup between starts; submit one more | Accepted starts return 202; excess returns 429 `PROCESSING_USAGE_LIMIT_EXCEEDED`, numeric limit/remaining/window/retryAfter/requestId, and `Retry-After` matching retryAfterSeconds | Capture each job ID and final headers/body. Cancel/delete artifacts; do not exceed planned provider cost. |
| ADM-3 | Mutation limit/window recorded | Send controlled protected mutations (prefer DELETE of unique nonexistent test job IDs) through the configured limit, then one extra | Excess returns 429 `REQUEST_RATE_LIMIT_EXCEEDED` with structured fields and matching `Retry-After`; other users remain unaffected | Capture count and response. Wait for window expiry; verify a later mutation is admitted. |
| ADM-4 | Nonzero admission use and at least one queued/processing controlled job | Record counters/jobs; restart Railway; reconnect and inspect state; repeat with a redeploy only if separately approved | Admission state survives; active usage reconciles once without duplicate charge; job ID/owner/status recover; fresh SSE starts with snapshot | Capture pre/post API, volume files/metadata without contents, deployment and recovery logs. Clean terminal jobs. |
| PERSIST-1 | Railway shell/observability access | Verify `[DATA_DIR]` paths for admission, workspace/core jobs, auth profiles, encryption key, uploads/cache/output; create a marker through normal app behavior, restart | Required records and key persist on mounted volume; runtime temporary/atomic files are not treated as canonical records and stale temporaries do not replace valid state | Capture redacted path metadata and before/after application results. Remove test jobs/media through APIs, not direct file deletion. |
| ACCESS-1 | User A owns pending and completed jobs; User B signed in | User A and B request job, status, source, SSE, and output URLs; retry without cookie and with invalid IDs/path variants | Owner succeeds; cross-user workspace resources return 404; protected output is denied (401/403 as applicable); invalid paths never disclose files | Capture status matrix and logs. Delete controlled jobs after checks. |
| ACCESS-2 | One real completed controlled job | Compare job/status/history/SSE payloads; fetch `videoUrl` MP4 and `audioUrl` MP3 with session; inspect/play both; retry without session | Completed record has one authoritative MP4 `videoUrl` `/output/{jobId}.mp4`; optional MP3 is `/output/{jobId}.mp3`; authenticated downloads are nonempty, playable, and tied to the same job | Capture payload, headers, media metadata, short UI screenshot. Delete job and both outputs via API. |
| ACCESS-3 | Controlled failed/cancelled job and invalid/missing-output scenario that does not alter production state | Inspect job/status/history and request predicted output URLs | Failed/cancelled/missing output never reports completed or exposes a working download; completed status is accepted only with validated final MP4 | Capture state, download response, logs. Delete terminal records. |

## Blocking failure criteria

Any authentication bypass, secret exposure, cross-user access, admin-policy bypass, privilege/self/last-super-admin lockout, missing or malformed admission enforcement, counter reset/double-count after restart, record/key loss, multi-replica deployment, volume/`DATA_DIR` mismatch, false completed state, unprotected/unplayable output, unhealthy startup, or unexplained 5xx is an immediate no-go. Missing or unredacted evidence also prevents sign-off.

## Cleanup and closeout

Restore all custom claims and disabled states; verify two active super-admins and configured bootstrap accounts. Logout/revoke all test sessions. Delete controlled workspace/core jobs and linked uploads/cache/MP4/MP3 through authenticated APIs; verify they are inaccessible. Delete test Gemini credentials through the workspace API. Allow rate windows to expire and record normalized counters. Remove local evidence copies containing media or credentials, retain only redacted evidence, and record any intentionally retained staging fixture with owner and deletion date.

## Go/no-go

Go requires every row to pass on one identified deployment, complete redacted evidence, successful cleanup, exactly one replica, and no blocking failure. Any failure is No-Go until corrected and the affected case plus its dependent cases are rerun.
