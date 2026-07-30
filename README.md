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

Local development loads ignored values from `.env.local`. Copy
`.env.example` to `.env.local` and set `MAX_UPLOAD_SIZE_MB` to a positive
number before running `npm run dev`; upload configuration fails closed when
the value is missing or invalid.
