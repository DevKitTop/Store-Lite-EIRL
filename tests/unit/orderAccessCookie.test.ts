// =====================================================
// orderAccessCookie — the signed full-access marker (R13 / R18, design D7-D9)
// =====================================================
// `/{slug}/order/{token}` serves a projection of the payment row: with no
// verified marker it must carry an explicit column allowlist and withhold every
// buyer PII field (R14). This module is what upgrades that request to the full
// row — and it is the ONLY thing standing between "the buyer's browser once
// proved this token belongs to this DNI" and "any browser with the token URL".
//
// Three properties are load-bearing, and each is pinned below:
//
//   1. TOKEN BINDING — the tracking token is inside the signed payload, so a
//      cookie minted for order A cannot be replayed against order B. A cookie
//      value that carried only `exp` + a bare HMAC would verify on ANY order.
//      Test (5) copies A's exact value into B's slot to prove the signature is
//      over the token, not merely over the expiry.
//   2. FAIL CLOSED ON AN UNSET SECRET (R18) — `env.orderAccessCookieSecret`
//      defaults to `''`, DELIBERATELY not to a dev fallback like
//      `otpHashSecret`'s. A known fallback would make an unset PRODUCTION
//      secret silently AUTHORIZE, which is the exact inversion this guards.
//      Test (10) mints a well-formed cookie and then pulls the secret.
//   3. NO LENGTH PRECONDITION — the attacker fully controls the cookie length,
//      and raw `timingSafeEqual` THROWS when its inputs differ in length. The
//      comparison goes through `safeTokenEqual` (`src/lib/tokenCompare.ts:32`),
//      which SHA-256-digests both sides first. Test (9) feeds it short and
//      malformed values so a regression to raw `timingSafeEqual` shows up as a
//      thrown TypeError rather than a silent pass.
//
// The cookie store is a fake (`next/headers` is mocked) but the module under
// test is the REAL one, including its own `createHmac` — so the value shape is
// asserted end to end rather than against a second implementation of it.
// =====================================================

import {
  deleteOrderAccessCookie,
  orderAccessCookieName,
  setOrderAccessCookie,
  verifyOrderAccessCookie,
} from '@/lib/orderAccessCookie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────

/** One recorded `cookieStore.set(...)` call — the exact attributes the module chose. */
interface RecordedCookie {
  name: string;
  value: string;
  httpOnly?: boolean;
  maxAge?: number;
  sameSite?: string;
  path?: string;
  secure?: boolean;
  domain?: string;
}

const { mockEnv, store, setCalls, mockCookiesFn } = vi.hoisted(() => ({
  // A mutable stand-in for `@/config/env` so a single suite can prove both the
  // "secret present" and the "secret unset" halves of R18 without module resets.
  mockEnv: { orderAccessCookieSecret: 'order-access-secret-for-tests' },
  store: new Map<string, string>(),
  setCalls: [] as RecordedCookie[],
  mockCookiesFn: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: mockCookiesFn }));

vi.mock('@/config/env', () => ({ env: mockEnv }));

const TOKEN_A = 'tok-order-a';
const TOKEN_B = 'tok-order-b';

