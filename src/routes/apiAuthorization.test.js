import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import apiRoutes from './api.js';
import { setAuthVerifierForTests } from '../middleware/auth.js';

const identities = {
    'user-session': {
        uid: 'ordinary-user',
        email: 'user@example.com',
        role: 'user',
        status: 'active'
    },
    'admin-session': {
        uid: 'admin-user',
        email: 'admin@example.com',
        role: 'admin',
        status: 'active'
    },
    'super-session': {
        uid: 'super-user',
        email: 'super@example.com',
        role: 'super_admin',
        status: 'active'
    }
};

const startTestServer = async () => {
    setAuthVerifierForTests(async ({ sessionCookie }) => {
        const identity = identities[sessionCookie];
        if (!identity) throw new Error('Invalid test session.');
        return identity;
    });
    const app = express();
    app.use(express.json());
    app.use('/api', apiRoutes);
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    return {
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`
    };
};

const request = (baseUrl, path, session, options = {}) => fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
        Cookie: `__session=${session}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
    }
});

test('ordinary users cannot read or mutate global settings or run diagnostics', async () => {
    const { server, baseUrl } = await startTestServer();
    try {
        const attempts = [
            await request(baseUrl, '/api/settings', 'user-session'),
            await request(baseUrl, '/api/settings', 'user-session', {
                method: 'POST',
                body: JSON.stringify({ key: 'GEMINI_MODEL', value: 'unauthorized-change' })
            }),
            await request(baseUrl, '/api/diagnostic', 'user-session')
        ];

        for (const response of attempts) {
            assert.equal(response.status, 403);
            assert.deepEqual(await response.json(), { error: 'Administrator access required.' });
        }
    } finally {
        setAuthVerifierForTests(null);
        await new Promise(resolve => server.close(resolve));
    }
});

test('administrators retain access to masked global settings', async () => {
    const { server, baseUrl } = await startTestServer();
    try {
        const response = await request(baseUrl, '/api/settings', 'admin-session');
        assert.equal(response.status, 200);
        assert.equal(typeof await response.json(), 'object');
    } finally {
        setAuthVerifierForTests(null);
        await new Promise(resolve => server.close(resolve));
    }
});

test('super administrators receive the same legacy administrator authorization', async () => {
    const { server, baseUrl } = await startTestServer();
    try {
        const settings = await request(baseUrl, '/api/settings', 'super-session');
        assert.equal(settings.status, 200);
        const creation = await request(baseUrl, '/api/jobs', 'super-session', { method: 'POST' });
        assert.equal(creation.status, 400);
        assert.deepEqual(await creation.json(), { error: 'Video file is required' });
    } finally {
        setAuthVerifierForTests(null);
        await new Promise(resolve => server.close(resolve));
    }
});

test('ordinary users cannot bypass workspace admission through legacy processing routes', async () => {
    const { server, baseUrl } = await startTestServer();
    try {
        for (const path of ['/api/jobs', '/api/process-recap', '/api/process']) {
            const response = await request(baseUrl, path, 'user-session', { method: 'POST' });
            assert.equal(response.status, 403);
            assert.deepEqual(await response.json(), { error: 'Administrator access required.' });
        }

        const adminResponse = await request(baseUrl, '/api/jobs', 'admin-session', { method: 'POST' });
        assert.equal(adminResponse.status, 400);
        assert.deepEqual(await adminResponse.json(), { error: 'Video file is required' });
    } finally {
        setAuthVerifierForTests(null);
        await new Promise(resolve => server.close(resolve));
    }
});
