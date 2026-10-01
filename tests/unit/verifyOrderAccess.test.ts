// =====================================================
// verifyOrderAccess — buyer order-access gate (R9 / R10, design D5 / D8)
// =====================================================
// `verifyOrderAccess` sits behind `OrderAuthGate`: an unauthenticated buyer
// supplies { trackingToken, dni, orderNumber } and is told yes or no. It is a
// guessing oracle, exactly like its sibling `POST /api/order/lookup`, so it must
// be limited the same way — on the SHARED auth-intent limiter, keyed
// (clientId, dni), BEFORE the payment lookup.
//
// What was wrong before this suite existed:
//
//   * a module-local 5-per-15-min counter keyed by IP ALONE, so one browser
//     shared a budget with every other buyer behind the same egress IP, and
//     6+ attempts at ONE dni were refused while 5 guesses at each of 11 dnis
//     all went through;
//   * its no-header fallback collapsed EVERY header-less caller into one
//     'unknown' bucket regardless of dni, so two buyers with different dnis
//     locked each other out;
//   * the counter had its own lifecycle (its own Map, its own window constant)
//     instead of the shared limiter's cleanup.
//
// Because this is a `'use server'` action it has no NextRequest, so the header
// reader is a plain object: this suite is the FIRST in tests/unit to mock
// `next/headers` (planner note N6) and its mock is written from the structural
// contract of `getClientIdentifierFromHeaders` (design D4), not copied.
//
// The real limiter store is used throughout — only `checkRateLimit` is swapped
// for a spy, so cases (b)-(e) run the actual sliding window. Each case burns its
// OWN client id: the store is module scope and buckets live 15 minutes.
// =====================================================

import {
  verifyOrderAccess,
  verifyOrderByGoogleIdentity,
} from '@/app/[slug]/(app)/order/[token]/actions';
import { RATE_LIMITS, type checkRateLimit as CheckRateLimit } from '@/lib/rateLimit';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────

/** One recorded `cookieStore.set(...)` call. */
interface RecordedCookie {
  name: string;
  value: string;
  maxAge?: number;
  httpOnly?: boolean;
  sameSite?: string;
  path?: string;
}

const {
  holder,
  mockHeaders,
  mockHeadersFn,
  mockCookiesFn,
  cookieStore,
  cookieWrites,
  mockFindFirst,
  mockCheckRateLimit,
  realLimiter,
} = vi.hoisted(() => {
  const holder = new Map<string, string>();
  const cookieStore = new Map<string, string>();
  return {
    holder,
    // A PLAIN OBJECT, not a Headers instance: `ReadonlyHeaders` from
    // `await headers()` satisfies `{ get(name): string | null }` structurally.
    mockHeaders: { get: (name: string) => holder.get(name) ?? null },
    mockHeadersFn: vi.fn(),
    mockCookiesFn: vi.fn(),
    cookieStore,
    cookieWrites: [] as RecordedCookie[],
    mockFindFirst: vi.fn(),
    mockCheckRateLimit: vi.fn(),
    realLimiter: { current: null as null | typeof CheckRateLimit },
  };
});

vi.mock('next/headers', () => ({ headers: mockHeadersFn, cookies: mockCookiesFn }));

vi.mock('@/core/database/client', () => ({
  db: { query: { payments: { findFirst: mockFindFirst } } },
}));

