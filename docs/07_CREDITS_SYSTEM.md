# Credits System

## Purpose

State exactly what exists today concerning credits and prevent future developers from assuming that a billing or quota system is already operational.

## Current Status

### Implemented

- Navigation includes a Credits destination.
- The application shell displays a numeric credit indicator.
- The Buy Credits page renders a “coming soon” empty state.
- The dashboard says credits are not yet available.

### Planned or Placeholder

The Credits page is an explicit UI placeholder. The repository contains no credit ledger, products, prices, checkout, payment provider, reservation, debit, refund, expiration, grant, or credit-audit contract; those concepts are absent rather than implemented placeholders.

### Known Issues

- `AppShell` casts the current profile to possible `creditBalance` or `credits` fields that are absent from the actual profile contract.
- Missing fields display as zero.
- Queue admission and upload are not protected by credits or backend quotas.
- A user can bypass the frontend active-job restriction.

## Architecture/Flow

Current flow:

```text
User profile
  → no credit fields returned
  → UI fallback to 0
  → Credits page says coming soon
  → processing remains unrestricted by credits
```

There is no database table or API route for credits.

## File References

- Credit indicator: `src/ui/layout/AppShell.tsx`
- Placeholder purchase page: `src/ui/pages/BuyCreditsPage.tsx`
- Dashboard placeholder: `src/ui/pages/DashboardPage.tsx`
- Actual user profile type: `src/auth/AuthProvider.tsx`
- Unrestricted queue admission: `src/routes/workspace.js`, `src/services/workspaceJobs.js`

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
