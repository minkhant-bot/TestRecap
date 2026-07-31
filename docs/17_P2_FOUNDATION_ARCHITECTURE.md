# P2 Foundation Architecture

## Current ZIP handoff status (2026-07-31)

P2.1, P2.2, and P2.3 implementation files are present in the working tree,
but all activation remains explicitly gated. P2.1 is inactive PostgreSQL
infrastructure and bootstrap scaffolding. P2.2 is the gated plans/Trial/
Normal/Pro, credits, purchase-review, ledger, balance, audit, and Super Admin
financial foundation. P2.3 is the separately gated live-job
snapshot/reservation, explicit BYOK versus Blink-funded mode,
settlement/release/refund, worker lease, checkpoint, and reconciliation
integration. No commercial values are seeded.

Implementation presence and verification are separate. Focused test files and
PostgreSQL integration test files exist, but PostgreSQL execution requires an
isolated TEST_DATABASE_URL; this document does not authorize claiming
production or staging validation. Remaining activation blockers are private
screenshot object storage/content verification, migration and global
role-authority cutover, backup/restore, reconciliation operations, and
authenticated staging verification.

### Verification evidence boundary

The focused live-billing unit set passed 36/36; the recorded full suite passed
284 tests, failed 0, and skipped 3. The three native PostgreSQL integration
tests (`src/db/postgres.integration.test.js`,
`src/services/billingFoundation.postgres.integration.test.js`, and
`src/services/liveJobBilling.postgres.integration.test.js`) were authored but
skipped because `TEST_DATABASE_URL` was unset. No successful native PostgreSQL
run or PostgreSQL restart-persistence test is evidenced. Therefore reserve,
settle, release, refund, retry, recovery, locking, transaction, concurrency,
and duplicate-prevention behavior remain unproven against PostgreSQL.

The migration has no ban/unban persistence table. Ban/unban and operational
Super Admin grant, deduction, refund, and reversal flows remain planned. The
intended sole Product Owner/Super Admin is `min85639@gmail.com`, but the
repository does not prove sole-owner enforcement. Backend authorization must
use PostgreSQL-backed roles after cutover; a frontend email check is not an
authorization mechanism. Keep both P2 gates disabled until isolated native
PostgreSQL verification passes. Railway main is a test/staging target, not a
production-ready release.

## P2.1 Implementation Boundary (2026-07-30)

P2.1 implements configuration, shared pool/transactions, deterministic forward
migrations, the initial schema, repository/service boundaries, bootstrap
scaffolding, database readiness, and pool shutdown. It does not activate
PostgreSQL authority. Existing JSON/file persistence, Firebase-claim roles,
encrypted BYOK storage, job execution, purchase, reservation, settlement, and UI
flows remain unchanged.

Migration `0001_p2_foundation.sql` contains no commercial seed values. Isolated
PostgreSQL integration verification, production migration, bootstrap UID
resolution, authority cutover, object storage, backups, and later P2 services
remain pending.

## Billing Foundation Implementation Boundary (2026-07-31)

The user-authorized “P2.2 billing foundation” delivery implements the
plans/policies/entitlements, Trial, catalog/banks, screenshot-metadata,
purchase-review, immutable-ledger/balance, first-purchase-bonus, adjustment,
estimate, and financial-audit scope described across the original P2.3–P2.6
architecture sections below.

Activation is explicit through `P2_BILLING_ENABLED=true` and requires
PostgreSQL. Billing requests synchronize Firebase identities, and financial
mutations require PostgreSQL `super_admin`. No commercial values are seeded.
Existing Firebase authorization outside financial routes, JSON job stores,
encrypted BYOK data, and the Core AI Pipeline remain authoritative.

This boundary does not implement object upload/download, live job billing
snapshots, reservations, settlement/release/refund, worker recovery, UI,
subscriptions, partial refunds, or pending-purchase cancellation. Those remain
in their later architecture phases.

## P2.3 Live Job Billing and Recovery Boundary (2026-07-31)

The P2.3 delivery connects the gated billing foundation to the workspace worker.
`P2_LIVE_JOB_BILLING_ENABLED=true` is a separate, default-off gate that also
requires `P2_BILLING_ENABLED=true` and PostgreSQL. When enabled, queue admission
requires an explicit assigned plan and mode, probes authoritative source
duration, snapshots the effective policy and entitlements, and commits a locked
credit reservation before JSON queue admission. Queue-admission failure
immediately compensates by releasing that reservation.

Workers acquire expiring PostgreSQL leases, reuse validated audio/transcript and
core checkpoints, and preserve the snapshotted reservation across restart.
Settlement occurs only after the existing authoritative `videoUrl` and regular,
non-zero output-file validation succeeds. Failure before settlement releases;
a qualifying system failure after settlement creates one full compensating
refund ledger entry. `review_required` is reserved for a settled recovery whose
output fact cannot be established. BYOK and Blink-funded credentials never
fallback to one another, and server-managed credentials are not returned.

This boundary does not activate the feature, seed commercial values, replace
JSON/Firebase authority globally, redesign UI, implement subscriptions or
partial refunds, or change any Core AI Pipeline stage or output behavior.

## Purpose

Define the approved architecture for Blink Automation plans, credits, manual
purchase review, BYOK and Blink-funded processing, PostgreSQL persistence,
payment-screenshot storage, financial auditing, and job billing. This remains
the design contract; implementation status is stated explicitly in the
boundaries above and phase list below.

The P2 foundation must not change workflow-v2, prompts, Gemini request content,
model-selection behavior, TTS, Timeline Verification, Scene Rebuild, FFmpeg,
export encoding, output quality, or the completed-output contract.

## Status and authority

- **Approved product architecture:** the commercial, billing, role, plan,
  settlement, failure, and bootstrap rules in this document.
- **Current implementation:** Firebase identity, Firebase custom-claim roles
  outside the financial API, encrypted BYOK files, JSON job stores, the existing
  workspace/Core AI Pipeline, and the explicitly gated PostgreSQL billing
  foundation described above.
- **Not implemented:** object upload/download for payment screenshots, global
  PostgreSQL role cutover, UI activation, operational backup/restore and
  production activation, and the later APIs identified below.
- Trial, Normal, and Pro are commercial plans. They are not recurring
  subscriptions unless a later approved requirement explicitly introduces
  subscriptions.

## Architectural separation

Five independent concepts must never be collapsed:

| Concept | Authority | Values or examples |
|---|---|---|
| Authentication identity | Firebase Authentication | Firebase UID, verified Google identity |
| Authorization role | PostgreSQL | `user`, `admin`, `super_admin` |
| Commercial plan | PostgreSQL | `trial`, `normal`, `pro` |
| Job billing mode | Snapshotted on each job | `byok`, `blink_funded` |
| Feature entitlement | Versioned PostgreSQL plan policy, snapshotted on each job | Blur, Flip, provider mode, resource limits |

Changing a plan never grants administrative permission. Changing a role never
changes pricing, credits, provider funding, or feature entitlement.

## Approved commercial model

### Duration billing

The authoritative user-facing billing quantity is uploaded source-video
duration. File size and Gemini token count must not determine the user-visible
charge. Provider usage may be recorded separately for internal cost analysis.

