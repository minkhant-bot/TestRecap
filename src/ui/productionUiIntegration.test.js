import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('production screen mapping keeps real authentication, routes, and job state', () => {
  const login = read('./pages/LoginPage.tsx');
  const routes = read('./AppFoundation.tsx');
  const admin = read('./pages/SuperAdminPage.tsx');
  const jobStatus = read('./workspace/useJobStatus.ts');

  assert.match(login, /await signInWithGoogle\(\)/);
  assert.doesNotMatch(login, /setTimeout|MOCK_/);
  assert.match(routes, /path="\/admin" element=\{<SuperAdminAccess \/>\}/);
  assert.match(routes, /profile\?\.role === 'super_admin'/);
  assert.match(admin, /useWorkspaceJobs\(5\)/);
  assert.match(admin, /listAdminUsers\(\)/);
  assert.match(admin, /listAdminPurchases\(\)/);
  assert.doesNotMatch(admin, /\/api\/health/i);
  assert.match(jobStatus, /new EventSource/);
  assert.doesNotMatch(jobStatus, /setInterval\([^]*setProgress/);
});

test('plans and credits bind only production billing contracts; purchase flow is a popup Dialog (Interaction Rule)', () => {
  const page = read('./pages/BuyCreditsPage.tsx');
  const api = read('./billing/api.ts');

  for (const path of [
    '/api/credits/balance', '/api/plans/me', '/api/plans', '/api/credits/ledger?limit=30',
    '/api/credit-purchase-requests', '/api/credit-plans/',
  ]) assert.match(api, new RegExp(path.replace(/[/?]/g, '\\$&')));
  assert.match(page, /listActiveCreditPackages/);
  assert.match(api, /credit-purchase-requests\/with-proof/);
  assert.match(api, /XMLHttpRequest/);
  assert.match(api, /request\.upload\.addEventListener\('progress'/);
  assert.match(page, /submitPurchaseWithProof/);
  assert.doesNotMatch(page, /approvePurchase|rejectPurchase|setTimeout/i);
  assert.doesNotMatch(page, /createCreditPackage|archiveCreditPackage|reorderCreditPackages/);
  assert.match(page, /from '\.\.\/components'/);
  assert.match(page, /<Dialog\b/);
  assert.match(page, /step === 'bank'/);
  assert.match(page, /step === 'proof'/);
  assert.match(page, /step === 'submitted'/);
});

test('Owner screen binds every supported admin and package API and does not infer authority from plans', () => {
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
  assert.match(page, /Add Credits/);
  assert.match(page, /createCreditPackage/);
  assert.match(page, /archiveCreditPackage/);
  assert.match(page, /reorderCreditPackages/);
  assert.match(shell, /superAdminOnly: true/);
  assert.doesNotMatch(page, /import \{[^}]*Modal[^}]*\} from '\.\.\/components'/);
  assert.doesNotMatch(page, /import \{[^}]*Toast[^}]*\} from '\.\.\/components'/);
});

test('Super Admin has an Overview tab (merged former Dashboard), a Trial Requests tab (Rule #1), and 8 tabs total', () => {
  const page = read('./pages/SuperAdminPage.tsx');

  const tabIds = ['overview', 'users', 'trial', 'purchases', 'packages', 'credits', 'audit', 'system'];
  for (const id of tabIds) assert.match(page, new RegExp(`id: '${id}'`));
  assert.equal((page.match(/id: '(overview|users|trial|purchases|packages|credits|audit|system)'/g) || []).length, 8);
  assert.match(page, /overviewContent/);
  assert.match(page, /StatCard variant="adminCard"/);
});

