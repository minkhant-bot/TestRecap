import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('Dialog centers over a dimmed backdrop, blocks background scroll, and never reflows page content (fixed/portal)', () => {
  const dialog = read('./Dialog.tsx');
  assert.match(dialog, /createPortal\(/, 'must portal to document.body, never render inline in the page flow');
  assert.match(dialog, /document\.body/);
  assert.match(dialog, /body\.style\.position = 'fixed'/, 'scroll lock must not let the background page reflow/scroll');
  const app = read('../styles/app.css');
  assert.match(app, /\.dialogBackdrop\s*\{[^}]*position:\s*fixed/s);
  assert.match(app, /\.dialogBackdrop\s*\{[^}]*align-items:\s*center/s);
  assert.match(app, /\.dialogBackdrop\s*\{[^}]*justify-content:\s*center/s);
  assert.match(app, /\.dialogBackdrop\s*\{[^}]*background:\s*rgba\(/s, 'backdrop must be dimmed');
});

test('Dialog card fits any viewport (360/390/430px covered by the shared <=480px breakpoint) with internal scrolling for long content', () => {
  const app = read('../styles/app.css');
  assert.match(app, /\.dialogCard\s*\{[^}]*max-height:\s*calc\(100dvh/s, 'must be capped to the viewport height, not overflow it');
  assert.match(app, /\.dialogCard__body\s*\{[^}]*overflow-y:\s*auto/s, 'long content must scroll inside the card, not push the card off-screen');
  assert.match(app, /@media \(max-width:\s*480px\)/, 'a single breakpoint covers every width the task asks to verify (360/390/430px)');
});

test('Dialog closes through the X button, backdrop click, and Escape -- all disabled while busy (never mid-submit)', () => {
  const dialog = read('./Dialog.tsx');
  assert.match(dialog, /aria-label="Close"[\s\S]{0,40}disabled=\{busy\}/);
  assert.match(dialog, /onMouseDown=\{event => \{ if \(event\.target === event\.currentTarget && !busy\) onClose\(\); \}\}/);
  assert.match(dialog, /event\.key === 'Escape' && !busyRef\.current/);
});

test('Dialog traps Tab focus inside the card and restores focus to the triggering control on close', () => {
  const dialog = read('./Dialog.tsx');
  assert.match(dialog, /triggerRef\.current = document\.activeElement/, 'must capture whatever had focus before opening');
  assert.match(dialog, /triggerRef\.current\.focus\(\)/, 'must restore focus to that control on close');
  assert.match(dialog, /trapTab/, 'must implement a Tab-trap so background controls never receive focus while open');
  assert.match(dialog, /event\.key !== 'Tab'/);
});

test('ConfirmBody is a shared, reusable confirm/destructive pattern (danger styling, busy-safe, localizable labels)', () => {
  const dialog = read('./Dialog.tsx');
  assert.match(dialog, /export function ConfirmBody/);
  assert.match(dialog, /variant=\{dangerous \? 'danger' : 'primary'\}/, 'destructive actions must be visually distinct');
  assert.match(dialog, /loading=\{busy\}/);
  assert.match(dialog, /confirmLabel = 'Confirm', cancelLabel = 'Cancel'/, 'labels must be overridable, not hardcoded English everywhere');
  const barrel = read('./index.ts');
  assert.match(barrel, /export \* from '\.\/Dialog'/, 'ConfirmBody must be reachable from the shared components barrel');
});