```text
billingBlockSeconds = 30
billingBlocks = ceil(sourceDurationSeconds / billingBlockSeconds)
requiredCredits = billingBlocks * creditsPerBlock
```

Duration must be finite and greater than zero. The backend must obtain or verify
the authoritative media duration before reservation. A client-supplied duration
is only a hint. Examples:

| Source duration | Billing blocks |
|---:|---:|
| greater than 0 through 30 seconds | 1 |
| greater than 30 through 60 seconds | 2 |
| greater than 60 through 90 seconds | 3 |
| greater than 90 through 120 seconds | 4 |

Credits, blocks, rates, balances, and ledger amounts are integers. Rates are
versioned database policy and must never be hardcoded in pipeline code.

### Trial

- Requires Firebase/Google sign-in and a valid supported user Gemini key.
- Uses BYOK only; the user pays Gemini provider usage through their provider
  account.
- Receives one configurable free-credit grant only after an eligibility
  decision.
- Trial jobs consume that free allowance using Trial's versioned
  credits-per-30-second-block rate.
- Purchased credits are not required until the free Trial allowance is
  exhausted.
- Free credits pay for limited Blink application/server/storage/export usage.
- Is not unlimited free BYOK processing.
- Blur and Flip are unavailable.
- After the free allowance is exhausted, continued processing requires
  purchased credits and transition to an eligible paid plan.
- Trial eligibility is independent of authorization role.

Trial-abuse controls must combine configurable signals rather than claiming any
one signal proves a unique person:

- one successful trial grant per eligible Blink user;
- prior trial grants connected to a Firebase identity;
- hashed or otherwise privacy-preserving BYOK-key reuse/risk signals;
- account-age and verified-provider signals;
- rate-limited device and network risk signals where legally and technically
  appropriate;
- manual deny/allow review for ambiguous cases;
- configurable allowance, availability window, and risk thresholds.

An IP address, device identifier, phone number, Google account, or API key alone
must never be documented as definitive proof of a unique human. Raw BYOK keys
must not be retained as trial-risk identifiers; use a keyed, non-reversible
fingerprint separated from credential encryption and access.

### Normal

- Paid BYOK plan.
- Requires a valid supported user Gemini key.
- Uses purchased Blink credits after the trial allowance is exhausted.
- Credits pay for Blink application, pipeline, server, storage, export, and
  service usage; Gemini provider usage remains billed to the user's provider
  account.
- Has a lower configurable credit rate than Pro.
- Blur and Flip are unavailable.
- May receive stricter server/resource entitlements than Pro.
- Is not permanently free.
- A rejected, invalid, unavailable, or quota-exhausted BYOK key produces a
  structured error. The job remains BYOK; Blink does not silently switch it to
  Pro or a platform key.

### Pro

- Paid Blink-funded plan.
- Does not require a user Gemini key.
- Requires sufficient purchased/eligible credits.
- Uses a platform-owned Gemini credential held in secret management.
- Has a higher configurable rate because it covers provider cost,
  infrastructure, full approved features, and margin.
- Blur and Flip are available.
- Receives the full approved entitlement set.
- Availability requires active Pro eligibility, sufficient credits, provider
  availability, and a valid server-owned credential.
- Blink never silently switches a Pro job to BYOK.

### Plan transition

A user may move from Trial to Normal or Pro through an explicit commercial-plan
selection permitted by current policy. Existing jobs retain their snapshots.
Moving between Normal and Pro changes only future jobs. Purchased credits are
account credits unless a later policy explicitly restricts a credit grant.

## Manual purchase and first-purchase bonus

Approved flow:

```text
active plan
  → applicable active bank account
  → exact snapshotted amount and bank details
  → external bank transfer
  → private payment screenshot
  → pending purchase request
  → Super Admin manually checks the real bank account
  → approve or reject
```

Blink does not automatically verify payment. No bank API, gateway, OCR
approval, sender name, transfer timestamp, or transaction/reference number is
required initially. Screenshot evidence is supporting evidence only.

Approval atomically:

1. changes the pending request to approved;
2. inserts the purchased-credit ledger entry;
3. if eligible, inserts a separate first-purchase-bonus ledger entry;
4. updates the balance projection;
5. consumes first-purchase eligibility;
6. inserts an immutable audit event.

The first-purchase bonus:

- is genuinely additional to purchased credits;
- is configurable and may be fixed credits or another explicitly configured
  integer rule;
- is enabled/disabled and optionally date-bounded;
- is granted once per eligible user, after their first successfully approved
  real purchase;
- is not granted for pending or rejected requests; if purchase cancellation is
  later approved, a cancelled request must also receive no bonus;
- is a separate `first_purchase_bonus` ledger entry linked to the purchase;
- is never recomputed from a later plan or promotion edit;
- is reversed with a separate compensating ledger entry when the qualifying
  purchase is fully reversed/refunded;
- must not be granted again after such reversal unless a later approved policy
  explicitly restores eligibility.

Financially relevant requests, snapshots, ledger entries, reservation records,
and audit events are never hard-deleted.

## PostgreSQL schema

Use managed PostgreSQL, UUID primary keys, `TIMESTAMPTZ`, and `BIGINT` integer
minor units/credit units. Database checks supplement service validation.
Financial service roles must have no `UPDATE` or `DELETE` permission on the
ledger and audit tables.

### `schema_migrations`

