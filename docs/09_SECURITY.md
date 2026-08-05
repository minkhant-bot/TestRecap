# Security

## Purpose

Document the current trust boundaries, protections, sensitive data, known vulnerabilities, and security work that remains.

## Current Status

### Implemented

- Firebase ID tokens are verified before session creation.
- Only Google-provider identities are accepted.
- Sessions use an HTTP-only cookie, `SameSite=Lax`, secure in production.
- Firebase disabled status is checked.
- Firebase custom role claims are validated against `user`, `admin`, and `super_admin`.
- Initial super-admin authority is bootstrapped by server-only Firebase UID configuration.
- Administrative mutations enforce actor revalidation, role hierarchy, self-lockout prevention, and last-super-admin protection.
- Workspace jobs are owner-scoped.
- Core jobs use owner/admin access checks.
- Output delivery requires authentication and authorization.
- Global legacy settings and diagnostic operations require an administrator role.
- Gemini credentials are encrypted at rest and omitted from responses.
- Future ledger and audit records are append-only; refunds and reversals use compensating entries.
- Filesystem cleanup uses root-bound path checks and rejects unsafe symlinks in sensitive paths.
- Upload size and extension/MIME checks exist.
- Workspace creation is capped at two active jobs per user; legacy creation routes are admin-only.
- Workspace deletion cross-checks workspace/core ownership and preflights every linked artifact before revoking records.
- Retention removes linked terminal records and artifacts together and preserves active or owner-mismatched state.
- Financial mutations use PostgreSQL transactions, locked authoritative rows,
  request-hash idempotency, immutable ledger entries, and append-only audit.
- Billing screenshot records contain private object metadata only. Object keys
  are server-generated; no public URL or database blob is exposed.

### Planned or Placeholder

- The approved P2 design preserves encrypted BYOK for Trial and Normal and introduces explicitly selected Blink-funded Pro using a platform-owned Gemini credential held in secret management. The currently implemented plans are Trial and Pro only; Normal remains architecturally defined but is not selectable through any current API (`POST /api/plans/me/select` always returns HTTP 410) — see `07_CREDITS_SYSTEM.md` "Plan model".
- PostgreSQL is authoritative for Super Admin permission on the gated financial
  API. Global application-role cutover and live reservation,
  settlement/refund/release authority remain pending.
- P2 never silently switches BYOK and Blink-funded modes. Workers receive only the job-scoped credential required by the selected mode.
- Raw BYOK/platform keys are forbidden from logs, audit, analytics, URLs, PostgreSQL policy/settings, and client-readable responses.
- Credential isolation and no-fallback rules are enforced by billing
  eligibility/estimate services; live provider-funded execution remains
  unimplemented.
- A formal threat model, rate limits, cumulative quotas, broader abuse controls, security-header policy, documented CSRF strategy, secrets rotation, and incident procedures are absent recommendations, not implemented placeholders.

### Known Issues

- Admission limits are durable but remain single-replica JSON state rather than distributed enforcement.
- Current production dependencies have documented, accepted advisories; the audit is not clean.
- Uncaught exceptions do not immediately terminate the process.

## Architecture/Flow

### Authentication boundary

1. Browser signs in through Firebase Google popup.
2. Browser sends a fresh ID token to `/api/auth/session`.
3. Server verifies token, provider, user record, and disabled status.
4. Server creates the `__session` cookie.
5. Every protected request verifies that session cookie and fetches the current Firebase user record.
6. Missing claims resolve to `user`; malformed or unsupported role claims fail authentication.

### Sensitive data

- Firebase service account: environment JSON/base64, configured file, or application-default credentials.
- Gemini key: per-user encrypted store and temporary encrypted job copy.
- Encryption key: persisted under the data directory.
- Source/output media and transcripts: private filesystem data.

### Output boundary

`/output/{jobId}.mp4|mp3` looks up the core job, applies owner/admin authorization, requires core status `complete`, and then sends the file.

### Dependency audit snapshot

On 2026-07-30, `npm audit --omit=dev` reported 10 production findings: two high and eight moderate. The previously vulnerable `ws@8.13.0` path through the Edge TTS packages is resolved to `ws@8.21.1`; the remaining findings include React Router, Firebase Admin transitive Google packages, and `uuid`.

### React Router advisory risk acceptance

The high-severity React Router advisory [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) remains unresolved; this is a documented risk acceptance, not a vulnerability remediation. The upstream advisory says it applies only to unstable RSC APIs. Blink uses a Vite SPA with declarative `BrowserRouter` routing and does not use RSC, framework mode, data-router actions, or server actions. The vulnerable path is therefore not reachable under the current architecture, and the advisory does not block beta on that basis.

`react-router` and `react-router-dom` must remain at `7.18.1` for now. Do not downgrade to `7.11.0`, and do not migrate to version 8 without separate architectural approval. Re-review this acceptance when an official compatible patched 7.x release or a supported DOM migration path becomes available, or before introducing any RSC, framework-mode, data-router action, or server-action functionality.

### uuid advisory review

