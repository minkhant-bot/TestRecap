import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('credit package UI permission-gates management and gives users the active-only catalog', () => {
  const page = read('../pages/BuyCreditsPage.tsx');
  assert.match(page, /profile\?\.role === 'super_admin'/);
  assert.match(page, /isSuperAdmin \? await listManagedCreditPackages\(\) : await listActiveCreditPackages\(\)/);
  assert.match(page, /items\.filter\(item => item\.active && !item\.archivedAt\)/);
  assert.match(page, /\{isSuperAdmin && \(/);
  assert.match(page, /Create package/);
  assert.match(page, /Edit/);
  assert.match(page, /Deactivate/);
  assert.match(page, /Activate/);
  assert.match(page, /Archive/);
  assert.doesNotMatch(page, /hard delete|Delete package/);
});

test('financial mutation controls use explicit review and confirmation', () => {
  const page = read('../pages/BuyCreditsPage.tsx');
  const api = read('./api.ts');
  assert.match(page, /Review changes/);
  assert.match(page, /Confirm change/);
  assert.match(page, /Historical transactions will not be changed/);
  assert.match(page, /Price \(minor units\)/);
  assert.match(page, /Currency code/);
  assert.match(api, /'Idempotency-Key': crypto\.randomUUID\(\)/);
  assert.match(api, /confirmed: true/);
});

test('owner UI binds every supported operation plus scoped audit history', () => {
  const page = read('../pages/BuyCreditsPage.tsx');
  for (const binding of [
    'createCreditPackage', 'editCreditPackage', 'setCreditPackageActive',
    'archiveCreditPackage', 'reorderCreditPackages', 'listCreditPackageAudit',
  ]) assert.match(page, new RegExp(binding));
  assert.match(page, /Audit history/);
  assert.match(page, /credit-package__actions/);
  assert.match(read('../styles/layout.css'), /@media \(max-width: 640px\)[\s\S]*\.credit-package \{ padding:/);
});
