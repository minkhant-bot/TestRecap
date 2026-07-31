# TestRecap

TestRecap is an authenticated AI movie-recap workspace with a durable,
single-concurrency processing queue. Firebase Authentication provides
email/password registration, login, logout, and persistent sessions.

## SaaS configuration

Enable Email/Password authentication in Firebase and configure the variables
listed in `.env.example`. Firebase Admin credentials stay server-side.
`FIREBASE_ADMIN_UIDS` provides the initial admin bootstrap; all subsequent
authorization uses backend-verified Firebase identities and custom claims.

All project APIs require authentication. Users can access only jobs owned by
their Firebase UID, while admins can access the global Users, Queue, Jobs,
System Status, and Logs views.

For Railway, mount a persistent Volume at `/data` and set `DATA_DIR=/data`.
The FIFO queue, job records, workflow checkpoints, uploads, caches, and output
artifacts then survive service restarts.

Railway main is initially a test/staging deployment, not production-ready.
PostgreSQL billing gates remain disabled until isolated native PostgreSQL
verification passes; PostgreSQL restart persistence is not yet proven. The
intended sole Product Owner/Super Admin is `min85639@gmail.com`, but enforcement
and ban/unban persistence are not implemented.

Local development loads ignored values from `.env.local`. Copy
`.env.example` to `.env.local` and set `MAX_UPLOAD_SIZE_MB` to a positive
number before running `npm run dev`; upload configuration fails closed when
the value is missing or invalid.

## Continue safely from this repository

Read all files in `docs/` before editing. Start with
`docs/00_PROJECT_OVERVIEW.md`, `docs/15_AI_ASSISTANT_CONTEXT.md`, and
`docs/17_P2_FOUNDATION_ARCHITECTURE.md`. They document the approved workflow,
P1–P5 status, P2.1/P2.2/P2.3 gates, Trial/Normal/Pro and BYOK rules, Super
Admin/bootstrap design, known/unverified areas, and the current dirty-worktree
handoff. `docs/12_KNOWN_ISSUES.md` is authoritative for pending verification;
`docs/14_ROADMAP.md` is authoritative for sequencing.

Current local commands are:

```bash
npm install
cp .env.example .env.local
npm run dev
node --test
npm run lint
npm run build
npm run db:status
npm run db:migrate
```

There is no `npm test` script. Database status/migrations require an isolated
PostgreSQL connection and must never run automatically. Both
`P2_BILLING_ENABLED` and `P2_LIVE_JOB_BILLING_ENABLED` default to `false`;
neither gate activates commercial values or replaces the existing JSON/Firebase
compatibility authority. Preserve workflow-v2/Core AI Pipeline prompts, TTS,
timeline, Scene Rebuild, FFmpeg, output validation, and canonical
`/output/{jobId}.mp4`. Do not edit code/tests/config/migrations/runtime behavior,
deployment, or commit/push unless a task explicitly authorizes it.
