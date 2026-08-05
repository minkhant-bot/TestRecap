# Global Project Rules

These rules are approved and apply to all work in this repository. Follow them in every task unless the user explicitly instructs otherwise for that specific task.

## Scope discipline

- Fix only the requested task.
- Do not change unrelated code, UI, text, layout, or business logic.
- Report unrelated issues instead of fixing them.

## Language

- English is the primary UI language.
- Use Burmese only where it clearly improves usability.
- Do not translate technical/admin text, statuses, form labels, audit logs, API errors, or developer text.

## Design

- Preserve the existing Blink design; do not redesign unless requested.
- Do not rewrite UI copy unless requested.

## Interaction Rule

- Use popup dialogs for user-triggered forms, confirmations, approvals, uploads, edits, and destructive actions that currently expand the page.
- Exception: do not change the existing View Video Preview behavior. The current video preview UX is approved and must remain unchanged.

## Verification

- Verify mobile at 360px, 390px, and 430px.
- Run focused tests, full tests, typecheck, and production build.

## Release discipline

- Never deploy, commit, or push unless explicitly instructed.
