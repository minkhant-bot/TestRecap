# Credits and Commercial Plans

> Current product workflow is manual bank confirmation followed by manual credit
> addition, not primarily Approve/Reject. Package/correction rules are in
> `18_PRODUCT_OWNER_DECISIONS_2026-08-01.md` and supersede conflicts below.

## Purpose

Separate current placeholder behavior from the approved P2 plan, purchase,
ledger, reservation, settlement, and compensation contract. The complete schema
and API specification is `17_P2_FOUNDATION_ARCHITECTURE.md`.

## Current Status

### Implemented

- Navigation includes Credits, and the shell displays a numeric balance
  fallback. Buy Credits (`/buy-credits`) is a real purchase flow — package and
  bank selection, external transfer, private proof upload via `Dialog`, and a
  pending purchase request — not a placeholder; this stale claim is corrected
  here and in `06_UI_UX.md`.
- Active-job and rolling admission limits are non-financial controls.
- Encrypted BYOK storage and verification exist.
- An opt-in PostgreSQL billing API foundation implements configurable Trial
  and Pro plans and policies (Normal is defined in the architecture and the
  database constraint but not selectable — see "Plan model" below),
  entitlements, Trial assessment and one-time grants (plus the newer Trial
  request/approval lifecycle), balance/ledger reads, credit packages/banks,
  private screenshot metadata, pending purchase submission, atomic Super
  Admin approval/rejection, one-time first-purchase bonus, and manual
  adjustments.
- No rates, allowances, bonuses, prices, currencies, packages, banks, or
  commercial policies are seeded.
- A separate default-off live-job gate connects authoritative-duration pricing,
  immutable job snapshots, reservations, settlement/release/full-refund,
  worker leases, checkpoint recovery, and exceptional `review_required`
  reconciliation to the existing workspace worker.
- Super Admin package management now provides create, edit, activate,
  deactivate, archive, and reorder operations behind the billing gate. Package
  mutations require explicit confirmation, idempotency, PostgreSQL Super Admin
  authority, and append-only audit entries. User reads return active,
  non-archived packages only.
- Self-service commercial-plan selection has been removed from the
  application code: `PLAN_CODES` in `src/services/billingFoundation.js` is
  now `{trial, pro}` only, and `POST /api/plans/me/select` unconditionally
  returns HTTP 410 `PLAN_SELF_SELECTION_REMOVED`. Pro is assigned only as a
  side effect of an approved credit purchase. The `plans.code` database check
  constraint still permits `'normal'` for compatibility, but no current code
  path can select or configure it as a live plan.
- A second, simpler Trial lifecycle now coexists with the original
  eligibility-assessment flow: an authenticated user submits one lifetime
  `trial_requests` row (`pending`), and PostgreSQL Super Admin approves it,
  granting a fixed, non-configurable 12 credits that expire exactly 120 hours
  (5 days) after approval. Unused Trial credit is automatically forfeited at
  the next job-reservation attempt after expiry (`checkAndExpireTrial`, gated
  behind `P2_LIVE_JOB_BILLING_ENABLED`). See "Trial request lifecycle" below.
  Added by migration `0003_trial_lifecycle.sql`.

### Approved and implemented as a gated foundation

- PostgreSQL-backed plans, policy rates, entitlements, Trial grants, purchase
  credits/bonus, immutable ledger, balance projection, and financial audit.
- Exact 30-second estimates and explicit BYOK versus Blink-funded eligibility.
- Manual purchase metadata, private binary proof upload/preview, and review,
  without public files or database blobs.

### Still not implemented

- Antivirus scanning beyond strict server-side JPEG/PNG/WebP structure,
  declared-type, size, and SHA-256 integrity validation.
- Production activation, global role cutover, backup/restore operations, and
  staging validation.

### Known gaps

- Legacy processing admission remains unchanged while the live billing gate is
  disabled.
- With the live gate enabled, every queue request must explicitly select the
  assigned plan and entitled mode; no server-key fallback is permitted.
- Railway proof-volume persistence plus synchronized database/binary
  backup/restore remain required before production use.
