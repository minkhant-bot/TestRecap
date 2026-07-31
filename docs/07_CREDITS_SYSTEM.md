# Credits and Commercial Plans

## Purpose

Separate current placeholder behavior from the approved P2 plan, purchase,
ledger, reservation, settlement, and compensation contract. The complete schema
and API specification is `17_P2_FOUNDATION_ARCHITECTURE.md`.

## Current Status

### Implemented

- Navigation includes Credits and the shell displays a numeric fallback.
- Buy Credits is a “coming soon” empty state.
- Active-job and rolling admission limits are non-financial controls.
- Encrypted BYOK storage and verification exist.
- An opt-in PostgreSQL billing API foundation implements configurable
  Trial/Normal/Pro plans and policies, entitlements, Trial assessment and
  one-time grants, balance/ledger reads, credit packages/banks, private
  screenshot metadata, pending purchase submission, atomic Super Admin
  approval/rejection, one-time first-purchase bonus, and manual adjustments.
- No rates, allowances, bonuses, prices, currencies, packages, banks, or
  commercial policies are seeded.
- A separate default-off live-job gate connects authoritative-duration pricing,
  immutable job snapshots, reservations, settlement/release/full-refund,
  worker leases, checkpoint recovery, and exceptional `review_required`
  reconciliation to the existing workspace worker.

### Approved and implemented as a gated foundation

- PostgreSQL-backed plans, policy rates, entitlements, Trial grants, purchase
  credits/bonus, immutable ledger, balance projection, and financial audit.
- Exact 30-second estimates and explicit BYOK versus Blink-funded eligibility.
- Manual purchase metadata and review, without public files or database blobs.

### Still not implemented

- Private object upload/download and malware/image verification integration.
- UI activation or redesign.
- Production activation, global role cutover, backup/restore operations, and
  staging validation.

### Known gaps

- The current Credits UI is not connected to the PostgreSQL billing APIs.
- Legacy processing admission remains unchanged while the live billing gate is
  disabled.
- With the live gate enabled, every queue request must explicitly select the
  assigned plan and entitled mode; no server-key fallback is permitted.
- Screenshot metadata can be administratively verified, but storage-provider
  upload and evidence-access adapters remain required before production use.

## Plan model

Plans are not roles:

| Plan | Gemini credential | Credits | Blur/Flip | Purpose |
|---|---|---|---|---|
| Trial | Valid user BYOK required | Trial jobs consume the configurable free allowance at Trial’s versioned 30-second-block rate; purchased credits are required only after that allowance is exhausted | Unavailable | Limited acquisition trial, not unlimited free BYOK |
| Normal | Valid user BYOK required | Purchased credits; lower configurable rate than Pro | Unavailable | Paid Blink infrastructure while user pays Gemini provider |
| Pro | Blink-owned secret | Purchased credits; higher configurable rate | Available | Provider-funded full approved feature set |

Roles remain only `user`, `admin`, and `super_admin`. Firebase verifies identity;
PostgreSQL is the approved P2 authority for roles/permissions. Plan assignment
never grants administrative access.

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
- Current UI placeholder: `src/ui/layout/AppShell.tsx`,
  `src/ui/pages/BuyCreditsPage.tsx`
- Current BYOK: `src/services/userGeminiKeys.js`,
  `src/routes/workspace.js`
- Current non-financial admission: `src/services/admissionControl.js`
- Current jobs: `src/services/workspaceJobs.js`,
  `src/services/jobManager.js`

## Open decisions

Exact rates, allowance, risk thresholds, credit-package prices/currencies,
bonus amount/dates, screenshot limits/retention, pending-request cancellation,
post-provider user-cancellation policy, `review_required` operations, and legacy
credential/data migration require approval before their dependent P2 phases
activate.
