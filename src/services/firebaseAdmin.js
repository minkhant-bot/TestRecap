import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'node:fs';
import path from 'node:path';
import { upsertAuthUser } from './authUserStore.js';

export const VALID_ROLES = Object.freeze(['user', 'admin', 'super_admin']);
const VALID_ROLE_SET = new Set(VALID_ROLES);
const PRIVILEGE = Object.freeze({ user: 0, admin: 1, super_admin: 2 });
let accessMutationTail = Promise.resolve();

export class AuthorizationPolicyError extends Error {
    constructor(message, { code = 'AUTHORIZATION_POLICY_VIOLATION', status = 403 } = {}) {
        super(message);
        this.name = 'AuthorizationPolicyError';
        this.code = code;
        this.status = status;
    }
}

export const getBootstrapSuperAdminUids = (env = process.env) => {
    const raw = env.FIREBASE_SUPER_ADMIN_UIDS?.trim();
    if (!raw) return new Set();
    const values = raw.split(',').map(value => value.trim());
    if (values.some(uid => !uid || uid.length > 128 || /[\s,]/.test(uid))) {
        throw new Error('FIREBASE_SUPER_ADMIN_UIDS must be a comma-separated list of valid Firebase UIDs.');
    }
    return new Set(values);
};

const parseServiceAccount = env => {
    const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
    if (raw) {
        try {
            return JSON.parse(raw);
        } catch {
            try {
                return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
            } catch {
                throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON or base64 JSON.');
            }
        }
    }

    const configuredFile = env.FIREBASE_SERVICE_ACCOUNT_FILE?.trim();
    const localFile = path.resolve(process.cwd(), configuredFile || 'firebase-admin.json');
    if (!fs.existsSync(localFile)) return null;
    try {
        return JSON.parse(fs.readFileSync(localFile, 'utf8'));
    } catch {
        throw new Error('Firebase service-account file is not valid JSON.');
    }
};

export const getFirebaseAdminAuth = (env = process.env) => {
    if (getApps().length === 0) {
        const serviceAccount = parseServiceAccount(env);
        initializeApp({
            credential: serviceAccount ? cert(serviceAccount) : applicationDefault(),
            ...(env.FIREBASE_PROJECT_ID ? { projectId: env.FIREBASE_PROJECT_ID } : {})
        });
    }
    return getAuth();
};

export const getAuthoritativeRole = (userRecord, env = process.env) => {
    if (!userRecord?.uid) throw new Error('Firebase user record is missing a UID.');
    if (getBootstrapSuperAdminUids(env).has(userRecord.uid)) return 'super_admin';
    const claimedRole = userRecord.customClaims?.role;
    if (claimedRole === undefined) return 'user';
    if (typeof claimedRole !== 'string' || !VALID_ROLE_SET.has(claimedRole)) {
        const error = new Error('Firebase role claim is malformed or unsupported.');
        error.code = 'AUTH_ROLE_CLAIM_INVALID';
        throw error;
    }
    return claimedRole;
};

export const toUserProfile = (userRecord, env = process.env) => ({
    uid: userRecord.uid,
    displayName: userRecord.displayName || '',
    email: userRecord.email || '',
    photoURL: userRecord.photoURL || '',
    role: getAuthoritativeRole(userRecord, env),
    createdAt: userRecord.metadata?.creationTime || null,
    updatedAt: userRecord.metadata?.lastRefreshTime || userRecord.metadata?.lastSignInTime || null,
    lastLoginAt: userRecord.metadata?.lastSignInTime || null,
    status: userRecord.disabled ? 'disabled' : 'active'
});

const assertGoogleIdentity = (decoded, userRecord) => {
    const tokenProvider = decoded.firebase?.sign_in_provider;
    const hasGoogleProvider = userRecord.providerData?.some(provider => provider.providerId === 'google.com');
    if (tokenProvider !== 'google.com' || !hasGoogleProvider) {
        const error = new Error('Only Google accounts may sign in.');
        error.code = 'AUTH_PROVIDER_NOT_ALLOWED';
        throw error;
    }
};

export const verifyFirebaseIdentity = async ({
    idToken = null,
    sessionCookie = null,
    auth = getFirebaseAdminAuth(),
    env = process.env
}) => {
    const decoded = idToken
        ? await auth.verifyIdToken(idToken, true)
        : await auth.verifySessionCookie(sessionCookie, true);
    const userRecord = await auth.getUser(decoded.uid);
    assertGoogleIdentity(decoded, userRecord);
    if (userRecord.disabled) {
        const error = new Error('User account is disabled.');
        error.code = 'AUTH_USER_DISABLED';
        throw error;
    }
    return toUserProfile(userRecord, env);
};