// orderService drags in the email + SMS senders; the gate never transitions an
// order, so the import is stubbed to keep this suite about the gate.
vi.mock('@/core/orders/orderService', () => ({ transition: vi.fn() }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// Keeps RATE_LIMITS and the real store; only `checkRateLimit` is a spy, so the
// real sliding window still decides every bucket.
vi.mock('@/lib/rateLimit', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  realLimiter.current = actual.checkRateLimit as typeof CheckRateLimit;
  return { ...actual, checkRateLimit: mockCheckRateLimit };
});

// ── Fixtures ─────────────────────────────────────────

const AUTH_MAX = RATE_LIMITS.auth.maxRequests; // 10 requests / 15 min
const TOKEN = 'tok-verify-1';
const CORRECT_ORDER = '#4242';
const GOOGLE_UID = 'google-uid-1';

/** The payment exists; only the caller's orderNumber can mismatch it. */
const PAYMENT = { orderNumber: CORRECT_ORDER };

function dniAt(index: number): string {
  return `1000000${index}`;
}

/** A fresh client id per case — buckets survive 15 minutes (planner note N3). */
function useClientIp(ip: string) {
  holder.set('x-forwarded-for', ip);
}

/** No client header at all → the shared 'unknown' client segment. */
function useNoClientHeader() {
  holder.clear();
}

beforeEach(() => {
  holder.clear();
  cookieStore.clear();
  cookieWrites.length = 0;
  mockHeadersFn.mockImplementation(async () => mockHeaders);
  mockCookiesFn.mockImplementation(async () => ({
    get: (name: string) => {
      const value = cookieStore.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (cookie: RecordedCookie) => {
      cookieWrites.push(cookie);
      if (cookie.maxAge === 0) cookieStore.delete(cookie.name);
      else cookieStore.set(cookie.name, cookie.value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }));
  mockFindFirst.mockResolvedValue(PAYMENT);
  mockCheckRateLimit.mockImplementation(realLimiter.current!);
});

// ── Suite: exhausted budget (R9, design D3) ─────────

describe('verifyOrderAccess — exhausted budget', () => {
  test('returns the rate-limited contract with a rounded-up retry and never queries the payment', async () => {
    useClientIp('203.0.113.100');
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0, resetInMs: 30_500 });

    const result = await verifyOrderAccess(TOKEN, '12345678');

    // ceil(30_500 / 1000) = 31, not 30 — seconds must round UP.
    expect(result).toEqual({
      success: false,
      error: 'Demasiados intentos. Esperá 31 segundos.',
      rateLimited: true,
    });
    // A server action has no HTTP status; the payment query must not run, or a
    // refused caller could still tell an existing dni from a missing one.
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});

// ── Suite: per (client, dni) keying (R9) ─────────────

describe('verifyOrderAccess — one budget per (client, dni)', () => {
  test('11 distinct dnis from one client are all served, none rate limited', async () => {
    useClientIp('203.0.113.101');
    // No payment matches any of these dnis.
    mockFindFirst.mockResolvedValue(null);

    const results = [];
    for (let index = 0; index < 11; index += 1) {
      results.push(await verifyOrderAccess(TOKEN, dniAt(index)));
    }

    // An IP-only budget refused the 6th through 11th guess. Keyed (client, dni)
    // there is no shared bucket to exhaust, so no result carries `rateLimited`.
    expect(results).toEqual(Array.from({ length: 11 }, () => ({ success: false })));
  });

  test('two header-less callers with different dnis are both served (no shared "unknown" bucket)', async () => {
    useNoClientHeader();
    mockFindFirst.mockResolvedValue(null);

    const first = await verifyOrderAccess(TOKEN, dniAt(1));
    const second = await verifyOrderAccess(TOKEN, dniAt(2));

    expect(first).toEqual({ success: false });
    expect(second).toEqual({ success: false });

    // Key proof: both calls were charged to distinct, dni-qualified keys.
    const charged = mockCheckRateLimit.mock.calls.map(([identifier]) => identifier);
    expect(charged.at(-2)).toBe(`unknown:dni:${dniAt(1)}`);
    expect(charged.at(-1)).toBe(`unknown:dni:${dniAt(2)}`);
  });
});

// ── Suite: refund on verified access (R10, design D8) ─

describe('verifyOrderAccess — a verified access refunds the budget', () => {
  test('the correct guess starts a fresh window instead of continuing the exhausted one', async () => {
    useClientIp('203.0.113.102');

    // 9 wrong guesses — still inside the budget, and a failed guess must not refund.
    for (let attempt = 0; attempt < AUTH_MAX - 1; attempt += 1) {
      expect(await verifyOrderAccess(TOKEN, '87654321', '#0000')).toEqual({ success: false });
    }

    // The correct guess on attempt 10 succeeds and clears the bucket.
    expect(await verifyOrderAccess(TOKEN, '87654321', CORRECT_ORDER)).toEqual({ success: true });

    // So a full budget of further wrong guesses is served, and only the 11th is
    // refused — proof the refund happened instead of the bucket merely continuing.
    for (let attempt = 0; attempt < AUTH_MAX; attempt += 1) {
      expect(await verifyOrderAccess(TOKEN, '87654321', '#0000')).toEqual({ success: false });
    }
    expect(await verifyOrderAccess(TOKEN, '87654321', '#0000')).toMatchObject({
      success: false,
      rateLimited: true,
    });
  });

  test('the refund is scoped to the verified dni — a sibling budget stays exhausted', async () => {
    useClientIp('203.0.113.103');
    const owner = '55667788';
    const sibling = '55667799';

    for (let attempt = 0; attempt < AUTH_MAX; attempt += 1) {
      await verifyOrderAccess(TOKEN, sibling, '#0000');
    }
    expect(await verifyOrderAccess(TOKEN, sibling, '#0000')).toMatchObject({ rateLimited: true });

    expect(await verifyOrderAccess(TOKEN, owner, CORRECT_ORDER)).toEqual({ success: true });

    // A global reset would have handed the sibling its full budget back too.
    expect(await verifyOrderAccess(TOKEN, sibling, '#0000')).toMatchObject({ rateLimited: true });
  });
});

// ── Suite: the success arms mint the access cookie (R13) ─
//
// A verified access is what upgrades `/{slug}/order/{token}` from its PII-free
// projection to the full payment row. So the mint is not decoration on the
// success path — it IS the capability, and R13 pins both halves: it must happen
// on every success, and it must NOT happen on any refusal.

describe('verifyOrderAccess — verified access mints the order access cookie', () => {
  test('a verified dni + order number mints the signed marker for THIS order', async () => {
    useClientIp('203.0.113.110');

    expect(await verifyOrderAccess(TOKEN, '87654321', CORRECT_ORDER)).toEqual({ success: true });

    expect(cookieWrites).toHaveLength(1);
    const cookie = cookieWrites[0];
    expect(cookie.name).toBe(`order_access_${TOKEN}`);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.maxAge).toBe(3600);
    expect(cookie.sameSite).toBe('lax');
    expect(cookie.path).toBe('/');
    // `{expMs}.{base64url signature}` — the marker is signed, not a bare flag.
    expect(cookie.value).toMatch(/^\d+\.[A-Za-z0-9_-]+$/);
  });

  test('a Google-identity match mints the marker too', async () => {
    useClientIp('203.0.113.111');
    mockFindFirst.mockResolvedValue({
      id: 'pay-google-1',
      orderNumber: CORRECT_ORDER,
      metadata: { customerAuth: { authId: GOOGLE_UID } },
    });

    expect(await verifyOrderByGoogleIdentity(TOKEN, GOOGLE_UID)).toEqual({ success: true });

    expect(cookieWrites).toHaveLength(1);
    expect(cookieWrites[0].name).toBe(`order_access_${TOKEN}`);
    expect(cookieWrites[0].httpOnly).toBe(true);
    expect(cookieWrites[0].maxAge).toBe(3600);
  });
});

// ── Suite: a refusal must not touch the cookie store (R13) ─
//
// "MUST NOT touch" is stronger than "must not set". A refusal that cleared the
// store would hand an attacker a way to log a real buyer out, and a refusal that
// set anything at all would be an authorization primitive. So the assertion is
// on an EMPTY write log — a delete shows up in the same log and fails it too.

describe('verifyOrderAccess — a refusal leaves the cookie store untouched', () => {
  test('a rate-limited caller gets no cookie', async () => {
    useClientIp('203.0.113.112');
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0, resetInMs: 30_500 });

    expect(await verifyOrderAccess(TOKEN, '87654321', CORRECT_ORDER)).toMatchObject({
      rateLimited: true,
    });

    expect(cookieWrites).toEqual([]);
    expect(cookieStore.size).toBe(0);
  });

  test('a wrong dni gets no cookie', async () => {
    useClientIp('203.0.113.113');
    // The lookup is `trackingToken AND buyerDni`; no row ⇒ this dni is not the
    // buyer's. Same `!order` branch as an unknown token, different situation.
    mockFindFirst.mockResolvedValue(null);

    expect(await verifyOrderAccess(TOKEN, '11111111', CORRECT_ORDER)).toEqual({ success: false });

    expect(cookieWrites).toEqual([]);
  });

  test('an unknown order gets no cookie', async () => {
    useClientIp('203.0.113.114');
    mockFindFirst.mockResolvedValue(null);

    expect(await verifyOrderAccess('tok-that-was-never-issued', '87654321', CORRECT_ORDER)).toEqual(
      {
        success: false,
      },
    );

    expect(cookieWrites).toEqual([]);
  });

  test('an expired marker already in the store is left byte-identical, not cleared', async () => {
    useClientIp('203.0.113.115');
    // A buyer whose 1h marker lapsed. A failed re-verification must leave the
    // stale cookie exactly as it found it — clearing it on a wrong guess would
    // turn the gate into a logout primitive for anyone who knows a tracking URL.
    const stale = '1.deadbeef';
    cookieStore.set(`order_access_${TOKEN}`, stale);
    mockFindFirst.mockResolvedValue(null);

    expect(await verifyOrderAccess(TOKEN, '87654321', '#0000')).toEqual({ success: false });

    expect(cookieWrites).toEqual([]);
    expect(cookieStore.get(`order_access_${TOKEN}`)).toBe(stale);
  });

  test('a refused Google-identity match gets no cookie', async () => {
    useClientIp('203.0.113.116');
    mockFindFirst.mockResolvedValue({
      id: 'pay-google-2',
      orderNumber: CORRECT_ORDER,
      metadata: { customerAuth: { authId: GOOGLE_UID } },
    });

    // Right token, wrong Google account.
    expect(await verifyOrderByGoogleIdentity(TOKEN, 'somebody-elses-uid')).toEqual({
      success: false,
      reason: 'wrong_account',
    });

    expect(cookieWrites).toEqual([]);
  });

  test('a Google match on an order with no Google link gets no cookie', async () => {
    useClientIp('203.0.113.117');
    mockFindFirst.mockResolvedValue({
      id: 'pay-google-3',
      orderNumber: CORRECT_ORDER,
      metadata: null,
    });

    expect(await verifyOrderByGoogleIdentity(TOKEN, GOOGLE_UID)).toEqual({
      success: false,
      reason: 'no_google_link',
    });

    expect(cookieWrites).toEqual([]);
  });
});

// ── Suite: R15 — `orderNumber IS NULL` must not self-authorize ─
//
// Both sides normalize to `null`, so `null !== null` is FALSE: a bare DNI (the
// `?dni=` auto-auth path, which sends no order number) was let straight into any
// order whose `orderNumber` happened to be NULL. That was survivable while the
// page only rendered; with success now minting a full-access cookie it is not.

describe('verifyOrderAccess — an order with no orderNumber is not auto-authorized (R15)', () => {
  test('a null orderNumber + no supplied number is refused, and mints nothing', async () => {
    useClientIp('203.0.113.118');
    mockFindFirst.mockResolvedValue({ orderNumber: null });

    expect(await verifyOrderAccess(TOKEN, '87654321')).toEqual({ success: false });

    expect(cookieWrites).toEqual([]);
  });

  test('a real matching orderNumber still succeeds (the conjunct is not a lockout)', async () => {
    useClientIp('203.0.113.119');
    mockFindFirst.mockResolvedValue({ orderNumber: CORRECT_ORDER });

    expect(await verifyOrderAccess(TOKEN, '87654321', CORRECT_ORDER)).toEqual({ success: true });

    expect(cookieWrites).toHaveLength(1);
  });

  test('a numbered order with no supplied orderNumber is still refused (unchanged)', async () => {
    useClientIp('203.0.113.120');
    mockFindFirst.mockResolvedValue({ orderNumber: CORRECT_ORDER });

    expect(await verifyOrderAccess(TOKEN, '87654321')).toEqual({ success: false });

    expect(cookieWrites).toEqual([]);
  });
});

// ── Suite: minting is inside the guard, so it cannot escape ─
//
// The mint runs inside `verifyOrderAccess`'s existing try/catch (design D10).
// That is deliberate but it is a trade-off, so it is pinned rather than left to
// chance: a `cookies()` failure degrades to `{success:false}` — a verified buyer
// is told no instead of receiving a half-minted authorization.

describe('verifyOrderAccess — a cookie-store failure degrades to a refusal', () => {
  test('an unavailable cookie store turns a verified access into {success:false}', async () => {
    useClientIp('203.0.113.121');
    mockCookiesFn.mockImplementation(async () => {
      throw new Error('Cookies can only be modified in a Server Action or Route Handler');
    });

    expect(await verifyOrderAccess(TOKEN, '87654321', CORRECT_ORDER)).toEqual({ success: false });
  });
});
