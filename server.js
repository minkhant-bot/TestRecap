
import express from 'express';
import cors from 'cors';
import path from 'path';
import apiRoutes from './src/routes/api.js';

import { initModels } from './src/ai/index.js';
import { listJobs, recoverStuckJobs } from './src/services/jobManager.js';
import { getJob } from './src/services/jobManager.js';
import { startCleanupSweep } from './src/services/cleanup.js';
import { restoreQueuedJobs } from './src/services/queue.js';
import { ensureStoragePaths, getServerBinding, getStoragePaths } from './src/config/runtime.js';
import { formatFasterWhisperStartupConfig, getFasterWhisperRuntimeConfig } from './src/ai/fasterWhisper.js';
import { canAccessJob, requireAuth } from './src/middleware/auth.js';
import { workspaceWorker } from './src/services/workspaceWorker.js';
import { admissionService } from './src/services/admissionControl.js';
import { listWorkspaceJobsForAdmission } from './src/services/workspaceJobs.js';
import { getDatabaseConfiguration, getRedactedDatabaseConfiguration } from './src/config/database.js';
import { shutdownDatabase } from './src/db/client.js';

const app = express();
const storagePaths = ensureStoragePaths(getStoragePaths());
let requestSequence = 0;
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] ||
    `${process.pid}-${Date.now()}-${++requestSequence}`;
  res.setHeader('X-Request-Id', req.requestId);
  const startedAt = Date.now();
  console.info(JSON.stringify({
    event: 'http.request.started',
    requestId: req.requestId,
    method: req.method,
    url: req.originalUrl,
    pid: process.pid
  }));
  res.once('finish', () => console.info(JSON.stringify({
    event: 'http.request.finished',
    requestId: req.requestId,
    status: res.statusCode,
    durationMs: Date.now() - startedAt
  })));
  next();
});
app.use(cors());
app.use(express.json());

// Generated media is private and requires the same owner/admin authorization as its job.
app.get('/output/:filename', requireAuth, (req, res) => {
  const match = String(req.params.filename).match(/^([0-9a-f-]{36})\.(mp4|mp3)$/i);
  if (!match) return res.status(404).end();
  const job = getJob(match[1]);
  if (!canAccessJob(req.user, job) || job.status !== 'complete') {
    return res.status(job ? 403 : 404).end();
  }
  return res.sendFile(path.join(storagePaths.output, req.params.filename));
});

// Setup API routes
app.use('/api', apiRoutes);

async function startServer() {
  const databaseConfiguration = getDatabaseConfiguration();
  console.info(JSON.stringify({ event: 'server.starting', pid: process.pid }));
  console.info(JSON.stringify({
    event: 'database.configuration',
    ...getRedactedDatabaseConfiguration(databaseConfiguration)
  }));
  console.log(formatFasterWhisperStartupConfig(getFasterWhisperRuntimeConfig()));
  recoverStuckJobs();
  restoreQueuedJobs();
  admissionService.reconcileProcessingStarts([
    ...listJobs().map(job => ({
      id: job.id,
      ownerUid: job.ownerUid,
      createdAt: job.created_at,
      queuedAt: job.queuedAt
    })),
    ...listWorkspaceJobsForAdmission()
  ]);
  admissionService.prune();
  workspaceWorker.start();
  startCleanupSweep();
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get(/^(?!\/(api|output)).*$/, (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const { port, host } = getServerBinding();
  const server = app.listen(port, host, () => {
    console.log(`Server running on http://${host}:${port} (pid ${process.pid})`);
  });
  let shuttingDown = false;
  const shutdown = async signal => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down.`);
    const forcedExit = setTimeout(() => process.exit(1), 10000);
    forcedExit.unref();
    await workspaceWorker.stop();
    await new Promise(resolve => server.close(resolve));
    await shutdownDatabase();
    clearTimeout(forcedExit);
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

process.on('uncaughtException', error => {
  console.error(JSON.stringify({
    event: 'process.uncaughtException',
    pid: process.pid,
    message: error?.message,
    stack: error?.stack
  }));
  process.exitCode = 1;
});
process.on('unhandledRejection', reason => {
  console.error(JSON.stringify({
    event: 'process.unhandledRejection',
    pid: process.pid,
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : null
  }));
});
process.on('exit', code => {
  console.info(JSON.stringify({ event: 'process.exit', pid: process.pid, code }));
});

startServer().catch(error => {
  console.error(JSON.stringify({
    event: 'server.start.failed',
    pid: process.pid,
    message: error?.message,
    stack: error?.stack
  }));
  process.exitCode = 1;
});
