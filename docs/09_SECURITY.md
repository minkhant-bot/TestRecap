# Security

## Purpose

Document the current trust boundaries, protections, sensitive data, known vulnerabilities, and security work that remains.

## Current Status

### Implemented

- Firebase ID tokens are verified before session creation.
- Only Google-provider identities are accepted.
- Sessions use an HTTP-only cookie, `SameSite=Lax`, secure in production.
- Firebase disabled status is checked.
- Workspace jobs are owner-scoped.
- Core jobs use owner/admin access checks.
- Output delivery requires authentication and authorization.
- Gemini credentials are encrypted at rest and omitted from responses.
- Filesystem cleanup uses root-bound path checks and rejects unsafe symlinks in sensitive paths.
- Upload size and extension/MIME checks exist.

### Planned or Placeholder

- No approved security-program expansion is recorded in the repository.
- A formal threat model, rate limits, quotas, abuse controls, security-header policy, documented CSRF strategy, secrets rotation, and incident procedures are absent recommendations, not implemented placeholders.

### Known Issues

- Ordinary authenticated users can mutate global legacy settings.
- No backend quota protects storage or AI/media compute.
- Role authority and privilege hierarchy are defective.
- Workspace deletion can leave downloadable output.
- Current production dependencies have known advisories.
- Uncaught exceptions do not immediately terminate the process.

## Architecture/Flow

### Authentication boundary

1. Browser signs in through Firebase Google popup.
2. Browser sends a fresh ID token to `/api/auth/session`.
3. Server verifies token, provider, user record, and disabled status.
4. Server creates the `__session` cookie.
5. Every protected request verifies that session cookie again.

### Sensitive data

- Firebase service account: environment JSON/base64, configured file, or application-default credentials.
- Gemini key: per-user encrypted store and temporary encrypted job copy.
- Encryption key: persisted under the data directory.
- Source/output media and transcripts: private filesystem data.

### Output boundary

`/output/{jobId}.mp4|mp3` looks up the core job, applies owner/admin authorization, requires core status `complete`, and then sends the file.

### Dependency audit snapshot

On 2026-07-29, `npm audit --omit=dev` reported 12 production findings: four high and eight moderate. Notable chains include `ws` through `@seepine/edge-tts`, React Router, Firebase Admin transitive Google packages, and `uuid`.

## File References

- Session/auth middleware: `src/middleware/auth.js`
- Firebase verification: `src/services/firebaseAdmin.js`
- Session routes: `src/routes/auth.js`
- Output authorization: `server.js`
- Credential encryption: `src/services/jobManager.js`, `src/services/userGeminiKeys.js`
- Path safety: `src/services/completedOutputDeletion.js`, `src/workers/workflowCleanup.js`
- Upload handling: `src/routes/workspace.js`
- Dependencies: `package.json`, `package-lock.json`

## Important Decisions

- Firebase web configuration is public by design; service-account credentials are server-only.
- Authorization is always evaluated on the backend.
- Gemini keys are never returned, even masked, by the workspace key API.
- A single persistent data volume contains secrets and user media and must be access-controlled and backed up appropriately.

## Future Work

The following are unapproved security recommendations:

- Resolve P0 authorization and abuse-control findings before public scale.
- Repair role authority and admin privilege separation.
- Replace or upgrade vulnerable dependencies after compatibility tests.
- Add HTTP security headers, explicit CORS policy, rate limits, request-size policy, and operational secret rotation.
- Make data deletion cover every linked record and artifact.
