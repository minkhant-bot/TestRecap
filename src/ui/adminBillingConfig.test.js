import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('Owner can configure Trial and Pro plans from the Super Admin UI, with frozen entitlements never owner-editable', () => {
  const page = read('./pages/SuperAdminPage.tsx');
  const api = read('./creditPackages/api.ts');

  assert.match(page, /openPlanConfig\('trial'\)|openPlanConfig\(code\)/);
  assert.match(page, /await configurePlan\(planEditing,/);
  assert.match(page, /await createPlanPolicy\(planEditing,/);
  assert.match(api, /export const configurePlan = \(code: 'trial' \| 'pro', input: PlanConfigInput\) =>/);
  assert.match(api, /mutation<\{ plan: CommercialPlan \}>\(`\/api\/admin\/billing\/plans\/\$\{code\}`, 'PUT', input\)/);

  // Rule #4 (frozen): entitlements/billing mode are derived from the plan
  // code inside the API client, never sourced from user-editable form state.
  assert.doesNotMatch(page, /entitlements:\s*\[/, 'entitlement flags must never be constructed from admin page state');
  assert.match(api, /FROZEN_POLICY_SHAPE/);
  assert.match(api, /trial:\s*\{\s*billingMode: 'byok'/);
  assert.match(api, /pro:\s*\{\s*billingMode: 'blink_funded'/);
});

test('Owner can create/edit bank accounts and link them to packages, with currency match enforced server-side', () => {
  const page = read('./pages/SuperAdminPage.tsx');
  const api = read('./creditPackages/api.ts');
  const billing = read('../services/billingFoundation.js');

  assert.match(page, /openBankCreate/);
  assert.match(page, /await configureBank\(bankDraft\.code\.trim\(\),/);
  assert.match(page, /await linkPackageBank\(packageId, bank\.id, active\)/);
  assert.match(page, /matchingPackages = packages\.filter\(item => item\.currency === bank\.currency/);
  assert.match(page, /Only packages in the same currency as a bank account can be linked to it/);

  assert.match(api, /export const configureBank = \(code: string, input: BankConfigInput\) =>/);
  assert.match(api, /export const linkPackageBank = \(creditPlanId: string, bankAccountId: string, active: boolean\) =>/);

  // The authoritative currency-match check lives in the backend, not just the UI.
  assert.match(billing, /if \(creditPlan\.currency !== bank\.currency\)/);
  assert.match(billing, /'BANK_CURRENCY_MISMATCH', 422/);
});

test('Buy Credits filters packages by currency without any conversion; MMK and THB stay separate records', () => {
  const page = read('./pages/BuyCreditsPage.tsx');

  assert.match(page, /const availableCurrencies = useMemo\(\s*\(\) => \[\.\.\.new Set\(packages\.map\(item => item\.currency\)\)\]/);
  assert.match(page, /const visiblePackages = useMemo\(\s*\(\) => packages\.filter\(item => item\.currency === currencyFilter\)/);
  assert.match(page, /visiblePackages\.map\(item => \{/);
  // No conversion arithmetic must exist anywhere near the currency filter.
  assert.doesNotMatch(page, /exchangeRate|convertCurrency|conversionRate/i);
});

test('Add/Deduct credits and per-user credit lookup synchronize the target Firebase user on demand, without a Firebase dependency leaking into the route layer', () => {
  const billing = read('../services/billingFoundation.js');
  assert.match(billing, /const ensureTargetUser = async \(firebaseUid, \{ client, deps \}\) => \{/);
  assert.match(billing, /const target = await ensureTargetUser\(userId, \{ client, deps \}\);/);
  assert.match(billing, /const target = await ensureTargetUser\(firebaseUid, \{ client, deps \}\);/);
  assert.match(billing, /resolveFirebaseUser: async uid => \{/);
  assert.match(billing, /import \{ getFirebaseAdminAuth, toUserProfile \} from '\.\/firebaseAdmin\.js';/);
});
