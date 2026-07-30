# API Contract

## Purpose

Describe the currently mounted HTTP contract, authorization boundaries, request shapes, and response behavior.

## Current Status

### Implemented

- The current client calls JSON and multipart APIs under `/api` on the same origin; the server also installs its current CORS middleware globally.
- Firebase session establishment and authenticated application APIs.
- Workspace job creation, queueing, status, SSE, cancellation, deletion, source preview, and Gemini-key management.
- Protected output delivery under `/output`.
- Legacy workflow, settings, voice, retry, project, and compatibility routes remain mounted.
- Legacy global settings and diagnostic routes require an administrator role.
- Legacy job-creation compatibility routes require an administrator role.
- Admin foundation endpoints are mounted behind `requireAdmin`.
- Authenticated processing starts and selected mutation endpoints enforce durable per-user admission limits.

### Planned or Placeholder

- No approved API expansion plan is recorded in the repository.
- Versioning, pagination, client idempotency keys, OpenAPI, and credits endpoints are absent; they are recommendations rather than implemented placeholders.

### Known Issues

- Legacy and workspace APIs overlap.
- Some errors are generic or not handled by a final structured API error middleware.
- Admin APIs are not used by the current admin UI.

## Architecture/Flow

All paths below are prefixed with `/api` unless shown otherwise.

### Public routes

| Method | Path | Response |
|---|---|---|
| GET | `/health` | `{ "status": "ok" }` |
| GET | `/config/firebase` | Public Firebase web configuration |
| POST | `/auth/session` | Creates HTTP-only `__session`; returns `{ user }` |

### Authenticated session

| Method | Path | Purpose |
|---|---|---|
| GET | `/auth/me` | Return verified current profile |
| POST | `/auth/logout` | Revoke refresh tokens and clear session cookie |

### Workspace key API

| Method | Path | Purpose |
|---|---|---|
| POST | `/workspace/gemini-key/verify` | Verify a supplied key without storing it |
| GET | `/workspace/gemini-key` | Return `{ hasApiKey }` |
| PUT | `/workspace/gemini-key` | Verify and store the current user’s key |
| DELETE | `/workspace/gemini-key` | Delete the current user’s stored key |

### Workspace jobs

| Method | Path | Purpose |
|---|---|---|
| GET | `/workspace/config` | Upload size and supported extensions |
| POST | `/workspace/jobs` | Multipart upload; create pending job |
| GET | `/workspace/jobs` | List current user’s jobs |
| GET | `/workspace/jobs/{jobId}` | Get owned job |
| GET | `/workspace/jobs/{jobId}/source` | Stream owned source file |
| POST | `/workspace/jobs/{jobId}/queue` | Persist effects and queue pending job |
| GET | `/workspace/jobs/{jobId}/status` | Job plus queue position |
| GET | `/workspace/jobs/{jobId}/events` | SSE snapshot/progress events |
| POST | `/workspace/jobs/{jobId}/cancel` | Explicit cancellation request |
| DELETE | `/workspace/jobs/{jobId}` | Delete a non-active workspace/core job and linked artifacts |
| GET | `/workspace/queue` | Current user’s queue view and worker snapshot |

Queue request:

```json
{
  "geminiApiKey": "",
  "effects": {
    "colorGrading": "cinematic",
    "flipVideoEnabled": true,
    "burnSubtitlesEnabled": false,
    "subtitlePosition": {
      "xPct": 10,
      "yPct": 78,
      "widthPct": 80,
      "heightPct": 12
    },
    "blurEnabled": false,
    "blurBoxes": []
  }
}
```

Successful queueing returns HTTP 202 with a workspace job and `queuePosition`.

Workspace upload admission permits at most two active jobs per user, where active means `pending`, `queued`, or `processing`. An exhausted quota returns HTTP 429:

```json
{
  "error": "You can have at most 2 active recap projects.",
  "code": "ACTIVE_JOB_QUOTA_EXCEEDED",
  "activeJobCount": 2,
  "activeJobLimit": 2
}
```

Independently, each user may make 30 protected mutation attempts per rolling five minutes and may start six processing jobs per rolling 24 hours by default. Processing usage is consumed once per accepted job ID. Workspace queueing and administrator-only legacy creation routes share the processing limit. Admission failures return HTTP 429 with `Retry-After`:

```json
{
  "error": "Processing usage limit exceeded",
  "code": "PROCESSING_USAGE_LIMIT_EXCEEDED",
  "limit": 6,
  "remaining": 0,
  "windowSeconds": 86400,
  "retryAfterSeconds": 120,
  "requestId": "..."
}
```

Mutation-rate failures use the same shape with `REQUEST_RATE_LIMIT_EXCEEDED`.

Workspace deletion returns HTTP 409 if either the workspace job or its linked core job is still active, or if their recorded owners do not match. Filesystem safety failures return structured HTTP 500 without deleting either record during preflight.

### SSE events

- `job.snapshot`
- `queue.position_changed`
- `job.processing_started`
- `job.cancellation_requested`
- `stage.started`
- `stage.progress`
- `stage.completed`
- `job.completed`
- `job.failed`
- `job.cancelled`
- `job.recovered`
- `heartbeat`

SSE event IDs are process-local and reset on restart. A fresh connection always receives a snapshot.

### Protected output

`GET /output/{uuid}.mp4|mp3` requires a valid session, an accessible core job, and core status `complete`.

### Admin foundation

- `GET /admin/users`
- `PATCH /admin/users/{uid}`
- `GET /admin/queue`
- `GET /admin/jobs`
- `GET /admin/logs`
- `GET /admin/system`

### Mounted legacy routes

`/diagnostic`, `/voices`, `/preview-voice`, `/settings`, `/jobs`, `/process-recap`, `/process`, `/retry/{jobId}`, `/status/{jobId}`, `/projects`, `/play/{jobId}`, `/completed-jobs`, and legacy job deletion/cancellation routes remain active. `/diagnostic`, both `/settings` operations, and the `/jobs`, `/process-recap`, and `/process` creation routes additionally require `requireAdmin`.

## File References

- Router composition: `src/routes/api.js`
- Workspace router: `src/routes/workspace.js`
- Authentication router: `src/routes/auth.js`
- Admin router: `src/routes/admin.js`
- Authorization middleware: `src/middleware/auth.js`
- Client API wrapper: `src/ui/workspace/api.ts`
- Public types: `src/ui/workspace/types.ts`

## Important Decisions

- Workspace resources return 404 rather than revealing another user’s job.
- Session cookies are sent with `credentials: include`.
- Queueing is valid only from `pending`.
- Effect normalization occurs before persistence.
- Validation failures return JSON with an `error` field.
- Successful queue and cancel requests return HTTP 202.

## Future Work

The following are unapproved API recommendations:

- Publish an OpenAPI contract after choosing the canonical job model.
- Remove or version deprecated routes after consumer verification.
- Add client idempotency and pagination; credits admission requires separate product approval.
- Standardize all API errors around request IDs and machine-readable codes.
