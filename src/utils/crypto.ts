import { logger, toErrorDetail } from '@/lib/logger';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * 🔐 Store Lite Security Utility
 * Encrypts and decrypts sensitive strings (like Culqi Secret Keys)
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

const MISSING_KEY_ERROR =
  'ENCRYPTION_KEY is not set. Stored secrets cannot be encrypted or decrypted without it.';

let cachedKey: Buffer | null = null;
let cachedKeySource: string | null = null;

/**
 * The AES key derived from `ENCRYPTION_KEY`.
 *
 * There is no fallback. This used to fall back to 32 zero bytes outside
 * production, which is a constant in the source: anything "encrypted" with it
 * is readable by whoever can read the database, and the real environment
 * cannot decrypt it. One staging row was written that way and every charge for
 * that business failed with an undecryptable credential.
 *
 * Failing here is loud and cheap; the alternative is silent data that only
 * fails much later, in front of a customer.
 *
 * Derived lazily and cached so importing this module never depends on the
 * environment, and rotating the variable between calls is still picked up.
 */
function encryptionKey(): Buffer {
  const source = process.env.ENCRYPTION_KEY?.trim();

  if (!source) {
    throw new Error(MISSING_KEY_ERROR);
  }

  if (!cachedKey || cachedKeySource !== source) {
    cachedKey = scryptSync(source, 'salt', 32);
    cachedKeySource = source;
  }

  return cachedKey;
}

/** True for the `iv:payload:authTag` shape this module writes. */
function looksEncrypted(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 3 && parts.every((part) => part.length > 0 && /^[0-9a-f]+$/i.test(part));
}

/**
 * Encrypts a text using AES-256-GCM
 */
export function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  // Format: iv:encrypted:authTag
  return `${iv.toString('hex')}:${encrypted}:${authTag}`;
}

/**
 * Decrypts a text using AES-256-GCM
 *
 * A value that is not in the ciphertext shape is returned unchanged: older rows
 * still hold the raw `sk_` credential, and the one-off script rewrites them.
 */
export function decrypt(cipherText: string): string {
  if (!looksEncrypted(cipherText)) {
    // Not ciphertext: an old plain-text key, kept readable during the transition.
    if (cipherText.startsWith('sk_')) return cipherText;
    throw new Error('Invalid cipher text format');
  }

  try {
    const [ivHex, encrypted, authTagHex] = cipherText.split(':');
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivHex, 'hex'));

    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    logger.error('crypto: decryption failed', { error: toErrorDetail(error) });
    // During transition, if it starts with sk_, it's probably not encrypted yet
    if (cipherText.startsWith('sk_')) return cipherText;
    throw new Error('Could not decrypt the secret key. Ensure ENCRYPTION_KEY is correct.');
  }
}
