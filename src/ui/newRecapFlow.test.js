import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('normal users land on New Recap and do not receive Projects navigation', () => {
  const routes = read('./AppFoundation.tsx');
  const login = read('./pages/LoginPage.tsx');
  const shell = read('./layout/AppShell.tsx');

  assert.match(routes, /profile\?\.role === 'super_admin' \? '\/dashboard' : '\/new-recap'/);
  assert.match(login, /profile\.role === 'super_admin' \? '\/dashboard' : '\/new-recap'/);
  assert.match(shell, /to: '\/new-recap', label: 'Recap အသစ်'.*userOnly: true/);
  assert.match(shell, /to: '\/projects', label: 'ပရောဂျက်များ'.*superAdminOnly: true/);
});

test('one valid video uploads automatically without a submission button', () => {
  const upload = read('./pages/UploadPage.tsx');

  assert.match(upload, /candidates\.length !== 1/);
  assert.doesNotMatch(upload, /type="file"\s+multiple/);
  assert.match(upload, /void uploadVideos\(selected\)/);
  assert.match(upload, /video\.duration > configuration\.maxSourceDurationSeconds/);
  assert.match(upload, /Video is too long\. Maximum supported duration is 15 minutes\./);
  assert.doesNotMatch(upload, />\s*Upload\s*<\/Button>/);
  assert.doesNotMatch(upload, /Drop up to 2 videos|Select up to 2 videos/);
  assert.doesNotMatch(upload, /return \(\) => cancelRef\.current/);
  assert.match(upload, /videos\.length > 0 && !\(compact && hideStatus\)/);
});

