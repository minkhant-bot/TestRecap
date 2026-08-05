import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createRequireAuth } from '../middleware/auth.js';
import { createAdminRouter } from './admin.js';

const identities = {
    user: { uid: 'user-a', role: 'user' },
    admin: { uid: 'admin-a', role: 'admin' },
    super: { uid: 'super-a', role: 'super_admin' }
};

const startServer = async (updateAccess, { recordDurableAudit } = {}) => {
    const app = express();
    app.use(express.json());
    app.use(createRequireAuth({
        verifyIdentity: async ({ sessionCookie }) => identities[sessionCookie]
    }));
    app.use('/admin', createAdminRouter({
        listUsers: async () => [],
        updateAccess,
        serializeUser: user => user,
        ...(recordDurableAudit ? { recordDurableAudit } : {})
    }));
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    return {
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}/admin`
    };
};

const patchUser = (baseUrl, session, uid, body) => fetch(`${baseUrl}/users/${uid}`, {
    method: 'PATCH',
    headers: {
        Cookie: `__session=${session}`,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
});

test('admin mutation routes use server identity and preserve policy status and code', async () => {
    const calls = [];
    const { server, baseUrl } = await startServer(async input => {
        calls.push(input);
        if (input.actor.role !== 'super_admin') {
            const error = new Error('Only super administrators may change roles.');
            error.code = 'ROLE_CHANGE_REQUIRES_SUPER_ADMIN';
            error.status = 403;
            throw error;
        }
        return { uid: input.uid, role: input.role, status: input.status };
    });
    try {
        const deniedUser = await patchUser(baseUrl, 'user', 'target', {
            role: 'admin', status: 'active'
        });
        assert.equal(deniedUser.status, 403);
        assert.equal(calls.length, 0);

        const deniedAdmin = await patchUser(baseUrl, 'admin', 'target', {
            role: 'admin', status: 'active'
        });
        assert.equal(deniedAdmin.status, 403);
        assert.deepEqual(await deniedAdmin.json(), {
            error: 'Only super administrators may change roles.',
            code: 'ROLE_CHANGE_REQUIRES_SUPER_ADMIN'
        });
        assert.equal(calls[0].actor, identities.admin);

        const allowedSuper = await patchUser(baseUrl, 'super', 'target', {
            role: 'admin', status: 'active'
        });
        assert.equal(allowedSuper.status, 200);
        assert.equal(calls[1].actor, identities.super);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});

test('role/status changes are durably audited on success and never on a denied attempt', async () => {
    const durableAuditCalls = [];
    const { server, baseUrl } = await startServer(async input => {
        if (input.actor.role !== 'super_admin') {
            const error = new Error('Only super administrators may change roles.');
            error.code = 'ROLE_CHANGE_REQUIRES_SUPER_ADMIN';
            error.status = 403;
            throw error;
        }
        return { uid: input.uid, role: input.role, status: input.status };
    }, {
        recordDurableAudit: async event => { durableAuditCalls.push(event); },
    });
    try {
        const denied = await patchUser(baseUrl, 'admin', 'target', { role: 'admin', status: 'active' });
        assert.equal(denied.status, 403);
        assert.equal(durableAuditCalls.length, 0, 'a denied mutation must never be recorded as if it happened');

        const allowed = await patchUser(baseUrl, 'super', 'target', { role: 'admin', status: 'active' });
        assert.equal(allowed.status, 200);
        assert.equal(durableAuditCalls.length, 1);
        assert.deepEqual(durableAuditCalls[0], {
            type: 'admin.user.updated',
            details: { actorUid: 'super-a', targetUid: 'target', role: 'admin', status: 'active' },
        });
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
