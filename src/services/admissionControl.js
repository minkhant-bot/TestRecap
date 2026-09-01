import fs from 'fs';
import path from 'path';
import { getStoragePaths } from '../config/runtime.js';
import { getAdmissionConfiguration } from '../config/admission.js';

const SCHEMA_VERSION = 1;

function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    mutationEvents: {},
    processingStarts: {},
    processingFailures: {},
  };
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2));
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    const directoryDescriptor = fs.openSync(path.dirname(filePath), 'r');
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporaryPath); } catch {}
    throw error;
  }
}

function normalizeState(value) {
  if (!value || value.schemaVersion !== SCHEMA_VERSION) return emptyState();
  return {
    schemaVersion: SCHEMA_VERSION,
    mutationEvents:
      value.mutationEvents && typeof value.mutationEvents === 'object'
        ? value.mutationEvents
        : {},
    processingStarts:
      value.processingStarts && typeof value.processingStarts === 'object'
        ? value.processingStarts
        : {},
    // Added after SCHEMA_VERSION 1 shipped -- deliberately tolerated as a
    // missing/absent field on existing persisted state rather than forcing a
    // schema bump, which would otherwise wipe every already-recorded
    // mutationEvents/processingStarts entry via the emptyState() branch
    // above the moment an older file is first loaded.
    processingFailures:
      value.processingFailures && typeof value.processingFailures === 'object'
        ? value.processingFailures
        : {},
  };
}

export class JsonAdmissionStore {
  constructor(filePath) {
    this.filePath = filePath;
    try {
      this.state = normalizeState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = emptyState();
    }
  }

  transact(operation) {
    const previousState = structuredClone(this.state);
    try {
      const result = operation(this.state);
      if (result.changed) atomicWriteJson(this.filePath, this.state);
      return result.value;
    } catch (error) {
      this.state = previousState;
      throw error;
    }
  }
}

