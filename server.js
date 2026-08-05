
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
import { reconcileStrandedLiveJobs } from './src/services/liveJobRecovery.js';
import { admissionService } from './src/services/admissionControl.js';
import { listWorkspaceJobsForAdmission } from './src/services/workspaceJobs.js';
import { getDatabaseConfiguration, getRedactedDatabaseConfiguration } from './src/config/database.js';
import { shutdownDatabase } from './src/db/client.js';
import { paymentProofStorage } from './src/services/paymentProofStorage.js';
import { runStartupMigrations } from './src/services/startupDatabase.js';

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
  // 24-hour completed-job retention: the record is kept (status stays
  // 'complete') but the file is already gone once expired, so this must be
  // checked and reported distinctly rather than attempting sendFile and
  // surfacing a raw filesystem error.
  if (job.expired) {
    return res.status(410).json({ error: 'This recap has expired.', code: 'JOB_EXPIRED' });
  }
  return res.sendFile(path.join(storagePaths.output, req.params.filename));
});

// Setup API routes
app.use('/api', apiRoutes);

async function startServer() {
  // Validate required configuration before accepting traffic. Dependency
  // reachability is reported separately by /api/ready.
  const databaseConfiguration = getDatabaseConfiguration();
  console.info(JSON.stringify({ event: 'server.starting', pid: process.pid }));
  console.info(JSON.stringify({
    event: 'database.configuration',
    ...getRedactedDatabaseConfiguration(databaseConfiguration)
  }));
  console.log(formatFasterWhisperStartupConfig(getFasterWhisperRuntimeConfig()));
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
  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, host);
    const onError = error => {
      listener.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      listener.off('error', onError);
      resolve(listener);
    };
    listener.once('listening', onListening);
    listener.once('error', onError);
  });
  console.log(`Server running on http://${host}:${port} (pid ${process.pid})`);

  const startWorkspaceServices = () => {
    try {
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
      // Reconciles any live-billing job left stranded (reserved/settled)
      // by a prior crash. No-ops when P2_LIVE_JOB_BILLING_ENABLED is off
      // (the default) or when PostgreSQL is unavailable/optional; never
      // blocks startup or the workspace worker.
      void reconcileStrandedLiveJobs()
        .then(result => {
          if (result.enabled && (result.reconciled > 0 || result.total > 0)) {
            console.info(JSON.stringify({
              event: 'billing.startup_reconciliation.complete',
              ...result,
            }));
          }
        })
        .catch(error => console.error(JSON.stringify({
          event: 'billing.startup_reconciliation.failed',
          message: error?.message || String(error),
        })));
    } catch (error) {
      console.error(JSON.stringify({
        event: 'workspace.background_start.failed',
        message: error?.message || String(error),
      }));
    }
    try {
      startCleanupSweep();
    } catch (error) {
      console.error(JSON.stringify({
        event: 'cleanup.background_start.failed',
        message: error?.message || String(error),
      }));
    }
  };

  // Liveness is available before migrations and operational background work.
  // Required migration failures stop the process; optional PostgreSQL cannot
  // take down the existing file-backed Core AI service.
  setImmediate(() => {
    void paymentProofStorage.cleanupTemporaryFiles()
      .then(removedTemporaryProofs => {
        if (removedTemporaryProofs.length) {
          console.info(JSON.stringify({
            event: 'payment_proof.temporary_cleanup',
            removedCount: removedTemporaryProofs.length,
          }));
        }
      })
      .catch(error => console.error(JSON.stringify({
        event: 'payment_proof.temporary_cleanup.failed',
        message: error?.message || String(error),
      })));

    void runStartupMigrations({ configuration: databaseConfiguration })
      .then(result => {
        console.info(JSON.stringify({
          event: 'database.startup_migrations.complete',
          attempted: result.attempted,
          applied: result.applied,
          reason: result.reason,
        }));
        startWorkspaceServices();
      })
      .catch(async error => {
        console.error(JSON.stringify({
          event: 'database.startup_migrations.failed',
          required: databaseConfiguration.required,
          message: error?.message || String(error),
        }));
        if (!databaseConfiguration.required) {
          startWorkspaceServices();
          return;
        }
        await new Promise(resolve => server.close(resolve));
        await shutdownDatabase();
        process.exitCode = 1;
      });
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
