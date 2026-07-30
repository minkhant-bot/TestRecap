import { verifyFirebaseIdentity } from '../services/firebaseAdmin.js';

export const SESSION_COOKIE_NAME = '__session';

const readCookies = header => Object.fromEntries(
    String(header || '').split(';').map(item => item.trim()).filter(Boolean).map(item => {
        const separator = item.indexOf('=');
        return separator < 0
            ? [decodeURIComponent(item), '']
            : [decodeURIComponent(item.slice(0, separator)), decodeURIComponent(item.slice(separator + 1))];
    })
);

export const createRequireAuth = ({ verifyIdentity = verifyFirebaseIdentity } = {}) =>
    async (req, res, next) => {
        const sessionCookie = readCookies(req.headers.cookie)[SESSION_COOKIE_NAME] || null;
        if (!sessionCookie) {
            return res.status(401).json({ error: 'Authentication required.' });
        }
        try {
            req.user = await verifyIdentity({ sessionCookie });
            return next();
        } catch (error) {
            const status = error?.code === 'AUTH_USER_DISABLED' ? 403 : 401;
            return res.status(status).json({ error: error?.message || 'Invalid authentication token.' });
        }
    };

let runtimeVerifyIdentity = verifyFirebaseIdentity;
export const setAuthVerifierForTests = verifier => {
    runtimeVerifyIdentity = verifier || verifyFirebaseIdentity;
};
export const requireAuth = createRequireAuth({
    verifyIdentity: input => runtimeVerifyIdentity(input)
});

export const isAdminRole = role => ['admin', 'super_admin'].includes(role);

export const requireAdmin = (req, res, next) => {
    if (!isAdminRole(req.user?.role)) {
        return res.status(403).json({ error: 'Administrator access required.' });
    }
    return next();
};

export const canAccessJob = (user, job) =>
    Boolean(user && job && (isAdminRole(user.role) || job.ownerUid === user.uid));

export const requireJobAccess = (req, res, job) => {
    if (!job) {
        res.status(404).json({ error: 'Job not found.' });
        return false;
    }
    if (!canAccessJob(req.user, job)) {
        res.status(403).json({ error: 'You do not have access to this project.' });
        return false;
    }
    return true;
};
