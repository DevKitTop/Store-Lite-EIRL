// =====================================================
// C11 / D2 / R8 — auth-intent rate limit on POST /api/order/lookup
//
// The storefront surface `LookupOrderModal.tsx:199` POSTs
// `{ dni, orderNumber, businessSlug }` with no session, so the endpoint is a
// guessing oracle: 8-digit DNI + order number → tracking token. The limiter
// MUST therefore run BEFORE zod, keyed `(IP, dni)` (design.md D2), because:
//   * keying by IP alone lets one attacker lock out a whole NAT/egress
//   * keying by dni alone is meaningless — dni is attacker-supplied
//   * running after zod would mean the brute-forcer pays only for well-formed
//     guesses, i.e. the limit would never bite
//
// `RATE_LIMITS.auth` (10 requests / 15 min, src/lib/rateLimit.ts:25) is the
// reused primitive; the 429 mirrors `proxy.ts:46-59`.
//
// `/api/order/track` is deliberately NOT covered here: it had zero callers
// once WU1 deleted TrackOrderModal, so it was deleted instead of limited
// (R7 became a REMOVED requirement, proven by this slice's git diff).
// =====================================================

import { POST } from '@/app/api/order/lookup/route';
import { buildOrderAccessIdentifier } from '@/lib/orderAccessRateLimit';
import { RATE_LIMITS, type checkRateLimit as CheckRateLimit } from '@/lib/rateLimit';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────
// 3 module-level doubles, all of them preserving the real logic that matters:
//   * `@/lib/rateLimit` keeps RATE_LIMITS, getClientIdentifier AND the sliding
//     window store real; only `checkRateLimit` is swapped for a spy, so the
//     bucket assertions run against the REAL limiter instead of a fake.
//   * `@/core/database/client` exposes the route's own queries so "did we reach
//     the database" is observable (repo pattern: penaltyStatusRoute.test.ts:31).
//   * `@/lib/supabase/server` answers the seller self-confirmation probe with an
//     anonymous session — the storefront case under test.

const { mockCheckRateLimit, realLimiter, mockPaymentsFindFirst, mockGetUser } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  realLimiter: { current: null as null | typeof CheckRateLimit },
  mockPaymentsFindFirst: vi.fn(),
  mockGetUser: vi.fn(),
}));

vi.mock('@/lib/rateLimit', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  realLimiter.current = actual.checkRateLimit as typeof CheckRateLimit;
  return { ...actual, checkRateLimit: mockCheckRateLimit };
});

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      payments: { findFirst: mockPaymentsFindFirst },
      // The anonymous path never reaches the seller checks, but the route
      // reaches these tables for authenticated callers — keep them callable.
      businesses: { findFirst: vi.fn() },
      businessTeamMembers: { findFirst: vi.fn() },
    },
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));

// ── Fixtures ─────────────────────────────────────────

const IP = '203.0.113.10';
const DNI = '12345678';
const BUSINESS_SLUG = 'acme-store';
/** RATE_LIMITS.auth — 10 requests / 15 min. Pinned so the spec ceiling is real. */
const AUTH_MAX = 10;

// The real limiter's store lives in module scope, so its buckets survive every
// test in this file for the whole 15-min window. Each route test therefore
// burns its OWN ip bucket — otherwise a test would inherit an exhausted one and
// pass (or fail) for the wrong reason.
const IP_UNDER_LIMIT = '203.0.113.20';
const IP_CEILING = '203.0.113.30';
const IP_PRE_ZOD = '203.0.113.40';
const IP_NO_DNI = '203.0.113.50';
const IP_OTHER_DNI = '203.0.113.60';
const IP_OTHER_IP = '203.0.113.70';

// The route must reuse the existing bucket config, not a bespoke one; naming it
// here pins that wiring in the assertions below.
const AUTH_LIMIT = RATE_LIMITS.auth;

const PAYMENT = {
  trackingToken: 'tok-abc123',
  businessId: 'biz-1',
  business: { slug: BUSINESS_SLUG },
};

function validBody(dni: string = DNI) {
  return { dni, orderNumber: '#1001', businessSlug: BUSINESS_SLUG };
}

function lookupRequest(body: unknown = validBody(), ip: string = IP): NextRequest {
  return new NextRequest('http://localhost/api/order/lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

/** Runs `count` sequential lookups and returns their statuses. */
async function lookupStatuses(count: number, body?: unknown, ip?: string): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const res = await POST(lookupRequest(body, ip));
    statuses.push(res.status);
  }
  return statuses;
}

// ── Suite: pure identifier builder (no mocks needed) ─

