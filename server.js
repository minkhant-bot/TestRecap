
import express from 'express';
import cors from 'cors';
import path from 'path';
import apiRoutes from './src/routes/api.js';

import { initModels } from './src/ai/index.js';
import { recoverStuckJobs } from './src/services/jobManager.js';
import { startCleanupSweep } from './src/services/cleanup.js';
import { ensureStoragePaths, getServerBinding, getStoragePaths } from './src/config/runtime.js';
import { formatFasterWhisperStartupConfig, getFasterWhisperRuntimeConfig } from './src/ai/fasterWhisper.js';

const app = express();
const storagePaths = ensureStoragePaths(getStoragePaths());
app.use(cors());
app.use(express.json());

// Serve outputs
app.use('/output', express.static(storagePaths.output));

// Setup API routes
app.use('/api', apiRoutes);

async function startServer() {
  console.log(formatFasterWhisperStartupConfig(getFasterWhisperRuntimeConfig()));
  recoverStuckJobs();
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
    console.log(`Server running on http://${host}:${port}`);
  });
  const shutdown = signal => {
    console.log(`Received ${signal}; shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch(console.error);
