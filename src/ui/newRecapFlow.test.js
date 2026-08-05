import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Strips comments before a "no leaked internal terms" check, so an
// explanatory code comment naming what must NOT be user-facing doesn't
// trip its own check -- only what actually ships to the browser counts.
const stripComments = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('all roles share New Recap/History/Plans navigation; Super Admin is role-gated', () => {
  const shell = read('./layout/AppShell.tsx');
  const foundation = read('./AppFoundation.tsx');

  assert.match(shell, /to: '\/new-recap', label: 'New Recap'/);
  assert.match(shell, /to: '\/history', label: 'History'/);
  assert.match(shell, /to: '\/buy-credits', label: 'Plans & Credits'/);
  assert.match(shell, /to: '\/admin', label: 'Super Admin', superAdminOnly: true/);
  assert.match(shell, /availableNavigation = navigation\.filter\(item => !item\.superAdminOnly \|\| isSuperAdmin\)/);
  assert.match(foundation, /profile\?\.role === 'super_admin' \? '\/admin' : '\/new-recap'/);
});

test('one valid video uploads automatically without a submission button', () => {
  const hook = read('./workspace/useUploadPanel.ts');

  assert.match(hook, /candidates\.length !== 1/);
  assert.doesNotMatch(hook, /type="file"\s+multiple/);
  assert.match(hook, /void uploadVideos\(selected\)/);
  assert.match(hook, /video\.duration > configuration\.maxSourceDurationSeconds/);
  assert.match(hook, /Video is too long\. Maximum supported duration is 15 minutes\./);
});

test('New Recap embeds live processing and applies the two-active-job UI limit', () => {
  const page = read('./pages/NewRecapPage.tsx');
  const jobStatus = read('./workspace/useJobStatus.ts');

  assert.match(page, /activeJobCount >= 2/);
  assert.match(page, /လက်ရှိ Recap ၂ ခု လုပ်ဆောင်နေပါသည်/);
  assert.match(jobStatus, /credentials: 'include'/);
  assert.doesNotMatch(page, /\.mp3|audioUrl|>MP3\b/);
  assert.match(page, /Pipeline job=\{job\}/);
  assert.match(page, /WORKFLOW_STEPS\.map/);
  assert.match(page, /getWorkflowStepState\(job, stage\.id, uploadState\)/);
  assert.match(page, /job\?\.status === 'failed'/);
  assert.match(page, />Retry</);
  assert.match(page, /retryFailedJob/);
});