- Restart reconciliation only covers jobs whose JSON-store status is still
  `processing` at restart. A hard process crash between a job's JSON terminal
  write and its Postgres settle/release call can leave a reservation
  permanently `reserved` with no automatic reconciliation; the query needed
  to find such jobs exists (`listRecoverableLiveJobIds`) but nothing calls it
  in production. See `12_KNOWN_ISSUES.md` item 15 and `17_P2_FOUNDATION_ARCHITECTURE.md`
  P2.9.

## Plan model

Plans are not roles. The originally approved architecture (`17_P2_FOUNDATION_ARCHITECTURE.md`)
defines three plans — Trial, Normal, Pro — but the current `billingFoundation.js`
implementation only accepts and configures **Trial** and **Pro**; Normal has
been removed from self-service selection and plan configuration:

| Plan | Gemini credential | Credits | Blur/Flip | Purpose |
|---|---|---|---|---|
| Trial | Valid user BYOK required | Fixed one-time grant of 12 credits, expiring 120 hours after Owner approval; purchased credits (via Pro) are required after that grant is exhausted or expires | Unavailable | Limited acquisition trial, not unlimited free BYOK |
| Pro | Blink-owned secret | Purchased credits; configurable rate | Available | Provider-funded full approved feature set |

Normal (paid BYOK without Blink funding) remains architecturally defined in
`17_P2_FOUNDATION_ARCHITECTURE.md` and the `plans.code` database constraint
still permits the value `'normal'` for compatibility, but no current API or
UI path can select, configure, or assign it — `POST /api/plans/me/select`
always returns HTTP 410 `PLAN_SELF_SELECTION_REMOVED`. Reconcile the
architecture document with this implementation decision before further
Normal-plan work.

Roles remain only `user`, `admin`, and `super_admin`. Firebase verifies identity;
PostgreSQL is the approved P2 authority for roles/permissions. Plan assignment
never grants administrative access.

## Trial request lifecycle

A second, simpler Trial pathway (migration `0003_trial_lifecycle.sql`,
repository `src/db/repositories/trialRequests.js`) now coexists with the
original eligibility-assessment flow described in "Purchase and bonus rule"
below and in `17_P2_FOUNDATION_ARCHITECTURE.md`'s `trial_eligibility_assessments`
design. It does not replace that schema — `trial_eligibility_assessments` and
its `/trial/eligibility` / `/trial/grant` / admin `/trial-assessments` routes
remain mounted and functional — but application code comments mark it as the
current, simpler flow:

```text
authenticated user
  → POST /api/trial/request  (one lifetime request per user; idempotent replay
     of an existing pending/approved request; 409 TRIAL_ALREADY_GRANTED if a
     grant already exists)
  → trial_requests row, status "pending"
  → Super Admin reviews GET /api/admin/billing/trial-requests
  → Super Admin approves POST /api/admin/billing/trial-requests/{id}/approve
     (idempotent; requires status "pending" and no existing grant)
  → fixed 12-credit trial_grant, expires_at = approval time + 120 hours
  → trial_requests row becomes "approved" (terminal; there is no reject state)
```

- `trial_requests.status` supports only `pending` and `approved` — unlike
  `credit_purchase_requests`, there is no `rejected` transition in this schema.
- `trial_grants` gained two nullable columns, `expires_at` and `expired_at`,
  and its `assessment_id` foreign key became nullable (the new flow performs
  no eligibility assessment).
- Both the grant amount (12 credits) and expiry window (120 hours) are fixed
  in application code (`TRIAL_GRANT_CREDITS`, `TRIAL_DURATION_MS` in
  `src/services/billingFoundation.js`), not driven by
  `plan_policy_versions.trial_allowance_credits` as the original architecture
  describes.
- Expiry is enforced lazily: `checkAndExpireTrial` runs inside the live-job
  credit-reservation transaction (`P2_LIVE_JOB_BILLING_ENABLED` gate). Once
  `expires_at` has passed, it marks the grant expired and forfeits any
  remaining balance with a `manual_deduction` ledger entry
  (`metadata.trigger = 'trial_expiry'`) before blocking the new reservation
  with `TRIAL_EXPIRED`. There is no separate background expiry sweep.
