// =====================================================
// C11 / D2 / R8 — auth-intent rate limit on POST /api/order/lookup
//
// The storefront surface `LookupOrderModal.tsx:199` POSTs
// `{ dni, orderNumber, businessSlug, trackingToken }` with a signed access cookie,
// so the endpoint is now gated on the cookie (R21). The limiter runs AFTER the
// cookie gate, keyed `(paymentId, businessId)` from the verified cookie (10 req/min).
//
// `LOOKUP_RATE_LIMIT` (10 requests / 1 min, src/lib/rateLimit.ts) is the
// reused primitive; the 429 mirrors `proxy.ts:46-59`.
// =====================================================

import { POST } from '@/app/api/order/lookup/route';
import { env } from '@/config/env';
import { orderAccessCookieName, sign } from '@/lib/orderAccessCookie';
import {
  buildOrderAccessIdentifier,
  checkOrderAccessRateLimitFor,
  resetOrderAccessRateLimit,
} from '@/lib/orderAccessRateLimit';
import {
  RATE_LIMITS,
  resetRateLimit,
  type checkRateLimit as CheckRateLimit,
} from '@/lib/rateLimit';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// Mock env
vi.mock('@/config/env', () => ({
  env: { orderAccessCookieSecret: 'test-secret', orderFlowV2: true },
}));

// ── Mocks ────────────────────────────────────────────
// 3 module-level doubles, all of them preserving the real logic that matters:
//   * `@/lib/rateLimit` keeps RATE_LIMITS, getClientIdentifier AND the sliding
//     window store real; only `checkRateLimit` is swapped for a spy, so the
//     bucket assertions run against the REAL limiter instead of a fake.
//   * `@/core/database/client` exposes the route's own queries so "did we reach
//     the database" is observable (repo pattern: penaltyStatusRoute.test.ts:31).
//   * `@/lib/supabase/server` answers the seller self-confirmation probe with an
//     anonymous session — the storefront case under test.
//   * `next/headers` cookies mock for minting/verifying cookies

const {
  mockCheckRateLimit,
  realLimiter,
  mockPaymentsFindFirst,
  mockGetUser,
  mockFindFirstBusiness,
  cookieStore,
  cookiesApi,
  mockCookiesFn,
} = vi.hoisted(() => {
  const cookiesMap = new Map<string, string>();
  const cookiesApi = {
    get: (name: string) =>
      cookiesMap.has(name) ? { name, value: cookiesMap.get(name) as string } : undefined,
    set: (opts: { name: string; value: string }) => {
      cookiesMap.set(opts.name, opts.value);
    },
  };
  return {
    mockCheckRateLimit: vi.fn(),
    realLimiter: { current: null as null | typeof CheckRateLimit },
    mockPaymentsFindFirst: vi.fn(),
    mockGetUser: vi.fn(),
    mockFindFirstBusiness: vi.fn(),
    cookieStore: cookiesMap,
    cookiesApi,
    mockCookiesFn: vi.fn(),
  };
});

vi.mock('@/lib/rateLimit', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  realLimiter.current = actual.checkRateLimit as typeof CheckRateLimit;
  return { ...actual, checkRateLimit: mockCheckRateLimit };
});

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      payments: { findFirst: mockPaymentsFindFirst },
      businesses: { findFirst: mockFindFirstBusiness },
      businessTeamMembers: { findFirst: vi.fn() },
    },
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookiesFn,
  headers: vi.fn(async () => ({ get: () => null })),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// ── Fixtures ─────────────────────────────────────────

const IP = '203.0.113.10';
const DNI = '12345678';
const BUSINESS_SLUG = 'acme-store';
const TRACKING_TOKEN = 'tok-abc123';
const PAYMENT_ID = 'pay-1';
const BUSINESS_ID = 'biz-1';
/** LOOKUP_RATE_LIMIT — 10 requests / 1 min. Pinned so the spec ceiling is real. */
const LOOKUP_MAX = 10;

const PAYMENT = {
  id: PAYMENT_ID,
  trackingToken: TRACKING_TOKEN,
  businessId: BUSINESS_ID,
  orderNumber: '1001',
  business: { slug: BUSINESS_SLUG },
  buyerDni: DNI,
};

function validBody(trackingToken = TRACKING_TOKEN, orderNumber = '#1001', dni = DNI) {
  return { dni, orderNumber, businessSlug: BUSINESS_SLUG, trackingToken };
}

