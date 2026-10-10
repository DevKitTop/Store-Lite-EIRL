// =====================================================
// src/lib/tokenCompare.ts — constant-time buyer token compare (D1)
// The buyer branch of POST /api/ticket/generate must decide
// "is this the caller's trackingToken?" without leaking the answer
// through response time. Hashing both sides normalizes the length,
// so timingSafeEqual receives two 32-byte buffers and cannot throw.
// =====================================================

import { safeTokenEqual } from '@/lib/tokenCompare';
import { describe, expect, test } from 'vitest';

const TRACKING_TOKEN = 'tk_9f2c1b7e4a6d8f0a3b5c7d9e1f3a5b7c';
const OTHER_TOKEN = 'tk_00000000000000000000000000000000';

describe('safeTokenEqual', () => {
  test('returns true for two identical tokens', () => {
    expect(safeTokenEqual(TRACKING_TOKEN, TRACKING_TOKEN)).toBe(true);
  });

  test('returns false for two different tokens of the same length', () => {
    // Same length, so this can only be detected by comparing content.
    expect(OTHER_TOKEN.length).toBe(TRACKING_TOKEN.length);
    expect(safeTokenEqual(TRACKING_TOKEN, OTHER_TOKEN)).toBe(false);
  });

  test('returns false for tokens of different lengths instead of throwing', () => {
    // timingSafeEqual throws when the two buffers differ in length. Reaching a
    // `false` here proves both sides were digested first (32 bytes each), which
    // is the whole point of the hash-before-compare design.
    const longer = `${TRACKING_TOKEN}_suffix`;

    expect(() => safeTokenEqual(TRACKING_TOKEN, longer)).not.toThrow();
    expect(safeTokenEqual(TRACKING_TOKEN, longer)).toBe(false);
  });

  test('returns false when only one side is empty', () => {
    expect(safeTokenEqual('', TRACKING_TOKEN)).toBe(false);
    expect(safeTokenEqual(TRACKING_TOKEN, '')).toBe(false);
  });

  test('returns true when both sides are empty — no empty special case', () => {
    // Documents the helper contract: it compares digests, it does not
    // second-guess blank input. Two blanks are equal digests, so the CALLER
    // is responsible for rejecting an absent token (see the route's buyer gate).
    expect(safeTokenEqual('', '')).toBe(true);
  });

  test('compares the full value: a single changed character flips the result', () => {
    const offByOne = `${TRACKING_TOKEN.slice(0, -1)}d`;

    expect(offByOne).toHaveLength(TRACKING_TOKEN.length);
    expect(safeTokenEqual(TRACKING_TOKEN, offByOne)).toBe(false);
  });

  test('does not trim surrounding whitespace before comparing', () => {
    // Guards against a future "be lenient with the token" refactor: the token
    // must match the stored value exactly, or it is not a proof.
    expect(safeTokenEqual(` ${TRACKING_TOKEN}`, TRACKING_TOKEN)).toBe(false);
    expect(safeTokenEqual(`${TRACKING_TOKEN} `, TRACKING_TOKEN)).toBe(false);
  });

  test('is order-independent, as a constant-time comparison must be', () => {
    expect(safeTokenEqual(TRACKING_TOKEN, OTHER_TOKEN)).toBe(
      safeTokenEqual(OTHER_TOKEN, TRACKING_TOKEN),
    );
    expect(safeTokenEqual(TRACKING_TOKEN, TRACKING_TOKEN)).toBe(
      safeTokenEqual(TRACKING_TOKEN, TRACKING_TOKEN),
    );
  });
});