The moderate-severity `uuid` advisory [GHSA-w5hq-g745-h8pq / CVE-2026-41907](https://github.com/advisories/GHSA-w5hq-g745-h8pq) affects the `v3()`, `v5()`, and `v6()` APIs when a caller supplies an undersized output buffer or out-of-range offset. It does not affect `v4()`.

The installed `uuid@9.0.1` is in the advisory's affected version range, both as a direct dependency and through Firebase Admin's Google transitive packages. Repository source uses only `v4()` with no caller-provided buffer. Inspection of the installed `google-gax` and `teeny-request` call sites also found only `v4()` usage; the loaded top-level `gaxios@7.3.0` uses Node/Web Crypto `randomUUID()`, while the audited but unloaded `gaxios@6.7.1` copies use unaffected `v4()`. The vulnerable API path is therefore not reachable in the reviewed working tree.

This review is a scoped beta risk acceptance, not a remediation or a claim that the audit finding is fixed. Do not force a broad transitive override or accept the audit's semver-major `uuid@14.0.1` suggestion without compatibility testing and separate approval. Re-review before adding any `uuid` v3/v5/v6 call, especially one using a buffer or offset, and when Firebase Admin is upgraded or a compatible dependency update becomes available.

### Firebase Admin advisory review

Blink installs `firebase-admin@13.10.0`. The production audit reports it as moderate only through installed service dependencies: `firebase-admin` → `@google-cloud/firestore@7.11.6` → `google-gax@4.6.1` → `retry-request@7.0.2` and `uuid@9.0.1`; and `firebase-admin` → `@google-cloud/storage@7.21.0` → `retry-request@7.0.2` → `teeny-request@9.0.0` → `uuid@9.0.1`, plus Storage/Google authentication copies of `gaxios@6.7.1` → `uuid@9.0.1`. `firebase-admin`, Firestore, Storage, `google-gax`, `retry-request`, `teeny-request`, and `gaxios` have no separate root advisory in this audit; their findings propagate from the `uuid` advisory.

Blink imports only the modular `firebase-admin/app` and `firebase-admin/auth` entry points. It initializes one Admin app and uses Auth to verify ID tokens and session cookies with revocation checks, fetch and list users, create session cookies, revoke refresh tokens, read and set custom claims, and update disabled status. Blink does not import or call Admin Firestore, Cloud Storage, Realtime Database, Messaging, Functions, Remote Config, App Check, or any Google Cloud client directly.

Runtime module tracing of Blink's Admin initialization loaded the Admin App/Auth modules, `google-auth-library@10.9.1`, and non-audited top-level `gaxios@7.3.0`; it did not load Firestore, Storage, `google-gax`, `retry-request`, `teeny-request`, audited `gaxios@6.7.1`, or `uuid`. Those packages are installed production dependencies but their advisory paths are unreachable under the reviewed Auth-only architecture. This is theoretical/optional-service exposure, not a reachable production vulnerability. Formally accept the Firebase Admin aggregate finding for beta without dependency changes. Re-review before enabling any non-Auth Firebase Admin service, importing a Google Cloud client, changing Admin import style, or changing Firebase Admin/lockfile versions.

### P1 security and dependency disposition

The P1 security and dependency review is complete for beta. `ws` is remediated, and every remaining audit entry is covered by the React Router, `uuid`, or Firebase Admin risk acceptances above. None has a reachable vulnerable production path in Blink's current architecture. P1 changed dependency resolution, admission/authorization boundaries, and documentation; it did not change the Core AI Pipeline contract, workflow stages, prompts, TTS behavior, timeline construction or verification, FFmpeg media composition, export behavior, or accepted output quality.

The current automated suite passes 232/232 tests, including workflow, TTS, timeline, and final-media regression coverage. Authenticated staging smoke testing remains a separate pre-beta release requirement and is not replaced by this review.

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
- Session-token claims are not trusted as current authority; role changes apply on the next request.
- `FIREBASE_SUPER_ADMIN_UIDS` is server-only configuration and its members are protected from API demotion/disablement.
- Gemini keys are never returned, even masked, by the workspace key API.
- A live Blink volume is not yet verified. When deployed as documented, the single persistent data volume will contain secrets and user media and must be access-controlled and backed up appropriately.

## Future Work

Approved future product requirements:

- Store platform-owned AI and TTS credentials only in server-side secret infrastructure; never expose them to clients.
- Use durable balances and an immutable ledger, with atomic reservations and idempotent charging.
- Settle success, failure, and explicit cancellation using documented refund or release rules.
- Require verified payment confirmation before issuing credits.
- Restrict administrative credit adjustments to authorized backend operations and preserve an audit history.
- Give clients no authority over balances, prices, reservations, charges, refunds, releases, voice eligibility, or arbitrary TTS parameters.

The following remain unapproved security recommendations:

- Resolve P0 authorization and abuse-control findings before public scale.
- Replace or upgrade vulnerable dependencies after compatibility tests.
- Add HTTP security headers, explicit CORS policy, rate limits, request-size policy, and operational secret rotation.
