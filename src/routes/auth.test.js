import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { setAuthVerifierForTests } from '../middleware/auth.js';
import { createAuthRouter } from './auth.js';

const profile = {
    uid: 'google-user',
    email: 'creator@example.com',
    displayName: 'Movie Creator',
    photoURL: '',
    role: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    lastLoginAt: '2026-07-28T00:00:00.000Z',
    status: 'active'
};

const startServer = async dependencies => {
    const app = express();
    app.use(express.json());
    app.use('/api/auth', createAuthRouter(dependencies));
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    return {
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`
    };
};

test('Google ID token exchange issues a secure backend session and supports restore and logout', async () => {
    let revokedUid = null;
    setAuthVerifierForTests(async ({ sessionCookie }) => {
        assert.equal(sessionCookie, 'backend-session-cookie');
        return profile;
    });
    const dependencies = {
        establishSession: async ({ idToken, expiresIn }) => {
            assert.equal(idToken, 'firebase-google-id-token');
            assert.ok(expiresIn > 0);
            return { profile, sessionCookie: 'backend-session-cookie' };
        },
        revokeSessions: async uid => { revokedUid = uid; }
    };
    const { server, baseUrl } = await startServer(dependencies);
    try {
        const exchange = await fetch(`${baseUrl}/api/auth/session`, {
            method: 'POST',
            headers: { Authorization: 'Bearer firebase-google-id-token' }
        });
        assert.equal(exchange.status, 200);
        assert.deepEqual((await exchange.json()).user, profile);
        const setCookie = exchange.headers.get('set-cookie');
        assert.match(setCookie, /__session=backend-session-cookie/);
        assert.match(setCookie, /HttpOnly/i);
        assert.match(setCookie, /SameSite=Lax/i);

        const cookie = '__session=backend-session-cookie';
        const restored = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
        assert.equal(restored.status, 200);
        assert.deepEqual(await restored.json(), profile);

        const logout = await fetch(`${baseUrl}/api/auth/logout`, {
            method: 'POST',
            headers: { Cookie: cookie }
        });
        assert.equal(logout.status, 200);
        assert.deepEqual(await logout.json(), { loggedOut: true });
        assert.equal(revokedUid, profile.uid);
        assert.match(logout.headers.get('set-cookie'), /__session=;/);
    } finally {
        setAuthVerifierForTests(null);
        await new Promise(resolve => server.close(resolve));
    }
});

test('session exchange rejects a missing or invalid Firebase ID token', async () => {
    const { server, baseUrl } = await startServer({
        establishSession: async () => {
            const error = new Error('Invalid Google identity.');
            error.code = 'AUTH_INVALID';
            throw error;
        }
    });
    try {
        const missing = await fetch(`${baseUrl}/api/auth/session`, { method: 'POST' });
        assert.equal(missing.status, 400);

        const invalid = await fetch(`${baseUrl}/api/auth/session`, {
            method: 'POST',
            headers: { Authorization: 'Bearer invalid-token' }
        });
        assert.equal(invalid.status, 401);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
