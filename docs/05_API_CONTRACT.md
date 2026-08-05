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
- Explicitly gated PostgreSQL billing APIs for plans, Trial eligibility/grants,
  estimates, balances/ledger, credit packages/banks, private screenshot
  metadata, purchase requests, and PostgreSQL-Super-Admin financial operations.

### Planned or Placeholder

- Production billing activation and Railway proof-volume backup/restore
  verification remain pending. Private multipart upload and authenticated
  streaming are implemented against `DATA_DIR`.
- P2 financial mutations require idempotency keys, PostgreSQL transaction boundaries, structured errors, and durable audit events.

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
| GET | `/workspace/config` | Upload size, 900-second duration limit, and supported extensions |
| POST | `/workspace/jobs` | Multipart upload; authoritatively probe duration and create a pending job only at or below 15:00 |
| GET | `/workspace/jobs` | List current user’s jobs |
| GET | `/workspace/jobs/{jobId}` | Get owned job |
| GET | `/workspace/jobs/{jobId}/source` | Stream owned source file |
| POST | `/workspace/jobs/{jobId}/queue` | Persist effects and queue pending job |
| GET | `/workspace/jobs/{jobId}/status` | Job plus queue position |
| GET | `/workspace/jobs/{jobId}/retry` | Inspect owner-scoped failed-job recoverability without exposing private paths |
| POST | `/workspace/jobs/{jobId}/retry` | Idempotently requeue one recoverable failed job from its validated checkpoint |
| GET | `/workspace/jobs/{jobId}/events` | SSE snapshot/progress events |
| POST | `/workspace/jobs/{jobId}/cancel` | Explicit cancellation request |
| DELETE | `/workspace/jobs/{jobId}` | Delete a non-active workspace/core job and linked artifacts |
| GET | `/workspace/queue` | Current user’s queue view and worker snapshot |

Queue request:

```json
{
  "planCode": "normal",
  "billingMode": "byok",
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

`planCode`, `billingMode`, and `Idempotency-Key` are required only when the
separate live-job billing gate is enabled. Trial accepts only `byok`; Pro
accepts only `blink_funded`. (The originally designed Normal plan would also
have accepted only `byok`, but `billingFoundation.js` no longer assigns any
user to Normal — see `07_CREDITS_SYSTEM.md` "Plan model" — so `planCode:
"normal"` cannot currently occur on a real reservation.) Successful queueing
returns HTTP 202 with a
workspace job, immutable safe billing snapshot, and `queuePosition`. BYOK
credential/quota failures use structured `BYOK_*` codes and never fall back to
Blink-funded mode.

Retry requires `Idempotency-Key` and returns HTTP 202 `RETRY_ACCEPTED` for the
first failed-to-queued transition or HTTP 200 `RETRY_IDEMPOTENT_REPLAY` for the
same request already queued/processing. A different concurrent key receives
`JOB_ALREADY_ACTIVE`; non-failed jobs receive `JOB_NOT_FAILED`. Missing,
corrupt, incompatible, or inactive-billing checkpoints fail closed with a
structured `RETRY_*` code. Retry reuses the existing job ID, admission record,
billing reservation, worker queue, lease acquisition, SSE channel, and output
completion guard; it does not reserve credits again.

The backend ignores client duration as authority. It probes the uploaded source
before job creation and rechecks the stored source before queueing or billing
reservation. Over 15:00 returns HTTP 422 with code `SOURCE_VIDEO_TOO_LONG` and
message `Video is too long. Maximum supported duration is 15 minutes.` No job,
queue entry, processing, or credit reservation is created by that rejection.

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
- `job.retry_accepted`
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

### PostgreSQL billing foundation

These routes return `BILLING_NOT_ENABLED` unless `P2_BILLING_ENABLED=true` with
PostgreSQL configured. Mutations require `Idempotency-Key`.

User routes:

- `GET /plans`, `GET /plans/me`
- `POST /plans/me/select` always returns HTTP 410 `PLAN_SELF_SELECTION_REMOVED`;
  self-service plan selection has been removed. Pro is assigned automatically
  only as a side effect of an approved credit purchase; Trial is granted only
  through the request/approval flow below.
- `GET /trial/eligibility`, `POST /trial/grant` (original eligibility-assessment
  flow; still mounted and functional, but superseded by the simpler flow below)
- `GET /trial/request`, `POST /trial/request` — current Trial pathway. A user
  submits one lifetime request (`POST`, idempotent via `Idempotency-Key`,
  replays an existing pending/approved request, 409 `TRIAL_ALREADY_GRANTED` if
  a grant already exists) and reads their own request status (`GET`).
- `POST /jobs/estimate` (non-authoritative estimate only; no reservation)
- `GET /credits/balance`, `GET /credits/ledger`
- `GET /credit-plans`, `GET /credit-plans/{id}/bank-accounts`
- `GET /payment-proofs/config`
- `POST /uploads/payment-screenshots/intents` (internal-compatible metadata intent)
- `GET /uploads/payment-screenshots/{id}` and authenticated
  `GET /uploads/payment-screenshots/{id}/content` for the owning user only
- `POST /credit-purchase-requests/with-proof` using multipart fields
  `creditPlanId`, `bankAccountId`, and one `proof` image; requires
  `Idempotency-Key`
- `POST/GET /credit-purchase-requests`, `GET /credit-purchase-requests/{id}`

PostgreSQL-Super-Admin routes under `/admin/billing`:

- catalog, purchase list/approve/reject, plan and immutable policy creation;
- credit-package, bank, package-bank-link, and promotion configuration;
- Trial eligibility assessment and manual credit grant/deduction;
- `GET /trial-requests` (list pending Trial requests, joined with requester
  email/display name) and `POST /trial-requests/{id}/approve` (idempotent;
  requires the request still `pending` and no existing grant; grants a fixed
  12 credits expiring 120 hours later and marks the request `approved`; there
  is no reject transition in this flow);
- private screenshot metadata read and authenticated content streaming at
  `GET /screenshots/{id}/content`, per-user balance/ledger, and audit reads.
- `POST /credit-packages`, `PATCH /credit-packages/{id}`;
  `POST /credit-packages/{id}/activate|deactivate|archive`, and
  `POST /credit-packages/reorder`. Each mutation requires `confirmed: true` and
  `Idempotency-Key`; authorization is PostgreSQL `super_admin`.

`GET /credit-packages` is an alias of `GET /credit-plans` and returns only
active, non-archived packages to authenticated normal users. Package `price` is
stored as integer minor units; create also retains the existing required
three-letter `currency` field.

The multipart proof route validates JPEG, PNG, or WebP content server-side,
stores it below private `DATA_DIR/payment-proofs`, completes the owned metadata,
and creates the purchase as one retry-safe workflow. Content routes never expose
the object key or a public path. A purchase requires a verified owned metadata
record. The Owner still checks the bank outside Blink before using the separate,
idempotent add-matching-credits action.

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

The following remain unimplemented:

- Publish an OpenAPI contract after choosing the canonical job model.
- Remove or version deprecated routes after consumer verification.
- Add the P2 APIs and cursor pagination defined in `17_P2_FOUNDATION_ARCHITECTURE.md`.
- Preserve explicit BYOK versus Blink-funded mode; never silently fall back between them.
- Standardize all API errors around request IDs and machine-readable codes.
