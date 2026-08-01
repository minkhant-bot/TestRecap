import express from 'express';
import { getApplicationReadiness } from '../services/databaseReadiness.js';

export const createHealthRouter = ({ readinessCheck = getApplicationReadiness } = {}) => {
  const router = express.Router();

  // Railway uses this as a liveness probe. Reaching this handler proves that
  // the HTTP process is accepting requests; background initialization is not
  // part of that contract.
  router.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Dependency-aware readiness remains available for operators and tooling.
  router.get('/ready', async (req, res) => {
    const readiness = await readinessCheck();
    res.status(readiness.httpStatus).json(readiness.body);
  });

  return router;
};

export default createHealthRouter();
