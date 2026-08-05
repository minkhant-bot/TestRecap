import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

// Production media-access regression suite: a completed job under 24h must
// serve its stored, authoritative job.videoUrl through the authenticated
// /output route, and the frontend must never fabricate a fallback path or
// couple Download's availability to Preview's blob-fetch outcome.

test('a newly-completed job\'s stored videoUrl is a relative, authoritative /output path (no host/protocol fabrication)', () => {
  const worker = read('../../services/workspaceWorker.js');
  const jobs = read('../../services/workspaceJobs.js');
  assert.match(worker, /videoUrl: `\/output\/\$\{jobId\}\.mp4`/);
  assert.match(worker, /videoUrl: `\/output\/\$\{job\.id\}\.mp4`/);
  assert.doesNotMatch(worker, /videoUrl: `https?:\/\//);
  // publicJob() is the only place the stored URL is exposed to the client,
  // and it must pass job.videoUrl through untouched (except nulling it on expiry).
  assert.match(jobs, /videoUrl: job\.expired \? null : job\.videoUrl/);
});

test('/output requires authentication, is excluded from the SPA catch-all, and 403/404s without leaking existence', () => {
  const server = read('../../../server.js');
  assert.match(server, /app\.get\('\/output\/:filename', requireAuth,/, 'media route must sit behind session-cookie auth, same as any other protected resource');
  assert.match(server, /if \(!canAccessJob\(req\.user, job\) \|\| job\.status !== 'complete'\)/);
  // The production SPA fallback explicitly excludes /output, so an
  // authenticated media request can never be silently redirected into the
  // index.html catch-all and lose its auth context.
  assert.match(server, /app\.get\(\/\^\(\?!\\\/\(api\|output\)\)\.\*\$\/, \(req, res\) => \{/);
});

test('expired media returns 410 JOB_EXPIRED instead of a raw filesystem error or a stale 200', () => {
  const server = read('../../../server.js');
  const expiredBlock = server.slice(server.indexOf("app.get('/output/:filename'"), server.indexOf("app.use('/api'"));
  assert.match(expiredBlock, /if \(job\.expired\) \{/);
  assert.match(expiredBlock, /res\.status\(410\)\.json\(\{ error: 'This recap has expired\.', code: 'JOB_EXPIRED' \}\)/);
  // The expiry check must run before sendFile, since the file itself is
  // already deleted once the job is expired.
  assert.ok(expiredBlock.indexOf('if (job.expired)') < expiredBlock.indexOf('res.sendFile'));
});

test('authenticated preview fetches the stored videoUrl as a credentialed blob and exposes mediaUrl/mediaError', () => {
  const hook = read('./useJobStatus.ts');
  assert.match(hook, /void fetch\(job\.videoUrl, \{\s*credentials: 'include',\s*signal: controller\.signal,\s*\}\)/);
  assert.match(hook, /objectUrl = URL\.createObjectURL\(blob\)/);
  assert.match(hook, /setMediaUrl\(objectUrl\)/);
});

test('authenticated download fetches the stored videoUrl as a credentialed blob, independent of the preview effect', () => {
  const hook = read('./useJobStatus.ts');
  const downloadFn = hook.slice(hook.indexOf('const downloadVideo ='), hook.indexOf('useEffect(() => {\n    if (job?.status !== \'completed\''));
  assert.match(downloadFn, /fetch\(job\.videoUrl, \{ credentials: 'include' \}\)/);
  assert.match(downloadFn, /URL\.createObjectURL\(blob\)/);
  assert.match(downloadFn, /link\.click\(\)/);
});

test('preview and download both read job.videoUrl verbatim -- neither derives or fabricates its own path', () => {
  const hook = read('./useJobStatus.ts');
  const page = read('../pages/NewRecapPage.tsx');
  assert.doesNotMatch(hook, /\/output\/\$\{job/, 'the hook must never reconstruct an output path itself');
  assert.doesNotMatch(page, /\/output\/\$\{job/, 'the page must never reconstruct an output path itself');
  const fetchCalls = hook.match(/fetch\(job\.videoUrl,/g) || [];
  assert.equal(fetchCalls.length, 2, 'exactly the preview effect and downloadVideo must fetch job.videoUrl -- the single authoritative artifact');
});

test('preview failure never removes a valid Download action -- Download is gated on job.videoUrl, not on preview blob state', () => {
  const page = read('../pages/NewRecapPage.tsx');
  const completedStart = page.indexOf("job?.status === 'completed' && !job.expired");
  const completedBlock = page.slice(completedStart, page.indexOf("နောက်တစ်ပုဒ် ဖန်တီးမည်", completedStart));
  assert.match(completedBlock, /\{job\.videoUrl && \(/, 'Download button must be gated on the authoritative job.videoUrl');
  assert.doesNotMatch(completedBlock, /\{status\.mediaUrl && <button/, 'Download must not be coupled to the preview blob fetch outcome');
  assert.match(completedBlock, /onClick=\{\(\) => void status\.downloadVideo\(/);
  assert.match(completedBlock, /status\.downloadError && <div className="alert error"/);
});

test('a preview network failure clears the loading state and surfaces a compact Retry Preview action, not a blank player', () => {
  const hook = read('./useJobStatus.ts');
  const page = read('../pages/NewRecapPage.tsx');
  assert.match(hook, /setMediaError\(requestError instanceof Error\s*\?\s*requestError\.message\s*:\s*'ပြီးစီးသည့်ဗီဒီယိုကို ဖွင့်၍မရပါ။'\)/);
  assert.match(page, /status\.mediaError\s*\?\s*<div className="alert error" role="alert">\{status\.mediaError\} <button className="btn ghost" onClick=\{status\.setMediaRetry\}>/);
  // Download's own request must also always clear its loading flag via
  // finally, and must guard against firing a second concurrent request.
  const downloadFn = hook.slice(hook.indexOf('const downloadVideo ='), hook.indexOf('useEffect(() => {\n    if (job?.status !== \'completed\''));
  assert.match(downloadFn, /if \(!job\?\.videoUrl \|\| downloading\) return;/, 'must guard against duplicate concurrent download requests');
  assert.match(downloadFn, /finally \{[\s\S]*setDownloading\(false\);[\s\S]*\}/);
});

test('the preview effect guards against duplicate concurrent fetches via its own AbortController cleanup on every re-run', () => {
  const hook = read('./useJobStatus.ts');
  const previewEffect = hook.slice(hook.indexOf("useEffect(() => {\n    if (job?.status !== 'completed'"), hook.indexOf('return {\n    job, loading'));
  assert.match(previewEffect, /const controller = new AbortController\(\);/);
  assert.match(previewEffect, /return \(\) => \{\s*controller\.abort\(\);/, 'an in-flight preview fetch must be aborted before a new one starts, preventing duplicate requests');
  assert.match(previewEffect, /\}, \[job\?\.id, job\?\.status, job\?\.videoUrl, mediaRetry\]\);/);
});
