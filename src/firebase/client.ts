import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import {
    browserLocalPersistence,
    getAuth,
    setPersistence,
    type Auth
} from 'firebase/auth';

let authPromise: Promise<Auth> | null = null;

const buildTimeConfig = (): FirebaseOptions => ({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
});

const isComplete = (config: FirebaseOptions) =>
    Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);

const loadRuntimeConfig = async (): Promise<FirebaseOptions> => {
    const built = buildTimeConfig();
    if (isComplete(built)) return built;
    const response = await fetch('/api/config/firebase');
    if (!response.ok) throw new Error('Firebase client configuration is unavailable.');
    const runtime = await response.json();
    if (!isComplete(runtime)) throw new Error('Firebase client configuration is incomplete.');
    return runtime;
};

export const getFirebaseAuth = () => {
    authPromise ||= loadRuntimeConfig().then(async config => {
        const app = getApps().length ? getApp() : initializeApp(config);
        const auth = getAuth(app);
        await setPersistence(auth, browserLocalPersistence);
        return auth;
    });
    return authPromise;
};