describe('buildOrderAccessIdentifier', () => {
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

// ── Suite: route behavior ────────────────────────────

describe('POST /api/order/lookup — 429 response contract', () => {
  beforeEach(() => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0, resetInMs: 30_500 });
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockPaymentsFindFirst.mockResolvedValue(PAYMENT);
  });

  test('mirrors proxy.ts:46-59 and never touches the database', async () => {
    const res = await POST(lookupRequest());

    expect(res.status).toBe(429);
    // ceil(30_500 / 1000) = 31, not 30 — the header must round UP.
    expect(res.headers.get('retry-after')).toBe('31');
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(res.headers.get('x-ratelimit-reset')).toBe('31');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ error: 'Too many requests. Please try again later.' });

    // Keyed (IP, dni) and reusing the existing RATE_LIMITS.auth primitive.
    expect(mockCheckRateLimit).toHaveBeenCalledWith(`${IP}:dni:${DNI}`, AUTH_LIMIT);
    // A refused request must not reveal whether the order exists.
    expect(mockPaymentsFindFirst).not.toHaveBeenCalled();
  });
});

describe('POST /api/order/lookup — pre-zod auth-intent limit', () => {
  beforeEach(() => {
    // Real limiter by default: these tests must exercise the actual bucket.
    mockCheckRateLimit.mockImplementation(realLimiter.current!);
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockPaymentsFindFirst.mockResolvedValue(PAYMENT);
  });

  test('a request under the limit is served normally with no rate-limit headers', async () => {
    const res = await POST(lookupRequest(validBody(), IP_UNDER_LIMIT));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, token: 'tok-abc123' });
    expect(res.headers.get('retry-after')).toBeNull();
    expect(res.headers.get('x-ratelimit-remaining')).toBeNull();
    expect(res.headers.get('x-ratelimit-reset')).toBeNull();
  });

  test('RATE_LIMITS.auth is enforced: 10 lookups served, the 11th refused', async () => {
    const statuses = await lookupStatuses(AUTH_MAX + 1, validBody(), IP_CEILING);

    expect(statuses).toEqual([...Array(AUTH_MAX).fill(200), 429]);
  });

  test('the limit bites BEFORE zod: a zod-invalid body is refused with 429, not 400', async () => {
    // Same body for every request, so the ONLY variable is the bucket:
    // under the limit → 400 from zod, exhausted → 429 from the limiter.
    const malformed = { ...validBody(), orderNumber: '' };
    const statuses = await lookupStatuses(AUTH_MAX + 1, malformed, IP_PRE_ZOD);

    expect(statuses.slice(0, AUTH_MAX)).toEqual(Array(AUTH_MAX).fill(400));
    expect(statuses.at(-1)).toBe(429);
  });

  test('a body with no dni still lands in a per-ip bucket (__missing__)', async () => {
    const noDni = { orderNumber: '#1001', businessSlug: BUSINESS_SLUG };
    const statuses = await lookupStatuses(AUTH_MAX + 1, noDni, IP_NO_DNI);

    expect(statuses.slice(0, AUTH_MAX)).toEqual(Array(AUTH_MAX).fill(400));
    expect(statuses.at(-1)).toBe(429);
    expect(mockCheckRateLimit).toHaveBeenCalledWith(`${IP_NO_DNI}:dni:__missing__`, AUTH_LIMIT);
  });

  test('a different dni from the same ip is unaffected by the exhausted bucket', async () => {
    const statuses = await lookupStatuses(AUTH_MAX + 1, validBody(), IP_OTHER_DNI);

    // The 10 lookups were really served before the refusal — the bucket was
    // live, not already exhausted by an earlier test.
    expect(statuses).toEqual([...Array(AUTH_MAX).fill(200), 429]);

    const otherDni = await POST(lookupRequest(validBody('87654321'), IP_OTHER_DNI));

    expect(otherDni.status).toBe(200);
    expect(mockCheckRateLimit).toHaveBeenLastCalledWith(`${IP_OTHER_DNI}:dni:87654321`, AUTH_LIMIT);
  });

  test('a different ip with the same dni is unaffected by the exhausted bucket', async () => {
    const statuses = await lookupStatuses(AUTH_MAX + 1, validBody(), IP_OTHER_IP);

    expect(statuses).toEqual([...Array(AUTH_MAX).fill(200), 429]);

    const otherIp = await POST(lookupRequest(validBody(), '198.51.100.77'));

    expect(otherIp.status).toBe(200);
    expect(mockCheckRateLimit).toHaveBeenLastCalledWith('198.51.100.77:dni:' + DNI, AUTH_LIMIT);
  });
});
