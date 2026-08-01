# UI and UX

> Final redesign is pending. Do not add blur, subtitle-position, font, or color
> controls; developer state/role/screen controls are prototype-only. See
> `18_PRODUCT_OWNER_DECISIONS_2026-08-01.md`.

## Purpose

Describe the current routes, navigation, screens, interaction rules, responsiveness, and user feedback.

## Current Status

### Implemented

- React 18 SPA using React Router.
- Google login, protected routes, session loading, and unauthorized page.
- Responsive application shell with desktop sidebar and mobile bottom navigation.
- New Recap upload/editor/processing flow.
- History and workspace job rows.
- Settings for the user’s Gemini key.
- Completed media preview and download.
- Completed History records expire with their media after the current 24-hour retention window.
- Burmese-first interface with some remaining English status/error text.

### Planned or Placeholder

- Credits purchase page currently shows “coming soon.”
- Admin navigation labels and pages do not expose the backend admin capabilities.
- No approved notification-center or offline-experience plan is recorded.
- P2 will present Trial, Normal, and Pro as commercial plans rather than roles.
- The UI may show plan, 30-second rate, entitlements, and estimated credits unobtrusively near submission or billing information; it must not require an intrusive confirmation popup for every job.
- Trial and Normal must not offer Blur or Flip; Pro may offer both. Backend entitlement enforcement remains authoritative.
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
| `/login` | Google sign-in |
| `/` | Super-admin → Dashboard; other user → New Recap |
| `/dashboard` | Super-admin-only wrapper around recent workspace jobs |
| `/new-recap` | Upload, effects setup, processing, completed output |
| `/projects` | Super-admin-only project list/upload |
| `/projects/new` | Redirect to New Recap |
| `/projects/{id}` | Redirect to `/new-recap?job={id}` |
| `/history` | All current user workspace jobs |
| `/buy-credits` | Placeholder |
| `/settings` | Profile, Gemini key, logout |
| `/unauthorized` | Access error |

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
- Shell/navigation: `src/ui/layout/AppShell.tsx`
- Login/auth UX: `src/ui/pages/LoginPage.tsx`, `src/auth/AuthProvider.tsx`
- New Recap: `src/ui/pages/NewRecapPage.tsx`
- Upload: `src/ui/pages/UploadPage.tsx`
- Processing: `src/ui/pages/ProcessingPage.tsx`
- Effects: `src/ui/workspace/VideoEffectsEditor.tsx`
- History/jobs: `src/ui/pages/HistoryPage.tsx`, `src/ui/workspace/JobList.tsx`
- Styles: `src/ui/styles/`

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