beforeEach(() => {
  store.clear();
  setCalls.length = 0;
  mockEnv.orderAccessCookieSecret = 'order-access-secret-for-tests';
  mockCookiesFn.mockImplementation(async () => ({
    get: (name: string) => {
      const value = store.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (cookie: RecordedCookie) => {
      setCalls.push(cookie);
      // Mirror real cookie semantics: maxAge 0 removes the cookie.
      if (cookie.maxAge === 0) store.delete(cookie.name);
      else store.set(cookie.name, cookie.value);
    },
    delete: (name: string) => {
      store.delete(name);
    },
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Suite: the cookie name ───────────────────────────

describe('orderAccessCookieName', () => {
  it('is derived from the tracking token so every order gets its own slot', () => {
    expect(orderAccessCookieName(TOKEN_A)).toBe(`order_access_${TOKEN_A}`);
  });

  it('does not collide across two orders', () => {
    expect(orderAccessCookieName(TOKEN_A)).not.toBe(orderAccessCookieName(TOKEN_B));
  });
});

// ── Suite: minting (design D8) ──────────────────────

describe('setOrderAccessCookie', () => {
  it('writes httpOnly / maxAge 3600 / SameSite=Lax / path / and NO domain', async () => {
    await setOrderAccessCookie(TOKEN_A);

    expect(setCalls).toHaveLength(1);
    const cookie = setCalls[0];
    expect(cookie.name).toBe(`order_access_${TOKEN_A}`);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.maxAge).toBe(3600);
    expect(cookie.sameSite).toBe('lax');
    // Route is /{slug}/order/{token} — no narrower fixed path can match, and a
    // `domain` would leak the marker to sibling tenant subdomains.
    expect(cookie.path).toBe('/');
    expect(cookie.domain).toBeUndefined();
    expect(cookie.secure).toBe(process.env.NODE_ENV === 'production');
  });

  it('signs `{expMs}.{base64url HMAC}` where the token is INSIDE the payload', async () => {
    const before = Date.now();
    await setOrderAccessCookie(TOKEN_A);
    const after = Date.now();

    const [expPart, signature, ...rest] = store.get(`order_access_${TOKEN_A}`)!.split('.');
    expect(rest).toHaveLength(0);
    // The expiry is stamped one hour out, inside the call window.
    expect(Number(expPart)).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(Number(expPart)).toBeLessThanOrEqual(after + 3_600_000);
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(signature).not.toContain(TOKEN_A);
  });

  it('mints a different signature per order even at the same instant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));

    await setOrderAccessCookie(TOKEN_A);
    await setOrderAccessCookie(TOKEN_B);

    // Identical expiry, identical secret, different token ⇒ different digest.
    // Without the token inside the payload these two values would be equal.
    const a = store.get(`order_access_${TOKEN_A}`)!;
    const b = store.get(`order_access_${TOKEN_B}`)!;
    expect(a.split('.')[0]).toBe(b.split('.')[0]);
    expect(a).not.toBe(b);
  });
});

// ── Suite: verifying ────────────────────────────────

describe('verifyOrderAccessCookie', () => {
  it('accepts a cookie it just minted', async () => {
    await setOrderAccessCookie(TOKEN_A);
    expect(await verifyOrderAccessCookie(TOKEN_A)).toBe(true);
  });

  it('rejects when no cookie exists at all', async () => {
    expect(await verifyOrderAccessCookie(TOKEN_A)).toBe(false);
  });

  it('R13: a cookie minted for order A is useless on order B', async () => {
    await setOrderAccessCookie(TOKEN_A);

    // The naive case: B's slot is simply empty.
    expect(await verifyOrderAccessCookie(TOKEN_B)).toBe(false);

    // The load-bearing case: A's EXACT value pasted into B's slot. Only a
    // signature computed over `{token, exp}` can reject this.
    store.set(`order_access_${TOKEN_B}`, store.get(`order_access_${TOKEN_A}`)!);
    expect(await verifyOrderAccessCookie(TOKEN_B)).toBe(false);
  });

  it('rejects a tampered signature', async () => {
    await setOrderAccessCookie(TOKEN_A);
    const raw = store.get(`order_access_${TOKEN_A}`)!;
    const [exp, signature] = raw.split('.');
    // Flip the last base64url char to a different one.
    const flipped = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
    store.set(`order_access_${TOKEN_A}`, `${exp}.${flipped}`);

    expect(await verifyOrderAccessCookie(TOKEN_A)).toBe(false);
  });

  it('rejects an expiry extended by the holder (the expiry is signed too)', async () => {
    await setOrderAccessCookie(TOKEN_A);
    const raw = store.get(`order_access_${TOKEN_A}`)!;
    const [, signature] = raw.split('.');
    store.set(`order_access_${TOKEN_A}`, `${Date.now() + 86_400_000}.${signature}`);

    expect(await verifyOrderAccessCookie(TOKEN_A)).toBe(false);
  });

  it('rejects an expired cookie even though its signature is intact', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
    await setOrderAccessCookie(TOKEN_A);

    // Still inside the window.
    vi.setSystemTime(new Date('2026-03-01T12:59:59Z'));
    expect(await verifyOrderAccessCookie(TOKEN_A)).toBe(true);

    // One second past the hour — the 1h self-heal window has closed.
    vi.setSystemTime(new Date('2026-03-01T13:00:00Z'));
    expect(await verifyOrderAccessCookie(TOKEN_A)).toBe(false);
  });

  it.each([
    ['a bare word with no separator', 'garbage'],
    ['a single character', 'x'],
    ['an empty expiry', '.abcdefghij'],
    ['a non-numeric expiry', 'notanumber.abcdefghij'],
    ['a 3-character signature over a valid expiry', '1767225600000.abc'],
    ['a huge unpadded signature', `${'1767225600000'}.${'A'.repeat(512)}`],
    ['a separator with no expiry', '..'],
    ['an empty value', ''],
  ])('returns false WITHOUT throwing for %s', async (_label, value) => {
    store.set(`order_access_${TOKEN_A}`, value);

    // The length precondition this pins: raw `timingSafeEqual` throws a
    // TypeError when the buffers differ in length, and this value's length is
    // attacker-controlled. `safeTokenEqual` digests both sides first.
    await expect(verifyOrderAccessCookie(TOKEN_A)).resolves.toBe(false);
  });
});

// ── Suite: R18 fail-closed on an unset secret ────────

describe('verifyOrderAccessCookie — unset secret', () => {
  it('returns false for a well-formed cookie when the secret is empty', async () => {
    await setOrderAccessCookie(TOKEN_A);
    expect(await verifyOrderAccessCookie(TOKEN_A)).toBe(true);

    // Pull the secret out from under the live cookie — e.g. the deploy that
    // forgot to set ORDER_ACCESS_COOKIE_SECRET.
    mockEnv.orderAccessCookieSecret = '';

    await expect(verifyOrderAccessCookie(TOKEN_A)).resolves.toBe(false);
  });

  it('still mints without throwing when the secret is empty (fail closed, not fail loud)', async () => {
    mockEnv.orderAccessCookieSecret = '';
    await expect(setOrderAccessCookie(TOKEN_A)).resolves.toBeUndefined();
  });
});

// ── Suite: revoking (design D8) ─────────────────────

describe('deleteOrderAccessCookie', () => {
  it('repeats path / byte-identically so the browser actually drops it', async () => {
    await setOrderAccessCookie(TOKEN_A);
    setCalls.length = 0;

    await deleteOrderAccessCookie(TOKEN_A);

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].name).toBe(`order_access_${TOKEN_A}`);
    // A mismatch here is a silent failure in the browser: the delete does not
    // match the set, so the cookie survives logout with full access intact.
    expect(setCalls[0].path).toBe('/');
    expect(setCalls[0].domain).toBeUndefined();
    expect(setCalls[0].httpOnly).toBe(true);
    expect(setCalls[0].sameSite).toBe('lax');
    expect(setCalls[0].maxAge).toBe(0);
    expect(setCalls[0].value).toBe('');
  });

  it('leaves a revoked cookie unverifiable', async () => {
    await setOrderAccessCookie(TOKEN_A);
    await deleteOrderAccessCookie(TOKEN_A);

    expect(store.has(`order_access_${TOKEN_A}`)).toBe(false);
    expect(await verifyOrderAccessCookie(TOKEN_A)).toBe(false);
  });

  it('only revokes its own order', async () => {
    await setOrderAccessCookie(TOKEN_A);
    await setOrderAccessCookie(TOKEN_B);

    await deleteOrderAccessCookie(TOKEN_A);

    expect(await verifyOrderAccessCookie(TOKEN_A)).toBe(false);
    expect(await verifyOrderAccessCookie(TOKEN_B)).toBe(true);
  });
});
