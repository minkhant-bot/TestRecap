import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('user Gemini key survives process restart encrypted and scoped by uid', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'testrecap-user-gemini-'));
    const storePath = path.join(root, 'credentials.json');
    const encryptionPath = path.join(root, 'encryption.key');
    const moduleUrl = new URL('./userGeminiKeys.js', import.meta.url).href;
    const env = {
        ...process.env,
        USER_GEMINI_KEY_STORE_PATH: storePath,
        USER_GEMINI_KEY_ENCRYPTION_PATH: encryptionPath
    };
    try {
        execFileSync(process.execPath, [
            '--input-type=module',
            '--eval',
            `const store = await import(${JSON.stringify(moduleUrl)});
             store.setUserGeminiApiKey('user-a', 'restart-secret');`
        ], { env });
        const result = execFileSync(process.execPath, [
            '--input-type=module',
            '--eval',
            `const store = await import(${JSON.stringify(moduleUrl)});
             process.stdout.write(JSON.stringify({
               available: store.hasUserGeminiApiKey('user-a'),
               otherUser: store.hasUserGeminiApiKey('user-b'),
               value: store.getUserGeminiApiKey('user-a')
             }));`
        ], { env, encoding: 'utf8' });
        assert.deepEqual(JSON.parse(result), {
            available: true,
            otherUser: false,
            value: 'restart-secret'
        });
        assert.doesNotMatch(fs.readFileSync(storePath, 'utf8'), /restart-secret/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
