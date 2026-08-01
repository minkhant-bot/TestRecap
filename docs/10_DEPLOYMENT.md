# Deployment

> Current staging truth: Railway Hobby is active; duplicated Staging points to
> old/main and is not deploy-ready. Keep auto-deploy off, do not deploy old code,
> and provision separate staging PostgreSQL without blindly reusing production
> database, volume, or secrets. See `18_PRODUCT_OWNER_DECISIONS_2026-08-01.md`.

## Purpose

Explain current local development and Railway/Docker production deployment, required configuration, persistent storage, health checks, and operational constraints.

## Current Status

### Implemented

- Local development through a scoped watcher and Vite middleware.
- Production Docker image based on Node 20 Bookworm Slim.
- Python virtual environment with Faster-Whisper dependencies.
- System FFmpeg, Burmese fonts, and cached Whisper model.
- Railway deployment configuration for Dockerfile builds, `/api/health`, one requested replica, and restart-on-failure. Railway main is initially a test/staging target, not production; this describes repository configuration, not verified live state.
- Persistent runtime paths under `DATA_DIR`.
- A startup-and-30-minute sweep applies the existing 24-hour completed-job retention window across linked workspace/core state.

### Planned or Placeholder

- P2 requires managed PostgreSQL and durable private payment-proof storage;
  neither is provisioned or verified on Railway. The implemented single-replica
  adapter stores proofs on the mounted `DATA_DIR` volume, never the ephemeral
  application filesystem or PostgreSQL blobs.
- Automated CI/CD gates, migrations, backup/restore, an observability backend, and multi-worker deployment are absent recommendations, not implemented placeholders.

### Known Issues

- Current application architecture is not fully tracked in Git.
- JSON stores require exactly one writer/replica.
- The repository/build context contains obsolete and generated artifacts.
- Shutdown cancellation cannot stop every deep media operation.
- The Blink Railway project, service, environment, public URL, replica state, variables, volume, and effective `DATA_DIR` have not been verified.

### Live deployment verification status

- Railway screenshots confirm that a project and Production environment exist, a public URL exists, one replica is running, and the shown deployment succeeded.
- Attribution of the shown Railway deployment to Blink: not verified.
- Railway volume and mount path: not verified.
- Effective `DATA_DIR`: not verified.
- Shown running replica count: one.
- Required production variables: not verified.
- A public URL is shown, but its status as the Blink staging URL is not verified.
- Startup and recovery logs: not verified.
- Deployment preflight: **BLOCKED** pending Blink attribution plus storage, variable, and log evidence.
- Full authenticated staging smoke testing: not started.

The screenshots establish only the Railway facts listed above. They do not verify
that the deployment is Blink or establish its runtime configuration.

## Architecture/Flow

### Local

```bash
npm install
cp .env.example .env.local
npm run dev
```

`npm run dev` starts `scripts/dev-server.mjs`, which launches `server.js`. Backend source/config changes restart the server; Vite handles frontend updates. Runtime writes do not intentionally trigger backend restart.

Default local binding: `http://0.0.0.0:3000`.

### Production build

1. Install OS Python, FFmpeg, certificates, and fonts.
2. Create `/opt/venv` and install `requirements.txt`.
3. Install Node dependencies including build tooling.
4. Copy repository.
5. Download Faster-Whisper `small` into the image cache.
6. Run `npm run build`.
7. Prune development dependencies.
8. Run as the non-root `node` user.
9. Start `node server.js`.

### Required/important environment

- `DATA_DIR=/data`
- `MAX_UPLOAD_SIZE_MB=<positive integer>`
- Optional `PAYMENT_PROOF_MAX_SIZE_MB` (integer 1–25, default 10); private proofs
  are stored below `DATA_DIR/payment-proofs`
- `PROCESSING_USAGE_LIMIT`, `PROCESSING_USAGE_WINDOW_MS`, `MUTATION_RATE_LIMIT`, and `MUTATION_RATE_WINDOW_MS` (all required positive bounded integers in production)
- Optional `ADMISSION_STORE_PATH`; otherwise admission state is stored under `DATA_DIR`
- Firebase web: `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_APP_ID`
- Firebase Admin: `FIREBASE_SERVICE_ACCOUNT_JSON`, file, or workload identity
- `FIREBASE_SUPER_ADMIN_UIDS`: comma-separated Firebase UIDs for protected initial super-admin bootstrap
- Optional server Gemini fallback: `GEMINI_API_KEY`
- Whisper: model/device/compute/threads/workers/beam/cache settings
- Railway provides `PORT`; production binds `0.0.0.0`

