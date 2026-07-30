import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ensureStoragePaths, getStoragePaths } from '../config/runtime.js';

const storagePaths = ensureStoragePaths(getStoragePaths());
const storePath = process.env.USER_GEMINI_KEY_STORE_PATH ||
    path.join(storagePaths.settings, 'user-gemini-credentials.json');
const encryptionKeyPath = process.env.USER_GEMINI_KEY_ENCRYPTION_PATH ||
    path.join(storagePaths.settings, 'encryption.key');

const encryptionKey = (() => {
    if (fs.existsSync(encryptionKeyPath)) return fs.readFileSync(encryptionKeyPath);
    const generated = crypto.randomBytes(32);
    fs.writeFileSync(encryptionKeyPath, generated, { mode: 0o600 });
    return generated;
})();

if (encryptionKey.length !== 32) {
    throw new Error('Gemini credential encryption key must contain exactly 32 bytes.');
}

const credentials = new Map();

const encrypt = value => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return {
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: encrypted.toString('base64')
    };
};

const decrypt = value => {
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        encryptionKey,
        Buffer.from(value.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return Buffer.concat([
        decipher.update(Buffer.from(value.data, 'base64')),
        decipher.final()
    ]).toString('utf8');
};

const persist = () => {
    const temporaryPath = `${storePath}.tmp`;
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(temporaryPath, JSON.stringify({
        schemaVersion: 1,
        credentials: Object.fromEntries(credentials)
    }, null, 2), { mode: 0o600 });
    fs.renameSync(temporaryPath, storePath);
};

const load = () => {
    if (!fs.existsSync(storePath)) return;
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    if (parsed?.schemaVersion !== 1 || !parsed.credentials || typeof parsed.credentials !== 'object') {
        throw new Error('Unsupported user Gemini credential store schema.');
    }
    for (const [uid, encrypted] of Object.entries(parsed.credentials)) {
        credentials.set(uid, encrypted);
    }
};

load();

export const getUserGeminiApiKey = uid => {
    const encrypted = credentials.get(String(uid));
    if (!encrypted) return null;
    try {
        return decrypt(encrypted);
    } catch {
        return null;
    }
};

export const hasUserGeminiApiKey = uid => Boolean(getUserGeminiApiKey(uid));

export const setUserGeminiApiKey = (uid, apiKey) => {
    const normalizedUid = String(uid || '').trim();
    const normalizedKey = String(apiKey || '').trim();
    if (!normalizedUid || !normalizedKey) throw new Error('User and Gemini API key are required.');
    credentials.set(normalizedUid, encrypt(normalizedKey));
    persist();
};

export const deleteUserGeminiApiKey = uid => {
    const deleted = credentials.delete(String(uid));
    if (deleted) persist();
    return deleted;
};

export const getUserGeminiCredentialStorePath = () => storePath;
