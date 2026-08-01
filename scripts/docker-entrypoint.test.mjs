import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entrypointPath = path.join(projectRoot, 'scripts', 'docker-entrypoint.sh');
const dockerfilePath = path.join(projectRoot, 'Dockerfile');

test('container entrypoint prepares the mounted DATA_DIR and starts the app command', {
  skip: typeof process.getuid === 'function' && process.getuid() !== 0
    ? 'ownership handoff requires root, as it does in the production container'
    : false,
}, async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'testrecap-entrypoint-'));

  try {
    const dataDir = path.join(fixtureRoot, 'data');
    const fakeBinDir = path.join(fixtureRoot, 'bin');
    const fakeGosuPath = path.join(fakeBinDir, 'gosu');
    const markerPath = path.join(dataDir, 'uploads', 'started.txt');
    const persistedPath = path.join(dataDir, 'workspace-jobs.json');

    await mkdir(dataDir);
    await writeFile(persistedPath, '{"preserved":true}\n');
    await chmod(dataDir, 0o555);
    await mkdir(fakeBinDir);
    await writeFile(fakeGosuPath, '#!/bin/sh\nshift\nexec "$@"\n', { mode: 0o755 });

    const result = spawnSync(
      'sh',
      [entrypointPath, process.execPath, '-e', `require('fs').mkdirSync(${JSON.stringify(path.dirname(markerPath))}); require('fs').writeFileSync(${JSON.stringify(markerPath)}, 'ok')`],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          APP_USER: 'root',
          DATA_DIR: dataDir,
          PATH: `${fakeBinDir}:${process.env.PATH}`,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(markerPath, 'utf8'), 'ok');
    assert.equal(await readFile(persistedPath, 'utf8'), '{"preserved":true}\n');
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('container entrypoint rejects unsafe DATA_DIR values without starting the app', () => {
  for (const dataDir of ['relative-data', '/']) {
    const result = spawnSync('sh', [entrypointPath, 'true'], {
      encoding: 'utf8',
      env: { ...process.env, APP_USER: 'root', DATA_DIR: dataDir },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Fatal:/);
  }
});

test('production image prepares the volume as root and drops privileges through gosu', async () => {
  const dockerfile = await readFile(dockerfilePath, 'utf8');

  assert.match(dockerfile, /apt-get install[^\n]*\bgosu\b/);
  assert.match(dockerfile, /ENTRYPOINT \["\/app\/scripts\/docker-entrypoint\.sh"\]/);
  assert.doesNotMatch(dockerfile, /^USER node$/m);
  assert.match(await readFile(entrypointPath, 'utf8'), /exec gosu "\$app_user" "\$@"/);
});
