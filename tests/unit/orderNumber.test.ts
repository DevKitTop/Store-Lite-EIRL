import {
  generateOrderNumber,
  ORDER_NUMBER_PATTERN,
  sanitizeTicketFileName,
} from '@/core/payments/orderNumber';
import { afterEach, describe, expect, test, vi } from 'vitest';

// =====================================================
// src/core/payments/orderNumber.ts — W-P4 generator contract (Slice 1)
// The buyer's order number is the only handle that reaches a
// payments row without a DNI check, so it must not be
// reconstructible from a purchase window. This suite pins the
// three properties that kill enumeration:
//   1. format — 12 uppercase hex nibbles (48 bits), no clock
//   2. legacy tolerance — the 8-char shape already in DEV still validates
//   3. filename injectivity — the ticket PNG name is the order number,
//      uploaded with upsert: true, so a collapsing character would let
//      one buyer overwrite another buyer's ticket
// =====================================================

// Independent oracle: asserted as a literal so the suite never grades
// the exported constant against itself.
const PINNED_PATTERN = /^ORD-[A-Za-z0-9_-]{8,20}$/;
const HEX_SUFFIX = /^[0-9A-F]{12}$/;

afterEach(() => {
  vi.useRealTimers();
});

describe('generateOrderNumber', () => {
  test('returns the ORD- prefix plus exactly 12 uppercase hex characters', () => {
    const orderNumber = generateOrderNumber();

    expect(orderNumber.slice(0, 4)).toBe('ORD-');
    expect(orderNumber.slice(4)).toHaveLength(12);
    // Hex-encoding raw bytes means only 0-9A-F can appear, and the
    // uppercase cast is what makes the charset disjoint from lowercase.
    expect(orderNumber.slice(4)).toMatch(HEX_SUFFIX);
    expect(orderNumber).toHaveLength(16);
  });

  test('every generated value matches the pinned pattern and the 32-char ceiling', () => {
    for (let i = 0; i < 1_000; i++) {
      const orderNumber = generateOrderNumber();

      expect(orderNumber).toMatch(PINNED_PATTERN);
      expect(orderNumber.length).toBeLessThanOrEqual(32);
    }
  });

  test('two rapid successive calls return different values', () => {
    // Same tick, no await between them: a clock-derived or unseeded
    // counter implementation would repeat here.
    const first = generateOrderNumber();
    const second = generateOrderNumber();

    expect(second).not.toBe(first);
  });

  test('10,000 generations yield 10,000 distinct values', () => {
    const seen = new Set<string>();

    for (let i = 0; i < 10_000; i++) {
      seen.add(generateOrderNumber());
    }

    expect(seen.size).toBe(10_000);
  });

  test('a frozen clock still produces distinct values', () => {
    // The root-cause guard for P4-2. If the suffix were derived from
    // Date.now() (or new Date()), every call inside one frozen tick
    // would return the identical string and this collapses to 1.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'));

    const seen = new Set<string>();

    for (let i = 0; i < 100; i++) {
      seen.add(generateOrderNumber());
    }

    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

describe('ORDER_NUMBER_PATTERN', () => {
  test('is exactly the pinned P4-6 literal, with no global flag', () => {
    // Pinned by spec requirement P4-6. If this drifts, the migration's
    // `!~ '^ORD-[A-Za-z0-9_-]{8,20}$'` format scan (Slice 4) and this
    // validator silently disagree about which rows are legal.
    expect(ORDER_NUMBER_PATTERN.source).toBe(PINNED_PATTERN.source);
    // A /g or /y regex keeps `lastIndex` between .test() calls and
    // returns alternating false results — the classic "every other
    // validation mysteriously fails" bug.
    expect(ORDER_NUMBER_PATTERN.global).toBe(false);
    expect(ORDER_NUMBER_PATTERN.sticky).toBe(false);
  });

  test('validates a generated value on every consecutive call', () => {
    // Statelessness, proven through the API rather than the flags alone.
    const value = generateOrderNumber();

    expect(ORDER_NUMBER_PATTERN.test(value)).toBe(true);
    expect(ORDER_NUMBER_PATTERN.test(value)).toBe(true);
    expect(ORDER_NUMBER_PATTERN.test(value)).toBe(true);
  });

  test('accepts the 8-char minimum and the 20-char maximum suffix', () => {
    expect(ORDER_NUMBER_PATTERN.test(`ORD-${'a'.repeat(8)}`)).toBe(true);
    expect(ORDER_NUMBER_PATTERN.test(`ORD-${'A'.repeat(20)}`)).toBe(true);
  });

  test('rejects suffixes outside the 8..20 window', () => {
    expect(ORDER_NUMBER_PATTERN.test(`ORD-${'a'.repeat(7)}`)).toBe(false);
    expect(ORDER_NUMBER_PATTERN.test(`ORD-${'a'.repeat(21)}`)).toBe(false);
    expect(ORDER_NUMBER_PATTERN.test('ORD-')).toBe(false);
  });

  test('rejects a missing or altered ORD- prefix', () => {
    expect(ORDER_NUMBER_PATTERN.test('ABCDEF012345')).toBe(false);
    expect(ORDER_NUMBER_PATTERN.test('ord-abcdef012345')).toBe(false);
    expect(ORDER_NUMBER_PATTERN.test('ORD_abcdef012345')).toBe(false);
    expect(ORDER_NUMBER_PATTERN.test(' XORD-abcdef012345')).toBe(false);
  });

  test('rejects characters outside [A-Za-z0-9_-]', () => {
    // A dot, a space and a slash all break the verify path segment and
    // would collapse to the same "_" in the ticket filename.
    expect(ORDER_NUMBER_PATTERN.test('ORD-abcdef.01234')).toBe(false);
    expect(ORDER_NUMBER_PATTERN.test('ORD-abcdef 01234')).toBe(false);
    expect(ORDER_NUMBER_PATTERN.test('ORD-abcdef/01234')).toBe(false);
    expect(ORDER_NUMBER_PATTERN.test('ORD-abcdef%01234')).toBe(false);
  });

  test('accepts lower and upper case, so legacy values stay legal', () => {
    // The charset is deliberately [A-Za-z0-9_-], not [A-F0-9]: the
    // generator only emits uppercase hex, but the 83 values already in
    // DEV are lowercase and must not be invalidated by a format change.
    expect(ORDER_NUMBER_PATTERN.test('ORD-abcdef01')).toBe(true);
    expect(ORDER_NUMBER_PATTERN.test('ORD-ABCDEF01')).toBe(true);
    expect(ORDER_NUMBER_PATTERN.test('ORD-a_b-C9xy')).toBe(true);
  });
});

describe('sanitizeTicketFileName', () => {
  test('is the identity on every generated order number', () => {
    // The route uploads `${sanitized}.png` with upsert: true, so the
    // sanitizer has to be a no-op for legal values. Anything else means
    // one buyer's ticket can replace another buyer's ticket in storage.
    for (let i = 0; i < 500; i++) {
      const orderNumber = generateOrderNumber();

      expect(sanitizeTicketFileName(orderNumber)).toBe(orderNumber);
    }
  });

  test('is the identity on the 8-char legacy shape too', () => {
    const legacyValues = [
      'ORD-3f9a2b1c',
      'ORD-A1B2C3D4',
      'ORD-00ff11aa',
      'ORD-zzz9_9zz',
      'ORD-________',
    ];

    for (const legacy of legacyValues) {
      expect(ORDER_NUMBER_PATTERN.test(legacy)).toBe(true);
      expect(sanitizeTicketFileName(legacy)).toBe(legacy);
    }
  });

  test('collapses out-of-set characters to a single underscore, like the route', () => {
    // Mirrors app/api/ticket/generate/route.ts:264. That inline copy is
    // replaced by this helper in Slice 3; until then this test is what
    // proves the two behaviours are the same function.
    expect(sanitizeTicketFileName('ORD-abc/012')).toBe('ORD-abc_012');
    expect(sanitizeTicketFileName('ORD-abc.012')).toBe('ORD-abc_012');
    expect(sanitizeTicketFileName('ORD a b')).toBe('ORD_a_b');
    expect(sanitizeTicketFileName('ORD-abc éà')).toBe('ORD-abc___');
    // Path separators collapse too, so the value cannot escape the bucket.
    expect(sanitizeTicketFileName('ORD-../etc')).toBe('ORD-___etc');
  });

  test('never merges two distinct legal order numbers into one filename', () => {
    // The collision property, stated directly: if injectivity ever broke,
    // upsert: true would hand buyer B the PNG that belongs to buyer A.
    const filenames = new Map<string, string>();

    for (let i = 0; i < 2_000; i++) {
      const orderNumber = generateOrderNumber();
      const fileName = sanitizeTicketFileName(orderNumber);
      const owner = filenames.get(fileName);

      expect(owner).toBeUndefined();
      filenames.set(fileName, orderNumber);
    }

    expect(filenames.size).toBe(2_000);
  });

  test('keeps legacy and freshly generated names disjoint', () => {
    const legacyFileName = sanitizeTicketFileName('ORD-3f9a2b1c');

    for (let i = 0; i < 500; i++) {
      expect(sanitizeTicketFileName(generateOrderNumber())).not.toBe(legacyFileName);
    }
  });
});

describe('legacy compatibility', () => {
  // The DEV reality the spec pins: 83 rows already carry an order number
  // and 2 of those have a printed ticket whose QR embeds the value. Nothing
  // in this change may invalidate them, so they have to clear the very same
  // validator the migration's format scan uses.
  const LEGACY_UUIDS = [
    '3f9a2b1c',
    'a1b2c3d4',
    '00ff11aa',
    'deadbeef',
    '0badc0de',
    'feedface',
    'c0ffee11',
    '8badf00d',
    '01234567',
    '89abcdef',
  ];

  const LEGACY_BASE36 = ['KZ7M2Q9X', 'A1B2C3D4', 'ZZZZZZZZ', '00000000', '9QX7M2KZ', 'M4N8P2Q6'];

  const legacyValues = [
    ...LEGACY_UUIDS.map((suffix) => `ORD-${suffix}`),
    ...LEGACY_BASE36.map((suffix) => `ORD-${suffix}`),
  ];

  test('the 8-char shapes derived from the old generators stay valid', () => {
    // Shape A is what app/api/payment/create-order/route.ts:159 actually
    // produced (`ORD-${crypto.randomUUID().slice(0, 8)}` — lowercase hex).
    // Shape B is the uppercase base-36 shape the design doc describes.
    // Both are subsets of [A-Za-z0-9], so one validator covers both.
    for (const legacy of legacyValues) {
      expect(legacy.slice(0, 4)).toBe('ORD-');
      expect(legacy.slice(4)).toHaveLength(8);
      expect(ORDER_NUMBER_PATTERN.test(legacy)).toBe(true);
    }

    expect(legacyValues).toHaveLength(16);
  });

  test('83 legacy-shaped values all clear the pinned pattern', () => {
    // Sized to the DEV row count from the spec reality check. Deterministic
    // values only — the property under test is the validator's, not the
    // generator's.
    const legacyShape = /^[0-9a-f]{8}$/;
    const values = Array.from({ length: 83 }, (_, index) => {
      const nibbles = index.toString(16).padStart(8, '0');

      expect(nibbles).toMatch(legacyShape);

      return `ORD-${nibbles}`;
    });

    const rejected = values.filter((value) => !ORDER_NUMBER_PATTERN.test(value));

    expect(rejected).toEqual([]);
    expect(values).toHaveLength(83);
  });

  test('a generated value can never take a legacy shape, and vice versa', () => {
    // Structural disjointness, not statistical luck: the legacy suffix is
    // exactly 8 characters and the generated suffix is exactly 12, so the
    // two sets cannot intersect under the anchored pattern. This is what
    // stops the UNIQUE index (Slice 4) from ever colliding across
    // generations.
    const generated = Array.from({ length: 1_000 }, () => generateOrderNumber());

    for (const value of generated) {
      expect(value.slice(4)).toHaveLength(12);
      expect(legacyValues).not.toContain(value);
    }

    expect(generated).toHaveLength(1_000);
  });
});
