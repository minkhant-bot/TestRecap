import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// server.js self-executes startServer() on import and binds a real port, so
// it can't be exercised as a unit under node:test without spawning a full
// process (which would need production Firebase/DB config this repo's test
// environment doesn't provide). These assertions instead lock in the exact
// startup ordering as source structure, the same technique already used for
// this file by src/ui/workspace/mediaAccess.test.js.
const source = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');

test('required startup migrations run and are awaited before the HTTP port opens', () => {
  const migrationCallIndex = source.indexOf('await runStartupMigrations(');
  const listenIndex = source.indexOf('app.listen(port, host)');
  assert.notEqual(migrationCallIndex, -1, 'runStartupMigrations must be awaited in startServer()');
  assert.notEqual(listenIndex, -1);
  assert.ok(
    migrationCallIndex < listenIndex,
    'runStartupMigrations must run before app.listen -- traffic must never reach an unmigrated schema',
  );
});

test('a required migration failure throws before the port binds, and never closes a server that was never opened', () => {
  const startupBlock = source.slice(
    source.indexOf('await runStartupMigrations('),
    source.indexOf('const { port, host } = getServerBinding();'),
  );
  assert.match(
    startupBlock,
    /if \(databaseConfiguration\.required\) \{\s*await shutdownDatabase\(\);\s*throw error;\s*\}/,
    'a required-database migration failure must throw out of startServer() before app.listen is ever reached',
  );
  assert.doesNotMatch(
    startupBlock,
    /server\.close/,
    'the pre-listen migration failure path must never reference `server` -- it does not exist yet at this point',
  );
});

test('an optional-database migration failure does not throw -- startup continues and still opens the port', () => {
  const startupBlock = source.slice(
    source.indexOf('await runStartupMigrations('),
    source.indexOf('const { port, host } = getServerBinding();'),
  );
  const requiredBranch = startupBlock.slice(startupBlock.indexOf('if (databaseConfiguration.required)'));
  assert.doesNotMatch(
    requiredBranch,
    /\}\s*else\s*\{\s*throw/,
    'only the required branch may throw -- an optional/absent database must fall through to app.listen',
  );
});

test('workspace services (worker, admission reconciliation, cleanup sweep, billing recovery) start exactly once', () => {
  assert.match(source, /const startWorkspaceServices = \(\) => \{/, 'the definition must still exist');
  // Exactly one call site: `startWorkspaceServices();` after app.listen
  // succeeds. Any second call site would double-start the worker/admission
  // reconciliation/cleanup sweep on every boot.
  const callSites = [...source.matchAll(/^ {2}startWorkspaceServices\(\);$/gm)];
  assert.equal(callSites.length, 1, 'startWorkspaceServices must be invoked exactly once');
});

test('graceful shutdown (SIGTERM/SIGINT) is still wired to workspaceWorker.stop, server.close, and shutdownDatabase', () => {
  const shutdownBlock = source.slice(source.indexOf('const shutdown = async signal'), source.indexOf("process.once('SIGTERM'"));
  assert.match(shutdownBlock, /await workspaceWorker\.stop\(\);/);
  assert.match(shutdownBlock, /await new Promise\(resolve => server\.close\(resolve\)\);/);
  assert.match(shutdownBlock, /await shutdownDatabase\(\);/);
  assert.match(source, /process\.once\('SIGTERM', \(\) => void shutdown\('SIGTERM'\)\);/);
  assert.match(source, /process\.once\('SIGINT', \(\) => void shutdown\('SIGINT'\)\);/);
});

test('payment-proof temporary cleanup no longer gates or is gated by migrations, and keeps its own error handling', () => {
  const cleanupBlock = source.slice(
    source.indexOf('setImmediate(() => {'),
    source.indexOf('startWorkspaceServices();'),
  );
  assert.match(cleanupBlock, /paymentProofStorage\.cleanupTemporaryFiles\(\)/);
  assert.match(cleanupBlock, /payment_proof\.temporary_cleanup\.failed/);
  assert.doesNotMatch(cleanupBlock, /runStartupMigrations/, 'migrations must not run inside this deferred block anymore');
});
