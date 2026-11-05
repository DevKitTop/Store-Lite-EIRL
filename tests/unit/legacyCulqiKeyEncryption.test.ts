// =====================================================
// Legacy Culqi key detection
//
// The one-off script rewrites plain-text keys in `business_settings`. Getting
// the split wrong is destructive in both directions:
//
//   - selecting a ciphertext encrypts it twice, and the seller's key becomes
//     undecryptable;
//   - skipping a plain-text key leaves a live payment credential exposed.
//
// So the predicate gets its own test, with the shapes that actually exist in
// the database rather than invented ones.
// =====================================================

import { describe, expect, it } from 'vitest';
import { isEncryptedCulqiKey, selectLegacyKeys } from '../../scripts/encrypt-legacy-culqi-keys';

// 32 hex iv, payload, 32 hex auth tag - the format `encrypt()` writes.
const CIPHERTEXT = `${'a'.repeat(32)}:${'b'.repeat(48)}:${'c'.repeat(32)}`;
// What staging actually has: a 24-character live key.
const PLAIN_TEXT = 'sk_test_1234567890abcdef';
const PLAIN_TEXT_LIVE = 'sk_live_abcdefghijklmnop';

describe('isEncryptedCulqiKey', () => {
  it('recognises the shape the application writes', () => {
    expect(isEncryptedCulqiKey(CIPHERTEXT)).toBe(true);
  });

  it('does not mistake a plain-text key for a ciphertext', () => {
    expect(isEncryptedCulqiKey(PLAIN_TEXT)).toBe(false);
    expect(isEncryptedCulqiKey(PLAIN_TEXT_LIVE)).toBe(false);
  });

  it('does not accept partial ciphertexts that would be double-encrypted', () => {
    expect(isEncryptedCulqiKey(`${'a'.repeat(32)}:${'b'.repeat(48)}`)).toBe(false);
    expect(isEncryptedCulqiKey(`${'a'.repeat(32)}::${'c'.repeat(32)}`)).toBe(false);
    expect(isEncryptedCulqiKey(`iv:encrypted:tag`)).toBe(false);
  });
});

describe('selectLegacyKeys', () => {
  it('selects only the rows still in plain text', () => {
    const rows = [
      { business_id: 'biz-1', culqi_secret_key: CIPHERTEXT },
      { business_id: 'biz-2', culqi_secret_key: PLAIN_TEXT },
      { business_id: 'biz-3', culqi_secret_key: PLAIN_TEXT_LIVE },
    ];

    expect(selectLegacyKeys(rows).map((row) => row.business_id)).toEqual(['biz-2', 'biz-3']);
  });

  it('finds nothing to do once every row is encrypted', () => {
    const rows = [
      { business_id: 'biz-1', culqi_secret_key: CIPHERTEXT },
      { business_id: 'biz-2', culqi_secret_key: CIPHERTEXT },
    ];

    expect(selectLegacyKeys(rows)).toEqual([]);
  });
});
