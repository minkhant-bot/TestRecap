import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createPaymentProofStorage,
  inspectPaymentProof,
  PaymentProofStorageError,
} from './paymentProofStorage.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const configurationFor = storageRoot => ({
  maxMegabytes: 1,
  maxBytes: 1024,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  extensions: ['jpg', 'png', 'webp'],
  storageProvider: 'data_dir_private',
  storageBucket: 'payment-proofs',
  storageRoot,
});
const objectKey = 'payment-proofs/11111111-1111-4111-8111-111111111111/2026/08/22222222-2222-4222-8222-222222222222.png';

test('private proof storage validates, persists, replays, and survives service restart', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blink-proof-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configuration = configurationFor(root);
  const storage = createPaymentProofStorage({ configuration });
  const inspected = storage.inspect({ buffer: png, mimetype: 'image/png', originalname: '../../receipt.png' });
  assert.equal(inspected.mimeType, 'image/png');
  assert.equal(inspected.extension, 'png');
  assert.match(inspected.sha256, /^[0-9a-f]{64}$/);

  assert.equal((await storage.store(objectKey, inspected)).replayed, false);
  assert.equal((await storage.store(objectKey, inspected)).replayed, true);
  const restartedStorage = createPaymentProofStorage({ configuration });
  const restored = await restartedStorage.read({
    objectKey,
    mimeType: inspected.mimeType,
    originalFilename: inspected.originalFilename,
    sizeBytes: inspected.sizeBytes,
    sha256: inspected.sha256,
  });
  assert.deepEqual(restored.buffer, png);
  const storedPath = path.join(root, objectKey.slice('payment-proofs/'.length));
  assert.equal((await fs.stat(storedPath)).mode & 0o777, 0o600);
});

test('proof validation rejects empty, oversized, unsupported, malformed, and mismatched input', () => {
  const configuration = { ...configurationFor('/unused'), maxBytes: png.length - 1 };
  const expectCode = (operation, code) => assert.throws(
    operation,
    error => error instanceof PaymentProofStorageError && error.code === code,
  );
  expectCode(() => inspectPaymentProof({ buffer: Buffer.alloc(0), mimetype: 'image/png' }, configurationFor('/unused')), 'PROOF_EMPTY');
  expectCode(() => inspectPaymentProof({ buffer: png, mimetype: 'image/png' }, configuration), 'PROOF_TOO_LARGE');
  expectCode(() => inspectPaymentProof({ buffer: Buffer.from('not-an-image'), mimetype: 'image/gif' }, configurationFor('/unused')), 'PROOF_MALFORMED');
  expectCode(() => inspectPaymentProof({ buffer: png, mimetype: 'image/jpeg' }, configurationFor('/unused')), 'PROOF_TYPE_MISMATCH');
  const gif = Buffer.from('GIF89a-valid-looking-but-unsupported');
  expectCode(() => inspectPaymentProof({ buffer: gif, mimetype: 'image/gif' }, configurationFor('/unused')), 'PROOF_TYPE_UNSUPPORTED');
});

test('proof storage rejects unsafe references, collisions, integrity failures, and missing files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blink-proof-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storage = createPaymentProofStorage({ configuration: configurationFor(root) });
  const inspected = storage.inspect({ buffer: png, mimetype: 'image/png', originalname: 'proof.png' });
  await assert.rejects(storage.store('../../public/proof.png', inspected), error => error.code === 'PROOF_REFERENCE_INVALID');
  await storage.store(objectKey, inspected);
  const changed = { ...inspected, buffer: Buffer.concat([png, Buffer.from('changed')]), sizeBytes: png.length + 7, sha256: 'a'.repeat(64) };
  await assert.rejects(storage.store(objectKey, changed), error => error.code === 'PROOF_STORAGE_COLLISION');
  await assert.rejects(storage.read({ objectKey, mimeType: 'image/png', originalFilename: 'proof.png', sizeBytes: inspected.sizeBytes, sha256: 'b'.repeat(64) }), error => error.code === 'PROOF_INTEGRITY_FAILED');
  await assert.rejects(storage.read({ ...inspected, objectKey: objectKey.replace('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333') }), error => error.code === 'PROOF_FILE_MISSING');
});

test('cleanup removes only abandoned atomic temporary files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'blink-proof-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'nested');
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, '.44444444-4444-4444-8444-444444444444.tmp');
  const permanent = path.join(directory, 'keep.png');
  await fs.writeFile(temporary, png);
  await fs.writeFile(permanent, png);
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await fs.utimes(temporary, old, old);
  const storage = createPaymentProofStorage({ configuration: configurationFor(root) });
  assert.equal((await storage.cleanupTemporaryFiles()).length, 1);
  await assert.rejects(fs.access(temporary));
  await fs.access(permanent);
});