export class AdmissionLimitError extends Error {
  constructor({ code, limit, remaining, windowSeconds, retryAfterSeconds }) {
    super(code === 'PROCESSING_USAGE_LIMIT_EXCEEDED'
      ? 'Processing usage limit exceeded'
      : 'Request rate limit exceeded');
    this.name = 'AdmissionLimitError';
    this.code = code;
    this.limit = limit;
    this.remaining = remaining;
    this.windowSeconds = windowSeconds;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function assertUid(uid) {
  if (typeof uid !== 'string' || !uid.trim()) throw new Error('Admission requires a user ID');
}

export function createAdmissionService({
  store,
  config = getAdmissionConfiguration(),
  now = () => Date.now(),
}) {
  const mutationWindowSeconds = Math.ceil(config.mutationRateWindowMs / 1000);
  const processingWindowSeconds = Math.ceil(config.processingUsageWindowMs / 1000);

  function consumeMutation(uid, endpoint, at = now()) {
    assertUid(uid);
    return store.transact((state) => {
      const cutoff = at - config.mutationRateWindowMs;
      const events = (state.mutationEvents[uid] || []).filter((event) => event.at > cutoff);
      if (events.length >= config.mutationRateLimit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((events[0].at + config.mutationRateWindowMs - at) / 1000));
        throw new AdmissionLimitError({
          code: 'REQUEST_RATE_LIMIT_EXCEEDED',
          limit: config.mutationRateLimit,
          remaining: 0,
          windowSeconds: mutationWindowSeconds,
          retryAfterSeconds,
        });
      }
      events.push({ at, endpoint });
      state.mutationEvents[uid] = events;
      return {
        changed: true,
        value: {
          limit: config.mutationRateLimit,
          remaining: config.mutationRateLimit - events.length,
          windowSeconds: mutationWindowSeconds,
        },
      };
    });
  }

  // 'credited' = a paid 'pro' plan, or a ledger history containing a manual
  // grant or purchase (see getProcessingQuotaTier in billingFoundation.js).
  // Callers that never resolve a tier (or fail to) get 'trial', the more
  // restrictive ceiling -- this function must never fail open.
  function resolveProcessingLimit(tier) {
    return tier === 'credited' ? config.processingUsageLimitCredited : config.processingUsageLimit;
  }

  function consumeProcessingStart(uid, jobId, { at = now(), tier = 'trial' } = {}) {
    assertUid(uid);
    if (typeof jobId !== 'string' || !jobId) throw new Error('Admission requires a job ID');
    const limit = resolveProcessingLimit(tier);
    return store.transact((state) => {
      const starts = state.processingStarts[uid] || [];
      const existing = starts.find((entry) => entry.jobId === jobId);
      if (existing) {
        return { changed: false, value: { consumed: false, idempotent: true } };
      }
      const active = starts.filter((entry) => entry.at > at - config.processingUsageWindowMs);
      if (active.length >= limit) {
        const oldest = active.reduce((left, right) => left.at <= right.at ? left : right);
        throw new AdmissionLimitError({
          code: 'PROCESSING_USAGE_LIMIT_EXCEEDED',
          limit,
          remaining: 0,
          windowSeconds: processingWindowSeconds,
          retryAfterSeconds: Math.max(1, Math.ceil((oldest.at + config.processingUsageWindowMs - at) / 1000)),
        });
      }
      starts.push({ at, jobId });
      state.processingStarts[uid] = starts;
      return {
        changed: true,
        value: {
          consumed: true,
          idempotent: false,
          limit,
          remaining: limit - active.length - 1,
          windowSeconds: processingWindowSeconds,
        },
      };
    });
  }

  function releaseProcessingStart(uid, jobId) {
    assertUid(uid);
    return store.transact((state) => {
      const starts = state.processingStarts[uid] || [];
      const retained = starts.filter((entry) => entry.jobId !== jobId);
      if (retained.length === starts.length) return { changed: false, value: false };
      state.processingStarts[uid] = retained;
      return { changed: true, value: true };
    });
  }

  // Refunds a processing-usage slot after a job that was successfully
  // admitted (queued) later fails or is cancelled by the pipeline -- a
  // genuine system/pipeline failure must not permanently cost the user a
  // slot the same way a successful job does. Bounded per uid per rolling
  // window (processingFailureRefundLimit) so this cannot be exploited by
  // repeatedly submitting deliberately-broken uploads for unlimited free
  // retries: once the cap is reached in the window, further failures behave
  // like today and permanently consume their slot. Idempotent per jobId --
  // a job's failure is only ever refunded/recorded once, even if the
  // caller's failure/cancellation handling somehow runs twice for it.
  function refundProcessingStartOnFailure(uid, jobId, { at = now() } = {}) {
    assertUid(uid);
    if (typeof jobId !== 'string' || !jobId) throw new Error('Admission requires a job ID');
    return store.transact((state) => {
      const failures = state.processingFailures[uid] || [];
      if (failures.some((entry) => entry.jobId === jobId)) {
        return { changed: false, value: { refunded: false, idempotent: true } };
      }
      const cutoff = at - config.processingUsageWindowMs;
      const recentFailureCount = failures.filter((entry) => entry.at > cutoff).length;
      const withinCap = recentFailureCount < config.processingFailureRefundLimit;
      failures.push({ at, jobId, refunded: withinCap });
      state.processingFailures[uid] = failures;

      let released = false;
      if (withinCap) {
        const starts = state.processingStarts[uid] || [];
        const retained = starts.filter((entry) => entry.jobId !== jobId);
        if (retained.length !== starts.length) {
          state.processingStarts[uid] = retained;
          released = true;
        }
      }
      return {
        changed: true,
        value: {
          refunded: withinCap && released,
          capReached: !withinCap,
          failureCount: recentFailureCount + 1,
          failureRefundLimit: config.processingFailureRefundLimit,
        },
      };
    });
  }

  function getSnapshot(uid, at = now()) {
    assertUid(uid);
    return store.transact((state) => {
      const mutationCutoff = at - config.mutationRateWindowMs;
      const processingCutoff = at - config.processingUsageWindowMs;
      const mutations = (state.mutationEvents[uid] || []).filter((entry) => entry.at > mutationCutoff);
      const starts = (state.processingStarts[uid] || []).filter((entry) => entry.at > processingCutoff);
      return {
        changed: mutations.length !== (state.mutationEvents[uid] || []).length,
        value: {
          mutation: { used: mutations.length, limit: config.mutationRateLimit },
          processing: { used: starts.length, limit: config.processingUsageLimit },
        },
      };
    });
  }

  function prune(at = now()) {
    return store.transact((state) => {
      const cutoff = at - config.mutationRateWindowMs;
      let changed = false;
      for (const [uid, events] of Object.entries(state.mutationEvents)) {
        const retained = events.filter((entry) => entry.at > cutoff);
        if (retained.length !== events.length) {
          state.mutationEvents[uid] = retained;
          changed = true;
        }
      }
      return { changed, value: changed };
    });
  }

  function reconcileProcessingStarts(records, at = now()) {
    return store.transact((state) => {
      let added = 0;
      for (const record of records) {
        const timestamp = new Date(record.queuedAt || record.createdAt).getTime();
        if (!record.ownerUid || !record.id || !Number.isFinite(timestamp)
          || timestamp <= at - config.processingUsageWindowMs) continue;
        const starts = state.processingStarts[record.ownerUid] || [];
        if (starts.some(entry => entry.jobId === record.id)) continue;
        starts.push({ at: timestamp, jobId: record.id });
        state.processingStarts[record.ownerUid] = starts;
        added += 1;
      }
      return { changed: added > 0, value: added };
    });
  }

  function withProcessingAdmission(uid, jobId, operation, options = {}) {
    const reservation = consumeProcessingStart(uid, jobId, options);
    try {
      return operation(reservation);
    } catch (error) {
      if (reservation.consumed) releaseProcessingStart(uid, jobId);
      throw error;
    }
  }

  return {
    consumeMutation,
    consumeProcessingStart,
    releaseProcessingStart,
    refundProcessingStartOnFailure,
    getSnapshot,
    prune,
    reconcileProcessingStarts,
    withProcessingAdmission,
  };
}

export function sendAdmissionError(res, error, requestId) {
  if (!(error instanceof AdmissionLimitError)) return false;
  res.set('Retry-After', String(error.retryAfterSeconds));
  res.status(429).json({
    error: error.message,
    code: error.code,
    limit: error.limit,
    remaining: error.remaining,
    windowSeconds: error.windowSeconds,
    retryAfterSeconds: error.retryAfterSeconds,
    requestId: requestId || null,
  });
  return true;
}

export function createMutationAdmissionMiddleware(service, endpoint) {
  return (req, res, next) => {
    try {
      service.consumeMutation(req.user.uid, endpoint);
      next();
    } catch (error) {
      if (!sendAdmissionError(res, error, req.requestId)) next(error);
    }
  };
}

const admissionConfig = getAdmissionConfiguration();
const admissionStorePath = process.env.ADMISSION_STORE_PATH ||
  path.join(getStoragePaths().settings, 'admission-state.json');
export const admissionService = createAdmissionService({
  store: new JsonAdmissionStore(admissionStorePath),
  config: admissionConfig,
});
