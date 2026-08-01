import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPaymentProofConfiguration } from '../config/paymentProof.js';

const OBJECT_KEY_PATTERN = /^payment-proofs\/[0-9a-f-]{36}\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/i;
const TEMPORARY_FILE_PATTERN = /^\.[0-9a-f-]{36}\.tmp$/i;

export class PaymentProofStorageError extends Error {
  constructor(message, { code = 'PROOF_STORAGE_ERROR', status = 400 } = {}) {
    super(message);
    this.name = 'PaymentProofStorageError';
    this.code = code;
    this.status = status;
  }
}

const fail = (message, code, status = 400) => {
  throw new PaymentProofStorageError(message, { code, status });
};

const hasPrefix = (buffer, bytes) => bytes.every((value, index) => buffer[index] === value);
const hasSuffix = (buffer, bytes) => bytes.every(
  (value, index) => buffer[buffer.length - bytes.length + index] === value,
);

const crc32 = buffer => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const validPng = buffer => {
  if (!hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return false;
  let offset = 8;
  let chunkIndex = 0;
  let sawImageData = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) return false;
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    if (crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== expectedCrc) return false;
    if (chunkIndex === 0 && (type !== 'IHDR' || length !== 13 ||
        buffer.readUInt32BE(offset + 8) === 0 || buffer.readUInt32BE(offset + 12) === 0)) return false;
    if (type === 'IDAT') sawImageData = true;
    if (type === 'IEND') return length === 0 && sawImageData && end === buffer.length;
    offset = end;
    chunkIndex += 1;
  }
  return false;
};

const validJpeg = buffer => {
  if (!hasPrefix(buffer, [0xff, 0xd8, 0xff]) || !hasSuffix(buffer, [0xff, 0xd9])) return false;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  let dimensionsFound = false;
  while (offset + 4 <= buffer.length - 2) {
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xda) return dimensionsFound;
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return false;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return false;
    if (sofMarkers.has(marker)) {
      if (length < 7 || buffer.readUInt16BE(offset + 3) === 0 || buffer.readUInt16BE(offset + 5) === 0) return false;
      dimensionsFound = true;
    }
    offset += length;
  }
  return false;
};

const validWebp = buffer => {
  if (buffer.length < 20 || buffer.subarray(0, 4).toString('ascii') !== 'RIFF' ||
      buffer.subarray(8, 12).toString('ascii') !== 'WEBP' ||
      buffer.readUInt32LE(4) !== buffer.length - 8) return false;
  let offset = 12;
  let imageChunk = false;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString('ascii');
    const length = buffer.readUInt32LE(offset + 4);
    const end = offset + 8 + length;
    if (end > buffer.length) return false;
    if (['VP8 ', 'VP8L', 'VP8X'].includes(type)) imageChunk = length > 0;
    offset = end + (length % 2);
  }
  return imageChunk && offset === buffer.length;
};

const detectImageType = buffer => {
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) {
    return { mimeType: 'image/gif', extension: 'gif' };
  }
  if (validJpeg(buffer)) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (validPng(buffer)) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (validWebp(buffer)) {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  fail('The payment proof is empty, malformed, or not a supported image.', 'PROOF_MALFORMED', 415);
};

const safeObjectPath = (objectKey, storageRoot) => {
  const match = String(objectKey || '').match(OBJECT_KEY_PATTERN);
  if (!match) fail('The payment proof storage reference is invalid.', 'PROOF_REFERENCE_INVALID', 500);
  const relative = objectKey.slice('payment-proofs/'.length);
  const root = path.resolve(storageRoot);
  const target = path.resolve(root, relative);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    fail('The payment proof storage reference is outside the private root.', 'PROOF_REFERENCE_INVALID', 500);
  }
  return { target, extension: match[1].toLowerCase() };
};

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