| Column | Type and constraints |
|---|---|
| `version` | `TEXT PRIMARY KEY` |
| `checksum` | `TEXT NOT NULL` |
| `description` | `TEXT NOT NULL` |
| `applied_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `execution_ms` | `INTEGER NOT NULL CHECK (execution_ms >= 0)` |

Rows are immutable. A changed checksum is a deployment failure.

### `users`

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `firebase_uid` | `TEXT NOT NULL UNIQUE` |
| `email` | `TEXT` |
| `display_name` | `TEXT NOT NULL DEFAULT ''` |
| `photo_url` | `TEXT NOT NULL DEFAULT ''` |
| `status` | `TEXT NOT NULL CHECK (status IN ('active','disabled'))` |
| `created_at` | `TIMESTAMPTZ NOT NULL` |
| `updated_at` | `TIMESTAMPTZ NOT NULL` |
| `last_login_at` | `TIMESTAMPTZ` |

Indexes: normalized email where supported, `(status)`, `(last_login_at)`.
`firebase_uid` is immutable. Users are disabled/anonymized under an approved
retention process, not hard-deleted while referenced by financial records.

### `user_roles`

| Column | Type and constraints |
|---|---|
| `user_id` | `UUID PRIMARY KEY REFERENCES users(id)` |
| `role` | `TEXT NOT NULL CHECK (role IN ('user','admin','super_admin'))` |
| `source` | `TEXT NOT NULL CHECK (source IN ('bootstrap','manual','migration'))` |
| `assigned_by_user_id` | `UUID REFERENCES users(id)` |
| `protected_bootstrap` | `BOOLEAN NOT NULL DEFAULT false` |
| `version` | `BIGINT NOT NULL DEFAULT 1 CHECK (version > 0)` |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |

Indexes: `(role)`, partial index for active/protected Super Admins as needed.
Only role state is stored here—never Trial, Normal, or Pro. Financial routes
read PostgreSQL role authority on every request. Role mutations lock relevant
rows, protect self/last/protected Super Admin, increment `version`, and insert
an audit event.

### `plans`

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `code` | `TEXT NOT NULL UNIQUE CHECK (code IN ('trial','normal','pro'))` |
| `name` | `TEXT NOT NULL` |
| `description` | `TEXT NOT NULL DEFAULT ''` |
| `active` | `BOOLEAN NOT NULL DEFAULT false` |
| `display_order` | `INTEGER NOT NULL DEFAULT 0` |
| `created_by_user_id` | `UUID REFERENCES users(id)` |
| `updated_by_user_id` | `UUID REFERENCES users(id)` |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `archived_at` | `TIMESTAMPTZ` |

Plans are archived, not deleted. The initial three plan codes are stable
commercial identifiers, not authorization values.

### `plan_policy_versions`

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `plan_id` | `UUID NOT NULL REFERENCES plans(id)` |
| `version` | `BIGINT NOT NULL CHECK (version > 0)` |
| `billing_block_seconds` | `INTEGER NOT NULL CHECK (billing_block_seconds = 30)` |
| `credits_per_block` | `BIGINT NOT NULL CHECK (credits_per_block > 0)` |
| `trial_allowance_credits` | `BIGINT NOT NULL DEFAULT 0 CHECK (trial_allowance_credits >= 0)` |
| `billing_mode` | `TEXT NOT NULL CHECK (billing_mode IN ('byok','blink_funded'))` |
| `effective_from` | `TIMESTAMPTZ NOT NULL` |
| `effective_until` | `TIMESTAMPTZ` |
| `active` | `BOOLEAN NOT NULL DEFAULT false` |
| `created_by_user_id` | `UUID NOT NULL REFERENCES users(id)` |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |

Unique `(plan_id, version)`. Exclusion/service validation prevents overlapping
active effective windows. Published policy versions are immutable; corrections
create a new version. Trial, Normal, and Pro each obtain their own configurable
credits-per-block value.

### `plan_entitlements`

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `policy_version_id` | `UUID NOT NULL REFERENCES plan_policy_versions(id)` |
| `entitlement_key` | `TEXT NOT NULL` |
| `enabled` | `BOOLEAN NOT NULL` |
| `integer_limit` | `BIGINT` |
| `text_value` | `TEXT` |

Unique `(policy_version_id, entitlement_key)`. Allowed keys are service
validated and initially include `blur`, `flip`, `byok_mode`,
`blink_funded_mode`, active-job/resource limits, storage/retention limits, and
other approved feature flags. Trial/Normal must have Blur and Flip disabled;
Pro has them enabled. Entitlements are snapshotted on accepted jobs.

### `user_plan_assignments`

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `user_id` | `UUID NOT NULL REFERENCES users(id)` |
| `plan_id` | `UUID NOT NULL REFERENCES plans(id)` |
| `status` | `TEXT NOT NULL CHECK (status IN ('active','inactive','suspended'))` |
| `source` | `TEXT NOT NULL CHECK (source IN ('trial','user_selection','admin','migration'))` |
| `starts_at` | `TIMESTAMPTZ NOT NULL` |
| `ends_at` | `TIMESTAMPTZ` |
| `created_by_user_id` | `UUID REFERENCES users(id)` |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |

A partial unique index permits one active assignment per user. Assignment
changes never mutate `user_roles`. History is retained.

### `trial_eligibility_assessments`

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `user_id` | `UUID NOT NULL REFERENCES users(id)` |
| `decision` | `TEXT NOT NULL CHECK (decision IN ('eligible','ineligible','review_required'))` |
| `policy_version` | `BIGINT NOT NULL` |
| `risk_reasons` | `JSONB NOT NULL DEFAULT '[]'` |
| `decided_by_user_id` | `UUID REFERENCES users(id)` |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |

Risk reasons contain codes, never raw IPs, raw device identifiers, or raw keys.
Indexes: `(user_id, created_at DESC)`, `(decision, created_at)`.

### `trial_grants`

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `user_id` | `UUID NOT NULL UNIQUE REFERENCES users(id)` |
| `assessment_id` | `UUID NOT NULL REFERENCES trial_eligibility_assessments(id)` |
| `credit_amount` | `BIGINT NOT NULL CHECK (credit_amount > 0)` |
| `policy_version_id` | `UUID NOT NULL REFERENCES plan_policy_versions(id)` |
| `ledger_entry_id` | `UUID NOT NULL UNIQUE REFERENCES credit_ledger(id)` |
| `idempotency_key` | `TEXT NOT NULL UNIQUE` |
| `granted_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |

One row per user makes the grant idempotent. It is never deleted or recreated.

### `promotion_versions`

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `code` | `TEXT NOT NULL` |
| `version` | `BIGINT NOT NULL` |
| `promotion_type` | `TEXT NOT NULL CHECK (promotion_type = 'first_purchase_bonus')` |
| `bonus_credits` | `BIGINT NOT NULL CHECK (bonus_credits > 0)` |
| `active` | `BOOLEAN NOT NULL DEFAULT false` |
| `effective_from` | `TIMESTAMPTZ NOT NULL` |
| `effective_until` | `TIMESTAMPTZ` |
| `created_by_user_id` | `UUID NOT NULL REFERENCES users(id)` |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |

Unique `(code, version)`. Published versions are immutable. The initial rule is
an integer bonus amount; another formula requires a later approved policy.

