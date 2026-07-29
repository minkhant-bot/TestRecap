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
- Admin foundation endpoints are mounted behind `requireAdmin`.

### Planned or Placeholder

- No approved API expansion plan is recorded in the repository.
- Versioning, pagination, idempotency keys, rate limits, OpenAPI, and credits endpoints are absent; they are recommendations rather than implemented placeholders.

### Known Issues

- Legacy and workspace APIs overlap.
- Global settings routes are available to every authenticated user.
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
| DELETE | `/workspace/jobs/{jobId}` | Delete non-active workspace job |
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

`/diagnostic`, `/voices`, `/preview-voice`, `/settings`, `/jobs`, `/process-recap`, `/process`, `/retry/{jobId}`, `/status/{jobId}`, `/projects`, `/play/{jobId}`, `/completed-jobs`, and legacy job deletion/cancellation routes remain active.

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
- Add idempotency, pagination, rate limiting, and credits admission.
- Standardize all API errors around request IDs and machine-readable codes.
