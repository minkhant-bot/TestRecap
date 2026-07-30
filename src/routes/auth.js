import express from 'express';
import {
    establishGoogleSession,
    revokeFirebaseSessions
} from '../services/firebaseAdmin.js';
import { requireAuth, SESSION_COOKIE_NAME } from '../middleware/auth.js';

const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1000;

export const createAuthRouter = ({
    establishSession = establishGoogleSession,
    revokeSessions = revokeFirebaseSessions
} = {}) => {
const router = express.Router();

router.post('/session', async (req, res) => {
    const authorization = String(req.headers.authorization || '');
    const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!idToken) return res.status(400).json({ error: 'Firebase ID token is required.' });
    try {
        const { profile, sessionCookie } = await establishSession({
            idToken,
            expiresIn: SESSION_DURATION_MS
        });
        res.cookie(SESSION_COOKIE_NAME, sessionCookie, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: SESSION_DURATION_MS,
            path: '/'
        });
        return res.json({ user: profile });
    } catch (error) {
        const status = error?.code === 'AUTH_USER_DISABLED' ? 403 : 401;
        return res.status(status).json({ error: error?.message || 'Unable to create session.' });
    }
});

router.use(requireAuth);
router.get('/me', (req, res) => res.json(req.user));

router.post('/logout', async (req, res) => {
    try {
        if (req.user?.uid) await revokeSessions(req.user.uid);
    } finally {
        res.clearCookie(SESSION_COOKIE_NAME, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/'
        });
    }
    res.json({ loggedOut: true });
});

return router;
};

export default createAuthRouter();