test('New Recap embeds live processing and applies the two-active-job UI limit', () => {
  const page = read('./pages/NewRecapPage.tsx');
  const processing = read('./pages/ProcessingPage.tsx');
  const routes = read('./AppFoundation.tsx');
  const upload = read('./pages/UploadPage.tsx');

  assert.match(page, /activeJobCount >= 2/);
  assert.match(page, /လက်ရှိ Recap ၂ ခု လုပ်ဆောင်နေပါသည်/);
  assert.match(page, /<ProcessingStatusView[\s\S]*projectId=\{activeJobId\}[\s\S]*uploadContent=/);
  assert.doesNotMatch(processing, /navigate\(`\/projects\/\$\{projectId\}`/);
  assert.doesNotMatch(routes, /projects\/:projectId\/processing/);
  assert.doesNotMatch(upload, /Opening Processing/);
  assert.match(processing, /credentials: 'include'/);
  assert.match(processing, /if \(!job\.videoUrl\)/);
  assert.match(processing, /fetch\(job\.videoUrl/);
  assert.doesNotMatch(processing, /job\.videoUrl \|\| `\/output/);
  assert.match(processing, /URL\.createObjectURL\(blob\)/);
  assert.match(processing, /<video controls preload="metadata" src=\{mediaUrl\}/);
  assert.match(processing, /<Download size=\{16\} \/>Download Video/);
  assert.doesNotMatch(processing, /<Button disabled loading=\{!mediaError\}>Download Video/);
  assert.doesNotMatch(processing, /\.mp3|audioUrl|>MP3|>MP4/);
  assert.doesNotMatch(processing, /navigate\(['"]\/history/);
  assert.match(processing, /new-recap-workspace--upload-only/);
  assert.match(processing, /new-recap-workspace--active/);
  assert.match(processing, /WORKFLOW_STEPS\.map/);
  assert.match(processing, /getWorkflowStepState\(job, stage\.id, uploadLifecycle\.state\)/);
  assert.match(page, /onLifecycleChange=\{setUploadLifecycle\}/);
  assert.match(page, /hideStatus/);
  assert.doesNotMatch(processing, /processing-page--embedded|Recap status/);
  assert.doesNotMatch(processing, />Back<\/Button>/);
  assert.match(processing, /job\?\.status === 'failed'/);
  assert.match(processing, />Recap အသစ် စမည်<\/Button>/);
  assert.match(processing, /getWorkspaceRetryEligibility/);
  assert.match(processing, /retryWorkspaceJob/);
  assert.match(processing, />Retry recap<\/Button>/);
  assert.doesNotMatch(processing, /processing-stage--failed/);
});

test('New Recap keeps one stable workflow container and uses only measured progress', () => {
  const page = read('./pages/NewRecapPage.tsx');
  const processing = read('./pages/ProcessingPage.tsx');
  const upload = read('./pages/UploadPage.tsx');
  const presentation = read('./workspace/workflowPresentation.ts');

  assert.match(processing, /!workflowStarted && <div className="new-recap-workspace__upload">/);
  assert.match(processing, /const pipeline = \([\s\S]*new-recap-workspace__pipeline/);
  assert.match(processing, /\{pipeline\}[\s\S]*!workflowStarted && <div className="new-recap-workspace__upload">/);
  assert.match(processing, /const workflowStarted = Boolean\(projectId \|\| job\)/);
  assert.doesNotMatch(processing, />Processing<|Current stage|processing-progress/);
  assert.match(processing, /job && job\.status !== 'pending'/);
  assert.match(page, /uploadContent=\{displayedJob \? null/);
  assert.doesNotMatch(page, /FileVideo2|Recap in progress|File selected|Starting processing/);
  assert.match(upload, /setState\('uploading'\);[\s\S]*readDuration/);
  assert.doesNotMatch(upload, /setTimeout\(\(\) => onComplete/);
  assert.match(presentation, /Math\.round\(job\.progress\)/);
  assert.doesNotMatch(presentation, /PROGRESS_RANGE|92/);
  assert.match(page, /searchParams\.get\('job'\)/);
});

test('idle New Recap shows one compact guide that disappears as soon as a file is selected', () => {
  const page = read('./pages/NewRecapPage.tsx');
  const processing = read('./pages/ProcessingPage.tsx');
  const styles = read('./styles/layout.css');

  assert.match(page, /Blink အသုံးပြုပုံ/);
  assert.match(page, /ဗီဒီယိုတင်ပါ/);
  assert.match(page, /စာတန်းထိုး၊ မှုန်ဝါးမှုနှင့် Effect များကို ချိန်ညှိပါ/);
  assert.match(page, /ဖန်တီးပြီး ဒေါင်းလုဒ်လုပ်ပါ/);
  assert.match(page, /500 MB အထိ <i>•<\/i> စတင်လုပ်ဆောင်မည်ကို နှိပ်မှသာ စတင်ပါမည်/);
  assert.match(page, /!uploadLifecycle\.filename && \(/);
  assert.match(styles, /\.new-recap-how/);
  assert.match(styles, /color-mix\(in srgb, var\(--ds-brand-500\)/);
  assert.match(styles, /\.new-recap-how ol \{[^}]*grid-template-columns: repeat\(3, 1fr\)/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.new-recap-how ol \{ grid-template-columns: 1fr; \}/);
  assert.match(processing, /!workflowStarted && <div className="new-recap-workspace__upload">/);
  assert.match(processing, /\{pipeline\}[\s\S]*!workflowStarted/);
});

test('History contains processing and completed recaps', () => {
  const history = read('./pages/HistoryPage.tsx');
  const detail = read('./pages/ProjectDetailPage.tsx');
  const list = read('./workspace/JobList.tsx');

  assert.match(history, /<JobList jobs=\{jobs\}/);
  assert.match(list, /\['queued', 'processing'\]\.includes\(job\.status\)/);
  assert.match(list, /new-recap\?job=/);
  assert.match(list, /job\.status === 'processing' \? 'In progress'/);
  assert.match(list, /job\.cancellationRequested[\s\S]*'Cancelling'/);
  assert.match(list, /onDelete && !\['queued', 'processing'\]\.includes\(job\.status\)/);
  assert.match(list, /getJobStatusLabel\(job\)/);
  assert.match(list, /navigate\(`\/new-recap\?job=/);
  assert.match(detail, /<Navigate to=\{`\/new-recap\?job=/);
  assert.doesNotMatch(detail, /workspace-project-summary|workspace-full-timeline|job\.filename/);
});

test('failed jobs expose retry only after real recoverability and use the idempotent API', () => {
  const processing = read('./pages/ProcessingPage.tsx');
  const history = read('./pages/HistoryPage.tsx');
  const list = read('./workspace/JobList.tsx');
  const api = read('./workspace/api.ts');
  assert.match(api, /\/api\/workspace\/jobs\/\$\{encodeURIComponent\(jobId\)\}\/retry/);
  assert.match(api, /'Idempotency-Key': idempotencyKey/);
  assert.match(processing, /retryEligibility\.recoverable/);
  assert.match(processing, /job\.retry_accepted/);
  assert.match(history, /getWorkspaceRetryEligibility/);
  assert.match(history, /retryWorkspaceJob/);
  assert.match(list, /retryEligibility\[job\.id\]\?\.recoverable/);
  assert.match(list, /Requeueing…/);
});

test('active cancellation stays on the existing job until SSE reports cancelled', () => {
  const processing = read('./pages/ProcessingPage.tsx');
  const api = read('./workspace/api.ts');
  const list = read('./workspace/JobList.tsx');

  assert.match(api, /jobs\/\$\{encodeURIComponent\(jobId\)\}\/cancel/);
  assert.match(processing, /'job\.cancellation_requested'/);
  assert.match(processing, /cancelling \|\| job\.cancellationRequested/);
  assert.match(processing, /job\.cancellationRequested \? 'Cancelling' : 'ပယ်ဖျက်မည်'/);
  assert.doesNotMatch(processing, /deleteWorkspaceJob/);
  assert.match(list, /onDelete && !\['queued', 'processing'\]\.includes\(job\.status\)/);
});

test('subtitle and blur setup happens on the uploaded job before explicit processing start', () => {
  const page = read('./pages/NewRecapPage.tsx');
  const editor = read('./workspace/VideoEffectsEditor.tsx');
  const upload = read('./pages/UploadPage.tsx');

  assert.doesNotMatch(page, /handleUploadComplete[\s\S]{0,100}beginProcessing/);
  assert.match(page, /setActiveJobId\(job\.id\)/);
  assert.match(page, /VideoEffectsEditor/);
  assert.match(page, /queueWorkspaceJob\(job\.id, '', latestEffectsRef\.current\)/);
  assert.match(editor, /burnSubtitlesEnabled: false/);
  assert.match(editor, /blurEnabled: false/);
  assert.match(editor, /colorGrading: 'original'/);
  assert.match(editor, /flipVideoEnabled: false/);
  assert.match(editor, /စာတန်းထိုးနေရာ အရွယ်ပြောင်းမည်|မှုန်ဝါးဧရိယာ ဖျက်မည်|Blur strength/);
  assert.match(editor, /Burn subtitles/);
  assert.match(editor, /Blur masks/);
  assert.match(page, /setupContent=\{displayedJob \? \(/);
  assert.match(read('./pages/ProcessingPage.tsx'), /Start Processing/);
  assert.match(upload, /onComplete\(createdJobs\[createdJobs\.length - 1\]\)/);
});

test('mobile effects editor keeps blur below subtitles and compact handles above both', () => {
  const editor = read('./workspace/VideoEffectsEditor.tsx');
  const styles = read('./styles/layout.css');
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
  assert.match(styles, /\.effects-box--blur \{ z-index: 1/);
  assert.match(styles, /\.effects-box--subtitle \{ z-index: 2/);
  assert.match(styles, /\.effects-handle \{[^}]*z-index: 3/);
  assert.match(styles, /\.effects-handle::before \{[^}]*inset: -0\.8rem/);
  assert.match(styles, /\.new-recap-workspace__editor \{ padding: 0/);
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

test('Color Grading and Flip Video are compact optional effects persisted with the pending job', () => {
  const page = read('./pages/NewRecapPage.tsx');
  const editor = read('./workspace/VideoEffectsEditor.tsx');
  const api = read('./workspace/api.ts');
  const backend = read('../services/videoEffects.js');
  const styles = read('./styles/layout.css');

  assert.match(editor, /Color Grading/);
  for (const option of ['Original', 'Auto', 'Cinematic', 'Warm', 'Cool']) {
    assert.match(editor, new RegExp(`>${option}<`));
  }
  assert.match(editor, />\s*Flip Video\s*</);
  assert.match(editor, /value=\{effects\.colorGrading\}/);
  assert.match(editor, /checked=\{effects\.flipVideoEnabled\}/);
  assert.match(editor, /effects-editor__video--flipped/);
  assert.match(styles, /\.effects-editor__video--flipped \{ transform: scaleX\(-1\); \}/);
  assert.match(editor, /effects-editor__media-controls/);
  assert.doesNotMatch(styles, /effects-editor__overlay[^}]*scaleX/);
  assert.match(page, /queueWorkspaceJob\(job\.id, '', latestEffectsRef\.current\)/);
  assert.match(page, /latestEffectsRef\.current = nextEffects;[\s\S]*setEffects\(nextEffects\)/);
  assert.match(api, /const body = \{ geminiApiKey, effects \}/);
  assert.match(api, /body: JSON\.stringify\(body\)/);
  for (const boundary of ['flip.toggle', 'editor.onEffectsChange', 'start.latestEffects', 'queue.request']) {
    assert.match(`${editor}\n${page}\n${api}`, new RegExp(boundary.replace('.', '\\.')));
  }
  assert.match(backend, /AUTO_COLOR_FILTER = 'eq=contrast=1\.03:saturation=1\.04:gamma=1\.01'/);
  assert.match(backend, /'-vf', 'hflip'/);
  assert.doesNotMatch(editor, /Auto Frame|crop|zoom/i);
});

test('local development restarts backend normalization when effects code changes', () => {
  const packageJson = JSON.parse(read('../../package.json'));
  const watcher = read('../../scripts/dev-watch-policy.mjs');
  assert.equal(packageJson.scripts.dev, 'node scripts/dev-server.mjs');
  assert.match(watcher, /'src\/services'/);
  assert.doesNotMatch(watcher, /src\/tmp|public\/output|data\/cache/);
});

test('Flip Video covers one complete video layer without mirroring controls or overlays', () => {
  const editor = read('./workspace/VideoEffectsEditor.tsx');
  const styles = read('./styles/layout.css');

  assert.equal((editor.match(/<video\b/g) || []).length, 1, 'preview must render exactly one video-content element');
  assert.doesNotMatch(editor, /<video[\s\S]{0,400}\scontrols(?:\s|>)/, 'native controls cannot share the transformed video element');
  assert.doesNotMatch(editor, /mirrorVideoRef|syncMirror|effects-editor__mirrored-content/);
  assert.match(styles, /\.effects-editor__video--flipped \{ transform: scaleX\(-1\); \}/);
  assert.doesNotMatch(styles, /\.effects-editor__video--flipped[^}]*clip-path|\.effects-editor__preview video[^}]*clip-path/);
  assert.doesNotMatch(styles, /\.effects-editor__(?:__media-controls|__overlay)[^}]*transform: scaleX/);
  assert.ok(
    editor.indexOf('effects-editor__video--flipped') < editor.indexOf('effects-editor__overlay')
      && editor.indexOf('effects-editor__overlay') < editor.indexOf('effects-editor__media-controls'),
    'unmirrored overlays and controls must be siblings above the sole video layer',
  );
});

test('processing progress hides the source file box and presents Final Export sub-steps', () => {
  const processing = read('./pages/ProcessingPage.tsx');
  const presentation = read('./workspace/workflowPresentation.ts');

  assert.doesNotMatch(processing, /showReadOnlyEditor|new-recap-workspace__editor--readonly/);
  for (const label of ['Color Grading', 'Flip', 'Blur', 'Subtitle', 'Verify Output']) {
    assert.match(processing, new RegExp(`'${label}'`));
  }
  assert.match(processing, /job\.stage === 'final_export'/);
  assert.match(presentation, /if \(job\.status === 'completed'\) return 100/);
  assert.match(presentation, /Math\.min\(99, Math\.round\(job\.progress\)\)/);
});

test('workflow remains visible for completed jobs without a second duplicate pipeline', () => {
  const processing = read('./pages/ProcessingPage.tsx');

  assert.match(processing, /\{pipeline\}/);
  assert.doesNotMatch(processing, /expandedWorkflowJobId|View workflow details/);
  assert.equal((processing.match(/\{pipeline\}/g) || []).length, 1);
});

test('mobile recap workspace uses one editor, one compact seven-stage pipeline, and one completed output', () => {
  const page = read('./pages/NewRecapPage.tsx');
  const processing = read('./pages/ProcessingPage.tsx');
  const presentation = read('./workspace/workflowPresentation.ts');
  const styles = read('./styles/layout.css');

  assert.match(page, /<h1>New Recap<\/h1>/);
  assert.match(processing, /\{pipeline\}/);
  assert.doesNotMatch(processing, /showReadOnlyEditor|new-recap-workspace__editor--readonly/);
  assert.match(processing, /Current progress/);
  assert.match(processing, /Start Processing/);
  assert.equal((presentation.match(/\{ id: '/g) || []).length, 7);
  assert.equal((processing.match(/Completed Recap/g) || []).length, 0);
  assert.equal((processing.match(/Download Video/g) || []).length, 1);
  assert.doesNotMatch(processing, /View workflow details|expandedWorkflowJobId/);
  assert.doesNotMatch(styles, /new-recap-workspace__actions \{ min-height: 24rem/);
  assert.doesNotMatch(styles, /new-recap-workspace__workflow \{ min-height: 25rem/);
  assert.match(styles, /\.new-recap-workspace \.processing-stages \{[\s\S]*grid-template-columns: repeat\(7, minmax\(6\.5rem, 1fr\)\)/);
  assert.match(styles, /scroll-snap-type: inline proximity/);
  assert.match(styles, /@keyframes blink-workspace-in/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test('processing pipeline uses the approved seven-stage horizontal filmstrip', () => {
  const processing = read('./pages/ProcessingPage.tsx');
  const presentation = read('./workspace/workflowPresentation.ts');
  const styles = read('./styles/layout.css');

  assert.equal((presentation.match(/\{ id: '/g) || []).length, 7);
  for (const label of ['Upload', 'Audio Extraction', 'Gemini Transcript', 'Voice Generation', 'Timeline Verification', 'Scene Rebuild', 'Final Export']) {
    assert.match(presentation, new RegExp(`label: '${label}'`));
  }
  assert.match(processing, /complete \? 'Complete' : active \? 'In progress' : 'Waiting'/);
  assert.match(processing, /stage\.id === 'final_export' && active/);
  assert.match(processing, /processing-stage__helper/);
  assert.match(processing, /aria-current=\{active \? 'step' : undefined\}/);
  assert.match(styles, /\.new-recap-workspace \.processing-stages \{[\s\S]*grid-template-columns: repeat\(7/);
  assert.match(styles, /\.new-recap-workspace \.processing-stage \{[\s\S]*scroll-snap-align: start/);
  assert.doesNotMatch(styles, /\.new-recap-workspace \.processing-stages \{[\s\S]{0,180}grid-template-columns: 1fr/);
});

test('History presents all terminal and active job states in compact mobile rows', () => {
  const history = read('./pages/HistoryPage.tsx');
  const list = read('./workspace/JobList.tsx');
  const presentation = read('./workspace/workflowPresentation.ts');
  const styles = read('./styles/layout.css');

  for (const label of ['In progress', 'Cancelling']) assert.match(list, new RegExp(label));
  for (const label of ['Cancelled', 'Failed', 'Completed']) assert.match(presentation, new RegExp(label));
  assert.match(list, /workspace-job__progress/);
  assert.match(styles, /\.workspace-history-card/);
  assert.match(styles, /\.workspace-job__progress/);
  assert.match(history, /window\.scrollTo\(\{ top: 0, left: 0, behavior: 'auto' \}\)/);
  assert.match(history, /workspace-history-page/);
  assert.match(styles, /\.workspace-history-card \.workspace-job-list \{ width: 100%; margin: 0; \}/);
  assert.match(styles, /\.workspace-history-card \{ overflow: visible; \}/);
  assert.match(styles, /padding-bottom: calc\(var\(--ds-space-16\) \+ env\(safe-area-inset-bottom\)\)/);
});

test('mobile shell uses the approved hamburger drawer with production identity and billing APIs', () => {
  const shell = read('./layout/AppShell.tsx');
  const styles = read('./styles/layout.css');

  assert.match(shell, /className="ds-topbar__menu"/);
  assert.match(shell, /className="ds-mobile-drawer"/);
  assert.match(shell, /fetch\('\/api\/credits\/balance'/);
  assert.match(shell, /fetch\('\/api\/plans\/me'/);
  assert.match(shell, /profile\?\.role === 'super_admin'/);
  assert.match(shell, /Owner \/ Super Admin/);
  assert.match(shell, /event\.key === 'Escape'/);
  assert.doesNotMatch(shell, /ds-bottom-nav/);
  assert.match(styles, /\.ds-mobile-drawer__panel \{/);
  assert.match(styles, /animation: ds-drawer-in/);
  assert.match(styles, /\.ds-mobile-billing \{/);
  assert.doesNotMatch(styles, /\.ds-bottom-nav/);
});

test('frontend navigation, pipeline, actions, and document language are localized for Burmese users', () => {
  const shell = read('./layout/AppShell.tsx');
  const presentation = read('./workspace/workflowPresentation.ts');
  const processing = read('./pages/ProcessingPage.tsx');
  const html = read('../../index.html');
  const base = read('./styles/base.css');
  const components = read('./styles/components.css');

  for (const label of ['Recap အသစ်', 'မှတ်တမ်း', 'ခရက်ဒစ်', 'ဆက်တင်များ']) {
    assert.match(shell, new RegExp(label));
  }
  for (const label of [
    'Upload', 'Audio Extraction', 'Gemini Transcript', 'Voice Generation',
    'Timeline Verification', 'Scene Rebuild', 'Final Export',
    'Waiting', 'In progress', 'Completed', 'Failed', 'Cancelled',
  ]) assert.match(presentation, new RegExp(label));
  assert.match(processing, /Cancelling/);
  assert.match(processing, /Download Video/);
  assert.match(html, /<html lang="my">/);
  assert.match(base, /:lang\(my\) h1/);
  assert.match(components, /\.ds-button \{[\s\S]*line-height: 1\.45/);
});
