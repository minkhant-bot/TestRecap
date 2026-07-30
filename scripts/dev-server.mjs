import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { watchedBackendPaths } from './dev-watch-policy.mjs';

const projectRoot = process.cwd();
let child;
let restarting = false;
let shuttingDown = false;

const launch = () => {
  child = spawn(process.execPath, ['--env-file-if-exists=.env.local', 'server.js'], {
    cwd: projectRoot,
    stdio: 'inherit'
  });
  console.info(JSON.stringify({
    event: 'dev.child.started',
    watcherPid: process.pid,
    serverPid: child.pid
  }));
  child.once('exit', (code, signal) => {
    console.info(JSON.stringify({ event: 'dev.child.exit', serverPid: child.pid, code, signal }));
    if (shuttingDown) {
      process.exit(code ?? (signal ? 1 : 0));
    }
    if (!restarting) process.exitCode = code ?? (signal ? 1 : 0);
  });
};

const restart = trigger => {
  if (restarting) return;
  restarting = true;
  console.info(JSON.stringify({ event: 'dev.restart.trigger', path: trigger }));
  child.once('exit', () => {
    restarting = false;
    launch();
  });
  child.kill('SIGTERM');
};

launch();

for (const watchedPath of watchedBackendPaths(projectRoot)) {
  if (!fs.existsSync(watchedPath)) continue;
  const stat = fs.statSync(watchedPath);
  fs.watch(watchedPath, { recursive: stat.isDirectory() }, (eventType, filename) => {
    restart(path.relative(projectRoot, stat.isDirectory()
      ? path.join(watchedPath, String(filename || ''))
      : watchedPath));
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    shuttingDown = true;
    child?.kill(signal);
  });
}
