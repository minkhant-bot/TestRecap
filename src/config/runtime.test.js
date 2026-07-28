import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { getServerBinding, getStoragePaths } from './runtime.js';

test('production binding uses Railway PORT and 0.0.0.0', () => {
    assert.deepEqual(getServerBinding({ NODE_ENV: 'production', PORT: '8080' }), {
        port: 8080,
        host: '0.0.0.0'
    });
    assert.deepEqual(getServerBinding({ NODE_ENV: 'development' }), {
        port: 3000,
        host: '0.0.0.0'
    });
});

test('DATA_DIR preserves local paths when absent and contains Railway artifacts when set', () => {
    const projectRoot = path.resolve('/workspace/TestRecap');
    assert.deepEqual(getStoragePaths({}, projectRoot), {
        root: projectRoot,
        uploads: path.join(projectRoot, 'src', 'tmp'),
        cache: path.join(projectRoot, 'data', 'cache'),
        output: path.join(projectRoot, 'public', 'output'),
        settings: path.join(projectRoot, 'data')
    });
    assert.deepEqual(getStoragePaths({ DATA_DIR: '/data' }, projectRoot), {
        root: '/data',
        uploads: '/data/uploads',
        cache: '/data/cache',
        output: '/data/output',
        settings: '/data'
    });
});
