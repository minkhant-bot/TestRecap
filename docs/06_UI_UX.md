# UI and UX

> Final redesign is pending. Do not add blur, subtitle-position, font, or color
> controls; developer state/role/screen controls are prototype-only. See
> `18_PRODUCT_OWNER_DECISIONS_2026-08-01.md`.

## Purpose

Describe the current routes, navigation, screens, interaction rules, responsiveness, and user feedback.

## Current Status

### Implemented

- React 18 SPA using React Router.
- A public, unauthenticated `LandingPage` at `/` (hero, features, how-it-works, Trial/Pro pricing cards, FAQ, CTA links to `/login`); a signed-in user who reaches it is redirected to `/admin` (super-admin) or `/new-recap` (other user) rather than seeing the marketing content.
- Google login, protected routes, session loading, and unauthorized page.
- Responsive application shell with desktop sidebar and mobile bottom navigation, an account menu (Settings/Logout), and a credits/plan chip.
- New Recap upload/editor/processing flow, now implemented as a single `NewRecapPage.tsx` component backed by two extracted hooks: `useUploadPanel.ts` (upload validation/XHR progress, formerly in `UploadPage.tsx`) and `useJobStatus.ts` (SSE subscription, polling fallback, retry/cancel, completed-media fetch, formerly in `ProcessingPage.tsx`).
- History and workspace job rows.
- Settings for the user’s Gemini key.
- Completed media preview and download.
- Completed History records expire with their media after the current 24-hour retention window.
- A tab-based Super Admin console at `/admin` (`SuperAdminPage.tsx`, role-gated to `super_admin`): Overview (workspace jobs + KPI stat cards), Users, Trial Requests, Purchases, Packages, Credits, Audit Log, and System Status. Users/Trial Requests/Purchases/Packages/Credits/Audit tabs call the real PostgreSQL billing/admin APIs described in `05_API_CONTRACT.md` and `08_ADMIN_SYSTEM.md`, gated behind `P2_BILLING_ENABLED`.
- A shared `Dialog.tsx` popup primitive (portal-based, Escape-to-close, focus-managed) implementing the CLAUDE.md Interaction Rule; it replaced the former `Modal.tsx`, `Toast.tsx`, and `Dropdown.tsx` components (deleted, no remaining references). Used by `BuyCreditsPage.tsx` (purchase flow) and extensively by `SuperAdminPage.tsx` (confirmations, proof viewer, package create/edit, audit history).
- A `StatCard.tsx` presentational KPI-tile component used on the Super Admin Overview and System Status tabs.
- Buy Credits (`/buy-credits`) is a real purchase flow, not a placeholder: it reads plan/balance/ledger data and lets the user pick a package and bank account, transfer funds outside Blink, and upload a payment-proof screenshot through a `Dialog`, submitting a pending purchase request via `src/ui/billing/api.ts`.
- Burmese-first interface with some remaining English status/error text.

### Planned or Placeholder

