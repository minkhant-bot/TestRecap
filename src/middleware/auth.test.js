import assert from 'node:assert/strict';
import test from 'node:test';
import {
    canAccessJob,
    createRequireAuth,
    requireAdmin
} from './auth.js';

const response = () => {
    const value = { statusCode: 200, body: null };
    value.status = code => { value.statusCode = code; return value; };
    value.json = body => { value.body = body; return value; };
    return value;
};

test('protected APIs authenticate through the backend session cookie', async () => {
    const expected = { uid: 'user-1', role: 'user', status: 'active' };
    const middleware = createRequireAuth({
        verifyIdentity: async input => {
            assert.equal(input.sessionCookie, 'signed-session');
            assert.equal(input.idToken, undefined);
            return expected;
        }
    });
    const req = { headers: { cookie: '__session=signed-session' } };
    const res = response();
    let nextCalled = false;
    await middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.deepEqual(req.user, expected);
});

test('missing, bearer-only, or invalid sessions are rejected', async () => {
    const missing = response();
    await createRequireAuth()({ headers: {} }, missing, () => {});
    assert.equal(missing.statusCode, 401);

    const bearerOnly = response();
    await createRequireAuth()({ headers: { authorization: 'Bearer firebase-id-token' } }, bearerOnly, () => {});
    assert.equal(bearerOnly.statusCode, 401);

    const invalid = response();
    await createRequireAuth({ verifyIdentity: async () => { throw new Error('invalid'); } })(
        { headers: { cookie: '__session=bad' } }, invalid, () => {});
    assert.equal(invalid.statusCode, 401);
});

test('roles and project ownership are enforced from backend identity', () => {
    const ownedJob = { ownerUid: 'user-1' };
    assert.equal(canAccessJob({ uid: 'user-1', role: 'user' }, ownedJob), true);
    assert.equal(canAccessJob({ uid: 'user-2', role: 'user' }, ownedJob), false);
    assert.equal(canAccessJob({ uid: 'admin-1', role: 'admin' }, ownedJob), true);
    assert.equal(canAccessJob({ uid: 'owner-1', role: 'super_admin' }, ownedJob), true);

    const denied = response();
    requireAdmin({ user: { role: 'user' } }, denied, () => {});
    assert.equal(denied.statusCode, 403);
    let allowed = false;
    requireAdmin({ user: { role: 'admin' } }, response(), () => { allowed = true; });
    assert.equal(allowed, true);
    let superAdminAllowed = false;
    requireAdmin({ user: { role: 'super_admin' } }, response(), () => { superAdminAllowed = true; });
    assert.equal(superAdminAllowed, true);
});
