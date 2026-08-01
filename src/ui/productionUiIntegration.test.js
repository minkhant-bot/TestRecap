import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('production screen mapping keeps real authentication, routes, and job state', () => {
  const login = read('./pages/LoginPage.tsx');
  const routes = read('./AppFoundation.tsx');
  const dashboard = read('./pages/DashboardPage.tsx');
  const processing = read('./pages/ProcessingPage.tsx');

  assert.match(login, /await signInWithGoogle\(\)/);
  assert.doesNotMatch(login, /setTimeout|MOCK_/);
  assert.match(routes, /path="\/admin" element=\{<SuperAdminAccess \/>\}/);
  assert.match(routes, /profile\?\.role === 'super_admin'/);
  assert.match(dashboard, /jobs\.filter/);
  assert.match(dashboard, /listAdminUsers\(\)/);
  assert.match(dashboard, /listAdminPurchases\(\)/);
  assert.match(dashboard, /const recentJobs = jobs\.slice\(0, 5\)/);
  assert.doesNotMatch(dashboard, /\/api\/health|system status/i);
  assert.match(processing, /EventSource/);
  assert.match(processing, /getDisplayedProgress\(job\)/);
  assert.doesNotMatch(processing, /setInterval\([^]*setProgress/);
});

test('plans and credits bind only production billing contracts and preserve gates', () => {
  const page = read('./pages/BuyCreditsPage.tsx');
  const api = read('./billing/api.ts');

  for (const path of [
    '/api/credits/balance', '/api/plans/me', '/api/plans', '/api/credits/ledger?limit=30',
    '/api/credit-purchase-requests', '/api/credit-plans/',
  ]) assert.match(api, new RegExp(path.replace(/[/?]/g, '\\$&')));
  assert.match(page, /listActiveCreditPackages/);
  assert.match(page, /integer minor units/i);
  assert.match(page, /Owner verifies the real bank transfer outside Blink/);
  assert.match(api, /credit-purchase-requests\/with-proof/);
  assert.match(api, /XMLHttpRequest/);
  assert.match(api, /request\.upload\.addEventListener\('progress'/);
  assert.match(page, /submitPurchaseWithProof/);
  assert.match(page, /Payment proof submitted/);
  assert.match(page, /proofConfig\.mimeTypes\.includes/);
  assert.match(page, /Manual payment workflow/);
  assert.match(page, /Owner checks the bank/);
  assert.doesNotMatch(page, /approvePurchase|rejectPurchase|setTimeout/i);
});

test('Owner screen binds supported APIs and does not infer authority from plans', () => {
  const page = read('./pages/SuperAdminPage.tsx');
  const api = read('./admin/api.ts');
  const shell = read('./layout/AppShell.tsx');

  for (const path of [
    '/api/admin/users', '/api/admin/billing/purchases', '/api/admin/logs?limit=100',
    '/api/admin/billing/audit', '/api/admin/system', '/api/admin/billing/adjustments',
    '/api/admin/billing/purchases/',
  ]) assert.match(api, new RegExp(path.replace(/[/?]/g, '\\$&')));
  assert.match(page, /last-Super-Admin protections/);
  assert.match(page, /Pro plan membership never grants administration/);
  assert.match(page, /Add matching credits/);
  assert.match(page, /Confirm add credits/);
  assert.match(page, /getScreenshotContent/);
  assert.match(page, /Payment proof is unavailable/);
  assert.doesNotMatch(page, /Storage<\/dt>|Object key<\/dt>/);
  assert.doesNotMatch(page, />Reject<|rejectPurchase/);
  assert.match(shell, /superAdminOnly: true/);
  assert.doesNotMatch(page, /plan.*role|role.*plan/i);
});

test('Owner mobile layout uses readable snap tabs and stacked user records', () => {
  const page = read('./pages/SuperAdminPage.tsx');
  const components = read('./styles/components.css');
  const layout = read('./styles/layout.css');

  assert.match(components, /\.ds-tabs__list\s*\{[^}]*overflow-x: auto[^}]*scroll-snap-type: inline mandatory/);
  assert.match(components, /\.ds-tabs__tab\s*\{[^}]*min-width: max-content[^}]*flex: 0 0 auto[^}]*scroll-snap-align: start/);
  assert.match(page, /className="admin-user-cards"/);
  assert.match(page, /Plan \/ credits/);
  assert.match(page, /Unavailable while billing is disabled/);
  assert.match(page, /Account actions[\s\S]*Not implemented/);
  assert.match(layout, /\.admin-user-cards \{ display: none; \}/);
  assert.match(layout, /@media \(max-width: 640px\)[\s\S]*\.admin-table-wrap \{ display: none; \}[\s\S]*\.admin-user-cards \{ display: grid/);
  assert.match(layout, /\.super-admin-page \{[\s\S]*padding-top: calc\(var\(--ds-space-8\) \+ env\(safe-area-inset-top\)\)/);
});

test('production design tokens expose amber as the only brand accent', () => {
  const tokens = read('./styles/tokens.css');
  const components = read('./styles/components.css');
  const layout = read('./styles/layout.css');
  const logo = read('../../public/assets/logo.svg');
  const productionStyles = `${tokens}\n${components}\n${layout}\n${logo}`;

  assert.match(tokens, /--ds-brand-300: #ffd27d/);
  assert.match(tokens, /--ds-brand-400: #f2bc5b/);
  assert.match(tokens, /--ds-action-primary: var\(--ds-brand-400\)/);
  assert.match(tokens, /--ds-focus: var\(--ds-brand-400\)/);
  assert.match(tokens, /--ds-status-processing: var\(--ds-brand-400\)/);
  assert.match(logo, /stop-color="#FFD27D"/);
  assert.doesNotMatch(productionStyles, /violet|purple|#b9b2ff|#9d91ff|#8575f6|#705ee2|#5d4bc8/i);
  assert.doesNotMatch(logo, /#8E52FF|#7A3EF0|#D2AEFF|#BC94FE|#6544D6|#5230BE/i);
});
