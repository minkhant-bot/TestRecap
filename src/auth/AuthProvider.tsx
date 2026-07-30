import {
    onIdTokenChanged,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    type User
} from 'firebase/auth';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getFirebaseAuth } from '../firebase/client';

export type SaaSRole = 'super_admin' | 'admin' | 'user';
export interface UserProfile {
    uid: string;
    displayName: string;
    email: string;
    photoURL: string;
    role: SaaSRole;
    createdAt: string | null;
    updatedAt: string | null;
    lastLoginAt: string | null;
    status: 'active' | 'disabled';
}

interface AuthContextValue {
    firebaseUser: User | null;
    profile: UserProfile | null;
    loading: boolean;
    configurationError: string | null;
    sessionError: string | null;
    signInWithGoogle(): Promise<void>;
    logout(): Promise<void>;
    refreshProfile(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [configurationError, setConfigurationError] = useState<string | null>(null);
    const [sessionError, setSessionError] = useState<string | null>(null);

    const establishBackendSession = async (user: User) => {
        const token = await user.getIdToken(true);
        const response = await fetch('/api/auth/session', {
            method: 'POST',
            credentials: 'include',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: '{}'
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || 'App Session ကို စတင်၍မရပါ။');
        }
        const payload = await response.json();
        setProfile(payload.user);
        setSessionError(null);
    };

    const restoreBackendSession = async () => {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        if (!response.ok) return false;
        setProfile(await response.json());
        setSessionError(null);
        return true;
    };

    useEffect(() => {
        let active = true;
        let unsubscribe = () => {};
        getFirebaseAuth()
            .then(auth => {
                if (!active) return;
                unsubscribe = onIdTokenChanged(auth, async user => {
                    if (!active) return;
                    setLoading(true);
                    setFirebaseUser(user);
                    try {
                        const restored = await restoreBackendSession();
                        if (!restored && user) await establishBackendSession(user);
                        if (!restored && !user) setProfile(null);
                    } catch {
                        setProfile(null);
                        setSessionError('Your session could not be restored. Please sign in again.');
                        if (user) await signOut(auth).catch(() => undefined);
                    } finally {
                        if (active) setLoading(false);
                    }
                });
            })
            .catch(error => {
                console.error('Firebase persistence initialization failed', error);
                if (active) {
                    setConfigurationError(error?.message || 'Firebase ဆက်တင် မအောင်မြင်ပါ။');
                    setLoading(false);
                }
            });
        return () => {
            active = false;
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (!profile) return;
        let active = true;
        const validate = async () => {
            const response = await fetch('/api/auth/me', { credentials: 'include' }).catch(() => null);
            if (!active || !response || response.status !== 401) return;
            const auth = await getFirebaseAuth();
            await signOut(auth).catch(() => undefined);
            if (active) {
                setProfile(null);
                setSessionError('Your session expired. Sign in again to continue.');
            }
        };
        const interval = window.setInterval(() => void validate(), 5 * 60 * 1000);
        const onVisibility = () => {
            if (document.visibilityState === 'visible') void validate();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            active = false;
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [profile]);

    useEffect(() => {
        const expire = async () => {
            const auth = await getFirebaseAuth();
            await signOut(auth).catch(() => undefined);
            setProfile(null);
            setSessionError('Your session expired. Sign in again to continue.');
        };
        window.addEventListener('testrecap:session-expired', expire);
        return () => window.removeEventListener('testrecap:session-expired', expire);
    }, []);

    const value = useMemo<AuthContextValue>(() => ({
        firebaseUser,
        profile,
        loading,
        configurationError,
        sessionError,
        signInWithGoogle: async () => {
            const auth = await getFirebaseAuth();
            setSessionError(null);
            const credential = await signInWithPopup(auth, googleProvider);
            await establishBackendSession(credential.user);
        },
        logout: async () => {
            const auth = await getFirebaseAuth();
            const response = await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });
            if (!response.ok && response.status !== 401) {
                throw new Error('လုံခြုံစွာ အကောင့်မှ ထွက်၍မရပါ။');
            }
            await signOut(auth);
            setProfile(null);
            setSessionError(null);
        },
        refreshProfile: async () => {
            const response = await fetch('/api/auth/me', { credentials: 'include' });
            if (response.status === 401) {
                const auth = await getFirebaseAuth();
                await signOut(auth);
                setProfile(null);
                throw new Error('Session သက်တမ်းကုန်သွားပါပြီ။');
            }
            if (!response.ok) throw new Error('အကောင့်ကို ပြန်လည်ရယူ၍မရပါ။');
            setProfile(await response.json());
        }
    }), [configurationError, firebaseUser, loading, profile, sessionError]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
    const value = useContext(AuthContext);
    if (!value) throw new Error('useAuth must be used inside AuthProvider.');
    return value;
};