### `user_promotion_redemptions`

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `user_id` | `UUID NOT NULL REFERENCES users(id)` |
| `promotion_type` | `TEXT NOT NULL` |
| `promotion_version_id` | `UUID NOT NULL REFERENCES promotion_versions(id)` |
| `purchase_request_id` | `UUID NOT NULL UNIQUE` |
| `bonus_ledger_entry_id` | `UUID NOT NULL UNIQUE REFERENCES credit_ledger(id)` |
| `redeemed_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `reversed_at` | `TIMESTAMPTZ` |
| `reversal_ledger_entry_id` | `UUID UNIQUE REFERENCES credit_ledger(id)` |

Unique `(user_id, promotion_type)` enforces one first-purchase redemption even
if the bonus is later reversed.

### `credit_plans`

`plans` describe access; `credit_plans` describe purchasable credit packages.

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `code` | `TEXT NOT NULL UNIQUE` |
| `name` | `TEXT NOT NULL` |
| `description` | `TEXT NOT NULL DEFAULT ''` |
| `credit_amount` | `BIGINT NOT NULL CHECK (credit_amount > 0)` |
| `price_minor` | `BIGINT NOT NULL CHECK (price_minor > 0)` |
| `currency` | `CHAR(3) NOT NULL` |
| `active` | `BOOLEAN NOT NULL DEFAULT false` |
| `display_order` | `INTEGER NOT NULL DEFAULT 0` |
| `created_by_user_id` | `UUID NOT NULL REFERENCES users(id)` |
| `updated_by_user_id` | `UUID NOT NULL REFERENCES users(id)` |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `archived_at` | `TIMESTAMPTZ` |

Money is integer minor units. Packages are archived, not deleted. Purchase
requests snapshot all financially relevant fields.

### `bank_accounts`

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `code` | `TEXT NOT NULL UNIQUE` |
| `bank_name` | `TEXT NOT NULL` |
| `account_name` | `TEXT NOT NULL` |
| `account_number` | `TEXT NOT NULL` |
| `branch` | `TEXT` |
| `currency` | `CHAR(3) NOT NULL` |
| `instructions` | `TEXT NOT NULL DEFAULT ''` |
| `active` | `BOOLEAN NOT NULL DEFAULT false` |
| `display_order` | `INTEGER NOT NULL DEFAULT 0` |
| creator/updater/timestamps | same pattern as `credit_plans` |
| `archived_at` | `TIMESTAMPTZ` |

Indexes: `(currency, active, display_order)`. Account values are commercial
configuration, not authorization roles or application secrets, but mutation is
Super-Admin-only and audited.

### `credit_plan_bank_accounts`

Composite primary key `(credit_plan_id, bank_account_id)`, both foreign keys;
`active BOOLEAN NOT NULL`, `created_at`, and creator. Currency must match,
enforced transactionally and by validation.

### `uploaded_files`

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `owner_user_id` | `UUID NOT NULL REFERENCES users(id)` |
| `purpose` | `TEXT NOT NULL CHECK (purpose = 'payment_screenshot')` initially |
| `storage_provider` | `TEXT NOT NULL` |
| `bucket` | `TEXT NOT NULL` |
| `object_key` | `TEXT NOT NULL UNIQUE` |
| `original_filename` | `TEXT NOT NULL` |
| `mime_type` | `TEXT NOT NULL` |
| `size_bytes` | `BIGINT NOT NULL CHECK (size_bytes > 0)` |
| `sha256` | `CHAR(64) NOT NULL` |
| `status` | `TEXT NOT NULL CHECK (status IN ('pending','verified','quarantined','archived'))` |
| `uploaded_at` | `TIMESTAMPTZ NOT NULL` |
| `verified_at` | `TIMESTAMPTZ` |
| `archived_at` | `TIMESTAMPTZ` |

Indexes: `(owner_user_id, uploaded_at DESC)`, `(sha256)`, `(status, uploaded_at)`.
PostgreSQL stores metadata only, never screenshot bytes.

### `credit_purchase_requests`

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `user_id` | `UUID NOT NULL REFERENCES users(id)` |
| `status` | `TEXT NOT NULL CHECK (status IN ('pending','approved','rejected'))` |
| `credit_plan_id` | `UUID NOT NULL REFERENCES credit_plans(id)` |
| `bank_account_id` | `UUID NOT NULL REFERENCES bank_accounts(id)` |
| `screenshot_file_id` | `UUID NOT NULL UNIQUE REFERENCES uploaded_files(id)` |
| `plan_code_snapshot` | `TEXT NOT NULL` |
| `plan_name_snapshot` | `TEXT NOT NULL` |
| `purchase_credit_snapshot` | `BIGINT NOT NULL CHECK (purchase_credit_snapshot > 0)` |
| `price_minor_snapshot` | `BIGINT NOT NULL CHECK (price_minor_snapshot > 0)` |
| `currency_snapshot` | `CHAR(3) NOT NULL` |
| `bank_snapshot` | `JSONB NOT NULL` |
| `bonus_policy_snapshot` | `JSONB` |
| `submitted_at` | `TIMESTAMPTZ NOT NULL` |
| `reviewed_at` | `TIMESTAMPTZ` |
| `reviewed_by_user_id` | `UUID REFERENCES users(id)` |
| `rejection_reason` | `TEXT` |
| `purchase_ledger_entry_id` | `UUID UNIQUE` |
| `bonus_ledger_entry_id` | `UUID UNIQUE` |
| `version` | `BIGINT NOT NULL DEFAULT 1` |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL` |

Indexes: `(status, submitted_at)`, `(user_id, submitted_at DESC)`,
`(reviewed_by_user_id, reviewed_at)`. Snapshots and screenshot link are
immutable after submission.

### `credit_ledger`

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `user_id` | `UUID NOT NULL REFERENCES users(id)` |
| `amount` | `BIGINT NOT NULL CHECK (amount <> 0)` |
| `entry_type` | `TEXT NOT NULL CHECK (entry_type IN ('trial_grant','purchase','first_purchase_bonus','settlement','refund','reversal','manual_grant','manual_deduction','migration'))` |
| `purchase_request_id` | `UUID REFERENCES credit_purchase_requests(id)` |
| `reservation_id` | `UUID REFERENCES credit_reservations(id)` |
| `job_id` | `UUID REFERENCES jobs(id)` |
| `reversal_of_entry_id` | `UUID REFERENCES credit_ledger(id)` |
| `correlation_key` | `TEXT NOT NULL UNIQUE` |
| `reason` | `TEXT` |
| `created_by_user_id` | `UUID REFERENCES users(id)` |
| `metadata` | `JSONB NOT NULL DEFAULT '{}'` |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |

Indexes: `(user_id, created_at DESC, id)`, `(entry_type, created_at)`,
purchase/reservation/job references. Context checks require the appropriate
source reference per entry type. Rows are append-only. Refund/reversal uses a
new compensating entry and never edits the original.

### `credit_balance_accounts`

| Column | Type and constraints |
|---|---|
| `user_id` | `UUID PRIMARY KEY REFERENCES users(id)` |
| `posted_balance` | `BIGINT NOT NULL DEFAULT 0 CHECK (posted_balance >= 0)` |
| `reserved_balance` | `BIGINT NOT NULL DEFAULT 0 CHECK (reserved_balance >= 0)` |
| `version` | `BIGINT NOT NULL DEFAULT 1 CHECK (version > 0)` |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |

`available_balance = posted_balance - reserved_balance` and must remain
non-negative. This is a transactionally updated projection; the append-only
ledger and active reservations remain the accounting source of truth.

