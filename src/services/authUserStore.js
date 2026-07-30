import fs from 'fs';
import path from 'path';
import { getStoragePaths } from '../config/runtime.js';

const profilesFile = () => path.join(getStoragePaths().settings, 'auth-users.json');

const readProfiles = () => {
    const file = profilesFile();
    if (!fs.existsSync(file)) return {};
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        throw new Error('Authentication profile store is unreadable.');
    }
};

const writeProfiles = profiles => {
    const file = profilesFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(profiles, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, file);
};

export const upsertAuthUser = identity => {
    const profiles = readProfiles();
    const previous = profiles[identity.uid];
    const now = new Date().toISOString();
    const profile = {
        uid: identity.uid,
        email: identity.email,
        displayName: identity.displayName,
        photoURL: identity.photoURL,
        role: identity.role,
        createdAt: previous?.createdAt || identity.createdAt || now,
        updatedAt: now,
        lastLoginAt: now,
        status: identity.status
    };
    profiles[identity.uid] = profile;
    writeProfiles(profiles);
    return profile;
};

export const getAuthUser = uid => readProfiles()[uid] || null;

export const clearAuthUserStoreForTests = () => {
    const file = profilesFile();
    if (fs.existsSync(file)) fs.unlinkSync(file);
};
