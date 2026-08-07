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

// --- 4. Performance: bundle splitting, request dedup, mobile compositing ---

test('per-role and heavy routes are code-split so a user never downloads screens they cannot reach', () => {
  const foundation = read('./AppFoundation.tsx');
  for (const [name, path] of [
    ['DashboardPage', './pages/DashboardPage'],
    ['NewRecapPage', './pages/NewRecapPage'],
    ['HistoryPage', './pages/HistoryPage'],
    ['BuyCreditsPage', './pages/BuyCreditsPage'],
    ['SuperAdminPage', './pages/SuperAdminPage'],
  ]) {
    const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      foundation,
      new RegExp(`const ${name} = lazy\\(\\(\\) => import\\('${escapedPath}'\\)`),
      `${name} must be lazy-loaded, not bundled into the main chunk`,
    );
  }
  // Landing/Login must stay eager -- they're the first thing an
  // unauthenticated visitor needs, so splitting them would add a chunk
  // round-trip to the very page this optimizes for.
  assert.match(foundation, /import \{ LandingPage \} from '\.\/pages\/LandingPage';/);
  assert.match(foundation, /import \{ LoginPage \} from '\.\/pages\/LoginPage';/);
  assert.doesNotMatch(foundation, /lazy\(\(\) => import\('\.\/pages\/LandingPage'\)/);
});

test('lazy routes render behind a Suspense boundary with the existing session-loading fallback (no new loading UI introduced)', () => {
  const shell = read('./layout/AppShell.tsx');
  assert.match(shell, /import \{ SessionLoading \} from '\.\.\/pages\/SessionLoading';/);
  assert.match(shell, /<Suspense fallback=\{<SessionLoading \/>\}>\s*<Outlet \/>\s*<\/Suspense>/);
});

test('the effects editor is lazy-loaded inside New Recap and only mounts once a job reaches pending', () => {
  const page = read('./pages/NewRecapPage.tsx');
  assert.match(page, /const VideoEffectsEditor = lazy\(\(\) => import\('\.\.\/workspace\/VideoEffectsEditor'\)/);
  assert.match(page, /job\?\.status === 'pending' &&[\s\S]{0,80}<Suspense fallback=\{<Skeleton height="16rem" \/>\}>/);
  // DEFAULT_VIDEO_EFFECTS must come from the small, always-eager
  // effectsState module -- pulling it from VideoEffectsEditor itself would
  // defeat the point of lazy-loading the editor.
  assert.match(page, /import \{ DEFAULT_VIDEO_EFFECTS \} from '\.\.\/workspace\/effectsState\.js';/);
});

test('the sidebar credit balance shares its request cache with Buy Credits instead of firing a second identical poll', () => {
  const shell = read('./layout/AppShell.tsx');
  const api = read('./billing/api.ts');
  assert.match(shell, /import \{ getBalance, getMyPlanAssignment \} from '\.\.\/billing\/api';/);
  assert.doesNotMatch(shell, /fetch\('\/api\/credits\/balance'/, 'AppShell must go through the shared getBalance(), not a raw fetch');
  assert.doesNotMatch(shell, /fetch\('\/api\/plans\/me'/, 'AppShell must go through the shared getMyPlanAssignment(), not a raw fetch');
  assert.match(api, /export const getBalance = \(\) => get<BillingBalance>\('\/api\/credits\/balance'\);/);
  assert.match(api, /export const getMyPlanAssignment = \(\) => get<PlanAssignment \| null>\('\/api\/plans\/me'\);/);
  assert.match(api, /const get = <T>\(path: string\) =>\s*dedupeRequest\(path, DEDUPE_TTL_MS,/);
  // getBillingOverview must reuse the same exported getters (same cache
  // key) rather than re-issuing its own separate calls to the same paths.
  const overview = api.slice(api.indexOf('export const getBillingOverview'));
  assert.match(overview, /getBalance\(\),/);
  assert.match(overview, /getMyPlanAssignment\(\),/);
});

test('the mobile nav panel no longer forces a backdrop blur behind an already-opaque background', () => {
  const css = read('./styles/app.css');
  const panelBlock = css.slice(css.indexOf('.mobileNavPanel {'), css.indexOf('.mobileNavPanel.is-open'));
  assert.match(panelBlock, /background: rgba\(5, 5, 5, 0\.98\);/, 'background must stay effectively opaque');
  assert.doesNotMatch(panelBlock, /backdrop-filter/, 'a blur behind an opaque background is pure compositing cost with no visible effect');
});

test('the completed-video preview box never clips its own error/retry state at narrow mobile widths', () => {
  const css = read('./styles/app.css');
  // At 360-430px, the .alert error message + Retry button rendered inside
  // the 9:16 .videoBox--portrait can be taller than the box itself; without
  // this override, the box's own overflow:hidden clips the Retry button,
  // making it unreachable (a real "unusable touch target" regression).
  assert.match(css, /\.videoBox--portrait:has\(\.alert\) \{ aspect-ratio: auto; \}/);
  // .videoBox's 52px font-size (sized for the bare '▶' placeholder glyph)
  // must not cascade into the error alert's text/button.
  assert.match(css, /\.videoBox \.alert \{ font-size: 1rem; \}/);
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