### `credit_reservations`

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `user_id` | `UUID NOT NULL REFERENCES users(id)` |
| `job_id` | `UUID NOT NULL UNIQUE REFERENCES jobs(id)` |
| `amount` | `BIGINT NOT NULL CHECK (amount > 0)` |
| `status` | `TEXT NOT NULL CHECK (status IN ('reserved','settled','released','refunded','review_required'))` |
| `idempotency_key` | `TEXT NOT NULL UNIQUE` |
| `reserved_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `settled_at`, `released_at`, `refunded_at` | `TIMESTAMPTZ` |
| `review_required_at` | `TIMESTAMPTZ` |
| `review_origin_status` | `TEXT CHECK (review_origin_status IN ('reserved','settled'))` |
| `resolution_reason` | `TEXT` |
| `version` | `BIGINT NOT NULL DEFAULT 1` |

Indexes: `(user_id, status)`, `(status, reserved_at)`. User, job, amount, and
idempotency key are immutable.

### `jobs`

The canonical operational job table must preserve workflow-v2 identity while
adding billing fields outside the Core AI Pipeline:

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `user_id` | `UUID NOT NULL REFERENCES users(id)` |
| operational lifecycle fields | existing validated status/stage/progress/timestamps |
| `selected_plan_id` | `UUID NOT NULL REFERENCES plans(id)` |
| `plan_code_snapshot` | `TEXT NOT NULL CHECK (plan_code_snapshot IN ('trial','normal','pro'))` |
| `billing_mode` | `TEXT NOT NULL CHECK (billing_mode IN ('byok','blink_funded'))` |
| `source_duration_ms` | `BIGINT NOT NULL CHECK (source_duration_ms > 0)` |
| `billing_block_seconds` | `INTEGER NOT NULL CHECK (billing_block_seconds = 30)` |
| `billing_blocks` | `BIGINT NOT NULL CHECK (billing_blocks > 0)` |
| `credits_per_block` | `BIGINT NOT NULL CHECK (credits_per_block > 0)` |
| `total_required_credits` | `BIGINT NOT NULL CHECK (total_required_credits > 0)` |
| `pricing_policy_version_id` | `UUID NOT NULL REFERENCES plan_policy_versions(id)` |
| `pricing_policy_snapshot` | `JSONB NOT NULL` |
| `entitlement_snapshot` | `JSONB NOT NULL` |
| `credit_reservation_id` | `UUID UNIQUE REFERENCES credit_reservations(id)` |
| `billing_status` | `TEXT NOT NULL CHECK (billing_status IN ('not_reserved','reserved','settled','released','refunded','review_required'))` |
| `paid_provider_started_at` | `TIMESTAMPTZ` |
| `billing_finalized_at` | `TIMESTAMPTZ` |
| `idempotency_key` | `TEXT NOT NULL UNIQUE` |

Duration, blocks, rate, total, selected plan, billing mode, policy version, and
entitlements become immutable when the job is accepted. Later policy edits do
not reprice it.

The circular job/reservation references are installed as deferrable foreign
keys after both tables exist. A single transaction inserts or links both before
commit; neither may point at a different user or amount.

### `user_provider_credentials`

This is the target metadata/encrypted-material record if existing BYOK
credentials are migrated. Migration is separately approved.

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `user_id` | `UUID NOT NULL REFERENCES users(id)` |
| `provider` | `TEXT NOT NULL CHECK (provider = 'gemini')` initially |
| `encrypted_payload` | `BYTEA NOT NULL` or managed encrypted-object reference |
| `encryption_key_version` | `TEXT NOT NULL` |
| `risk_fingerprint` | `TEXT` |
| `verification_status` | `TEXT NOT NULL CHECK (verification_status IN ('unverified','valid','invalid','unavailable'))` |
| `verified_at` | `TIMESTAMPTZ` |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL` |
| `revoked_at` | `TIMESTAMPTZ` |

Unique active credential `(user_id, provider)` via partial index. The risk
fingerprint is keyed/non-reversible and cannot authenticate provider use.
Only the credential service can read encrypted material; ordinary application,
analytics, audit, and admin readers cannot.

### `job_provider_usage`

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `job_id` | `UUID NOT NULL REFERENCES jobs(id)` |
| `user_id` | `UUID NOT NULL REFERENCES users(id)` |
| `provider` | `TEXT NOT NULL` |
| `model_identifier` | `TEXT NOT NULL` |
| `operation_type` | `TEXT NOT NULL` |
| `provider_correlation_id` | `TEXT` |
| `input_units`, `output_units` | `BIGINT CHECK (value >= 0)` |
| `audio_duration_ms` | `BIGINT CHECK (audio_duration_ms >= 0)` |
| `estimated_cost_minor` | `BIGINT CHECK (estimated_cost_minor >= 0)` |
| `cost_currency` | `CHAR(3)` |
| `metadata` | `JSONB NOT NULL DEFAULT '{}'` |
| `recorded_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |

Indexes: `(job_id, recorded_at)`, `(provider, recorded_at)`,
`(user_id, recorded_at)`. These records support internal analysis only and do
not determine the user-facing duration charge. They must not contain prompts,
raw keys, or provider response content unless a later privacy policy explicitly
permits it.

### `audit_logs`

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `occurred_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `actor_user_id` | `UUID REFERENCES users(id)` |
| `actor_service` | `TEXT` |
| `subject_user_id` | `UUID REFERENCES users(id)` |
| `request_id` | `TEXT` |
| `event_type` | `TEXT NOT NULL` |
| `resource_type` | `TEXT NOT NULL` |
| `resource_id` | `UUID` |
| `before_state`, `after_state` | `JSONB` |
| `metadata` | `JSONB NOT NULL DEFAULT '{}'` |
| `network_risk_hash`, `device_risk_hash` | `TEXT` |

Check requires exactly one of actor user/service where appropriate. Indexes:
`(occurred_at DESC)`, `(actor_user_id, occurred_at DESC)`,
`(subject_user_id, occurred_at DESC)`, and
`(resource_type, resource_id, occurred_at DESC)`. Append-only database
permissions prohibit update/delete. Secrets, raw screenshots, raw keys,
cookies, and authorization headers are forbidden.

### `system_settings`

