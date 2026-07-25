import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const settingsStore = new Map();

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
const keyPath = path.join(dataDir, 'encryption.key');

let encryptionKey;
if (fs.existsSync(keyPath)) {
    encryptionKey = fs.readFileSync(keyPath);
} else {
    encryptionKey = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, encryptionKey);
}

const ENCRYPTION_ALGORITHM = 'aes-256-cbc';

function encrypt(text) {
    if (!text) return text;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
    if (!text) return text;
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, encryptionKey, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

export const getSetting = (key) => {
    const _getRaw = (k) => {
        const value = settingsStore.get(k);
        if (value === undefined) return null;
        try {
            return decrypt(value);
        } catch (e) {
            console.error('Failed to decrypt setting', k, e);
            return null;
        }
    };

    if (key === 'DIALOGUE_MODE') {
        let val = _getRaw('DIALOGUE_MODE');
        if (val !== null) return val;
        
        let oldNarration = _getRaw('NARRATION_MODE');
        if (oldNarration === 'dialogue') return 'true';
        if (oldNarration === 'colloquial' || oldNarration === 'normal') return 'false';
        
        let oldTranslation = _getRaw('TRANSLATION_STYLE');
        if (oldTranslation === 'dialogue') return 'true';
        return 'false';
    }
    
    if (key === 'COLLOQUIAL_MODE') {
        let val = _getRaw('COLLOQUIAL_MODE');
        if (val !== null) return val;
        
        let oldNarration = _getRaw('NARRATION_MODE');
        if (oldNarration === 'colloquial') return 'true';
        if (oldNarration === 'dialogue' || oldNarration === 'normal') return 'false';
        
        let oldNaturalness = _getRaw('BURMESE_NATURALNESS');
        if (oldNaturalness === 'high_colloquial') return 'true';
        return 'false';
    }

    return _getRaw(key);
};

export const setSetting = (key, value) => {
    if (key === 'GEMINI_API_KEY') {
        console.warn(`[Settings] Rejected persistent save of security key: ${key}`);
        return;
    }
    const encrypted = encrypt(value);
    settingsStore.set(key, encrypted);
};

export const deleteSetting = (key) => {
    settingsStore.delete(key);
};

export const getAllSettingsMasked = () => {
    const keys = ['EDGE_TTS_VOICE', 'DIALOGUE_MODE', 'COLLOQUIAL_MODE', 'VOICE_SPEED', 'VOICE_PITCH', 'AUDIO_LOUDNESS', 'SYNC_MODE', 'OUTPUT_SPEED_MULTIPLIER'];
    const result = {
        GEMINI_API_KEY: { configured: false }
    };
    for (const k of keys) {
        const val = getSetting(k);
        if (val) {
            if (k.endsWith('_KEY')) {
                const masked = '•'.repeat(16) + val.slice(-4);
                result[k] = { configured: true, masked };
            } else {
                result[k] = { configured: true, value: val };
            }
        } else {
            result[k] = { configured: false };
        }
    }
    return result;
};
