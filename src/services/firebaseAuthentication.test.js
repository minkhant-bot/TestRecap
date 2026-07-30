import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    establishGoogleSession,
    getAuthoritativeRole,
    updateFirebaseUserAccess,
    verifyFirebaseIdentity
} from './firebaseAdmin.js';

const googleUser = overrides => ({
    uid: 'google-user-1',
    email: 'creator@example.com',
    displayName: 'Movie Creator',
    photoURL: 'https://example.com/avatar.jpg',
    disabled: false,
    customClaims: {},
    providerData: [{ providerId: 'google.com' }],
    metadata: {
        creationTime: '2026-01-01T00:00:00.000Z',
        lastSignInTime: '2026-07-28T00:00:00.000Z',
        lastRefreshTime: '2026-07-28T00:00:00.000Z'
    },
    ...overrides
});

test('validated custom claims are authoritative and malformed roles fail closed', () => {
    assert.equal(getAuthoritativeRole(googleUser()), 'user');
    assert.equal(getAuthoritativeRole(googleUser({
        uid: 'claimed-admin',
        customClaims: { role: 'admin' }
    })), 'admin');
    assert.equal(getAuthoritativeRole(googleUser({
        uid: 'claimed-super-admin',
        customClaims: { role: 'super_admin' }
    })), 'super_admin');
    assert.equal(getAuthoritativeRole(googleUser({
        email: 'min85639@gmail.com'
    })), 'user');
    assert.throws(
        () => getAuthoritativeRole(googleUser({ customClaims: { role: 'owner' } })),
        error => error.code === 'AUTH_ROLE_CLAIM_INVALID'
    );
    assert.throws(
        () => getAuthoritativeRole(googleUser({ customClaims: { role: true } })),
        error => error.code === 'AUTH_ROLE_CLAIM_INVALID'
    );
});

test('configured Firebase UIDs safely bootstrap super-admin authority and repair a stale claim', async () => {
    const env = { FIREBASE_SUPER_ADMIN_UIDS: 'bootstrap-1, bootstrap-2' };
    assert.equal(getAuthoritativeRole(googleUser({
        uid: 'bootstrap-1',
        customClaims: { role: 'user' }
    }), env), 'super_admin');
    assert.throws(
        () => getAuthoritativeRole(googleUser(), { FIREBASE_SUPER_ADMIN_UIDS: 'valid, bad uid' }),
        /comma-separated list/
    );

    let writtenClaims = null;
    const auth = {
        verifyIdToken: async () => ({
            uid: 'bootstrap-1',
            firebase: { sign_in_provider: 'google.com' }
        }),
        getUser: async () => googleUser({
            uid: 'bootstrap-1',
            customClaims: { role: 'user', retained: true }
        }),
        setCustomUserClaims: async (uid, claims) => {
            assert.equal(uid, 'bootstrap-1');
            writtenClaims = claims;
        },
        createSessionCookie: async () => 'bootstrap-session'
    };
    const result = await establishGoogleSession({
        idToken: 'bootstrap-token',
        expiresIn: 1000,
        auth,
        env
    });
    assert.equal(result.profile.role, 'super_admin');
    assert.deepEqual(writtenClaims, { role: 'super_admin', retained: true });
});

