# Credits System

## Purpose

State exactly what exists today concerning credits and prevent future developers from assuming that a billing or quota system is already operational.

## Current Status

### Implemented

- Navigation includes a Credits destination.
- The application shell displays a numeric credit indicator.
- The Buy Credits page renders a “coming soon” empty state.
- The dashboard says credits are not yet available.
- Workspace upload admission enforces a non-financial limit of two active jobs per user.
- Server admission enforces configurable non-financial rolling mutation and processing-start limits per user.

### Planned or Placeholder

The Credits page is an explicit UI placeholder. The repository contains no credit ledger, products, prices, checkout, payment provider, reservation, debit, refund, expiration, grant, or credit-audit contract; those concepts are absent rather than implemented placeholders.

### Known Issues

- `AppShell` casts the current profile to possible `creditBalance` or `credits` fields that are absent from the actual profile contract.
- Missing fields display as zero.
- There is no credit-based admission; current cumulative and request-rate limits do not represent balances or billing.
- The two-active-job limit is a fixed product quota, not a credit balance.

## Architecture/Flow

Current flow:

```text
User profile
  → no credit fields returned
  → UI fallback to 0
  → Credits page says coming soon
  → workspace upload rejects a third active job with HTTP 429
  → admission may reject excessive mutations or processing starts with HTTP 429
  → no credit debit occurs
```

There is no database table or API route for credits.

## File References

- Credit indicator: `src/ui/layout/AppShell.tsx`
- Placeholder purchase page: `src/ui/pages/BuyCreditsPage.tsx`
- Dashboard placeholder: `src/ui/pages/DashboardPage.tsx`
- Actual user profile type: `src/auth/AuthProvider.tsx`
- Active-job admission quota: `src/routes/workspace.js`, `src/services/workspaceJobs.js`
- Rolling admission limits: `src/config/admission.js`, `src/services/admissionControl.js`

## Important Decisions

- No billing behavior should be inferred from the visible zero balance.
- Credits must not be implemented only in the client.
- A future system must define reservation and compensation around long-running asynchronous jobs before accepting payment.

## Future Work

Future work requires product and billing approval. At minimum it must define:

- Immutable ledger entries and balance calculation.
- Administrative grants and corrections.
- Reservation before queueing.
- Final debit on the approved milestone.
- Refund/release for validation failures, cancellation, and backend failure.
- Idempotency and concurrency control.
- Payment-provider reconciliation and audit retention.

None of these items is currently implemented.
