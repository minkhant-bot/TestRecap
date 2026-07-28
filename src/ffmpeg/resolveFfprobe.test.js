import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFfprobePath } from './resolveFfprobe.js';

test('prefers system ffprobe without consulting the static binary', () => {
    let staticChecked = false;
    const result = resolveFfprobePath('/static/ffprobe', {
        execFileSync: (command, args) => {
            assert.equal(command, 'ffprobe');
            assert.deepEqual(args, ['-version']);
        },
        accessSync: () => { staticChecked = true; }
    });
    assert.equal(result, 'ffprobe');
    assert.equal(staticChecked, false);
});

test('uses executable ffprobe-static when system ffprobe is unavailable', () => {
    const result = resolveFfprobePath('/static/ffprobe', {
        execFileSync: () => { throw new Error('ENOENT'); },
        accessSync: (path, mode) => {
            assert.equal(path, '/static/ffprobe');
            assert.equal(mode, 1);
        }
    });
    assert.equal(result, '/static/ffprobe');
});

test('fails fast with both attempted sources when neither is usable', () => {
    assert.throws(() => resolveFfprobePath('/missing/ffprobe', {
        execFileSync: () => { throw new Error('ENOENT'); },
        accessSync: () => { throw new Error('ENOENT'); }
    }), /system command "ffprobe".*missing or not executable at "\/missing\/ffprobe"/);
});