test('production design tokens expose pink as the only brand accent (BlinkAutomationFull_v2.jsx palette)', () => {
  const reference = read('./styles/reference.css');
  const app = read('./styles/app.css');
  const logo = read('../../public/assets/logo.svg');
  const productionStyles = `${reference}\n${app}\n${logo}`;

  assert.match(reference, /--accent:#ff2d7d;/);
  assert.match(logo, /stop-color="#FF2D7D"/);
  assert.doesNotMatch(productionStyles, /violet|purple|#b9b2ff|#9d91ff|#8575f6|#705ee2|#5d4bc8/i);
  assert.doesNotMatch(logo, /#8E52FF|#7A3EF0|#D2AEFF|#BC94FE|#6544D6|#5230BE/i);
  assert.doesNotMatch(productionStyles, /#ffd27d|#f2bc5b|#dca13b|#b77a22|#c88416|#aa6d0d|#8d5908/i);
});

test('reference.css matches BlinkAutomationFull_v2.jsx except for documented Burmese-typography fixes', () => {
  const referenceFile = read('../../BlinkAutomationFull_v2.jsx');
  const referenceCss = read('./styles/reference.css');
  const match = referenceFile.match(/const styles = `\n([\s\S]*?)\n`;/);
  assert.ok(match, 'BlinkAutomationFull_v2.jsx must still contain its styles template literal');
  const sourceCss = match[1].trim();

  // The static mockup was authored against English display copy and never
  // exercised real Burmese text. Negative letter-spacing and `overflow-wrap:
  // anywhere` break Myanmar glyph stacking (medials/vowel signs render
  // detached or overlapping); these are the only intentional deviations
  // from the byte-identical copy, kept minimal and reverted here so any
  // other drift still fails this test.
  const revertedCss = referenceCss.trim()
    .replace(
      'body{font-family:"Noto Sans Myanmar","Manrope",system-ui,sans-serif;color:var(--text);-webkit-font-smoothing:antialiased;line-height:1.7;overflow-wrap:break-word;text-rendering:optimizeLegibility}',
      'body{font-family:"Noto Sans Myanmar","Manrope",system-ui,sans-serif;color:var(--text);-webkit-font-smoothing:antialiased;line-height:1.7;overflow-wrap:anywhere}'
    )
    .replace(
      '.hero h1{font-size:clamp(40px,6.7vw,82px);line-height:1.5;letter-spacing:normal;margin:27px auto 20px;max-width:970px}',
      '.hero h1{font-size:clamp(40px,6.7vw,82px);line-height:1.32;letter-spacing:-.02em;margin:27px auto 20px;max-width:970px}'
    )
    .replace(
      '.section h2{font-size:clamp(32px,4.7vw,54px);line-height:1.48;letter-spacing:normal;margin:8px 0}',
      '.section h2{font-size:clamp(32px,4.7vw,54px);line-height:1.4;letter-spacing:-.018em;margin:8px 0}'
    )
    .replace(
      '  .hero h1{font-size:clamp(35px,10vw,52px);line-height:1.5;margin-top:20px}',
      '  .hero h1{font-size:clamp(35px,10vw,52px);line-height:1.42;margin-top:20px}'
    );

  assert.equal(revertedCss, sourceCss, 'reference.css must match the source styles block once the documented Burmese-typography fixes are reverted');
});

test('component hierarchy was rebuilt, not reskinned: no Modal/Dropdown/Toast, old ds-* system is gone', () => {
  const componentsIndex = read('./components/index.ts');
  const shell = read('./layout/AppShell.tsx');
  const landing = read('./pages/LandingPage.tsx');
  const reference = read('./styles/reference.css');
  const app = read('./styles/app.css');

  assert.doesNotMatch(componentsIndex, /Modal|Dropdown|Toast/);
  assert.doesNotMatch(shell, /ds-mobile-drawer|ds-topbar__menu|ds-sidebar/);
  assert.doesNotMatch(`${reference}\n${app}`, /\.ds-button|\.ds-card|\.ds-badge|\.ds-tabs__|\.ds-app-shell|\.ds-sidebar/);
  assert.match(reference, /^\.workspaceApp\{/m);
  assert.match(reference, /^\.sidebar\{/m);
  assert.match(reference, /^\.mobileNav\{display:none\}/m);
  assert.match(landing, /className="hero shell"/);
  assert.match(landing, /className="pricegrid"/);
});