P2.1 PostgreSQL variables:

- `DATABASE_URL`: optional while the foundation is inactive.
- `DATABASE_REQUIRED`: defaults false; enable only after an approved cutover.
- `DATABASE_SSL_MODE`: `disable`, `require`, or `verify-full`; configured
  production defaults to `verify-full`.
- Optional pool controls: `DATABASE_POOL_MAX` (10),
  `DATABASE_IDLE_TIMEOUT_MS` (30000), `DATABASE_CONNECTION_TIMEOUT_MS` (5000),
  and `DATABASE_QUERY_TIMEOUT_MS` (15000).
- `P2_BILLING_ENABLED`: defaults false and gates the PostgreSQL billing APIs.
- `P2_LIVE_JOB_BILLING_ENABLED`: defaults false, requires the billing gate, and
  separately gates live reservations, provider mode, settlement, and recovery.

Run `npm run db:status` and then `npm run db:migrate` as a controlled operation.
Migrations are checksummed and advisory-locked. Startup never auto-migrates and
there is no destructive rollback command.

### Persistent volume

Railway must mount a volume at `/data`. Losing it loses job and admission records, encryption key, encrypted credentials, uploads, private payment proofs, caches, and outputs. Staging and production must use separate databases and separate volumes/`DATA_DIR` roots.

Back up PostgreSQL and `DATA_DIR/payment-proofs` as one operational recovery set.
Restore both to a consistent recovery point: PostgreSQL contains only the opaque
proof reference and integrity metadata, while the volume contains the binary.
Missing binaries return an explicit unavailable response without deleting the
historical purchase or ledger record.

Uploads use atomic temporary files. Startup removes only abandoned `.tmp` files
older than 24 hours. If storage, database completion, or purchase association
fails, the pending metadata and any completed opaque binary are retained so the
same idempotency key can retry safely; cleanup never deletes verified proof
binaries, purchases, or ledger history. Operators should reconcile retained
pending records rather than deleting financial history.

### Health and shutdown

- Liveness: `GET /api/health` returns HTTP 200 with `{ "status": "ok" }` once
  the HTTP server is accepting requests. Railway and Docker use this endpoint;
  optional/background startup work and dependency warmup do not change it.
- Readiness: `GET /api/ready` reports redacted PostgreSQL reachability and
  migration state. With `DATABASE_REQUIRED=true`, unavailable PostgreSQL or
  non-current migrations returns HTTP 503. Invalid required database
  configuration remains a fatal startup error before the server binds.
- Docker health check uses Node `fetch`.
- SIGINT/SIGTERM stops the workspace worker, closes HTTP, closes the PostgreSQL
  pool, then exits.
- A ten-second forced nonzero exit guards shutdown.

### Pre-beta requirement

Authenticated staging smoke testing remains required before beta. It must verify
bootstrap sign-in, immediate role-change enforcement, hierarchy rejection,
last-super-admin protection, admission HTTP 429/`Retry-After`, restart
persistence, and mounted-volume retention. The exact manual procedure and
evidence requirements are in `16_STAGING_SMOKE_TEST.md`. The documented default
is `DATA_DIR=/data` with a `/data` mount; another path such as `/app/data` is
valid only when the variable and Railway volume mount are deliberately identical.

## File References

- Development scripts: `package.json`, `scripts/dev-server.mjs`, `scripts/dev-watch-policy.mjs`
- Server: `server.js`
- Runtime paths: `src/config/runtime.js`
- Container: `Dockerfile`, `.dockerignore`, `requirements.txt`
- Railway: `railway.json`, `RAILWAY.md`
- Environment template: `.env.example`

## Important Decisions

- Production must use persistent `DATA_DIR`.
- Blink requires exactly one Railway replica; the live staging replica count is not yet verified.
- Configure at least one reviewed bootstrap super-admin UID before first administrative use.
- P2 deployment must use a one-time protected PostgreSQL bootstrap transaction and then disable temporary bootstrap configuration; permanent email comparisons are forbidden.
- PostgreSQL and private proof-volume backups/restores must be tested together
  before financial activation.
- The Whisper model is downloaded during image build, not per job.
- Application code runs as non-root.
- Production serves the built `dist` SPA from Express.

## Future Work

The following are unapproved deployment recommendations:

- Establish a fully tracked release baseline.
- Add CI for tests, TypeScript, build, dependency audit, and container smoke tests.
- Define backup and restore for both JSON stores and encryption key.
- Add centralized logs/metrics and graceful cancellation through all child work.
