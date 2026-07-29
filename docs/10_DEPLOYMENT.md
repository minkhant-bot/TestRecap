# Deployment

## Purpose

Explain current local development and Railway/Docker production deployment, required configuration, persistent storage, health checks, and operational constraints.

## Current Status

### Implemented

- Local development through a scoped watcher and Vite middleware.
- Production Docker image based on Node 20 Bookworm Slim.
- Python virtual environment with Faster-Whisper dependencies.
- System FFmpeg, Burmese fonts, and cached Whisper model.
- Railway Dockerfile deployment, health check, one replica, and restart-on-failure.
- Persistent runtime paths under `DATA_DIR`.

### Planned or Placeholder

- No approved operations expansion is recorded in the repository.
- Automated CI/CD gates, migrations, backup/restore, an observability backend, and multi-worker deployment are absent recommendations, not implemented placeholders.

### Known Issues

- Current application architecture is not fully tracked in Git.
- JSON stores require exactly one writer/replica.
- The repository/build context contains obsolete and generated artifacts.
- Shutdown cancellation cannot stop every deep media operation.

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
- Firebase web: `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_APP_ID`
- Firebase Admin: `FIREBASE_SERVICE_ACCOUNT_JSON`, file, or workload identity
- Optional server Gemini fallback: `GEMINI_API_KEY`
- Whisper: model/device/compute/threads/workers/beam/cache settings
- Railway provides `PORT`; production binds `0.0.0.0`

### Persistent volume

Railway must mount a volume at `/data`. Losing it loses job records, encryption key, encrypted credentials, uploads, caches, and outputs.

### Health and shutdown

- Health: `GET /api/health`
- Docker health check uses Node `fetch`.
- SIGINT/SIGTERM stops the workspace worker, closes HTTP, then exits.
- A ten-second forced nonzero exit guards shutdown.

## File References

- Development scripts: `package.json`, `scripts/dev-server.mjs`, `scripts/dev-watch-policy.mjs`
- Server: `server.js`
- Runtime paths: `src/config/runtime.js`
- Container: `Dockerfile`, `.dockerignore`, `requirements.txt`
- Railway: `railway.json`, `RAILWAY.md`
- Environment template: `.env.example`

## Important Decisions

- Production must use persistent `DATA_DIR`.
- Railway replica count is one.
- The Whisper model is downloaded during image build, not per job.
- Application code runs as non-root.
- Production serves the built `dist` SPA from Express.

## Future Work

The following are unapproved deployment recommendations:

- Establish a fully tracked release baseline.
- Add CI for tests, TypeScript, build, dependency audit, and container smoke tests.
- Define backup and restore for both JSON stores and encryption key.
- Add centralized logs/metrics and graceful cancellation through all child work.