function lookupRequest(body: unknown = validBody(), cookie?: string): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': IP,
  };
  if (cookie) {
    headers['cookie'] = cookie;
  }
  return new NextRequest('http://localhost/api/order/lookup', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function mintValidCookie(trackingToken: string) {
  const cookieName = orderAccessCookieName(trackingToken);
  const expMs = Date.now() + 60 * 60 * 1000; // 1 hour
  const secret = env.orderAccessCookieSecret || 'r21-test-secret';
  const signature = sign(secret, trackingToken, expMs);
  const value = `${expMs}.${signature}`;
  cookieStore.set(cookieName, value);
}

// ── Suite: pure identifier builder (no mocks needed) ─
// These test the OLD identifier builder used by verifyOrderAccess action

describe('buildOrderAccessIdentifier (legacy - used by verifyOrderAccess)', () => {
  test('composes ip + dni so the bucket is per (IP, dni) pair', () => {
    expect(buildOrderAccessIdentifier(IP, { dni: DNI })).toBe(`${IP}:dni:${DNI}`);
  });

  test('different dnis from the same ip produce independent identifiers', () => {
    expect(buildOrderAccessIdentifier(IP, { dni: '11111111' })).not.toBe(
      buildOrderAccessIdentifier(IP, { dni: '22222222' }),
    );
  });

  test('the same dni from different ips produces independent identifiers', () => {
    expect(buildOrderAccessIdentifier('198.51.100.1', { dni: DNI })).not.toBe(
      buildOrderAccessIdentifier('198.51.100.2', { dni: DNI }),
    );
  });

  // The attacker controls dni entirely, so an absent / non-string / empty value
  // must NOT produce unbounded or colliding keys — it falls back to a single
  // per-IP bucket instead.
  test.each([
    ['a missing dni', { orderNumber: '#1' }],
    ['an empty dni', { dni: '' }],
    ['a non-string dni', { dni: 12_345_678 }],
    ['a null body', null],
  ])('falls back to the per-ip bucket for %s', (_label, rawBody) => {
    expect(buildOrderAccessIdentifier(IP, rawBody)).toBe(`${IP}:dni:__missing__`);
  });

  test('slices an oversized dni to 64 chars so the store key stays bounded', () => {
    const oversized = '9'.repeat(500);
    const identifier = buildOrderAccessIdentifier(IP, { dni: oversized });

    expect(identifier).toBe(`${IP}:dni:${'9'.repeat(64)}`);
    expect(identifier).toHaveLength(IP.length + ':dni:'.length + 64);
  });
});

// ── Suite: identifier-level entry points (R9 / R10, design D2) ──
//
// `checkOrderAccessRateLimitFor(clientId, body)` can only be used from a route that
// HAS a `NextRequest`. The buyer order gate is a `'use server'` action, so it
// reaches the same bucket through `(clientId, rawBody)` instead. These cases pin
// that the two entry points are the SAME bucket, not a parallel one: same
// identifier composition, same config, and a reset that cancels what a charge
// created.

describe('checkOrderAccessRateLimitFor / resetOrderAccessRateLimit (legacy - used by verifyOrderAccess)', () => {
  beforeEach(() => {
    // The REAL limiter: the point is that the composition reaches the real store.
    mockCheckRateLimit.mockImplementation(realLimiter.current!);
  });

  test('charges `${clientId}:dni:${dni}` with the shared RATE_LIMITS.auth config', () => {
    const clientId = '198.51.100.201';

    const result = checkOrderAccessRateLimitFor(clientId, { dni: '44556677' });

    expect(mockCheckRateLimit).toHaveBeenCalledWith(`${clientId}:dni:44556677`, RATE_LIMITS.auth);
    // Real sliding-window math, not a stub echo.
    expect(result).toEqual({
      allowed: true,
      remaining: RATE_LIMITS.auth.maxRequests - 1,
      resetInMs: RATE_LIMITS.auth.windowMs,
    });
  });

  test('resets the bucket it charged, scoped to that dni (D2)', () => {
    const clientId = '198.51.100.202';
    const body = { dni: '44556678' };
    const siblingBody = { dni: '44556679' };

    for (let attempt = 1; attempt <= RATE_LIMITS.auth.maxRequests; attempt += 1) {
      checkOrderAccessRateLimitFor(clientId, body);
      checkOrderAccessRateLimitFor(clientId, siblingBody);
    }
    expect(checkOrderAccessRateLimitFor(clientId, body).allowed).toBe(false);
    expect(checkOrderAccessRateLimitFor(clientId, siblingBody).allowed).toBe(false);

    resetOrderAccessRateLimit(clientId, body);

    expect(checkOrderAccessRateLimitFor(clientId, body)).toMatchObject({
      allowed: true,
      remaining: RATE_LIMITS.auth.maxRequests - 1,
    });
    // The reset is scoped: a sibling dni on the same client stays exhausted.
    expect(checkOrderAccessRateLimitFor(clientId, siblingBody).allowed).toBe(false);
  });
});

// ── Suite: NEW route behavior (cookie-gated lookup, R21) ────────────────────────

describe('POST /api/order/lookup — NEW: cookie-gated lookup with rate limit (R21)', () => {
  const LOOKUP_RATE_LIMIT = { windowMs: 60 * 1000, maxRequests: 10 };
  const LOOKUP_KEY = `${PAYMENT_ID}:${BUSINESS_ID}`;

  beforeEach(() => {
    cookieStore.clear();
    vi.clearAllMocks();

    // Reset rate limit store for the lookup key
    resetRateLimit(LOOKUP_KEY, LOOKUP_RATE_LIMIT);

    mockCheckRateLimit.mockImplementation(realLimiter.current!);
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockFindFirstBusiness.mockResolvedValue({ id: BUSINESS_ID, slug: BUSINESS_SLUG });

    // Mock cookies() to return our cookie store
    mockCookiesFn.mockImplementation(async () => cookiesApi);

    mockPaymentsFindFirst.mockImplementation(async (args: unknown) => {
      const columns = (args as { columns?: Record<string, unknown> })?.columns;
      // Always return a valid payment with the requested columns
      const row = {
        ...PAYMENT,
        id: PAYMENT_ID,
        trackingToken: TRACKING_TOKEN,
        orderNumber: '1001',
      };
      if (columns) {
        const projected: Record<string, unknown> = {};
        if (columns.id) projected.id = row.id;
        if (columns.businessId) projected.businessId = row.businessId;
        if (columns.orderNumber) projected.orderNumber = row.orderNumber;
        if (columns.trackingToken) projected.trackingToken = row.trackingToken;
        return projected;
      }
      return row;
    });
  });

  test('no cookie → 401 reauth_required, no DB hit', async () => {
    const res = await POST(lookupRequest(validBody()));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Necesitás volver a verificar tu acceso al pedido.',
      reason: 'reauth_required',
    });
    expect(mockPaymentsFindFirst).not.toHaveBeenCalled();
  });

  test('valid cookie → 200 with token, DB hit', async () => {
    // Mint a valid cookie
    await mintValidCookie(TRACKING_TOKEN);

    const res = await POST(lookupRequest(validBody()));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, token: TRACKING_TOKEN });
    expect(mockPaymentsFindFirst).toHaveBeenCalledTimes(2); // First by token, then by dni+orderNumber
  });

  test('rate limit: 10 requests allowed, 11th refused with 429', async () => {
    await mintValidCookie(TRACKING_TOKEN);

    // Make 10 requests
    for (let i = 0; i < LOOKUP_MAX; i++) {
      const res = await POST(lookupRequest(validBody()));
      expect(res.status).toBe(200);
    }

    // 11th request should be rate limited
    const res = await POST(lookupRequest(validBody()));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeDefined();
  });

  test('rate limit returns proper 429 headers', async () => {
    await mintValidCookie(TRACKING_TOKEN);

    // Exhaust the bucket
    for (let i = 0; i < LOOKUP_MAX; i++) {
      await POST(lookupRequest(validBody()));
    }

    const res = await POST(lookupRequest(validBody()));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeDefined();
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('X-RateLimit-Reset')).toBeDefined();
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Too many requests. Please try again later.' });
  });

  test('cross-order attempt (cookie for A, body asks for B) → 404 order_not_found', async () => {
    await mintValidCookie(TRACKING_TOKEN);

    const res = await POST(lookupRequest(validBody(TRACKING_TOKEN, '#9999')));

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.reason).toBe('order_not_found');
  });

  test('forged cookie → 401 reauth_required', async () => {
    // Set a forged cookie directly in the mock store
    cookieStore.set(`order_access_${TRACKING_TOKEN}`, 'invalid.signature');

    const req = lookupRequest(validBody(), `order_access_${TRACKING_TOKEN}=invalid.signature`);
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.reason).toBe('reauth_required');
  });
});