export const inspectPaymentProof = (
  file,
  configuration = getPaymentProofConfiguration(),
) => {
  const buffer = file?.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    fail('Select a non-empty payment proof image.', 'PROOF_EMPTY', 400);
  }
  if (buffer.length > configuration.maxBytes) {
    fail(`Payment proof exceeds the ${configuration.maxMegabytes} MB limit.`, 'PROOF_TOO_LARGE', 413);
  }
  const detected = detectImageType(buffer);
  const claimedMimeType = String(file?.mimetype || '').trim().toLowerCase();
  if (!configuration.mimeTypes.includes(detected.mimeType)) {
    fail('This payment proof image type is not supported.', 'PROOF_TYPE_UNSUPPORTED', 415);
  }
  if (claimedMimeType !== detected.mimeType) {
    fail('The payment proof content does not match its declared image type.', 'PROOF_TYPE_MISMATCH', 415);
  }
  return {
    buffer,
    mimeType: detected.mimeType,
    extension: detected.extension,
    sizeBytes: buffer.length,
    sha256: sha256(buffer),
    originalFilename: String(file?.originalname || 'payment-proof').slice(0, 255),
  };
};

export const createPaymentProofStorage = ({
  configuration = getPaymentProofConfiguration(),
} = {}) => ({
  configuration,
  inspect: file => inspectPaymentProof(file, configuration),
  async store(objectKey, inspected) {
    const resolved = safeObjectPath(objectKey, configuration.storageRoot);
    if (resolved.extension !== inspected.extension) {
      fail('The payment proof extension does not match its validated content.', 'PROOF_TYPE_MISMATCH', 415);
    }
    await fs.mkdir(path.dirname(resolved.target), { recursive: true, mode: 0o700 });
    try {
      const existing = await fs.readFile(resolved.target);
      if (existing.length !== inspected.sizeBytes || sha256(existing) !== inspected.sha256) {
        fail('The payment proof key already contains different data.', 'PROOF_STORAGE_COLLISION', 409);
      }
      return { replayed: true, path: resolved.target };
    } catch (error) {
      if (error instanceof PaymentProofStorageError) throw error;
      if (error?.code !== 'ENOENT') throw error;
    }

    const temporaryPath = path.join(path.dirname(resolved.target), `.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporaryPath, inspected.buffer, { flag: 'wx', mode: 0o600 });
      try {
        await fs.link(temporaryPath, resolved.target);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const existing = await fs.readFile(resolved.target);
        if (existing.length !== inspected.sizeBytes || sha256(existing) !== inspected.sha256) {
          fail('The payment proof key already contains different data.', 'PROOF_STORAGE_COLLISION', 409);
        }
      }
      await fs.chmod(resolved.target, 0o600);
      return { replayed: false, path: resolved.target };
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  },
  async read(metadata) {
    const resolved = safeObjectPath(metadata?.objectKey, configuration.storageRoot);
    let buffer;
    try {
      buffer = await fs.readFile(resolved.target);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        fail('The stored payment proof file is missing.', 'PROOF_FILE_MISSING', 410);
      }
      throw error;
    }
    const inspected = inspectPaymentProof({
      buffer,
      mimetype: metadata.mimeType,
      originalname: metadata.originalFilename,
    }, configuration);
    if (String(metadata.sizeBytes) !== String(inspected.sizeBytes) ||
        metadata.sha256 !== inspected.sha256) {
      fail('The stored payment proof failed its integrity check.', 'PROOF_INTEGRITY_FAILED', 409);
    }
    return inspected;
  },
  async cleanupTemporaryFiles({ olderThanMs = 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
    const removed = [];
    const walk = async directory => {
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(target);
        else if (TEMPORARY_FILE_PATTERN.test(entry.name)) {
          const stat = await fs.stat(target);
          if (now - stat.mtimeMs >= olderThanMs) {
            await fs.rm(target, { force: true });
            removed.push(target);
          }
        }
      }
    };
    await walk(configuration.storageRoot);
    return removed;
  },
});

export const paymentProofStorage = createPaymentProofStorage();
