import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRestartForPath } from './dev-watch-policy.mjs';

test('runtime data and build writes never restart the backend watcher', () => {
  for (const runtimePath of [
    'src/tmp/upload.mp4',
    'data/workspace-jobs.json',
    'data/app.sqlite',
    'data/cache/job/state.json',
    'public/output/job.mp4',
    'logs/server.log',
    'dist/assets/app.js'
  ]) {
    assert.equal(shouldRestartForPath(runtimePath, '/app'), false, runtimePath);
  }
});

test('backend source and config writes restart the backend watcher', () => {
  for (const sourcePath of [
    'server.js',
    'src/routes/workspace.js',
    'src/services/workspaceWorker.js',
    'src/config/runtime.js'
  ]) {
    assert.equal(shouldRestartForPath(sourcePath, '/app'), true, sourcePath);
  }
});
