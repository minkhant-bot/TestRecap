import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('Owner configures only Name/Description/Active for Trial and Pro; every technical field is backend-owned', () => {
  const page = read('./pages/SuperAdminPage.tsx');
  const api = read('./creditPackages/api.ts');
  const billing = read('../services/billingFoundation.js');

  // The simplified client call: one PUT to the /defaults endpoint with the
  // owner-facing fields only.
  assert.match(api, /export const configurePlan = \(code: 'trial' \| 'pro', input: PlanConfigInput\) =>/);
  assert.match(api, /mutation<\{ plan: CommercialPlan; policy: unknown \}>\(`\/api\/admin\/billing\/plans\/\$\{code\}\/defaults`, 'PUT', input\)/);
  assert.match(api, /export interface PlanConfigInput \{\s*name: string;\s*description: string;\s*active: boolean;\s*\}/);

  // Technical fields must never appear in the Owner-facing plan panel
  // (scoped to planConfigPanel -- the unrelated credit-package form
  // legitimately keeps its own displayOrder field).
  const planPanelStart = page.indexOf('const planConfigPanel');
  const planPanel = page.slice(planPanelStart, page.indexOf('const trialContent', planPanelStart));
  for (const forbidden of ['creditsPerBlock', 'policy version', 'Policy version', 'displayOrder', 'BYOK', 'Blink-funded']) {
    assert.doesNotMatch(planPanel, new RegExp(forbidden), `"${forbidden}" must not appear in the Owner plan UI`);
  }
  assert.doesNotMatch(page, /createPlanPolicy/, 'the simplified page must never call the low-level policy API directly');

  // Backend-owned defaults are fixed constants, never sourced from the Owner's request body.
  assert.match(billing, /export const configurePlanDefaults = async \(identity, planCode, input, options = \{\}\) => \{/);
  assert.match(billing, /if \(!PLAN_CODES\.has\(planCode\)\) fail\('code must be trial or pro\.', 'INVALID_INPUT'\);/);
  const configurePlanDefaultsBody = billing.slice(
    billing.indexOf('export const configurePlanDefaults'),
    billing.indexOf('export const configureCreditPlan'),
  );
  assert.doesNotMatch(configurePlanDefaultsBody, /input\?\.creditsPerBlock|input\?\.billingMode|input\?\.entitlements|input\?\.version|input\?\.displayOrder/,
    'technical fields must never be read from client input in the backend-owned-defaults path');
  assert.match(configurePlanDefaultsBody, /creditsPerBlock: PLAN_POLICY_DEFAULTS\.creditsPerBlock/);
  assert.match(configurePlanDefaultsBody, /billingMode: PLAN_POLICY_DEFAULTS\.billingMode/);
  assert.match(configurePlanDefaultsBody, /entitlements: PLAN_POLICY_DEFAULTS\.entitlements/);
});

test('Trial is no longer BYOK-only: every plan requires blink_funded and full Blur/Flip entitlements', () => {
  const billing = read('../services/billingFoundation.js');
  assert.match(billing, /if \(billingMode !== 'blink_funded'\) fail\(`\$\{planCode\} requires blink_funded\.`, 'INVALID_PLAN_POLICY', 422\);/);
  assert.match(billing, /if \(!flags\.blur \|\| !flags\.flip \|\| flags\.byok_mode \|\| !flags\.blink_funded_mode\) \{/);
  assert.doesNotMatch(billing, /BYOK Trial and Pro-only/i, 'the old Rule #4 BYOK-Trial wording must be gone');

  assert.match(billing, /entitlements: Object\.freeze\(\[/);
  assert.match(billing, /Object\.freeze\(\{ key: 'blur', enabled: true \}\)/);
  assert.match(billing, /Object\.freeze\(\{ key: 'flip', enabled: true \}\)/);
  assert.match(billing, /Object\.freeze\(\{ key: 'byok_mode', enabled: false \}\)/);
  assert.match(billing, /Object\.freeze\(\{ key: 'blink_funded_mode', enabled: true \}\)/);
});

test('Trial (and every other authorized user) processes jobs through the server-managed Gemini key, with no personal/BYOK branching', () => {
  const workspace = read('../routes/workspace.js');
  // Outside the dormant live-billing branch (P2_LIVE_JOB_BILLING_ENABLED,
  // currently off), job creation/queueing/retry resolve the Gemini key from
  // resolveServerGeminiKey() alone -- never from a plan code, a Trial flag,
  // or any personal-key lookup.
  const nonLiveBillingKeyResolutions = [...workspace.matchAll(/resolveServerGeminiKey\(\)/g)];
  assert.ok(nonLiveBillingKeyResolutions.length >= 3,
    'upload, queue, and retry must each resolve the server-managed key outside live billing');
  assert.doesNotMatch(workspace, /planCode === 'trial'|requestedMode === 'trial'|trial.*geminiApiKey|geminiApiKey.*trial/i,
    'the server-managed key resolution must never branch on Trial specifically');
});

test('Trial grant is exactly 12 credits, which is exactly 6 minutes at the fixed 1-credit-per-30-second-block rate', () => {
  const billing = read('../services/billingFoundation.js');
  assert.match(billing, /export const TRIAL_GRANT_CREDITS = 12n;/);
  assert.match(billing, /export const CREDITS_PER_BLOCK_DEFAULT = 1n;/);
  assert.match(billing, /export const TRIAL_GRANT_MINUTES = Number\(TRIAL_GRANT_CREDITS \* 30n\) \/ 60;/);
  // 12 credits * 1 block/credit * 30s/block / 60s/min = 6 minutes, computed, not hand-typed.
  const TRIAL_GRANT_CREDITS = 12n;
  const computedMinutes = Number(TRIAL_GRANT_CREDITS * 30n) / 60;
  assert.equal(computedMinutes, 6);

  const page = read('./pages/SuperAdminPage.tsx');
  assert.match(page, /Trial grant: <strong>\{TRIAL_GRANT_CREDITS\} credits · up to \{TRIAL_GRANT_MINUTES\} minutes<\/strong> \(fixed, read-only\)/);
});

test('Owner never types a bank code; the backend generates and safely de-duplicates it', () => {
  const page = read('./pages/SuperAdminPage.tsx');
  const api = read('./creditPackages/api.ts');
  const billing = read('../services/billingFoundation.js');

  assert.doesNotMatch(page, /Bank code/i, 'no bank-code field may appear in the Owner bank form');
  assert.match(api, /export const configureBank = \(input: BankConfigInput\) =>/);
  assert.match(api, /mutation<\{ bank: BankAccount \}>\('\/api\/admin\/billing\/banks', 'POST', input\)/);
  const bankConfigInputBlock = api.slice(api.indexOf('export interface BankConfigInput'), api.indexOf('export const configureBank'));
  assert.doesNotMatch(bankConfigInputBlock, /code:/, 'BankConfigInput must not carry a code field');

  assert.match(billing, /export const configureBankAutoCode = async \(identity, input, options = \{\}\) => \{/);
  assert.match(billing, /const generateBankCode = async \(request, \{ client, deps \}\) => \{/);
  assert.match(billing, /const code = await generateBankCode\(request, \{ client, deps \}\);/);
});

test('bank code generation disambiguates a genuine collision instead of overwriting a different account', async () => {
  const { configureBankAutoCode } = await import('../services/billingFoundation.js');
  const calls = { upserts: [] };
  const deps = {
    transaction: async work => work({}),
    users: { ensureUser: async () => ({ id: 'owner-id' }) },
    roles: {
      findRoleByUserId: async () => ({ role: 'super_admin' }),
      assignRole: async () => ({ role: 'super_admin' }),
    },
    billing: {
      findBankAccountByCode: async code => (
        code === 'kbz-bank-mmk-6789' ? { account_number: '000000006789' } : null
      ),
      listBankAccounts: async () => [],
      upsertBankAccount: async bank => { calls.upserts.push(bank); return { id: 'bank-id', ...bank }; },
    },
    audit: { insertAuditLog: async event => event },
    idempotency: {
      claimIdempotencyKey: async ({ requestHash }) => ({ request_hash: requestHash, state: 'in_progress' }),
      completeIdempotencyKey: async () => undefined,
    },
  };
  const identity = { uid: 'owner-uid', role: 'super_admin' };
  const env = { P2_BILLING_ENABLED: 'true', DATABASE_URL: 'postgresql://db.example/blink' };

  await configureBankAutoCode(identity, {
    bankName: 'KBZ Bank', accountName: 'Blink', accountNumber: '111111116789',
    currency: 'MMK', active: true,
  }, { env, idempotencyKey: 'bank-collision', deps });

  assert.equal(calls.upserts[0].code, 'kbz-bank-mmk-6789-1',
    'a different account colliding on the base code must get a disambiguated suffix, never overwrite the existing one');
});

test('duplicate bank-account identity (same name/currency/account) reuses the same generated code instead of creating a duplicate', async () => {
  const { configureBankAutoCode } = await import('../services/billingFoundation.js');
  const calls = { upserts: [] };
  const deps = {
    transaction: async work => work({}),
    users: { ensureUser: async () => ({ id: 'owner-id' }) },
    roles: {
      findRoleByUserId: async () => ({ role: 'super_admin' }),
      assignRole: async () => ({ role: 'super_admin' }),
    },
    billing: {
      findBankAccountByCode: async code => (
        code === 'kbz-bank-mmk-6789' ? { account_number: '111111116789' } : null
      ),
      listBankAccounts: async () => [],
      upsertBankAccount: async bank => { calls.upserts.push(bank); return { id: 'bank-id', ...bank }; },
    },
    audit: { insertAuditLog: async event => event },
    idempotency: {
      claimIdempotencyKey: async ({ requestHash }) => ({ request_hash: requestHash, state: 'in_progress' }),
      completeIdempotencyKey: async () => undefined,
    },
  };
  const identity = { uid: 'owner-uid', role: 'super_admin' };
  const env = { P2_BILLING_ENABLED: 'true', DATABASE_URL: 'postgresql://db.example/blink' };

  await configureBankAutoCode(identity, {
    bankName: 'KBZ Bank', accountName: 'Blink', accountNumber: '111111116789',
    currency: 'MMK', active: true,
  }, { env, idempotencyKey: 'bank-resave', deps });

  assert.equal(calls.upserts[0].code, 'kbz-bank-mmk-6789',
    'the same real bank identity must resolve to the same stable code (an update, not a duplicate)');
});

test('Owner can link a bank account to a package, with currency match enforced server-side', () => {
  const page = read('./pages/SuperAdminPage.tsx');
  const api = read('./creditPackages/api.ts');
  const billing = read('../services/billingFoundation.js');

  assert.match(page, /openBankCreate/);
  assert.match(page, /await configureBank\(\{/);
  assert.match(page, /await linkPackageBank\(packageId, bank\.id, active\)/);
  assert.match(page, /matchingPackages = packages\.filter\(item => item\.currency === bank\.currency/);
  assert.match(page, /Only packages in the same currency as a bank account can be linked to it/);

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

test('New Recap disables Start Recap and offers Buy Credits / Request Trial on INSUFFICIENT_CREDITS', () => {
  const page = read('./pages/NewRecapPage.tsx');
  assert.match(page, /requestError\.code === 'INSUFFICIENT_CREDITS'/);
  assert.match(page, /disabled=\{starting \|\| insufficientCredits\}/);
  assert.match(page, /onClick=\{\(\) => navigate\('\/buy-credits'\)\}/);
});
