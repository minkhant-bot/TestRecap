# Railway deployment

This repository is configured for Railway to build from the root `Dockerfile`
and start with `npm start`. The server reads Railway's `PORT` automatically and
binds to `0.0.0.0` in production. This is deployment guidance, not evidence
that a live Blink Railway target is configured or verified.

The Blink Railway project, service, environment, public URL, replica count,
volume, effective `DATA_DIR`, and variable presence are currently unverified.
Deployment preflight is blocked, and authenticated staging smoke testing has
not started. Screenshots from other Railway projects are not Blink evidence.

Mount a Railway Volume at `/data`. Set `DATA_DIR=/data` so uploads, job caches,
temporary rendering artifacts, MP4 files, MP3 files, and local settings data
remain beneath that volume. Without `DATA_DIR`, local development retains the
existing repository-relative directories.

Recommended Railway Variables:

- `DATA_DIR=/data`
- `MAX_UPLOAD_SIZE_MB` set to the approved positive upload limit in megabytes.
- `QUEUE_CONCURRENCY=1`
- `WHISPER_MODEL=small`
- `WHISPER_DEVICE=cpu`
- `WHISPER_COMPUTE_TYPE=int8`
- `WHISPER_NUM_WORKERS=1`
- `WHISPER_BEAM_SIZE=3`
- `WHISPER_CPU_THREADS` set to the service CPU allocation when an explicit
  value is desired; the application otherwise detects CPUs and caps the
  default at four threads.
- `OMP_NUM_THREADS` optionally set to the same bounded CPU allocation.
- `HF_HOME=/opt/models/huggingface` to use the model cached in the image.
- `GEMINI_API_KEY` only when the key is supplied as a Railway secret rather
  than per request.
- `FIREBASE_PROJECT_ID` for Firebase Admin and browser authentication.
- `FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`, and `FIREBASE_APP_ID` for
  the public Firebase web configuration returned at runtime.
- `FIREBASE_SERVICE_ACCOUNT_JSON` containing the Firebase service-account
  JSON (plain JSON or base64-encoded JSON). This is a Railway secret.
- `FIREBASE_SUPER_ADMIN_UIDS` as a comma-separated, reviewed bootstrap list of
  Firebase UIDs. These UIDs receive protected `super_admin` authority and
  cannot be demoted or disabled through the API.

The image build downloads the `small` Faster-Whisper model into
`/opt/models/huggingface`. Runtime jobs reuse that cache and do not download
the model per transcription.

Authentication uses Google accounts through Firebase Authentication. Enable
the Google provider. The server verifies every ID token and secure session
cookie with Firebase Admin, fetches the current user record on each request,
and accepts only validated server-side custom role claims.

Queue and job state are written atomically beneath `DATA_DIR` in
`saas-state.json`. Job-scoped BYOK credentials are encrypted at rest with the
persisted `encryption.key`. Mount the Railway Volume at `/data`; without that
volume queued jobs cannot survive a Railway container replacement.

Before beta, run authenticated staging smoke tests for super-admin bootstrap,
role hierarchy and immediate enforcement, admission 429 responses, restart
persistence, and `/data` volume retention.