test('valid Google session creates a first-time profile and updates an existing profile', async () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'testrecap-auth-'));
    const previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = temporaryRoot;
    let signIn = 0;
    const auth = {
        verifyIdToken: async token => {
            assert.equal(token, 'valid-google-token');
            return {
                uid: 'google-user-1',
                firebase: { sign_in_provider: 'google.com' }
            };
        },
        getUser: async () => googleUser({
            displayName: signIn++ === 0 ? 'First Name' : 'Updated Name'
        }),
        setCustomUserClaims: async () => undefined,
        createSessionCookie: async (token, options) => {
            assert.equal(token, 'valid-google-token');
            assert.equal(options.expiresIn, 1000);
            return 'backend-session';
        }
    };

    try {
        const first = await establishGoogleSession({
            idToken: 'valid-google-token',
            expiresIn: 1000,
            auth
        });
        assert.equal(first.sessionCookie, 'backend-session');
        assert.equal(first.profile.displayName, 'First Name');
        assert.equal(first.profile.role, 'user');
        assert.equal(first.profile.status, 'active');

        const second = await establishGoogleSession({
            idToken: 'valid-google-token',
            expiresIn: 1000,
            auth
        });
        assert.equal(second.profile.uid, first.profile.uid);
        assert.equal(second.profile.createdAt, first.profile.createdAt);
        assert.equal(second.profile.displayName, 'Updated Name');
        assert.notEqual(second.profile.updatedAt, null);
        assert.notEqual(second.profile.lastLoginAt, null);
    } finally {
        if (previousDataDir === undefined) delete process.env.DATA_DIR;
        else process.env.DATA_DIR = previousDataDir;
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test('invalid tokens and non-Google providers are rejected', async () => {
    await assert.rejects(
        verifyFirebaseIdentity({
            sessionCookie: 'invalid-session',
            auth: {
                verifySessionCookie: async () => {
                    throw new Error('invalid token');
                }
            }
        }),
        /invalid token/
    );

    await assert.rejects(
        verifyFirebaseIdentity({
            sessionCookie: 'password-session',
            auth: {
                verifySessionCookie: async () => ({
                    uid: 'password-user',
                    firebase: { sign_in_provider: 'password' }
                }),
                getUser: async () => googleUser({
                    uid: 'password-user',
                    providerData: [{ providerId: 'password' }]
                })
            }
        }),
        /Only Google accounts/
    );
});

const createMutableAuth = records => {
    const users = new Map(records.map(record => [record.uid, googleUser(record)]));
    return {
        users,
        async getUser(uid) {
            const user = users.get(uid);
            if (!user) throw new Error(`Unknown user: ${uid}`);
            return structuredClone(user);
        },
        async setCustomUserClaims(uid, claims) {
            users.get(uid).customClaims = structuredClone(claims);
        },
        async updateUser(uid, updates) {
            Object.assign(users.get(uid), updates);
            return structuredClone(users.get(uid));
        },
        async listUsers() {
            return {
                users: [...users.values()].map(user => structuredClone(user)),
                pageToken: undefined
            };
        },
        async verifySessionCookie() {
            throw new Error('Test must provide verifySessionCookie.');
        }
    };
};

const actor = (uid, role) => ({ uid, role });

test('admin and super-admin mutations enforce role hierarchy and peer boundaries', async () => {
    const auth = createMutableAuth([
        { uid: 'root', customClaims: { role: 'super_admin' } },
        { uid: 'admin-a', customClaims: { role: 'admin' } },
        { uid: 'admin-b', customClaims: { role: 'admin' } },
        { uid: 'user-a', customClaims: { role: 'user' } }
    ]);

    await updateFirebaseUserAccess({
        uid: 'user-a', role: 'user', status: 'disabled',
        actor: actor('admin-a', 'admin'), auth
    });
    assert.equal(auth.users.get('user-a').disabled, true);

    await assert.rejects(
        updateFirebaseUserAccess({
            uid: 'user-a', role: 'admin', status: 'disabled',
            actor: actor('admin-a', 'admin'), auth
        }),
        error => error.code === 'ROLE_CHANGE_REQUIRES_SUPER_ADMIN'
    );
    await assert.rejects(
        updateFirebaseUserAccess({
            uid: 'admin-b', role: 'admin', status: 'disabled',
            actor: actor('admin-a', 'admin'), auth
        }),
        error => error.code === 'PEER_ADMIN_MUTATION_FORBIDDEN'
    );
    await assert.rejects(
        updateFirebaseUserAccess({
            uid: 'root', role: 'admin', status: 'active',
            actor: actor('admin-a', 'admin'), auth
        }),
        error => error.code === 'ROLE_CHANGE_REQUIRES_SUPER_ADMIN'
    );

    await updateFirebaseUserAccess({
        uid: 'admin-b', role: 'super_admin', status: 'active',
        actor: actor('root', 'super_admin'), auth
    });
    assert.equal(auth.users.get('admin-b').customClaims.role, 'super_admin');
});

test('self-elevation, self-demotion, self-disable, and bootstrap removal are rejected', async () => {
    const env = { FIREBASE_SUPER_ADMIN_UIDS: 'root' };
    const auth = createMutableAuth([
        { uid: 'root', customClaims: { role: 'user' } },
        { uid: 'other-root', customClaims: { role: 'super_admin' } },
        { uid: 'admin-a', customClaims: { role: 'admin' } }
    ]);

    for (const request of [
        { uid: 'admin-a', role: 'super_admin', status: 'active', actor: actor('admin-a', 'admin') },
        { uid: 'admin-a', role: 'user', status: 'active', actor: actor('admin-a', 'admin') },
        { uid: 'admin-a', role: 'admin', status: 'disabled', actor: actor('admin-a', 'admin') }
    ]) {
        await assert.rejects(
            updateFirebaseUserAccess({ ...request, auth, env }),
            error => error.code === 'ADMIN_SELF_LOCKOUT_FORBIDDEN'
        );
    }
    await assert.rejects(
        updateFirebaseUserAccess({
            uid: 'root', role: 'admin', status: 'active',
            actor: actor('other-root', 'super_admin'), auth, env
        }),
        error => error.code === 'BOOTSTRAP_SUPER_ADMIN_PROTECTED'
    );
});

test('last active super-admin protection is serialized across concurrent mutations', async () => {
    const auth = createMutableAuth([
        { uid: 'super-a', customClaims: { role: 'super_admin' } },
        { uid: 'super-b', customClaims: { role: 'super_admin' } }
    ]);
    const outcomes = await Promise.allSettled([
        updateFirebaseUserAccess({
            uid: 'super-b', role: 'user', status: 'active',
            actor: actor('super-a', 'super_admin'), auth
        }),
        updateFirebaseUserAccess({
            uid: 'super-a', role: 'user', status: 'active',
            actor: actor('super-b', 'super_admin'), auth
        })
    ]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
    const activeSuperAdmins = [...auth.users.values()].filter(user =>
        !user.disabled && user.customClaims.role === 'super_admin'
    );
    assert.equal(activeSuperAdmins.length, 1);
});

test('subsequent authentication immediately enforces current role and rejects invalidated claims', async () => {
    const auth = createMutableAuth([
        { uid: 'root', customClaims: { role: 'super_admin' } },
        { uid: 'admin-a', customClaims: { role: 'admin' } }
    ]);
    auth.verifySessionCookie = async () => ({
        uid: 'admin-a',
        firebase: { sign_in_provider: 'google.com' }
    });
    assert.equal((await verifyFirebaseIdentity({ sessionCookie: 'same-session', auth })).role, 'admin');

    await updateFirebaseUserAccess({
        uid: 'admin-a', role: 'user', status: 'active',
        actor: actor('root', 'super_admin'), auth
    });
    assert.equal((await verifyFirebaseIdentity({ sessionCookie: 'same-session', auth })).role, 'user');

    auth.users.get('admin-a').customClaims.role = 'stale-owner';
    await assert.rejects(
        verifyFirebaseIdentity({ sessionCookie: 'same-session', auth }),
        error => error.code === 'AUTH_ROLE_CLAIM_INVALID'
    );
});
