import crypto from 'node:crypto';
import { config } from '../config.js';

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const key = Buffer.from(config.masterKey, 'hex');
  if (key.length !== 32) {
    throw new Error(
      'CPWORK_MASTER_KEY must be 32 bytes hex (64 hex chars). Generate with: openssl rand -hex 32',
    );
  }
  return key;
}

/** Encrypt a plaintext secret. Returns iv:tag:ciphertext (hex). */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

/** Decrypt a value produced by encryptSecret. Returns null on failure. */
export function decryptSecret(payload: string): string | null {
  try {
    const [ivHex, tagHex, dataHex] = payload.split(':');
    if (!ivHex || !tagHex || !dataHex) return null;
    const decipher = crypto.createDecipheriv(
      ALGO,
      getKey(),
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}
