// =====================================================
// ENCRYPTION_KEY is required, in every environment
//
// `encrypt()` used to fall back to 32 zero bytes outside production. Anything
// written with that key is readable by anyone who can read the database - the
// key is a constant in the source - and the real environment cannot decrypt it.
// One staging row was written that way; every charge for that business failed.
//
// These tests pin the loud failure: a missing key must throw at the call, not
// silently produce data that breaks later in front of a customer.
// =====================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'test-encryption-key';

async function loadModule() {
  vi.resetModules();
  return import('@/utils/crypto');
}

describe('crypto without ENCRYPTION_KEY', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses to encrypt in development instead of using a public fallback', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { encrypt } = await loadModule();

    expect(() => encrypt('sk_test_123')).toThrow(/ENCRYPTION_KEY is not set/);
  });

  it('refuses to encrypt in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { encrypt } = await loadModule();

    expect(() => encrypt('sk_test_123')).toThrow(/ENCRYPTION_KEY is not set/);
  });

  it('refuses to decrypt a ciphertext', async () => {
    const { decrypt } = await loadModule();
    const ciphertext = `${'a'.repeat(32)}:${'b'.repeat(48)}:${'c'.repeat(32)}`;

    expect(() => decrypt(ciphertext)).toThrow(/Could not decrypt/);
  });

  it('still returns an old plain-text key unchanged', async () => {
    // The one-off script rewrites these; reading them must not need the key.
    const { decrypt } = await loadModule();

    expect(decrypt('sk_test_legacy')).toBe('sk_test_legacy');
  });
});

describe('crypto with ENCRYPTION_KEY', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trips a value', async () => {
    const { encrypt, decrypt } = await loadModule();

    const ciphertext = encrypt('sk_live_abcdefghijklmnop');

    expect(ciphertext).toMatch(/^[0-9a-f]{32}:[0-9a-f]+:[0-9a-f]{32}$/);
    expect(decrypt(ciphertext)).toBe('sk_live_abcdefghijklmnop');
  });

  it('does not decrypt with a different key', async () => {
    const { encrypt } = await loadModule();
    const ciphertext = encrypt('sk_live_abcdefghijklmnop');

    vi.stubEnv('ENCRYPTION_KEY', 'another-key');
    const { decrypt } = await loadModule();

    expect(() => decrypt(ciphertext)).toThrow(/Could not decrypt/);
  });

  it('produces a different ciphertext each time', async () => {
    const { encrypt } = await loadModule();

    // A fresh IV per call: identical inputs must not produce identical rows.
    expect(encrypt('sk_live_same')).not.toBe(encrypt('sk_live_same'));
  });
});
