import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

// --- 1. Owner Dashboard --------------------------------------------------

test('Dashboard is a dedicated page, Owner/Super-Admin only, showing only the former Overview metrics and recent jobs', () => {
  const dashboard = read('./pages/DashboardPage.tsx');
  const foundation = read('./AppFoundation.tsx');

  assert.match(dashboard, /StatCard variant="adminCard" value=\{jobsLoading \? '…' : activeJobs\} label="Active jobs"/);
  assert.match(dashboard, /StatCard variant="adminCard" value=\{loading \? '…' : userCount\} label="Registered users"/);
  assert.match(dashboard, /StatCard variant="adminCard" value=\{loading \? '…' : pendingPurchases\} label="Awaiting manual credit"/);
  assert.match(dashboard, /Recent workspace jobs/);
  assert.match(dashboard, /<JobList jobs=\{recentJobs\} compact \/>/);

  assert.match(foundation, /function DashboardAccess\(\)/);
  assert.match(foundation, /profile\?\.role === 'super_admin' \? <DashboardPage \/> : <Navigate to="\/new-recap" replace \/>/);
  assert.match(foundation, /<Route path="\/dashboard" element=\{<DashboardAccess \/>\}/);
});

test('Owner/Admin bottom navigation order is Dashboard | New Recap | History | Plans & Credits | Admin; normal users see neither Dashboard nor Admin', () => {
  const shell = read('./layout/AppShell.tsx');
  const order = ['/dashboard', '/new-recap', '/history', '/buy-credits', '/admin']
    .map(path => shell.indexOf(`to: '${path}'`));
  assert.ok(order.every(index => index !== -1), 'every nav destination must be present');
  assert.deepEqual(order, [...order].sort((a, b) => a - b));

  assert.match(shell, /to: '\/dashboard', label: 'Dashboard', superAdminOnly: true/);
  assert.match(shell, /to: '\/admin', label: 'Admin', superAdminOnly: true/);
  assert.match(shell, /availableNavigation = navigation\.filter\(item => !item\.superAdminOnly \|\| isSuperAdmin\)/);
  // Mobile nav must render availableNavigation directly (no special-cased
  // second Admin link bolted on afterward -- that was the old duplicate
  // rendering path this task replaces).
  assert.match(shell, /\{availableNavigation\.map\(\(\{ to, label, Icon \}\) => \(/);
});

test('Overview is removed from the Admin section selector', () => {
  const admin = read('./pages/SuperAdminPage.tsx');
  assert.doesNotMatch(admin, /id: 'overview'/);
  assert.doesNotMatch(admin, /label: 'Overview'/);
  assert.doesNotMatch(admin, /overviewContent/);
});

// --- 2. Live updates -------------------------------------------------------

test('one shared, controlled auto-refresh mechanism exists: single interval, visibility/online resume, degraded-after-repeated-failure', () => {
  const hook = read('./hooks/useAutoRefresh.ts');
  assert.match(hook, /const interval = window\.setInterval\(\(\) => void tick\(\), intervalMs\);/);
  assert.equal((hook.match(/window\.setInterval/g) || []).length, 1, 'exactly one interval must ever be created per mount');
  assert.match(hook, /document\.addEventListener\('visibilitychange', onVisible\)/);
  assert.match(hook, /window\.addEventListener\('online', onVisible\)/);
  assert.match(hook, /window\.clearInterval\(interval\)/, 'the interval must be cleared on cleanup, never left running');
  assert.match(hook, /failures \+= 1;\s*if \(failures >= 3\) setDegraded\(true\);/);
  assert.match(hook, /document\.visibilityState === 'hidden'\) return;/, 'polling must skip while the tab is hidden');
});

test('recent jobs, admin overview data, trial requests, purchases/users, packages, plans, banks, and credit balances all use the shared auto-refresh mechanism', () => {
  const useWorkspaceJobs = read('./workspace/useWorkspaceJobs.ts');
  const admin = read('./pages/SuperAdminPage.tsx');
  const buyCredits = read('./pages/BuyCreditsPage.tsx');
  const shell = read('./layout/AppShell.tsx');

  assert.match(useWorkspaceJobs, /import \{ useAutoRefresh \} from '\.\.\/hooks\/useAutoRefresh';/);
  assert.match(useWorkspaceJobs, /const \{ degraded \} = useAutoRefresh\(refresh, \{ intervalMs \}\);/);

  for (const loader of ['load', 'loadTrialRequests', 'loadPackages', 'loadPlans', 'loadBanks']) {
    assert.match(admin, new RegExp(`useAutoRefresh\\(${loader}\\)`), `${loader} must be wired to the shared auto-refresh mechanism`);
  }

  assert.match(buyCredits, /useAutoRefresh\(loadPackages\)/);
  assert.match(buyCredits, /useAutoRefresh\(loadBilling\)/);
  assert.match(buyCredits, /useAutoRefresh\(loadTrialRequest\)/);

  assert.match(shell, /useAutoRefresh\(loadBillingSummary\);/);
});

test('History no longer runs its own duplicate polling interval; it uses useWorkspaceJobs\' single mechanism', () => {
  const history = read('./pages/HistoryPage.tsx');
  assert.doesNotMatch(history, /setInterval\(/, 'History must not create its own second polling loop');
  assert.match(history, /useWorkspaceJobs\(undefined, \{ intervalMs: 3000 \}\)/);
});

test('job-status SSE reconnects and stops its polling fallback once the connection reopens, instead of running both forever after one blip', () => {
  const jobStatus = read('./workspace/useJobStatus.ts');
  assert.match(jobStatus, /events\.onerror = \(\) => \{/);
  assert.match(jobStatus, /events\.onopen = \(\) => \{/);
  const onOpenBody = jobStatus.slice(jobStatus.indexOf('events.onopen'), jobStatus.indexOf('return () => {'));
  assert.match(onOpenBody, /window\.clearInterval\(pollingRef\.current\)/);
  assert.match(onOpenBody, /pollingRef\.current = null;/);
});

test('a compact connection/retry hint renders only when live updates are degraded, never as a permanent element', () => {
  const hint = read('./components/LiveStatusHint.tsx');
  assert.match(hint, /if \(!degraded\) return null;/);
  assert.match(hint, /role="status"/);

  for (const page of ['./pages/HistoryPage.tsx', './pages/DashboardPage.tsx', './pages/SuperAdminPage.tsx', './pages/BuyCreditsPage.tsx', './pages/NewRecapPage.tsx']) {
    assert.match(read(page), /<LiveStatusHint degraded=\{/, `${page} must surface the shared degraded indicator`);
  }
});

// --- 3. New Recap mobile controls layout -----------------------------------

test('effects controls use an explicit grid layout matching the required grouping, not unpredictable flex-wrap', () => {
  const editor = read('./workspace/VideoEffectsEditor.tsx');
  const css = read('./styles/app.css');

  // Color Grading: full-width row.
  assert.match(editor, /className="effects-editor__grading effects-editor__row--full"/);
  // Flip Video + Burn Subtitles: two-column row, both effects-editor__toggle.
  const twoColBlock = editor.slice(editor.indexOf("effects-editor__row--two-col"), editor.indexOf('effects-editor__subtitle-color'));
  assert.equal((twoColBlock.match(/className="effects-editor__toggle"/g) || []).length, 2);
  assert.match(twoColBlock, />\s*Flip Video/);
  assert.match(twoColBlock, />\s*Burn subtitles/);
  // Subtitle Color: full-width, only rendered when Burn Subtitles is enabled.
  assert.match(editor, /\{effects\.burnSubtitlesEnabled && \(\s*<div className="effects-editor__subtitle-color effects-editor__row--full"/);
  // Blur Masks: full-width row.
  assert.match(editor, /className="effects-editor__toggle effects-editor__row--full"[\s\S]{0,400}Blur masks/);
  // Add Blur Box: full-width action, only when Blur Masks is enabled.
  assert.match(editor, /\{effects\.blurEnabled && \(\s*<Button[\s\S]{0,300}className="effects-editor__row--full"/);
  // Blur Strength: full-width, beneath Add Blur Box.
  assert.ok(editor.indexOf('Add blur box') < editor.indexOf('effects-editor__strength effects-editor__row--full'));

  // CSS: an explicit 2-column grid, not flex-wrap; full-width/two-col helpers exist.
  assert.match(css, /\.effects-editor__controls \{ padding: 14px; display: grid; grid-template-columns: 1fr 1fr;/);
  assert.match(css, /\.effects-editor__row--full \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /\.effects-editor__row--two-col \{ grid-column: 1 \/ -1; display: grid; grid-template-columns: 1fr 1fr;/);
  // Touch targets >= 44px, and the shared <=480px breakpoint (covers 360/390/430px) is present.
  assert.match(css, /min-height: 44px;/);
  assert.match(css, /@media \(max-width: 480px\) \{/);
});

test('no feature was removed from the effects editor while restructuring its layout', () => {
  const editor = read('./workspace/VideoEffectsEditor.tsx');
  for (const feature of [
    'Color Grading', 'Flip Video', 'Burn subtitles', 'Blur masks', 'Add blur box', 'Blur strength',
    'SUBTITLE_COLOR_SWATCHES', 'colorGrading', 'flipVideoEnabled', 'burnSubtitlesEnabled', 'blurEnabled', 'blurBoxes',
  ]) {
    assert.match(editor, new RegExp(feature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `"${feature}" must still exist`);
  }
});
