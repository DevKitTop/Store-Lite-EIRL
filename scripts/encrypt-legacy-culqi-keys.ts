/**
 * Encrypts Culqi secret keys that are still stored in plain text.
 *
 * `business_settings.culqi_secret_key` holds two shapes:
 *
 *   - `iv:encrypted:authTag` — what `updateCulqiCredentials` writes today,
 *     AES-256-GCM with `ENCRYPTION_KEY`;
 *   - the raw `sk_...` key — rows written before that encryption existed.
 *
 * `decrypt()` handles both, which is why the app works. But a plain-text row is
 * a live payment credential sitting in the database and, until PR #312, in the
 * seller's browser payload as well. This rewrites those rows in place.
 *
 * It has to run with the application's `ENCRYPTION_KEY`, so it is a script and
 * not a SQL migration: the key is not available to the database.
 *
 * Dry run by default. `--apply` performs the writes. Idempotent: a second run
 * finds nothing to do.
 *
 * Usage: pnpm tsx scripts/encrypt-legacy-culqi-keys.ts [--apply]
 */
import 'dotenv/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import postgres from 'postgres';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

/** `iv:payload:authTag`, all hex — the only shape this script leaves alone. */
const ENCRYPTED_PATTERN = /^[0-9a-f]{32}:[0-9a-f]+:[0-9a-f]{32}$/;

/**
 * The key `encrypt()` falls back to when `ENCRYPTION_KEY` is unset outside
 * production. It is 32 zero bytes: a constant anyone can read from the source.
 *
 * A value encrypted with it is not protected at all, and the real environment
 * cannot decrypt it, so it has to be rewritten exactly like plain text.
 */
const DEV_FALLBACK_KEY = Buffer.alloc(32, 0);

/**
 * True for a value the application has already encrypted.
 *
 * Exported so a test can pin it: treating a ciphertext as plain text would
 * encrypt it twice and make the stored key unreadable, while treating a
 * plain-text key as ciphertext would leave the credential exposed.
 */
export function isEncryptedCulqiKey(value: string): boolean {
  return ENCRYPTED_PATTERN.test(value);
}

function decryptWithKey(value: string, key: Buffer): string {
  const [ivHex, payload, tagHex] = value.split(':');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(payload, 'hex', 'utf8') + decipher.final('utf8');
}

/**
 * True when the value is ciphertext produced with the development fallback.
 *
 * It looks encrypted, so the plain-text check misses it, but it is readable by
 * anyone holding the database and undecryptable by the real environment.
 */
export function isDevFallbackCiphertext(value: string): boolean {
  if (!isEncryptedCulqiKey(value)) {
    return false;
  }

  try {
    decryptWithKey(value, DEV_FALLBACK_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Rows that must be rewritten: plain text, or ciphertext under a known-public key. */
export function needsRewrite(value: string): boolean {
  return !isEncryptedCulqiKey(value) || isDevFallbackCiphertext(value);
}

/**
 * The rows this script has to rewrite.
 *
 * Exported and pure so a test can prove the split both ways: a plain-text key
 * must be selected, and a properly encrypted value must never be (encrypting
 * it again would make the stored credential undecryptable).
 */
export function selectLegacyKeys<T extends { culqi_secret_key: string }>(rows: T[]): T[] {
  return rows.filter((row) => needsRewrite(row.culqi_secret_key));
}

/** The plain-text value behind any row, whichever shape it is in today. */
export function revealCulqiKey(value: string, key: Buffer): string {
  if (!isEncryptedCulqiKey(value)) {
    return value;
  }

  const decryptionKey = isDevFallbackCiphertext(value) ? DEV_FALLBACK_KEY : key;
  return decryptWithKey(value, decryptionKey);
}

function encryptWithKey(text: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}:${cipher.getAuthTag().toString('hex')}`;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  const rawKey = process.env.ENCRYPTION_KEY;

  if (!connectionString) {
    throw new Error('DATABASE_URL or POSTGRES_URL is required.');
  }
  if (apply && !rawKey) {
    // Without it, the script would write values the app can never decrypt.
    // A dry run only reads, so it does not need the key.
    throw new Error('ENCRYPTION_KEY is required to encrypt stored keys.');
  }

  const { scryptSync } = await import('node:crypto');
  const key = rawKey ? scryptSync(rawKey, 'salt', 32) : null;

  const sql = postgres(connectionString, { max: 1, prepare: false });

  try {
    const rows = await sql<{ business_id: string; culqi_secret_key: string }[]>`
      select business_id, culqi_secret_key
      from public.business_settings
      where culqi_secret_key is not null
      order by business_id
    `;

    const legacy = selectLegacyKeys(rows);

    console.log(
      `Scanned ${rows.length} configured business(es): ` +
        `${rows.length - legacy.length} encrypted, ${legacy.length} to rewrite ` +
        `(${legacy.filter((row) => isDevFallbackCiphertext(row.culqi_secret_key)).length} under the dev fallback key).`,
    );

    if (legacy.length === 0) {
      console.log('Nothing to do.');
      return;
    }

    if (!apply) {
      console.log('Dry run. Re-run with --apply to encrypt them.');
      return;
    }

    for (const row of legacy) {
      if (!key) {
        throw new Error('ENCRYPTION_KEY is required to encrypt stored keys.');
      }
      const plain = revealCulqiKey(row.culqi_secret_key, key);
      const encrypted = encryptWithKey(plain, key);
      await sql`
        update public.business_settings
        set culqi_secret_key = ${encrypted}, updated_at = now()
        where business_id = ${row.business_id}::uuid
          and culqi_secret_key = ${row.culqi_secret_key}
      `;
      // Never print the value or a prefix of it.
      console.log(`Encrypted the key for business ${row.business_id}.`);
    }

    console.log(`Done. ${legacy.length} key(s) encrypted.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1]?.includes('encrypt-legacy-culqi-keys')) {
  main().catch((error: unknown) => {
    console.error('Failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