export const establishGoogleSession = async ({
    idToken,
    expiresIn,
    auth = getFirebaseAdminAuth(),
    env = process.env
}) => {
    const decoded = await auth.verifyIdToken(idToken, true);
    const userRecord = await auth.getUser(decoded.uid);
    assertGoogleIdentity(decoded, userRecord);
    if (userRecord.disabled) {
        const error = new Error('User account is disabled.');
        error.code = 'AUTH_USER_DISABLED';
        throw error;
    }

    const role = getAuthoritativeRole(userRecord, env);
    if (userRecord.customClaims?.role !== role) {
        await auth.setCustomUserClaims(userRecord.uid, {
            ...(userRecord.customClaims || {}),
            role
        });
    }

    const profile = upsertAuthUser({ ...toUserProfile(userRecord, env), role });
    const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });
    return { profile, sessionCookie };
};

export const revokeFirebaseSessions = async (uid, auth = getFirebaseAdminAuth()) =>
    auth.revokeRefreshTokens(uid);

export const listFirebaseUsers = async (auth = getFirebaseAdminAuth(), env = process.env) => {
    const users = [];
    let pageToken;
    do {
        const page = await auth.listUsers(1000, pageToken);
        users.push(...page.users.map(user => toUserProfile(user, env)));
        pageToken = page.pageToken;
    } while (pageToken);
    return users;
};

export const updateFirebaseUserAccess = async ({
    uid,
    role,
    status,
    actor,
    auth = getFirebaseAdminAuth(),
    env = process.env
}) => {
    const operation = async () => {
        if (!actor?.uid) {
            throw new AuthorizationPolicyError('A valid administrator identity is required.');
        }
        const actorRecord = await auth.getUser(actor.uid);
        const actorRole = getAuthoritativeRole(actorRecord, env);
        if (actorRecord.disabled || PRIVILEGE[actorRole] < PRIVILEGE.admin) {
            throw new AuthorizationPolicyError('Administrator access is no longer active.', {
                code: 'ADMIN_AUTHORITY_STALE'
            });
        }
        if (!VALID_ROLE_SET.has(role)) {
            throw new AuthorizationPolicyError('Role must be super_admin, admin, or user.', {
                code: 'INVALID_ROLE',
                status: 400
            });
        }
        if (!['active', 'disabled'].includes(status)) {
            throw new AuthorizationPolicyError('Status must be active or disabled.', {
                code: 'INVALID_STATUS',
                status: 400
            });
        }

        const existing = await auth.getUser(uid);
        const existingRole = getAuthoritativeRole(existing, env);
        const requestedDisabled = status === 'disabled';
        const bootstrapUids = getBootstrapSuperAdminUids(env);

        if (actor.uid === uid &&
            (role !== existingRole || requestedDisabled !== Boolean(existing.disabled))) {
            throw new AuthorizationPolicyError(
                'Administrators cannot change their own role or disabled status.',
                { code: 'ADMIN_SELF_LOCKOUT_FORBIDDEN' }
            );
        }

        if (actorRole !== 'super_admin') {
            if (role !== existingRole) {
                throw new AuthorizationPolicyError(
                    'Only super administrators may change roles.',
                    { code: 'ROLE_CHANGE_REQUIRES_SUPER_ADMIN' }
                );
            }
            if (PRIVILEGE[existingRole] >= PRIVILEGE[actorRole]) {
                throw new AuthorizationPolicyError(
                    'Administrators cannot modify peer or higher-privileged accounts.',
                    { code: 'PEER_ADMIN_MUTATION_FORBIDDEN' }
                );
            }
        }

        if (bootstrapUids.has(uid) && (role !== 'super_admin' || requestedDisabled)) {
            throw new AuthorizationPolicyError(
                'Configured bootstrap super administrators cannot be demoted or disabled.',
                { code: 'BOOTSTRAP_SUPER_ADMIN_PROTECTED', status: 409 }
            );
        }

        if (existingRole === 'super_admin' && (role !== 'super_admin' || requestedDisabled)) {
            const users = [];
            let pageToken;
            do {
                const page = await auth.listUsers(1000, pageToken);
                users.push(...page.users);
                pageToken = page.pageToken;
            } while (pageToken);
            const otherActiveSuperAdmins = users.filter(user =>
                user.uid !== uid &&
                !user.disabled &&
                getAuthoritativeRole(user, env) === 'super_admin'
            );
            if (otherActiveSuperAdmins.length === 0) {
                throw new AuthorizationPolicyError(
                    'The last active super administrator cannot be demoted or disabled.',
                    { code: 'LAST_SUPER_ADMIN_PROTECTED', status: 409 }
                );
            }
        }

        const previousClaims = { ...(existing.customClaims || {}) };
        const previousDisabled = Boolean(existing.disabled);
        try {
            if (role !== existingRole || existing.customClaims?.role !== role) {
                await auth.setCustomUserClaims(uid, { ...previousClaims, role });
            }
            if (requestedDisabled !== previousDisabled) {
                await auth.updateUser(uid, { disabled: requestedDisabled });
            }
        } catch (error) {
            try {
                await auth.setCustomUserClaims(uid, previousClaims);
                await auth.updateUser(uid, { disabled: previousDisabled });
            } catch {}
            throw error;
        }
        return auth.getUser(uid);
    };

    const result = accessMutationTail.then(operation, operation);
    accessMutationTail = result.catch(() => undefined);
    return result;
};
