import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

// Package CRUD moved from BuyCreditsPage.tsx (now purchase-only, matching the
// reference's user-facing Plans screen) into SuperAdminPage.tsx's Packages
// tab (matching the reference's embedded Admin -> Packages tab). BuyCreditsPage
// keeps only the active/managed-catalog distinction and the confirm-then-submit
// pattern is a popup Dialog (Interaction Rule), not a page-expanding panel.

test('credit package UI is admin-only in SuperAdminPage; BuyCreditsPage gives all users the active-only catalog', () => {
  const admin = read('../pages/SuperAdminPage.tsx');
  const buy = read('../pages/BuyCreditsPage.tsx');

  assert.match(admin, /listManagedCreditPackages\(\)/);
  assert.match(admin, /Create package/);
  assert.match(admin, />Edit</);
  assert.match(admin, /item\.active \? 'Deactivate' : 'Activate'/);
  assert.match(admin, />Archive</);
  assert.doesNotMatch(admin, /hard delete|Delete package/);

  assert.match(buy, /listActiveCreditPackages\(\)/);
  assert.match(buy, /items\.filter\(item => item\.active && !item\.archivedAt\)/);
  assert.doesNotMatch(buy, /createCreditPackage|archiveCreditPackage|setCreditPackageActive|reorderCreditPackages/);
});

test('financial mutation controls use explicit review and confirmation in a popup Dialog (Interaction Rule)', () => {
  const admin = read('../pages/SuperAdminPage.tsx');
  const api = read('./api.ts');
  assert.match(admin, /Review changes/);
  assert.match(admin, /Confirm change/);
  assert.match(admin, /Historical transaction values stay unchanged/);
  assert.match(admin, /Price \(minor units\)/);
  assert.match(admin, /Currency code/);
  assert.match(admin, /pendingPackage &&/);
  assert.match(admin, /<Dialog open=\{pendingPackage/);
  assert.doesNotMatch(admin, /import \{[^}]*Modal[^}]*\} from '\.\.\/components'/);
  assert.match(api, /'Idempotency-Key': crypto\.randomUUID\(\)/);
  assert.match(api, /confirmed: true/);
});

test('owner UI binds every supported package operation plus scoped audit history', () => {
  const admin = read('../pages/SuperAdminPage.tsx');
  for (const binding of [
    'createCreditPackage', 'editCreditPackage', 'setCreditPackageActive',
    'archiveCreditPackage', 'reorderCreditPackages', 'listCreditPackageAudit',
  ]) assert.match(admin, new RegExp(binding));
  assert.match(admin, /Audit history/);
  assert.match(admin, /<Dialog open=\{historyOpen\}/);
});