| Column | Type and constraints |
|---|---|
| `key` | `TEXT PRIMARY KEY` |
| `value_json` | `JSONB NOT NULL` |
| `classification` | `TEXT NOT NULL CHECK (classification IN ('public','internal'))` |
| `version` | `BIGINT NOT NULL DEFAULT 1 CHECK (version > 0)` |
| `updated_by_user_id` | `UUID REFERENCES users(id)` |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL` |

Plan rates belong in versioned plan policy tables, promotions in promotion
tables, and secrets in secret management—not `system_settings`. Every mutation
uses optimistic version checking and an audit row.

### `idempotency_keys`

| Column | Type and constraints |
|---|---|
| `id` | `UUID PRIMARY KEY` |
| `actor_scope` | `TEXT NOT NULL` |
| `operation` | `TEXT NOT NULL` |
| `idempotency_key` | `TEXT NOT NULL` |
| `request_hash` | `CHAR(64) NOT NULL` |
| `state` | `TEXT NOT NULL CHECK (state IN ('in_progress','completed','failed'))` |
| `resource_type` | `TEXT` |
| `resource_id` | `UUID` |
| `response_status` | `INTEGER CHECK (response_status BETWEEN 100 AND 599)` |
| `response_body` | `JSONB` |
| `created_at`, `updated_at` | `TIMESTAMPTZ NOT NULL` |
| `expires_at` | `TIMESTAMPTZ` |

Unique `(actor_scope, operation, idempotency_key)`. Reuse with a different
request hash returns `409`. Financial-operation records are retained according
to financial retention rather than short general API expiry.

### `role_bootstrap_state`

| Column | Type and constraints |
|---|---|
| `bootstrap_name` | `TEXT PRIMARY KEY` |
| `status` | `TEXT NOT NULL CHECK (status IN ('pending','completed','disabled'))` |
| `bootstrap_user_id` | `UUID REFERENCES users(id)` |
| `completed_at`, `disabled_at` | `TIMESTAMPTZ` |
| `audit_log_id` | `UUID UNIQUE REFERENCES audit_logs(id)` |
| `version` | `BIGINT NOT NULL DEFAULT 1` |

One protected row plus a PostgreSQL advisory lock makes bootstrap one-time and
concurrency safe. It contains no email, UID secret, credential, or token.

### `worker_leases`

| Column | Type and constraints |
|---|---|
| `job_id` | `UUID PRIMARY KEY REFERENCES jobs(id)` |
| `worker_id` | `TEXT NOT NULL` |
| `lease_token` | `UUID NOT NULL UNIQUE` |
| `leased_at`, `heartbeat_at`, `expires_at` | `TIMESTAMPTZ NOT NULL` |
| `attempt` | `INTEGER NOT NULL CHECK (attempt > 0)` |

Indexes: `(expires_at)`, `(worker_id, heartbeat_at)`. Conditional acquire and
heartbeat operations prevent duplicate workers; lease expiry permits recovery
but never independently releases credits.

## State machines

### Purchase request

The object upload is prepared and verified before request submission. The
financial request begins in `pending`.

```text
pending → approved
pending → rejected
```

Approved and rejected are terminal. Pending-purchase cancellation is not an
approved transition or initial API. Its availability, authorization, timing,
and consequences remain unresolved until Product Owner approval.

Repeated approval with the same
idempotency key returns the original approved result. Another key against an
already approved request returns the existing terminal representation without
adding credits. Conflicting terminal transitions return `409`.

### Reservation and billing

```text
reserved → settled
reserved → released
reserved → review_required
review_required → settled
review_required → released
settled → refunded
settled → review_required
review_required → refunded   only when prior settlement is established
```

- `reserved`: credits reduce available balance; no ledger debit yet.
- `settled`: valid usable output reached the approved completion milestone; a
  negative settlement ledger entry exists.
- `released`: no charge; reserved balance is restored and no settlement debit
  exists.
- `refunded`: a prior settlement is offset in full by a positive refund entry.
- `review_required`: exceptional recovery state used only after reconciliation
  cannot establish provider, settlement, or usable-output facts.
  `review_origin_status` preserves whether funds were still reserved or already
  settled. A reserved-origin review keeps the amount unavailable; a
  settled-origin review does not reserve it again. Every review row must have a
  configurable resolution deadline, alerting, and an idempotent reconciliation
  or Super Admin resolution path; credits must not remain unavailable
  indefinitely.

Initial P2 has no partial refund. Released, refunded, and settled are terminal
except full `settled → refunded`. Invalid transitions return `409`.

### Completion and settlement milestone

Settlement must not occur merely because AI generation returned. It occurs only
after the existing completion contract is satisfied:

- canonical `videoUrl` is assigned;
- output path exists;
- output is a regular file;
- output size is greater than zero;
- existing output validation has accepted it as usable.

The billing service consumes this milestone as an external fact. It must not
change the pipeline's validation, FFmpeg, or output-quality behavior.

## Transaction boundaries and locking

### Trial grant

Begin transaction; lock user and trial/balance rows; verify eligible assessment
and absence of `trial_grants`; insert trial grant, `trial_grant` ledger entry,
update balance projection, and audit row; commit. Unique `trial_grants.user_id`,
ledger correlation, and idempotency keys make retries safe.

### Purchase approval

Begin; verify current PostgreSQL `super_admin`; lock purchase `FOR UPDATE`;
require pending; lock user promotion/balance rows; insert `purchase` ledger
entry; determine first approved real purchase while protected by unique
promotion redemption; insert separate bonus ledger/redemption when eligible;
update balance projection; update request; insert audit; commit. All succeed or
all fail.

### Purchase rejection

Lock request; require pending; store reviewer, reason, and rejected status;
insert audit; commit. No credit or bonus entry.

### Manual adjustment

Super Admin only. Lock balance; require a nonempty reason; validate a deduction
does not exceed available balance; insert `manual_grant` or
`manual_deduction`; update projection; audit; commit. Never overwrite balance.

### Job reservation

Begin after authoritative duration and policy resolution; lock active plan
assignment/policy and balance; recalculate blocks and credits server-side;
verify entitlement and mode; check `available_balance`; insert job billing
snapshot and unique reservation; increase reserved balance; audit; commit.
Only then may the job enter paid processing.

### Settlement

Lock job, reservation, and balance; require committed `reserved` state and valid
output milestone; insert one negative `settlement` ledger entry; decrease both
posted and reserved balance by the reserved amount; set reservation/job
settled; audit; commit.

### Release

Lock job, reservation, and balance; require `reserved` or resolvable
`review_required`; decrease reserved balance only; set released; audit; commit.
There is no negative settlement entry to reverse. Ordinary pre-settlement
system/export failure with no valid output follows this path directly and must
not first create a settlement debit.

### Full refund

Refund is valid only when a settlement ledger debit already exists. Lock the
settled reservation, original settlement entry, and balance; insert one
positive `refund` entry for the full settled amount; increase posted balance;
set refunded; audit. A purchase reversal separately inserts compensating
`reversal` entries for both purchased credits and any first-purchase bonus.

### Concurrency and retries

- Lock the single `credit_balance_accounts` row to serialize concurrent
  reservations for one user.
- Use unique job/reservation, purchase approval, promotion redemption, ledger
  correlation, and idempotency constraints.
- Never hold a transaction open during Firebase, object upload, Gemini, TTS,
  FFmpeg, or other network/media work.
- Retry deadlocks/serialization failures with a small bounded policy.
- Store completed idempotent responses. Network timeout or double-click returns
  the committed result rather than repeating the mutation.

## Balance model

The immutable ledger is the source of truth; `credit_balance_accounts` is a
transactionally maintained projection used for row locking and fast reads.

```text
posted balance = sum(all ledger amounts)
reserved balance = sum(amount of reservations currently reserved, plus
                   review_required rows whose review_origin_status is reserved)
