import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import express from 'express';
import { requireAuth, setAuthVerifierForTests } from '../middleware/auth.js';
import { VIDEO_TOO_LONG_MESSAGE } from '../config/upload.js';

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testrecap-workspace-route-'));
process.env.DATA_DIR = temporaryRoot;
process.env.MAX_UPLOAD_SIZE_MB = '0.001';
process.env.WORKSPACE_JOB_STORE_PATH = path.join(temporaryRoot, 'workspace-jobs.json');
// All authorized users process through this single server-managed key --
// there is no personal-key UI or fallback left in the route handlers.
process.env.GEMINI_API_KEY = 'server-managed-test-key';

const { createWorkspaceRouter } = await import('./workspace.js');
const {
    createJob: createProcessingJob,
    deleteJob: deleteProcessingJob,
    getJob: getProcessingJob,
    getJobKeys: getProcessingJobKeys,
    listJobs: listProcessingJobs,
    updateJob: updateProcessingJob
} = await import('../services/jobManager.js');
const {
    createWorkspaceJob,
    getWorkspaceJobInternal,
    listWorkspaceJobsForAdmission,
    updateWorkspaceJobInternal
} = await import('../services/workspaceJobs.js');

const owner = {
    uid: 'workspace-owner',
    email: 'owner@example.com',
    displayName: 'Workspace Owner',
    role: 'user',
    status: 'active'
};
let authenticatedUser = owner;
let serverGeminiKeyValid = true;
setAuthVerifierForTests(async () => authenticatedUser);

const app = express();
app.use(express.json());
app.use('/api/workspace', requireAuth, createWorkspaceRouter({
    verifyKey: async () => ({ valid: serverGeminiKeyValid }),
    readSourceDuration: async () => 123.45
}));
const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
});
const baseUrl = `http://127.0.0.1:${server.address().port}/api/workspace`;
const authenticated = { Cookie: '__session=workspace-session' };