test('New Recap is a single real-data-driven orchestrator, no mock progress timers', () => {
  const page = read('./pages/NewRecapPage.tsx');
  const jobStatus = read('./workspace/useJobStatus.ts');
  const presentation = read('./workspace/workflowPresentation.ts');

  assert.match(jobStatus, /new EventSource/);
  assert.doesNotMatch(page, /setInterval\([^)]*setProgress/);
  assert.doesNotMatch(page, /setTimeout\(\(\) => .*onComplete/);
  assert.match(presentation, /Math\.round\(job\.progress\)/);
  assert.match(page, /searchParams\.get\('job'\)/);
});

test('idle New Recap shows the reference upload panel and a compact three-step guide', () => {
  const page = read('./pages/NewRecapPage.tsx');

  assert.match(page, /Blink အသုံးပြုပုံ/);
  assert.match(page, /ဗီဒီယိုတင်ပါ/);
  assert.match(page, /className="panel uploadpanel/);
  assert.match(page, /className="statsgrid"/);
});

test('History contains processing and completed recaps and routes to /new-recap?job=', () => {
  const history = read('./pages/HistoryPage.tsx');
  const list = read('./workspace/JobList.tsx');

  assert.match(history, /<JobList jobs=\{jobs\}/);
  assert.match(list, /\['queued', 'processing'\]\.includes\(job\.status\)/);
  assert.match(list, /new-recap\?job=/);
  assert.match(list, /job\.status === 'processing' \? 'In progress'/);
  assert.match(list, /job\.cancellationRequested[\s\S]*'Cancelling'/);
  assert.match(list, /onDelete && !\['queued', 'processing'\]\.includes\(job\.status\)/);
  assert.match(list, /getJobStatusLabel\(job\)/);
});

test('failed jobs expose retry only after real recoverability and use the idempotent API', () => {
  const jobStatus = read('./workspace/useJobStatus.ts');
  const history = read('./pages/HistoryPage.tsx');
  const list = read('./workspace/JobList.tsx');
  const api = read('./workspace/api.ts');
  assert.match(api, /\/api\/workspace\/jobs\/\$\{encodeURIComponent\(jobId\)\}\/retry/);
  assert.match(api, /'Idempotency-Key': idempotencyKey/);
  assert.match(jobStatus, /retryEligibility\?\.recoverable/);
  assert.match(jobStatus, /job\.retry_accepted/);
  assert.match(history, /getWorkspaceRetryEligibility/);
  assert.match(history, /retryWorkspaceJob/);
  assert.match(list, /retryEligibility\[job\.id\]\?\.recoverable/);
  assert.match(list, /Requeueing…/);
});

test('active cancellation stays on the existing job until SSE reports cancelled', () => {
  const jobStatus = read('./workspace/useJobStatus.ts');
  const api = read('./workspace/api.ts');
  const list = read('./workspace/JobList.tsx');

  assert.match(api, /jobs\/\$\{encodeURIComponent\(jobId\)\}\/cancel/);
  assert.match(jobStatus, /'job\.cancellation_requested'/);
  assert.match(jobStatus, /cancelling \|\| job\.cancellationRequested/);
  assert.doesNotMatch(jobStatus, /deleteWorkspaceJob/);
  assert.match(list, /onDelete && !\['queued', 'processing'\]\.includes\(job\.status\)/);
});

test('subtitle and blur setup happens on the uploaded (pending) job before explicit processing start', () => {
  const page = read('./pages/NewRecapPage.tsx');
  const editor = read('./workspace/VideoEffectsEditor.tsx');

  assert.match(page, /job\?\.status === 'pending'/);
  assert.match(page, /VideoEffectsEditor/);
  assert.match(page, /queueWorkspaceJob\(job\.id, '', latestEffectsRef\.current\)/);
  assert.match(editor, /burnSubtitlesEnabled: false/);
  assert.match(editor, /blurEnabled: false/);
  assert.match(editor, /colorGrading: 'original'/);
  assert.match(editor, /flipVideoEnabled: false/);
  assert.match(editor, /Burn subtitles/);
  assert.match(editor, /Blur masks/);
  assert.match(page, /Recap စတင်ဖန်တီးမည်/);
});

test('effects editor keeps blur below subtitles and handles above both, unchanged from prior verified layering', () => {
  const editor = read('./workspace/VideoEffectsEditor.tsx');
  const app = read('./styles/app.css');
  const backend = read('../services/videoEffects.js');

  assert.match(editor, /setVideoAspectRatio\(`\$\{event\.currentTarget\.videoWidth\} \/ \$\{event\.currentTarget\.videoHeight\}`\)/);
  assert.ok(
    editor.indexOf('effects-box--blur') < editor.indexOf('effects-box--subtitle'),
    'blur masks must render before subtitles',
  );
  assert.ok(
    editor.indexOf('effects-box--subtitle') < editor.indexOf('effects-handles'),
    'handles must render after both effect layers',
  );
  assert.match(app, /\.effects-box--blur \{ z-index: 1/);
  assert.match(app, /\.effects-box--subtitle \{ z-index: 2/);
  assert.match(app, /\.effects-handle \{[^}]*z-index: 3/);
  assert.ok(
    backend.indexOf("if (normalized.colorGrading !== 'original')") < backend.indexOf('if (normalized.flipVideoEnabled'),
    'color grading must run before horizontal flip',
  );
  assert.ok(
    backend.indexOf('if (normalized.flipVideoEnabled') < backend.indexOf('if (hasBlur)'),
    'horizontal flip must run before blur',
  );
  assert.ok(
    backend.indexOf('if (hasBlur)') < backend.indexOf('if (normalized.burnSubtitlesEnabled)'),
    'final export must burn subtitles after blur',
  );
});

test('Color Grading and Flip Video are optional effects persisted with the pending job', () => {
  const page = read('./pages/NewRecapPage.tsx');
  const editor = read('./workspace/VideoEffectsEditor.tsx');
  const api = read('./workspace/api.ts');
  const backend = read('../services/videoEffects.js');
  const app = read('./styles/app.css');

  assert.match(editor, /Color Grading/);
  for (const option of ['Original', 'Auto', 'Cinematic', 'Warm', 'Cool']) {
    assert.match(editor, new RegExp(`>${option}<`));
  }
  assert.match(editor, />\s*Flip Video\s*</);
  assert.match(editor, /value=\{effects\.colorGrading\}/);
  assert.match(editor, /checked=\{effects\.flipVideoEnabled\}/);
  assert.match(editor, /effects-editor__video--flipped/);
  assert.match(app, /\.effects-editor__video--flipped \{ transform: scaleX\(-1\); \}/);
  assert.match(editor, /effects-editor__media-controls/);
  assert.match(page, /queueWorkspaceJob\(job\.id, '', latestEffectsRef\.current\)/);
  assert.match(page, /latestEffectsRef\.current = nextEffects;[\s\S]*setEffects\(nextEffects\)/);
  assert.match(api, /const body = \{ geminiApiKey, effects \}/);
  assert.match(api, /body: JSON\.stringify\(body\)/);
  assert.match(backend, /AUTO_COLOR_FILTER = 'eq=contrast=1\.03:saturation=1\.04:gamma=1\.01'/);
  assert.match(backend, /'-vf', 'hflip'/);
});

test('Flip Video covers one complete video layer without mirroring controls or overlays', () => {
  const editor = read('./workspace/VideoEffectsEditor.tsx');
  const app = read('./styles/app.css');

  assert.equal((editor.match(/<video\b/g) || []).length, 1, 'preview must render exactly one video-content element');
  assert.doesNotMatch(editor, /<video[\s\S]{0,400}\scontrols(?:\s|>)/, 'native controls cannot share the transformed video element');
  assert.doesNotMatch(editor, /mirrorVideoRef|syncMirror|effects-editor__mirrored-content/);
  assert.match(app, /\.effects-editor__video--flipped \{ transform: scaleX\(-1\); \}/);
  assert.doesNotMatch(app, /\.effects-editor__(?:__media-controls|__overlay)[^}]*transform: scaleX/);
  assert.ok(
    editor.indexOf('effects-editor__video--flipped') < editor.indexOf('effects-editor__overlay')
      && editor.indexOf('effects-editor__overlay') < editor.indexOf('effects-editor__media-controls'),
    'unmirrored overlays and controls must be siblings above the sole video layer',
  );
});

test('processing progress presents Final Export sub-steps from real job.progress thresholds', () => {
  const page = read('./pages/NewRecapPage.tsx');
  const presentation = read('./workspace/workflowPresentation.ts');

  for (const label of ['Color Grading', 'Flip', 'Blur', 'Subtitle', 'Verify Output']) {
    assert.match(page, new RegExp(`'${label}'`));
  }
  assert.match(page, /job\.stage === 'final_export'/);
  assert.match(presentation, /if \(job\.status === 'completed'\) return 100/);
  assert.match(presentation, /Math\.min\(99, Math\.round\(job\.progress\)\)/);
});

test('workflow pipeline renders once per screen with the sanitized 5-stage product-facing list, no internal pipeline names', () => {
  const page = read('./pages/NewRecapPage.tsx');
  const presentation = read('./workspace/workflowPresentation.ts');

  assert.equal((presentation.match(/\{ id: '/g) || []).length, 5);
  for (const label of ['Uploading', 'Preparing', 'Generating narration', 'Building video', 'Finalizing']) {
    assert.match(presentation, new RegExp(`label: '${escapeRegExp(label)}'`));
  }
  const shippedCode = stripComments(presentation);
  for (const leaked of ['Whisper', 'Gemini', 'FFmpeg', 'Edge', 'Sawaungthin', 'Timeline Verification', 'Scene Rebuild', 'checkpoint']) {
    assert.doesNotMatch(shippedCode, new RegExp(leaked, 'i'), `internal term "${leaked}" must not reach the shipped label mapping`);
  }
  assert.match(page, /aria-current=\{active \? 'step' : undefined\}/);
  assert.equal((page.match(/<Pipeline job=\{job\}/g) || []).length, 2, 'pipeline used for both processing and failed views, never duplicated within one view');
});

test('History rows show live progress and status for every terminal/active state', () => {
  const history = read('./pages/HistoryPage.tsx');
  const list = read('./workspace/JobList.tsx');
  const presentation = read('./workspace/workflowPresentation.ts');
  const app = read('./styles/app.css');

  for (const label of ['In progress', 'Cancelling']) assert.match(list, new RegExp(label));
  for (const label of ['Cancelled', 'Failed', 'Completed']) assert.match(presentation, new RegExp(label));
  assert.match(list, /'queued', 'processing'\]\.includes\(job\.status\) &&/);
  assert.match(app, /\.historyitem \{/);
  assert.match(history, /window\.scrollTo\(\{ top: 0, left: 0, behavior: 'auto' \}\)/);
});

test('mobile shell is a bottom nav bar (not a drawer), reachable via real routing and billing APIs', () => {
  const shell = read('./layout/AppShell.tsx');
  const app = read('./styles/app.css');
  const reference = read('./styles/reference.css');

  assert.match(shell, /className="mobileNav"/);
  assert.doesNotMatch(shell, /Dropdown|Modal/);
  assert.match(shell, /fetch\('\/api\/credits\/balance'/);
  assert.match(shell, /fetch\('\/api\/plans\/me'/);
  assert.match(shell, /profile\?\.role === 'super_admin'/);
  assert.match(reference, /^\.mobileNav\{display:none\}/m);
  assert.match(app, /\.mobileNav a \{/);
});

test('pipeline/status labels are concise English (technical, not translated); document language is still Burmese for real users', () => {
  const shell = read('./layout/AppShell.tsx');
  const presentation = read('./workspace/workflowPresentation.ts');
  const page = read('./pages/NewRecapPage.tsx');
  const html = read('../../index.html');
  const reference = read('./styles/reference.css');

  for (const label of [
    'Uploading', 'Preparing', 'Generating narration', 'Building video', 'Finalizing',
    'Waiting', 'Completed', 'Failed', 'Cancelled',
  ]) assert.match(presentation, new RegExp(escapeRegExp(label)));
  assert.match(page, /Cancelling/);
  assert.match(page, /Download Video/);
  assert.match(html, /<html lang="my">/);
  assert.match(reference, /body\{font-family:"Noto Sans Myanmar","Manrope"/);
});