- Admin navigation exposes a single "Super Admin" item (desktop sidebar and mobile bottom nav) pointing at `/admin`; there is no separate Dashboard or Projects navigation item any more.
- No approved notification-center or offline-experience plan is recorded.
- Application code currently offers only Trial and Pro as selectable/grantable commercial plans (`billingFoundation.js`'s `PLAN_CODES`); `POST /api/plans/me/select` always returns HTTP 410 `PLAN_SELF_SELECTION_REMOVED`, and Trial is granted only through the new request/Owner-approval flow (see `07_CREDITS_SYSTEM.md`). The `plans.code` database constraint still permits `'normal'` for compatibility, but no current UI or API path can select it. This is implemented behind the same inactive `P2_BILLING_ENABLED` gate as the rest of the billing foundation.
- The UI may show plan, 30-second rate, entitlements, and estimated credits unobtrusively near submission or billing information; it must not require an intrusive confirmation popup for every job.
- Trial must not offer Blur or Flip; Pro may offer both. Backend entitlement enforcement remains authoritative.
- A failed BYOK job remains BYOK and shows a structured key/provider error; the UI must not silently switch it to Pro.

### Known Issues

- Large MP4s are fetched fully into browser memory.
- History polls every three seconds even when no jobs are active.
- Normal users and super-admins receive different navigation. Current Firebase-claim roles are hardened; approved P2 migration to PostgreSQL role authority remains unimplemented.
- Some duplicate loading/error patterns exist across pages.
- Browser metadata provides immediate over-15-minute feedback, but real
  near-15-minute end-to-end processing remains unverified. Backend enforcement
  is authoritative if metadata is missing or a client bypasses the UI.

## Architecture/Flow

### Route map

| Route | Current behavior |
|---|---|
| `/` | Public `LandingPage`; a signed-in user is redirected to `/admin` or `/new-recap` |
| `/login` | Google sign-in |
| `/new-recap` | Upload, effects setup, processing, completed output (protected) |
| `/history` | All current user workspace jobs (protected) |
| `/buy-credits` | Real purchase flow: plans/balance/ledger, package + bank selection, proof upload (protected) |
| `/settings` | Profile, Gemini key, logout (protected) |
| `/admin` | Super Admin console; renders `SuperAdminPage` only if `role === 'super_admin'`, otherwise redirects to `/new-recap` (protected) |
| `/dashboard` | Retired; redirects to `/admin` (super-admin) or `/new-recap` (other), kept only so old links resolve |
| `/projects`, `/projects/new`, `/projects/:projectId` | Retired; all redirect to `/new-recap` (the `:projectId` value is not preserved) |
| `/unauthorized` | Access error |

`DashboardPage.tsx`, `ProjectsPage.tsx`, `ProjectDetailPage.tsx`, `UploadPage.tsx`, and `ProcessingPage.tsx` have been deleted from the working tree; none are imported by `src/ui/AppFoundation.tsx`.

### New Recap states

```text
No job
  → upload panel
Pending job
  → effects editor + Start Processing
Queued/Processing
  → seven-stage pipeline + progress + Cancel
Completed
  → preview + Download + expandable workflow
Failed/Cancelled
  → terminal status and reset actions
```

### Effects editor

- One video element receives preview Color and Flip classes.
- Overlay coordinates remain independent of the CSS-flipped source image.
- Subtitle preview is above Blur.
- Drag/resize uses percentages of the rendered video rectangle.
- Controls become read-only after processing starts.

### Progress transport

The processing screen opens an authenticated EventSource and applies partial payloads to the current job. On SSE error, three-second status polling starts. Closing or refreshing the page does not cancel a job.

## File References

- Application routes: `src/ui/AppFoundation.tsx`
- Landing page: `src/ui/pages/LandingPage.tsx`
- Shell/navigation: `src/ui/layout/AppShell.tsx`
- Login/auth UX: `src/ui/pages/LoginPage.tsx`, `src/auth/AuthProvider.tsx`
- New Recap: `src/ui/pages/NewRecapPage.tsx`
- Upload: `src/ui/workspace/useUploadPanel.ts`
- Processing: `src/ui/workspace/useJobStatus.ts`
- Effects: `src/ui/workspace/VideoEffectsEditor.tsx`
- History/jobs: `src/ui/pages/HistoryPage.tsx`, `src/ui/workspace/JobList.tsx`
- Buy Credits: `src/ui/pages/BuyCreditsPage.tsx`, `src/ui/billing/api.ts`
- Super Admin console: `src/ui/pages/SuperAdminPage.tsx`
- Popup/stat primitives: `src/ui/components/Dialog.tsx`, `src/ui/components/StatCard.tsx`
- Styles: `src/ui/styles/index.css` (imports `reference.css` then `app.css`)

## Important Decisions

- Mobile is a primary layout target.
- Upload begins immediately after selecting one valid file.
- Processing requires a second, explicit Start Processing action.
- Connection errors preserve the pending job and effects for retry.
- Native video controls are not placed on the transformed preview element.
- Output download uses a generated Blob URL in the current UI.

## Future Work

The following are unapproved UI/UX recommendations:

- Replace full-file Blob loading with streaming/range-aware media.
- Poll only when active jobs require it.
- Connect or remove unfinished admin navigation.
- Complete Burmese localization and accessibility testing.