available balance = posted balance - reserved balance
settled spending = absolute sum(settlement debits)
refunded credits = sum(refund credits)
```

A scheduled reconciliation recalculates projections. Any mismatch disables new
Blink-funded reservations for the affected account and raises an audit/alert;
it never silently rewrites financial history.

## API contracts

All routes use the existing authenticated same-origin architecture. Mutations
return structured errors and request IDs. Financial mutations require an
`Idempotency-Key`; the backend hashes the normalized request. Expected common
statuses: `200/201/202`, `400` malformed, `401` unauthenticated, `403`
unauthorized/ineligible, `404`, `409` state/idempotency conflict, `422`
semantically invalid, `429`, and `503` unavailable dependency. Insufficient
credits uses one documented code such as `INSUFFICIENT_CREDITS` with `409`; the
client must not infer balances from HTTP status alone.

### Plans, eligibility, and estimates

- `GET /api/plans`
  - Authenticated user.
  - Returns available plan codes, display data, current effective policy
    version, billing mode, rate, and public entitlements.
  - No secrets or internal margin/provider-cost data.
- `GET /api/plans/me`
  - Returns current assignment/status and effective entitlements.
- `POST /api/plans/me/select`
  - Body: `planCode`; explicit Normal/Pro selection subject to eligibility.
  - Idempotent. Never changes `user_roles`.
- `GET /api/trial/eligibility`
  - Returns `eligible`, `ineligible`, or `review_required`, whether already
    granted, allowance if public, and safe reason codes.
- `POST /api/trial/grant`
  - Requires valid stored BYOK and eligible assessment.
  - Atomically inserts grant, ledger, balance, and audit.
  - Idempotent; repeated calls return the original grant.
- `POST /api/jobs/estimate`
  - Body: upload/job reference, explicit `planCode`, `billingMode`.
  - Backend verifies authoritative duration when available and returns duration,
    30-second blocks, credits per block, estimated/authoritative total, policy
    version, and relevant entitlements.
  - Does not reserve credits or force a confirmation popup.
  - UI may show this unobtrusively near Start Processing/account billing.

### BYOK

- Existing verify/presence/store/delete behavior remains conceptually:
  `POST /api/workspace/gemini-key/verify`,
  `GET/PUT/DELETE /api/workspace/gemini-key`.
- Store accepts the raw key only over the authenticated request, verifies it,
  encrypts it, and returns presence/verification metadata—not the key.
- A future credential record may include provider, key version, verification
  timestamp/status, encrypted material reference, and non-reversible risk
  fingerprint. It must not expose raw or decrypted values.

### Job creation/admission

- Upload creates the existing pending job without beginning paid processing.
- `POST /api/workspace/jobs/{jobId}/queue`
  - Body includes explicit `planCode`, `billingMode`, expected policy version,
    and effects.
  - Backend validates ownership, authoritative duration, active assignment,
    entitlements, BYOK/platform credential availability, current policy, and
    requested effects.
  - It computes the authoritative charge and atomically reserves credits before
    queue admission.
  - Response includes billing snapshot and reservation state, never credentials.
  - Repeating with the same idempotency key returns the same job/reservation.
  - A stale client estimate is replaced by authoritative policy or rejected
    with a structured policy-version conflict; it is never trusted for charge.
- Internal billing service operations:
  `reserve`, `settle`, `release`, `mark-review-required`, and `refund`.
  Prefer direct service calls; if HTTP is required, use a non-browser service
  identity and private `/internal/billing/*` boundary.

### BYOK failure

Invalid, unavailable, quota-exhausted, or provider-rejected BYOK returns a
structured error containing safe provider category, retryability, selected
mode, job ID, and request ID. It does not contain a key or silently choose Pro.
An unsettled reservation follows the approved failure rules.

### Purchases

- `GET /api/credit-plans?currency=...`: active packages.
- `GET /api/credit-plans/{id}/bank-accounts`: applicable active accounts.
- `POST /api/uploads/payment-screenshots/intents`: validates declared
  MIME/size and issues a private upload intent.
- `POST /api/uploads/payment-screenshots/{id}/complete`: verifies object
  metadata, hash, image decoding/scanning state, and ownership.
- `POST /api/credit-purchase-requests`: plan ID, bank ID, verified file ID;
  snapshots current values and creates pending.
- `GET /api/credit-purchase-requests` and `GET /{id}`: own records only.
- Pending purchase cancellation endpoint/state is not exposed until Product
  Owner approval defines its availability, authorization, timing, and effects.
- `GET /api/credits/balance`: posted, reserved, available.
- `GET /api/credits/ledger?cursor=...`: paginated own ledger/history.

### Super Admin

Use PostgreSQL `super_admin`, not generic `requireAdmin`:

- list/filter/read purchase requests and short-lived screenshot access;
- approve or reject pending requests;
- create/update/archive credit packages and bank accounts;
- create/publish/archive plan policy and promotion versions;
- assign/suspend commercial plans without changing roles;
- manual grant/deduction and approved full refund/reversal;
- financial ledger, trial-risk decision, and audit review;
- role management through separately protected endpoints.

Every mutation requires idempotency where repeatable, a reason where
financially relevant, and an audit record in the same database transaction.

## Payment screenshot storage

- Use private durable object storage, not PostgreSQL blobs or assumed-permanent
  Railway local filesystem.
- Suggested key:
  `payment-screenshots/{userUuid}/{year}/{month}/{randomFileUuid}`.
- Use short-lived signed upload/download URLs or a backend streaming boundary.
- Users access only their own request evidence; Super Admin accesses evidence
  only for review/audit. Normal Admin has no default access.
- Final MIME allowlist and size limit remain product/security decisions.
- Validate declared MIME, magic bytes, successful bounded image decode,
  dimensions, and decompression limits; strip or control metadata where
  appropriate.
- Compute SHA-256 after upload. Hash matches generate a risk warning only; they
  do not prove duplicate or invalid payment.
- Quarantine files pending validation/malware controls.
- Record provider, bucket/key, MIME, size, hash, uploader, and timestamps.
- Use object versioning/backup and test restore separately from PostgreSQL.
- Orphan upload intents may be expired by a safe lifecycle rule.
- Financial retention/archive policy must be approved before object deletion.

## Mode decision logic

Input is explicit user selection plus current plan policy:

1. Resolve active plan assignment and published policy version.
2. Validate requested mode is entitled:
   - Trial → BYOK;
   - Normal → BYOK;
   - Pro → Blink-funded.
3. Validate feature entitlements before accepting effects.
4. Validate authoritative duration and calculate credits.
5. BYOK: require verified encrypted user credential.
6. Blink-funded: require Pro eligibility, platform credential availability,
   provider availability, and sufficient credits.
7. Persist the complete immutable job billing/entitlement snapshot.
8. Reserve credits atomically.
9. Admit the job only after commit.

There is no automatic fallback in either direction. The user fixes BYOK or
explicitly selects an eligible Pro plan/mode for a new admission attempt.

## Failure, release, refund, and recovery

| Event | Initial P2 rule |
|---|---|
| Upload or media validation fails before reservation | No reservation and no debit |
| Plan/entitlement/BYOK validation fails | No queue admission; no debit |
| Reservation transaction fails | Job does not begin |
| Queue admission fails in the same transaction | Roll back reservation |
| User cancels before paid provider work | Release reservation |
| Blink/provider fails before paid work begins | Release reservation |
| BYOK is invalid/quota exhausted/rejected | Structured BYOK failure; preserve mode; release if no chargeable Blink work occurred |
| Blink/system failure, including final export, with no valid usable output and no settlement debit | Automatically release the reservation; do not settle merely to create a refund |
| Blink/system failure with an existing settlement debit and no valid usable output | Insert a full compensating refund; initial P2 has no partial refund |
| Crash/restart | First reconcile job checkpoint, settlement ledger, provider marker/correlation, and usable-output contract |
| Reconciliation proves no valid output and no prior settlement | Automatically release |
| Reconciliation proves valid usable output | Settle the existing reservation idempotently |
| Provider, settlement, or output state genuinely cannot be established | Exceptionally mark `review_required`; alert and resolve within a configured operational deadline |
| Worker crashes before paid-provider marker | Resume idempotently or safely release if job is abandoned |
| Worker crashes after paid-provider marker | Reconcile checkpoint, output, ledger, and provider correlation; use `review_required` only if facts remain indeterminate |
| Process restarts | Recover job, lease, billing snapshot, and same reservation; never reserve twice |
| Retry from checkpoint | Reuse the same reservation and immutable price |
| Duplicate worker | Database lease/conditional job update prevents duplicate execution and settlement |
| Output URL missing, file missing/not regular/zero bytes/invalid | Never mark successful; release when unsettled, or fully refund only when a settlement debit exists |
| Reservation remains stale | Reconcile to settle/release first; use time-bounded `review_required` only when facts cannot be established. Age alone does not prove release |
| Qualifying purchase fully reversed | Separate purchase and bonus compensating entries; first-purchase redemption remains consumed |

No partial refunds are supported initially. Explicit user cancellation after
paid provider work begins remains an open business decision. Until approved,
the system must reconcile established billing/output facts and use
`review_required` only when those facts are genuinely indeterminate—not as the
default cancellation outcome.

## Authentication, role authority, and bootstrap

Firebase remains the identity/login verifier. PostgreSQL becomes authoritative
for application roles and permissions. Firebase claims may be a compatibility
cache during migration but cannot override PostgreSQL for financial or role
administration.

Controlled initial Super Admin bootstrap:

1. Accept a temporary server-only bootstrap configuration identifying the
   approved Firebase identity. Do not scatter email comparisons through code.
2. Resolve and verify its Firebase UID through Firebase Admin.
3. Begin a PostgreSQL bootstrap transaction protected by a database advisory
   lock and a one-time bootstrap-state record.
4. Upsert the user by Firebase UID.
5. Insert `user_roles(role='super_admin', source='bootstrap',
   protected_bootstrap=true)`.
6. Insert an immutable audit event without secrets.
7. Mark bootstrap complete and commit.
8. Verify login and a second recovery-capable Super Admin under an approved
   operational procedure.
9. Disable/remove the temporary bootstrap configuration after initialization.

The currently associated bootstrap identity is operational input, not a
permanent authorization rule. Documentation and logs must not expose
credentials. Protected bootstrap Super Admin deletion, demotion, or disablement
is rejected unless a separately approved recovery procedure is activated with
strong authentication, multiple-party review where practical, immutable audit,
and verification that another active Super Admin exists.

## Security and privacy requirements

- BYOK credentials stay encrypted with authenticated encryption and managed,
  versioned key material. Existing encrypted handling remains until migration is
  approved and verified.
- Raw keys never enter logs, audits, analytics, URLs, database plan/settings
  rows, exception bodies, or client-readable responses.
- Workers receive only the job-scoped credential required by the snapshotted
  mode.
- Platform Gemini keys remain in secret management.
- Plan rates and nonsecret policy may be in PostgreSQL; secrets may not be in
  `system_settings`.
- Financial, role, plan, bank, promotion, trial, and entitlement mutations are
  audited.
- Ledger and audit records are append-only.
- Refunds and reversals are compensating entries.
- All object and database access is ownership/role scoped.
- Privacy-safe trial signals require retention, access, and deletion policy.

## Implementation order

### P2.1 — Database infrastructure and migrations

Connection pool, transaction helper, migration runner/checksums, database
readiness, test database, and deployment contract. No runtime store cutover and
no Core AI Pipeline changes.

### P2.2 — Durable identity, role, audit, and bootstrap foundation

User sync, PostgreSQL role authority, protected bootstrap transaction,
append-only audit, and last-Super-Admin concurrency protection. Firebase remains
identity authority. Billing-domain identity sync, financial Super Admin
authority, append-only audit, and bootstrap scaffolding exist; global
application-role cutover and operational bootstrap remain pending.

### P2.3 — Plans, policies, entitlements, promotions, and assignments

Trial/Normal/Pro, versioned 30-second rates, Blur/Flip/provider entitlements,
trial allowance, first-purchase promotion, and public eligibility reads.
Implemented behind explicit billing activation with no seeded commercial values.

### P2.4 — Object storage and manual purchase requests

Private screenshot lifecycle, credit packages, bank accounts, immutable
snapshots, pending/rejected review, and retention controls.
Metadata, catalog, snapshots, and review are implemented; private object
upload/download, content verification, and retention operations remain pending.

### P2.5 — Immutable ledger and balance projection

Ledger permissions, trial grant, purchase credit, bonus, adjustments,
reconciliation, pagination, and invariant monitoring.
Core ledger/grant/purchase/bonus/adjustment and balance projection are
implemented; cursor pagination and scheduled invariant monitoring remain pending.

### P2.6 — Super Admin approval/rejection transactions

Atomic purchase/bonus approval, rejection, adjustment, full reversal, audit,
idempotency, and concurrency tests.
Approval, rejection, adjustment, audit, idempotency, and concurrency are
implemented. Full purchase/bonus reversal remains pending.

### P2.7 — Job billing snapshots and reservations

Authoritative duration, block calculation, immutable policy/entitlement
snapshot, atomic reservation, concurrent-admission protection, and job linkage
outside pipeline internals.

### P2.8 — BYOK/Blink-funded selection and settlement

Explicit mode, credential isolation, platform-secret boundary, completion
milestone settlement, full failure release/refund, and no silent fallback.

### P2.9 — Recovery, migration, backup, and staging verification

Worker lease/reconciliation, `review_required`, legacy data backfill/cutover,
PostgreSQL/object backup restore, restart/redeploy, and concurrency tests.

Every phase requires focused tests and documentation updates. All phases must
confirm the Core AI Pipeline and accepted output behavior remain unchanged.

## Required tests before activation

- Real PostgreSQL migration and constraint tests.
- Concurrent reservation tests using independent connections.
- Ledger append-only and projection reconciliation tests.
- Trial-grant and first-purchase-bonus idempotency/race tests.
- Purchase double-approval, competing-reviewer, rollback-injection, and
  rejected/cancelled-no-credit tests.
- Full purchase/bonus reversal tests using compensating entries.
- Role/plan separation and permission-matrix tests.
- Protected bootstrap, self-lockout, last-Super-Admin, and bootstrap-disable
  tests.
- Plan version/snapshot immutability and exact block-boundary tests.
- No silent BYOK/funded fallback tests.
- Secret-redaction tests for logs, errors, audit, URLs, and responses.
- Screenshot ownership, signed URL, MIME spoof, oversized/decompression,
  quarantine, hash-warning, and orphan tests.
- Worker crash before/after paid marker, restart, duplicate execution,
  settlement, release, refund, and `review_required` tests.
- Missing/nonregular/zero/invalid output must never settle.
- Database and object-storage backup/restore test.
- Existing automated, TypeScript, build, and media regression suites must
  remain green without changing output expectations.

## Open decisions that still block later implementation

These do not block database/migration scaffolding, but the affected feature
cannot activate until approved:

1. Exact integer Trial, Normal, and Pro credits per 30-second block.
2. Exact trial allowance and trial risk thresholds/review process.
3. Exact Normal-versus-Pro resource limits other than approved feature/mode
   differences.
4. Credit package amounts, money prices, and supported currencies.
5. First-purchase bonus integer amount, activation dates, and whether it is
   global or limited to specified packages.
6. Whether pending purchase cancellation exists and, if approved, its
   authorization, timing, and consequences.
7. Payment screenshot MIME allowlist, maximum bytes, and retention duration.
8. User-cancellation outcome after paid provider work begins.
9. Operational deadline, escalation process, and authority for resolving
   exceptional `review_required` cases.
10. Migration treatment for existing BYOK credentials and existing users/jobs.