- Both new endpoints require `P2_BILLING_ENABLED`; no separate gate was added.
  `trial_requests` rows are append-only (a `prevent_financial_delete()`
  trigger blocks deletion), matching the immutability pattern used elsewhere
  in the billing schema.

## Billing rule

```text
blocks = ceil(authoritativeSourceDurationSeconds / 30)
credits = blocks * versionedPlanCreditsPerBlock
```

Credits and balances are integers. File size and Gemini token count do not
determine the user-facing charge. The accepted job snapshots plan, billing mode,
duration, blocks, rate, total, entitlements, and pricing-policy version.

## Purchase and bonus rule

The user selects a credit package and applicable bank account, transfers the
exact amount outside Blink, uploads one private screenshot, and submits a
pending request. The Super Admin manually checks the actual bank account and
approves or rejects. Screenshot evidence never automatically proves payment.

Approval adds purchased credits exactly once in the same transaction as request
state and audit. An eligible real first purchase also receives a genuinely
additional, configurable bonus as a separate immutable ledger entry. Rejected
or cancelled requests receive neither. A full purchase reversal creates
separate compensating entries for purchase and bonus; original entries remain.

## Reservation and completion rule

Paid processing begins only after an atomic committed reservation prevents
concurrent overspending. Settlement requires the existing valid usable-output
contract: authoritative `videoUrl`, existing regular output file, non-zero
size, and successful existing output validation.

Before settlement, Blink/system failure without valid output releases the
reservation. A refund applies only when a settlement ledger debit already
exists; normal failure must not create an unnecessary settlement merely to
refund it. Initial P2 has no partial refund.

Recovery first reconciles the job checkpoint, settlement ledger, and usable
output. No valid output and no prior settlement releases automatically; valid
output settles. `review_required` is exceptional and is used only when provider,
settlement, or output facts genuinely cannot be established. It must trigger a
bounded reconciliation/Super Admin workflow and may not leave credits
indefinitely unavailable.

BYOK failure remains BYOK and returns a structured error. Pro failure remains
Blink-funded. Neither mode silently falls back to the other.

## Authority

- User: view plans/banks, request purchase, view own balance/history, use an
  eligible explicit mode.
- Admin: no credit-changing authority by default.
- Super Admin: plan/rate/entitlement/bank/promotion policy, purchase review,
  manual adjustment, full refund/reversal, role management, financial/audit
  review.
- Worker: idempotent job-scoped reserve/settle/release/review operations only.

Balances are never overwritten. Every change is an immutable ledger entry.
Financial records are never hard-deleted. Raw credentials never enter ledger,
audit, logs, analytics, URLs, or client responses.

## File References

- Complete P2 contract: `docs/17_P2_FOUNDATION_ARCHITECTURE.md`
- Current UI (real billing flow, not a placeholder): `src/ui/layout/AppShell.tsx`,
  `src/ui/pages/BuyCreditsPage.tsx`, `src/ui/billing/api.ts`
- Current Super Admin billing UI: `src/ui/pages/SuperAdminPage.tsx`
- Trial request/approval: `src/db/migrations/0003_trial_lifecycle.sql`,
  `src/db/repositories/trialRequests.js`, `src/services/billingFoundation.js`,
  `src/routes/billing.js`, `src/routes/adminBilling.js`
- Current BYOK: `src/services/userGeminiKeys.js`,
  `src/routes/workspace.js`
- Current non-financial admission: `src/services/admissionControl.js`
- Current jobs: `src/services/workspaceJobs.js`,
  `src/services/jobManager.js`

## Open decisions

The Trial grant amount and expiry are now fixed in code for the request/approval
flow (12 credits, 120 hours) rather than open; Normal's rate question is moot
while Normal is not selectable. Exact Pro credits-per-30-second-block rate,
risk thresholds for the original eligibility-assessment flow, credit-package
prices/currencies, bonus amount/dates, screenshot limits/retention,
pending-request cancellation, post-provider user-cancellation policy,
`review_required` operations, and legacy credential/data migration still
require approval before their dependent P2 phases activate.