after(async () => {
    setAuthVerifierForTests(null);
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

test('workspace endpoints require a backend session', async () => {
    const response = await fetch(`${baseUrl}/jobs`);
    assert.equal(response.status, 401);
});

test('configuration exposes the configured limit and supported formats', async () => {
    const response = await fetch(`${baseUrl}/config`, { headers: authenticated });
    assert.equal(response.status, 200);
    const config = await response.json();
    assert.equal(config.configured, true);
    assert.equal(config.maxUploadSizeMb, 0.001);
    assert.equal(config.maxUploadSizeBytes, Math.floor(0.001 * 1024 * 1024));
    assert.equal(config.maxSourceDurationSeconds, 900);
    assert.deepEqual(config.supportedExtensions, ['mp4', 'mkv', 'mov', 'avi', 'webm']);
});

test('authoritative upload duration accepts 14:59 and 15:00 but rejects 15:01', async () => {
    for (const duration of [899, 900]) {
        authenticatedUser = { ...owner, uid: `duration-${duration}` };
        const durationApp = express();
        durationApp.use(express.json());
        durationApp.use('/api/workspace', requireAuth, createWorkspaceRouter({
            verifyKey: async () => ({ valid: true }),
            readSourceDuration: async () => duration
        }));
        const durationServer = await new Promise(resolve => {
            const listener = durationApp.listen(0, '127.0.0.1', () => resolve(listener));
        });
        try {
            const body = new FormData();
            body.append('video', new Blob([Buffer.alloc(512)], { type: 'video/mp4' }), `${duration}.mp4`);
            body.append('duration', '999999');
            const response = await fetch(
                `http://127.0.0.1:${durationServer.address().port}/api/workspace/jobs`,
                { method: 'POST', headers: authenticated, body }
            );
            assert.equal(response.status, 201);
            assert.equal((await response.json()).duration, duration);
        } finally {
            await new Promise(resolve => durationServer.close(resolve));
        }
    }

    authenticatedUser = { ...owner, uid: 'duration-901' };
    let reserveCalls = 0;
    const rejectedApp = express();
    rejectedApp.use(express.json());
    rejectedApp.use('/api/workspace', requireAuth, createWorkspaceRouter({
        verifyKey: async () => ({ valid: true }),
        liveBillingEnabled: () => true,
        readSourceDuration: async () => 901,
        reserveBilling: async () => { reserveCalls += 1; }
    }));
    const rejectedServer = await new Promise(resolve => {
        const listener = rejectedApp.listen(0, '127.0.0.1', () => resolve(listener));
    });
    try {
        const body = new FormData();
        body.append('video', new Blob([Buffer.alloc(512)], { type: 'video/mp4' }), 'too-long.mp4');
        body.append('duration', '1');
        const response = await fetch(
            `http://127.0.0.1:${rejectedServer.address().port}/api/workspace/jobs`,
            { method: 'POST', headers: authenticated, body }
        );
        assert.equal(response.status, 422);
        assert.deepEqual(await response.json(), {
            error: VIDEO_TOO_LONG_MESSAGE,
            code: 'SOURCE_VIDEO_TOO_LONG'
        });
        assert.equal(reserveCalls, 0);
        const jobs = await fetch(
            `http://127.0.0.1:${rejectedServer.address().port}/api/workspace/jobs`,
            { headers: authenticated }
        );
        assert.deepEqual(await jobs.json(), []);
    } finally {
        await new Promise(resolve => rejectedServer.close(resolve));
        authenticatedUser = owner;
    }
});

test('queue rechecks authoritative duration before queueing or reserving credits', async () => {
    authenticatedUser = { ...owner, uid: 'queue-duration-owner' };
    let probedDuration = 900;
    let reserveCalls = 0;
    const durationApp = express();
    durationApp.use(express.json());
    durationApp.use('/api/workspace', requireAuth, createWorkspaceRouter({
        verifyKey: async () => ({ valid: true }),
        liveBillingEnabled: () => true,
        readSourceDuration: async () => probedDuration,
        reserveBilling: async () => { reserveCalls += 1; }
    }));
    const durationServer = await new Promise(resolve => {
        const listener = durationApp.listen(0, '127.0.0.1', () => resolve(listener));
    });
    try {
        const body = new FormData();
        body.append('video', new Blob([Buffer.alloc(512)], { type: 'video/mp4' }), 'boundary.mp4');
        const uploaded = await fetch(
            `http://127.0.0.1:${durationServer.address().port}/api/workspace/jobs`,
            { method: 'POST', headers: authenticated, body }
        );
        assert.equal(uploaded.status, 201);
        const job = await uploaded.json();

        probedDuration = 901;
        const queued = await fetch(
            `http://127.0.0.1:${durationServer.address().port}/api/workspace/jobs/${job.id}/queue`,
            {
                method: 'POST',
                headers: { ...authenticated, 'Content-Type': 'application/json' },
                body: JSON.stringify({ billingMode: 'blink_funded', planCode: 'pro' })
            }
        );
        assert.equal(queued.status, 422);
        assert.deepEqual(await queued.json(), {
            error: VIDEO_TOO_LONG_MESSAGE,
            code: 'SOURCE_VIDEO_TOO_LONG'
        });
        assert.equal(reserveCalls, 0);
        assert.equal(getWorkspaceJobInternal(job.id).status, 'pending');
    } finally {
        await new Promise(resolve => durationServer.close(resolve));
        authenticatedUser = owner;
    }
});

test('unsupported and oversized files are rejected without creating jobs', async () => {
    const invalid = new FormData();
    invalid.append('video', new Blob(['not video'], { type: 'text/plain' }), 'notes.txt');
    const unsupported = await fetch(`${baseUrl}/jobs`, {
        method: 'POST',
        headers: authenticated,
        body: invalid
    });
    assert.equal(unsupported.status, 415);

    const large = new FormData();
    large.append('video', new Blob([Buffer.alloc(2048)], { type: 'video/mp4' }), 'large.mp4');
    const oversized = await fetch(`${baseUrl}/jobs`, {
        method: 'POST',
        headers: authenticated,
        body: large
    });
    assert.equal(oversized.status, 413);

    const jobs = await fetch(`${baseUrl}/jobs`, { headers: authenticated });
    assert.deepEqual(await jobs.json(), []);
});

test('an invalid server-managed Gemini key blocks job creation with a service configuration error, not a user-facing key prompt', async () => {
    serverGeminiKeyValid = false;
    const body = new FormData();
    body.append('video', new Blob([Buffer.alloc(512)], { type: 'video/mp4' }), 'movie.mp4');
    const uploaded = await fetch(`${baseUrl}/jobs`, {
        method: 'POST',
        headers: authenticated,
        body
    });
    assert.equal(uploaded.status, 500);
    const payload = await uploaded.json();
    assert.equal(payload.code, 'GEMINI_KEY_INVALID');
    assert.doesNotMatch(payload.error, /enter|provide|your.*key/i);
    const history = await fetch(`${baseUrl}/jobs`, { headers: authenticated });
    assert.deepEqual(await history.json(), []);
    serverGeminiKeyValid = true;
});

test('no personal Gemini API key surface remains reachable', async () => {
    for (const request of [
        () => fetch(`${baseUrl}/gemini-key`, { headers: authenticated }),
        () => fetch(`${baseUrl}/gemini-key`, {
            method: 'PUT', headers: { ...authenticated, 'Content-Type': 'application/json' },
            body: JSON.stringify({ geminiApiKey: 'anything' })
        }),
        () => fetch(`${baseUrl}/gemini-key`, { method: 'DELETE', headers: authenticated }),
        () => fetch(`${baseUrl}/gemini-key/verify`, {
            method: 'POST', headers: { ...authenticated, 'Content-Type': 'application/json' },
            body: JSON.stringify({ geminiApiKey: 'anything' })
        }),
    ]) {
        assert.equal((await request()).status, 404);
    }
});

test('normal users and Owner/Super Admin both process through the server-managed key, with no personal key required or accepted', async () => {
    for (const identity of [
        { ...owner, uid: `normal-${randomUUID()}`, role: 'user' },
        { ...owner, uid: `owner-${randomUUID()}`, role: 'super_admin' },
    ]) {
        authenticatedUser = identity;
        const body = new FormData();
        body.append('video', new Blob([Buffer.alloc(512)], { type: 'video/mp4' }), `${identity.role}.mp4`);
        const uploaded = await fetch(`${baseUrl}/jobs`, {
            method: 'POST', headers: authenticated, body
        });
        assert.equal(uploaded.status, 201, `${identity.role} upload must succeed via the server-managed key alone`);
        const job = await uploaded.json();
        const queued = await fetch(`${baseUrl}/jobs/${job.id}/queue`, {
            method: 'POST',
            headers: { ...authenticated, 'Content-Type': 'application/json' },
            body: JSON.stringify({ effects: {} })
        });
        assert.equal(queued.status, 202, `${identity.role} queueing must succeed via the server-managed key alone`);
        await fetch(`${baseUrl}/jobs/${job.id}/cancel`, { method: 'POST', headers: authenticated });
        await fetch(`${baseUrl}/jobs/${job.id}`, { method: 'DELETE', headers: authenticated });
    }
    authenticatedUser = owner;
});

test('queueing under live billing never demands a BYOK key, even though the client never sends billingMode', async () => {
    authenticatedUser = { ...owner, uid: `live-blink-funded-${randomUUID()}` };
    let reserveArgs = null;
    const liveApp = express();
    liveApp.use(express.json());
    liveApp.use('/api/workspace', requireAuth, createWorkspaceRouter({
        verifyKey: async () => ({ valid: true }),
        liveBillingEnabled: () => true,
        readSourceDuration: async () => 12,
        reserveBilling: async args => {
            reserveArgs = args;
            return {
                snapshot: {
                    planCode: 'trial', billingMode: 'blink_funded',
                    billingBlocks: '1', totalCredits: '1', billingStatus: 'reserved'
                }
            };
        },
        releaseBilling: async () => ({ billingStatus: 'released' })
    }));
    const liveServer = await new Promise(resolve => {
        const listener = liveApp.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const liveUrl = `http://127.0.0.1:${liveServer.address().port}/api/workspace`;
    try {
        const body = new FormData();
        body.append('video', new Blob([Buffer.alloc(512)], { type: 'video/mp4' }), 'no-billing-mode.mp4');
        const uploaded = await fetch(`${liveUrl}/jobs`, { method: 'POST', headers: authenticated, body });
        assert.equal(uploaded.status, 201);
        const job = await uploaded.json();

        // The real frontend never sends billingMode/planCode on queue (see
        // src/ui/workspace/api.ts's queueWorkspaceJob) -- this reproduces the
        // exact production request shape that used to return "A verified BYOK
        // Gemini key is required." even though no plan has ever supported BYOK
        // since the Trial/Pro simplification.
        const queued = await fetch(`${liveUrl}/jobs/${job.id}/queue`, {
            method: 'POST',
            headers: { ...authenticated, 'Content-Type': 'application/json', 'Idempotency-Key': 'no-billing-mode-1' },
            body: JSON.stringify({ effects: {} })
        });
        assert.equal(queued.status, 202);
        assert.doesNotMatch(JSON.stringify(await queued.json()), /byok|BYOK/i);
        assert.equal(reserveArgs.requestedMode, 'blink_funded');
        await fetch(`${liveUrl}/jobs/${job.id}/cancel`, { method: 'POST', headers: authenticated });
        await fetch(`${liveUrl}/jobs/${job.id}`, { method: 'DELETE', headers: authenticated });
    } finally {
        await new Promise(resolve => liveServer.close(resolve));
        authenticatedUser = owner;
    }
});

test('a missing Idempotency-Key still returns the existing validation error, and a duplicate submission with the reused key creates only one reservation', async () => {
    authenticatedUser = { ...owner, uid: `live-duplicate-${randomUUID()}` };
    const reservedKeysByJob = new Map();
    let reservationCount = 0;
    let releaseCount = 0;
    const liveApp = express();
    liveApp.use(express.json());
    liveApp.use('/api/workspace', requireAuth, createWorkspaceRouter({
        verifyKey: async () => ({ valid: true }),
        liveBillingEnabled: () => true,
        readSourceDuration: async () => 12,
        // Mirrors reserveLiveJob's real idempotency contract (see
        // liveJobBilling.js): the same jobId+key pair replays the existing
        // reservation instead of creating a new one; a missing key is
        // rejected before any reservation is made.
        reserveBilling: async ({ jobId, idempotencyKey }) => {
            const key = String(idempotencyKey || '').trim();
            if (!key) {
                const error = new Error('Idempotency-Key is required.');
                error.name = 'BillingError';
                error.code = 'IDEMPOTENCY_KEY_REQUIRED';
                error.status = 400;
                throw error;
            }
            const existingKey = reservedKeysByJob.get(jobId);
            if (existingKey === key) {
                return { snapshot: { billingStatus: 'reserved' }, replayed: true };
            }
            reservationCount += 1;
            reservedKeysByJob.set(jobId, key);
            return { snapshot: { billingStatus: 'reserved' }, replayed: false };
        },
        releaseBilling: async () => { releaseCount += 1; return { billingStatus: 'released' }; }
    }));
    const liveServer = await new Promise(resolve => {
        const listener = liveApp.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const liveUrl = `http://127.0.0.1:${liveServer.address().port}/api/workspace`;
    try {
        const body = new FormData();
        body.append('video', new Blob([Buffer.alloc(512)], { type: 'video/mp4' }), 'duplicate.mp4');
        const uploaded = await fetch(`${liveUrl}/jobs`, { method: 'POST', headers: authenticated, body });
        assert.equal(uploaded.status, 201);
        const job = await uploaded.json();

        const missingKey = await fetch(`${liveUrl}/jobs/${job.id}/queue`, {
            method: 'POST',
            headers: { ...authenticated, 'Content-Type': 'application/json' },
            body: JSON.stringify({ effects: {} })
        });
        assert.equal(missingKey.status, 400);
        assert.equal((await missingKey.json()).code, 'IDEMPOTENCY_KEY_REQUIRED');
        assert.equal(reservationCount, 0);

        const first = await fetch(`${liveUrl}/jobs/${job.id}/queue`, {
            method: 'POST',
            headers: { ...authenticated, 'Content-Type': 'application/json', 'Idempotency-Key': 'attempt-key-1' },
            body: JSON.stringify({ effects: {} })
        });
        assert.equal(first.status, 202);
        assert.equal(reservationCount, 1);

        // A duplicate submission reusing the same attempt's key (as the
        // frontend now does on a retried Start Recap click) must not create
        // a second reservation, and must not release the first, valid one
        // just because the job is already queued.
        const duplicate = await fetch(`${liveUrl}/jobs/${job.id}/queue`, {
            method: 'POST',
            headers: { ...authenticated, 'Content-Type': 'application/json', 'Idempotency-Key': 'attempt-key-1' },
            body: JSON.stringify({ effects: {} })
        });
        assert.equal(duplicate.status, 409);
        assert.equal(reservationCount, 1);
        assert.equal(releaseCount, 0);

        await fetch(`${liveUrl}/jobs/${job.id}/cancel`, { method: 'POST', headers: authenticated });
        await fetch(`${liveUrl}/jobs/${job.id}`, { method: 'DELETE', headers: authenticated });
    } finally {
        await new Promise(resolve => liveServer.close(resolve));
        authenticatedUser = owner;
    }
});

test('a missing server-managed Gemini key blocks job creation, queueing, and retry with a 503 service configuration error', async () => {
    const unconfiguredOwner = { ...owner, uid: `unconfigured-${randomUUID()}` };
    authenticatedUser = unconfiguredOwner;
    let configuredKey = 'server-managed-test-key';
    const unconfiguredApp = express();
    unconfiguredApp.use(express.json());
    unconfiguredApp.use('/api/workspace', requireAuth, createWorkspaceRouter({
        verifyKey: async () => ({ valid: true }),
        readSourceDuration: async () => 10,
        resolveServerGeminiKey: () => configuredKey
    }));
    const unconfiguredServer = await new Promise(resolve => {
        const listener = unconfiguredApp.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const unconfiguredUrl = `http://127.0.0.1:${unconfiguredServer.address().port}/api/workspace`;
    try {
        configuredKey = '';
        const blockedUpload = await fetch(`${unconfiguredUrl}/jobs`, {
            method: 'POST', headers: authenticated,
            body: (() => {
                const body = new FormData();
                body.append('video', new Blob([Buffer.alloc(512)], { type: 'video/mp4' }), 'unconfigured.mp4');
                return body;
            })()
        });
        assert.equal(blockedUpload.status, 503);
        assert.equal((await blockedUpload.json()).code, 'GEMINI_KEY_NOT_CONFIGURED');
        assert.deepEqual(
            await (await fetch(`${unconfiguredUrl}/jobs`, { headers: authenticated })).json(), []
        );

        configuredKey = 'server-managed-test-key';
        const uploaded = await fetch(`${unconfiguredUrl}/jobs`, {
            method: 'POST', headers: authenticated,
            body: (() => {
                const body = new FormData();
                body.append('video', new Blob([Buffer.alloc(512)], { type: 'video/mp4' }), 'reconfigured.mp4');
                return body;
            })()
        });
        assert.equal(uploaded.status, 201);
        const job = await uploaded.json();

        configuredKey = '';
        const blockedQueue = await fetch(`${unconfiguredUrl}/jobs/${job.id}/queue`, {
            method: 'POST',
            headers: { ...authenticated, 'Content-Type': 'application/json' },
            body: JSON.stringify({ effects: {} })
        });
        assert.equal(blockedQueue.status, 503);
        assert.equal((await blockedQueue.json()).code, 'GEMINI_KEY_NOT_CONFIGURED');
        assert.equal(getWorkspaceJobInternal(job.id).status, 'pending');

        updateWorkspaceJobInternal(job.id, {
            status: 'failed', stage: 'failed', failedAt: new Date().toISOString()
        });
        const blockedRetry = await fetch(`${unconfiguredUrl}/jobs/${job.id}/retry`, {
            method: 'POST', headers: { ...authenticated, 'Idempotency-Key': 'unconfigured-retry' }
        });
        assert.equal(blockedRetry.status, 503);
        assert.equal((await blockedRetry.json()).code, 'GEMINI_KEY_NOT_CONFIGURED');
    } finally {
        authenticatedUser = owner;
        await new Promise(resolve => unconfiguredServer.close(resolve));
    }
});

test('insufficient credits block queueing with a 402 INSUFFICIENT_CREDITS error, and the job is never queued', async () => {
    authenticatedUser = { ...owner, uid: `insufficient-credits-${randomUUID()}` };
    let creditCheckCalls = 0;
    const creditApp = express();
    creditApp.use(express.json());
    creditApp.use('/api/workspace', requireAuth, createWorkspaceRouter({
        verifyKey: async () => ({ valid: true }),
        readSourceDuration: async () => 60,
        billingConfigured: () => true,
        checkCredits: async (identity, { sourceDurationSeconds }) => {
            creditCheckCalls += 1;
            assert.equal(sourceDurationSeconds, 60);
            return { sufficient: false, requiredCredits: 2n, availableCredits: 0n };
        }
    }));
    const creditServer = await new Promise(resolve => {
        const listener = creditApp.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const creditUrl = `http://127.0.0.1:${creditServer.address().port}/api/workspace`;
    try {
        const body = new FormData();
        body.append('video', new Blob([Buffer.alloc(512)], { type: 'video/mp4' }), 'insufficient.mp4');
        const uploaded = await fetch(`${creditUrl}/jobs`, {
            method: 'POST', headers: authenticated, body
        });
        assert.equal(uploaded.status, 201);
        const job = await uploaded.json();

        const queued = await fetch(`${creditUrl}/jobs/${job.id}/queue`, {
            method: 'POST',
            headers: { ...authenticated, 'Content-Type': 'application/json' },
            body: JSON.stringify({ effects: {} })
        });
        assert.equal(queued.status, 402);
        const payload = await queued.json();
        assert.equal(payload.code, 'INSUFFICIENT_CREDITS');
        assert.equal(payload.requiredCredits, '2');
        assert.equal(payload.availableCredits, '0');
        assert.equal(creditCheckCalls, 1);
        assert.equal(getWorkspaceJobInternal(job.id).status, 'pending', 'a job must never be queued when credits are insufficient');
    } finally {
        authenticatedUser = owner;
        await new Promise(resolve => creditServer.close(resolve));
    }
});

test('sufficient credits allow queueing to proceed as normal', async () => {
    authenticatedUser = { ...owner, uid: `sufficient-credits-${randomUUID()}` };
    const creditApp = express();
    creditApp.use(express.json());
    creditApp.use('/api/workspace', requireAuth, createWorkspaceRouter({
        verifyKey: async () => ({ valid: true }),
        readSourceDuration: async () => 60,
        billingConfigured: () => true,
        checkCredits: async () => ({ sufficient: true, requiredCredits: 2n, availableCredits: 12n })
    }));
    const creditServer = await new Promise(resolve => {
        const listener = creditApp.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const creditUrl = `http://127.0.0.1:${creditServer.address().port}/api/workspace`;
    try {
        const body = new FormData();
        body.append('video', new Blob([Buffer.alloc(512)], { type: 'video/mp4' }), 'sufficient.mp4');
        const uploaded = await fetch(`${creditUrl}/jobs`, {
            method: 'POST', headers: authenticated, body
        });
        assert.equal(uploaded.status, 201);
        const job = await uploaded.json();

        const queued = await fetch(`${creditUrl}/jobs/${job.id}/queue`, {
            method: 'POST',
            headers: { ...authenticated, 'Content-Type': 'application/json' },
            body: JSON.stringify({ effects: {} })
        });
        assert.equal(queued.status, 202);
        assert.equal(getWorkspaceJobInternal(job.id).status, 'queued');
        await fetch(`${creditUrl}/jobs/${job.id}/cancel`, { method: 'POST', headers: authenticated });
    } finally {
        authenticatedUser = owner;
        await new Promise(resolve => creditServer.close(resolve));
    }
});

test('the credit gate is skipped entirely when the PostgreSQL billing foundation is not configured, preserving existing behavior', async () => {
    authenticatedUser = { ...owner, uid: `billing-disabled-${randomUUID()}` };
    let creditCheckCalls = 0;
    const creditApp = express();
    creditApp.use(express.json());
    creditApp.use('/api/workspace', requireAuth, createWorkspaceRouter({
        verifyKey: async () => ({ valid: true }),
        readSourceDuration: async () => 60,
        billingConfigured: () => false,
        checkCredits: async () => { creditCheckCalls += 1; return { sufficient: false, requiredCredits: 2n, availableCredits: 0n }; }
    }));
    const creditServer = await new Promise(resolve => {
        const listener = creditApp.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const creditUrl = `http://127.0.0.1:${creditServer.address().port}/api/workspace`;
    try {
        const body = new FormData();
        body.append('video', new Blob([Buffer.alloc(512)], { type: 'video/mp4' }), 'billing-disabled.mp4');
        const uploaded = await fetch(`${creditUrl}/jobs`, {
            method: 'POST', headers: authenticated, body
        });
        assert.equal(uploaded.status, 201);
        const job = await uploaded.json();

        const queued = await fetch(`${creditUrl}/jobs/${job.id}/queue`, {
            method: 'POST',
            headers: { ...authenticated, 'Content-Type': 'application/json' },
            body: JSON.stringify({ effects: {} })
        });
        assert.equal(queued.status, 202);
        assert.equal(creditCheckCalls, 0, 'the credit gate must never be invoked when billing is not configured');
        await fetch(`${creditUrl}/jobs/${job.id}/cancel`, { method: 'POST', headers: authenticated });
    } finally {
        authenticatedUser = owner;
        await new Promise(resolve => creditServer.close(resolve));
    }
});

const uploadVideo = (filename = 'movie.mp4') => {
    const body = new FormData();
    body.append('video', new Blob([Buffer.alloc(512)], { type: 'video/mp4' }), filename);
    return fetch(`${baseUrl}/jobs`, {
        method: 'POST',
        headers: authenticated,
        body
    });
};

 test('server enforces the two-active-job quota atomically per user and releases capacity', async () => {
    const concurrent = await Promise.all([
        uploadVideo('first.mp4'),
        uploadVideo('second.mp4'),
        uploadVideo('third.mp4')
    ]);
    const accepted = concurrent.filter(response => response.status === 201);
    const denied = concurrent.filter(response => response.status === 429);
    assert.equal(accepted.length, 2);
    assert.equal(denied.length, 1);
    assert.deepEqual(await denied[0].json(), {
        error: 'You can have at most 2 active recap projects.',
        code: 'ACTIVE_JOB_QUOTA_EXCEEDED',
        activeJobCount: 2,
        activeJobLimit: 2
    });
    const ownerJobs = await Promise.all(accepted.map(response => response.json()));
    for (const job of ownerJobs) {
        assert.equal(
            listWorkspaceJobsForAdmission().some(record => record.id === job.id),
            false
        );
    }

    const preflightDenied = await uploadVideo('fourth.mp4');
    assert.equal(preflightDenied.status, 429);
    assert.equal((await preflightDenied.json()).activeJobCount, 2);

    authenticatedUser = { ...owner, uid: 'different-owner' };
    const otherAccepted = await uploadVideo('other-owner.mp4');
    assert.equal(otherAccepted.status, 201);
    const otherJob = await otherAccepted.json();
    const otherDeleted = await fetch(`${baseUrl}/jobs/${otherJob.id}`, {
        method: 'DELETE',
        headers: authenticated
    });
    assert.equal(otherDeleted.status, 200);

    authenticatedUser = owner;
    updateWorkspaceJobInternal(ownerJobs[0].id, {
        status: 'failed',
        stage: 'failed',
        failedAt: new Date().toISOString(),
        error: 'Synthetic terminal state for quota regression coverage.'
    });
    const replacement = await uploadVideo('replacement.mp4');
    assert.equal(replacement.status, 201);
    const replacementJob = await replacement.json();

    for (const jobId of [ownerJobs[0].id, ownerJobs[1].id, replacementJob.id]) {
        const cleanup = await fetch(`${baseUrl}/jobs/${jobId}`, {
            method: 'DELETE',
            headers: authenticated
        });
        assert.equal(cleanup.status, 200);
    }
    const history = await fetch(`${baseUrl}/jobs`, { headers: authenticated });
    assert.deepEqual(await history.json(), []);
});

test('workspace deletion removes the terminal core record, credentials, output, cache, and source', async () => {
    const uploaded = await uploadVideo('completed-delete.mp4');
    assert.equal(uploaded.status, 201);
    const job = await uploaded.json();
    const workspaceJob = getWorkspaceJobInternal(job.id);
    const outputPaths = [
        path.join(temporaryRoot, 'output', `${job.id}.mp4`),
        path.join(temporaryRoot, 'output', `${job.id}.mp3`)
    ];
    const cachePath = path.join(temporaryRoot, 'cache', job.id);
    fs.mkdirSync(cachePath, { recursive: true });
    for (const target of [...outputPaths, path.join(cachePath, 'state.json')]) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, 'owned artifact');
    }
    createProcessingJob(job.id, {
        ownerUid: owner.uid,
        videoPath: workspaceJob.storedPath,
        audioPath: null,
        originalFilename: job.filename
    });
    updateProcessingJob(job.id, {
        status: 'complete',
        completed_at: Date.now(),
        result: { videoUrl: `/output/${job.id}.mp4` }
    });
    updateWorkspaceJobInternal(job.id, {
        status: 'completed',
        stage: 'completed',
        completedAt: new Date().toISOString(),
        videoUrl: `/output/${job.id}.mp4`
    });

    const deletion = await fetch(`${baseUrl}/jobs/${job.id}`, {
        method: 'DELETE',
        headers: authenticated
    });
    assert.equal(deletion.status, 200);
    assert.deepEqual(await deletion.json(), { deleted: true, jobId: job.id });
    assert.equal(getProcessingJob(job.id), null);
    assert.deepEqual(getProcessingJobKeys(job.id), {});
    assert.equal(getWorkspaceJobInternal(job.id), null);
    assert.equal(fs.existsSync(workspaceJob.storedPath), false);
    assert.ok(outputPaths.every(target => !fs.existsSync(target)));
    assert.equal(fs.existsSync(cachePath), false);
});

test('workspace deletion rejects an active core job without mutating either lifecycle', async () => {
    const uploaded = await uploadVideo('active-core.mp4');
    assert.equal(uploaded.status, 201);
    const job = await uploaded.json();
    const workspaceJob = getWorkspaceJobInternal(job.id);
    updateWorkspaceJobInternal(job.id, {
        status: 'failed',
        stage: 'failed',
        failedAt: new Date().toISOString(),
        error: 'Workspace reached a terminal state first.'
    });
    createProcessingJob(job.id, {
        ownerUid: owner.uid,
        videoPath: workspaceJob.storedPath,
        audioPath: null,
        originalFilename: job.filename
    });
    updateProcessingJob(job.id, { status: 'processing' });

    const blocked = await fetch(`${baseUrl}/jobs/${job.id}`, {
        method: 'DELETE',
        headers: authenticated
    });
    assert.equal(blocked.status, 409);
    assert.deepEqual(await blocked.json(), { error: 'Active core jobs cannot be deleted.' });
    assert.equal(getProcessingJob(job.id).status, 'processing');
    assert.equal(getWorkspaceJobInternal(job.id).status, 'failed');
    assert.equal(fs.existsSync(workspaceJob.storedPath), true);

    updateProcessingJob(job.id, { status: 'error', error: 'Stopped for cleanup.' });
    const cleanup = await fetch(`${baseUrl}/jobs/${job.id}`, {
        method: 'DELETE',
        headers: authenticated
    });
    assert.equal(cleanup.status, 200);
});

test('workspace deletion rejects a mismatched core owner and cleans orphan artifacts when core state is absent', async () => {
    const mismatchedUpload = await uploadVideo('owner-mismatch.mp4');
    assert.equal(mismatchedUpload.status, 201);
    const mismatchedJob = await mismatchedUpload.json();
    const mismatchedWorkspace = getWorkspaceJobInternal(mismatchedJob.id);
    createProcessingJob(mismatchedJob.id, {
        ownerUid: 'different-owner',
        videoPath: mismatchedWorkspace.storedPath,
        audioPath: null,
        originalFilename: mismatchedJob.filename
    });
    updateProcessingJob(mismatchedJob.id, { status: 'error', error: 'Synthetic mismatch.' });

    const blocked = await fetch(`${baseUrl}/jobs/${mismatchedJob.id}`, {
        method: 'DELETE',
        headers: authenticated
    });
    assert.equal(blocked.status, 409);
    assert.deepEqual(await blocked.json(), { error: 'Workspace and core job ownership do not match.' });
    assert.ok(getProcessingJob(mismatchedJob.id));
    assert.ok(getWorkspaceJobInternal(mismatchedJob.id));
    deleteProcessingJob(mismatchedJob.id);
    const mismatchCleanup = await fetch(`${baseUrl}/jobs/${mismatchedJob.id}`, {
        method: 'DELETE',
        headers: authenticated
    });
    assert.equal(mismatchCleanup.status, 200);

    const orphanUpload = await uploadVideo('orphan-output.mp4');
    assert.equal(orphanUpload.status, 201);
    const orphanJob = await orphanUpload.json();
    const orphanOutput = path.join(temporaryRoot, 'output', `${orphanJob.id}.mp4`);
    const orphanCache = path.join(temporaryRoot, 'cache', orphanJob.id);
    fs.mkdirSync(orphanCache, { recursive: true });
    fs.mkdirSync(path.dirname(orphanOutput), { recursive: true });
    fs.writeFileSync(orphanOutput, 'orphan output');
    fs.writeFileSync(path.join(orphanCache, 'state.json'), 'orphan cache');
    assert.equal(getProcessingJob(orphanJob.id), null);

    const orphanDeletion = await fetch(`${baseUrl}/jobs/${orphanJob.id}`, {
        method: 'DELETE',
        headers: authenticated
    });
    assert.equal(orphanDeletion.status, 200);
    assert.equal(fs.existsSync(orphanOutput), false);
    assert.equal(fs.existsSync(orphanCache), false);
});

test('workspace deletion preflight preserves records when a canonical artifact is unsafe', async () => {
    const uploaded = await uploadVideo('unsafe-output.mp4');
    assert.equal(uploaded.status, 201);
    const job = await uploaded.json();
    const workspaceJob = getWorkspaceJobInternal(job.id);
    updateWorkspaceJobInternal(job.id, {
        status: 'completed',
        stage: 'completed',
        completedAt: new Date().toISOString()
    });
    createProcessingJob(job.id, {
        ownerUid: owner.uid,
        videoPath: workspaceJob.storedPath,
        audioPath: null,
        originalFilename: job.filename
    });
    updateProcessingJob(job.id, { status: 'complete', completed_at: Date.now() });
    const outside = path.join(temporaryRoot, 'outside-output');
    const outputPath = path.join(temporaryRoot, 'output', `${job.id}.mp4`);
    fs.writeFileSync(outside, 'must remain');
    fs.symlinkSync(outside, outputPath);

    const blocked = await fetch(`${baseUrl}/jobs/${job.id}`, {
        method: 'DELETE',
        headers: authenticated
    });
    assert.equal(blocked.status, 500);
    assert.deepEqual(await blocked.json(), { error: 'Project files could not be removed safely.' });
    assert.ok(getProcessingJob(job.id));
    assert.ok(getWorkspaceJobInternal(job.id));
    assert.equal(fs.readFileSync(outside, 'utf8'), 'must remain');

    fs.unlinkSync(outputPath);
    const cleanup = await fetch(`${baseUrl}/jobs/${job.id}`, {
        method: 'DELETE',
        headers: authenticated
    });
    assert.equal(cleanup.status, 200);
    fs.unlinkSync(outside);
});

test('valid upload creates a persistent pending job without activating processing', async () => {
    const body = new FormData();
    body.append('video', new Blob([Buffer.alloc(512)], { type: 'video/mp4' }), 'movie.mp4');
    body.append('duration', '123.45');
    const uploaded = await fetch(`${baseUrl}/jobs`, {
        method: 'POST',
        headers: authenticated,
        body
    });
    assert.equal(uploaded.status, 201);
    const job = await uploaded.json();
    assert.match(job.id, /^[0-9a-f-]{36}$/);
    assert.equal(job.filename, 'movie.mp4');
    assert.equal(job.fileSize, 512);
    assert.equal(job.duration, 123.45);
    assert.equal(job.status, 'pending');
    assert.equal(job.stage, 'pending');
    assert.equal(job.progress, 0);
    assert.ok(job.createdAt);
    assert.ok(job.updatedAt);
    assert.deepEqual(job.retry, { attempts: 0, maxAttempts: 0, lastAttemptAt: null, resumeStage: null });
    assert.equal(Object.hasOwn(job, 'storedPath'), false);
    assert.equal(listProcessingJobs().some(processingJob => processingJob.id === job.id), false);

    const history = await fetch(`${baseUrl}/jobs`, { headers: authenticated });
    const jobs = await history.json();
    assert.equal(jobs.length, 1);
    assert.deepEqual(jobs[0], job);

    const opened = await fetch(`${baseUrl}/jobs/${job.id}`, { headers: authenticated });
    assert.equal(opened.status, 200);
    const source = await fetch(`${baseUrl}/jobs/${job.id}/source`, { headers: authenticated });
    assert.equal(source.status, 200);
    assert.equal((await source.arrayBuffer()).byteLength, 512);

    authenticatedUser = { ...owner, uid: 'different-owner' };
    const forbiddenByOwnership = await fetch(`${baseUrl}/jobs/${job.id}`, { headers: authenticated });
    assert.equal(forbiddenByOwnership.status, 404);
    const forbiddenSource = await fetch(`${baseUrl}/jobs/${job.id}/source`, { headers: authenticated });
    assert.equal(forbiddenSource.status, 404);
    authenticatedUser = owner;

    const queued = await fetch(`${baseUrl}/jobs/${job.id}/queue`, {
        method: 'POST',
        headers: {
            ...authenticated,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            effects: {
                colorGrading: 'warm',
                flipVideoEnabled: true,
                burnSubtitlesEnabled: false,
                subtitlePosition: { xPct: 15, yPct: 70, widthPct: 70, heightPct: 12 },
                blurEnabled: false,
                blurBoxes: []
            }
        })
    });
    assert.equal(queued.status, 202);
    const queuedJob = await queued.json();
    assert.equal(queuedJob.status, 'queued');
    assert.equal(queuedJob.effects.colorGrading, 'warm');
    assert.equal(queuedJob.effects.flipVideoEnabled, true);
    assert.equal(queuedJob.effects.burnSubtitlesEnabled, false);
    assert.equal(queuedJob.effects.blurEnabled, false);
    assert.deepEqual(queuedJob.effects.blurBoxes, []);
    const queue = await fetch(`${baseUrl}/queue`, { headers: authenticated });
    const queuePayload = await queue.json();
    assert.equal(queuePayload.concurrency, 1);
    assert.equal(queuePayload.jobs[0].id, job.id);
    assert.equal(queuePayload.jobs[0].position, 1);

    const cancelled = await fetch(`${baseUrl}/jobs/${job.id}/cancel`, {
        method: 'POST',
        headers: authenticated
    });
    assert.equal(cancelled.status, 202);
    const cancelledJob = await cancelled.json();
    assert.equal(cancelledJob.status, 'cancelled');
    assert.equal(cancelledJob.cancellationRequested, true);

    const deleted = await fetch(`${baseUrl}/jobs/${job.id}`, {
        method: 'DELETE',
        headers: authenticated
    });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { deleted: true, jobId: job.id });
    const empty = await fetch(`${baseUrl}/jobs`, { headers: authenticated });
    assert.deepEqual(await empty.json(), []);
});

test('live billing reservation is compensated when queue admission fails', async () => {
    let released = null;
    const liveApp = express();
    liveApp.use(express.json());
    liveApp.use('/api/workspace', requireAuth, createWorkspaceRouter({
        verifyKey: async () => ({ valid: true }),
        liveBillingEnabled: () => true,
        readSourceDuration: async () => 61,
        reserveBilling: async () => ({
            snapshot: {
                planCode: 'pro', billingMode: 'blink_funded',
                billingBlocks: '3', totalCredits: '6', billingStatus: 'reserved'
            }
        }),
        releaseBilling: async (jobId, reason) => {
            released = { jobId, reason };
            return { billingStatus: 'released' };
        },
        admission: {
            consumeMutation: () => ({ allowed: true }),
            withProcessingAdmission: () => {
                const error = new Error('Synthetic queue capacity failure.');
                error.code = 'PROCESSING_CAPACITY_EXCEEDED';
                throw error;
            }
        }
    }));
    const liveServer = await new Promise(resolve => {
        const listener = liveApp.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const liveUrl = `http://127.0.0.1:${liveServer.address().port}/api/workspace`;
    try {
        const body = new FormData();
        body.append('video', new Blob([Buffer.alloc(512)], { type: 'video/mp4' }), 'billed.mp4');
        const upload = await fetch(`${liveUrl}/jobs`, {
            method: 'POST', headers: authenticated, body
        });
        assert.equal(upload.status, 201);
        const job = await upload.json();
        const queued = await fetch(`${liveUrl}/jobs/${job.id}/queue`, {
            method: 'POST',
            headers: {
                ...authenticated,
                'Content-Type': 'application/json',
                'Idempotency-Key': 'route-live-1'
            },
            body: JSON.stringify({
                planCode: 'pro', billingMode: 'blink_funded', effects: {}
            })
        });
        assert.equal(queued.status, 500);
        assert.deepEqual(released, {
            jobId: job.id, reason: 'queue_admission_failed'
        });
        assert.equal(getWorkspaceJobInternal(job.id).status, 'pending');
        updateWorkspaceJobInternal(job.id, { status: 'failed', stage: 'failed' });
        await fetch(`${liveUrl}/jobs/${job.id}`, {
            method: 'DELETE', headers: authenticated
        });
    } finally {
        await new Promise(resolve => liveServer.close(resolve));
    }
});

test('failed workspace retry is owner-only, idempotent, concurrency-safe, and creates no billing reservation', async () => {
    const retryOwner = { ...owner, uid: `retry-owner-${randomUUID()}` };
    authenticatedUser = retryOwner;
    const id = randomUUID();
    const directory = path.join(temporaryRoot, 'uploads', 'workspace', id);
    fs.mkdirSync(directory, { recursive: true });
    const storedPath = path.join(directory, 'source.mp4');
    fs.writeFileSync(storedPath, 'valid source');
    createWorkspaceJob({
        id, ownerUid: retryOwner.uid, filename: 'retry.mp4', fileSize: 12,
        duration: 10, storedPath
    });
    updateWorkspaceJobInternal(id, {
        status: 'failed', stage: 'failed', failedAt: new Date().toISOString(),
        diagnostic: { stage: 'audio_extraction' }, error: 'Audio failed.'
    });
    let wakeCount = 0;
    let reserveCount = 0;
    const retryApp = express();
    retryApp.use(express.json());
    retryApp.use('/api/workspace', requireAuth, createWorkspaceRouter({
        verifyKey: async () => ({ valid: true }),
        readSourceDuration: async () => 10,
        resolveServerGeminiKey: () => 'verified-key',
        reserveBilling: async () => { reserveCount += 1; throw new Error('must not reserve'); },
        worker: { wake: () => { wakeCount += 1; }, snapshot: () => ({}) },
        publishQueue: () => undefined,
        admission: {
            consumeMutation: () => ({ allowed: true }),
            withProcessingAdmission: (_uid, _jobId, operation) => operation({ idempotent: true })
        }
    }));
    const retryServer = await new Promise(resolve => {
        const listener = retryApp.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const retryUrl = `http://127.0.0.1:${retryServer.address().port}/api/workspace`;
    try {
        const eligibility = await fetch(`${retryUrl}/jobs/${id}/retry`, { headers: authenticated });
        assert.equal(eligibility.status, 200);
        assert.deepEqual(await eligibility.json(), {
            recoverable: true, resumeStage: 'upload', resumeProgress: 5
        });

        authenticatedUser = { ...owner, uid: `other-${randomUUID()}` };
        const denied = await fetch(`${retryUrl}/jobs/${id}/retry`, {
            method: 'POST', headers: { ...authenticated, 'Idempotency-Key': 'retry-denied' }
        });
        assert.equal(denied.status, 404);
        assert.equal((await denied.json()).code, 'NOT_FOUND');
        authenticatedUser = retryOwner;

        const request = () => fetch(`${retryUrl}/jobs/${id}/retry`, {
            method: 'POST', headers: { ...authenticated, 'Idempotency-Key': 'retry-same' }
        });
        const responses = await Promise.all([request(), request()]);
        assert.deepEqual(responses.map(response => response.status).sort(), [200, 202]);
        const payloads = await Promise.all(responses.map(response => response.json()));
        assert.deepEqual(payloads.map(payload => payload.status).sort(), ['accepted', 'duplicate']);
        assert.equal(getWorkspaceJobInternal(id).status, 'queued');
        assert.equal(getWorkspaceJobInternal(id).retry.attempts, 1);
        assert.equal(wakeCount, 1);
        assert.equal(reserveCount, 0);

        const alreadyActive = await fetch(`${retryUrl}/jobs/${id}/retry`, {
            method: 'POST', headers: { ...authenticated, 'Idempotency-Key': 'different-key' }
        });
        assert.equal(alreadyActive.status, 409);
        assert.equal((await alreadyActive.json()).code, 'JOB_ALREADY_ACTIVE');
    } finally {
        authenticatedUser = owner;
        await new Promise(resolve => retryServer.close(resolve));
    }
});

test('retry rejects non-failed jobs and reports missing recovery artifacts', async () => {
    const retryOwner = { ...owner, uid: `retry-errors-${randomUUID()}` };
    authenticatedUser = retryOwner;
    const createRecord = (status, keepSource = true) => {
        const id = randomUUID();
        const directory = path.join(temporaryRoot, 'uploads', 'workspace', id);
        fs.mkdirSync(directory, { recursive: true });
        const storedPath = path.join(directory, 'source.mp4');
        fs.writeFileSync(storedPath, 'valid source');
        createWorkspaceJob({ id, ownerUid: retryOwner.uid, filename: `${id}.mp4`, fileSize: 12, duration: 10, storedPath });
        if (status === 'failed') updateWorkspaceJobInternal(id, { status: 'failed', stage: 'failed', failedAt: new Date().toISOString() });
        if (!keepSource) fs.unlinkSync(storedPath);
        return id;
    };
    const pendingId = createRecord('pending');
    const missingId = createRecord('failed', false);
    const retryApp = express();
    retryApp.use(express.json());
    retryApp.use('/api/workspace', requireAuth, createWorkspaceRouter({
        readSourceDuration: async () => 10,
        resolveServerGeminiKey: () => 'verified-key',
        worker: { wake: () => undefined, snapshot: () => ({}) },
        publishQueue: () => undefined
    }));
    const retryServer = await new Promise(resolve => {
        const listener = retryApp.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const retryUrl = `http://127.0.0.1:${retryServer.address().port}/api/workspace`;
    try {
        const notFailed = await fetch(`${retryUrl}/jobs/${pendingId}/retry`, {
            method: 'POST', headers: { ...authenticated, 'Idempotency-Key': 'pending' }
        });
        assert.equal(notFailed.status, 409);
        assert.equal((await notFailed.json()).code, 'JOB_NOT_FAILED');
        const eligibility = await fetch(`${retryUrl}/jobs/${missingId}/retry`, { headers: authenticated });
        assert.equal(eligibility.status, 200);
        const unavailable = await eligibility.json();
        assert.equal(unavailable.recoverable, false);
        assert.equal(unavailable.code, 'RETRY_ARTIFACT_MISSING');
        const missing = await fetch(`${retryUrl}/jobs/${missingId}/retry`, {
            method: 'POST', headers: { ...authenticated, 'Idempotency-Key': 'missing' }
        });
        assert.equal(missing.status, 422);
        assert.equal((await missing.json()).code, 'RETRY_ARTIFACT_MISSING');
    } finally {
        authenticatedUser = owner;
        await new Promise(resolve => retryServer.close(resolve));
    }
});
