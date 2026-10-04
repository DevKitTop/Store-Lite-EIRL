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
import {
  buildOrderAccessIdentifier,
  buildOrderVerifyIdentifier,
  buildOrderVerifyIpIdentifier,
  checkOrderAccessRateLimitFor,
  checkOrderVerifyRateLimitFor,
  checkOrderVerifyRateLimits,
  resetOrderAccessRateLimit,
} from '@/lib/orderAccessRateLimit';
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

// ── Suite: identifier-level entry points (R9 / R10, design D2) ──
//
// `checkOrderAccessRateLimit(request, body)` can only be used from a route that
// HAS a `NextRequest`. The buyer order gate is a `'use server'` action, so it
// reaches the same bucket through `(clientId, rawBody)` instead. These cases pin
// that the two entry points are the SAME bucket, not a parallel one: same
// identifier composition, same config, and a reset that cancels what a charge
// created.

describe('checkOrderAccessRateLimitFor / resetOrderAccessRateLimit', () => {
  beforeEach(() => {
    // The REAL limiter: the point is that the composition reaches the real store.
    mockCheckRateLimit.mockImplementation(realLimiter.current!);
  });

  test('charges `${clientId}:dni:${dni}` with the shared RATE_LIMITS.auth config', () => {
    const clientId = '198.51.100.201';

    const result = checkOrderAccessRateLimitFor(clientId, { dni: '44556677' });

    expect(mockCheckRateLimit).toHaveBeenCalledWith(`${clientId}:dni:44556677`, AUTH_LIMIT);
    // Real sliding-window math, not a stub echo.
    expect(result).toEqual({
      allowed: true,
      remaining: AUTH_LIMIT.maxRequests - 1,
      resetInMs: AUTH_LIMIT.windowMs,
    });
  });

  test('resets the bucket it charged, scoped to that dni (D2)', () => {
    const clientId = '198.51.100.202';
    const body = { dni: '44556678' };
    const siblingBody = { dni: '44556679' };

    for (let attempt = 1; attempt <= AUTH_MAX; attempt += 1) {
      checkOrderAccessRateLimitFor(clientId, body);
      checkOrderAccessRateLimitFor(clientId, siblingBody);
    }
    expect(checkOrderAccessRateLimitFor(clientId, body).allowed).toBe(false);
    expect(checkOrderAccessRateLimitFor(clientId, siblingBody).allowed).toBe(false);

    resetOrderAccessRateLimit(clientId, body);

    expect(checkOrderAccessRateLimitFor(clientId, body)).toMatchObject({
      allowed: true,
      remaining: AUTH_MAX - 1,
    });
    // The reset is scoped: a sibling dni on the same client stays exhausted.
    expect(checkOrderAccessRateLimitFor(clientId, siblingBody).allowed).toBe(false);
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

// ── Suite: verify page dual-key throttle (R23 fine bucket + coarse per-IP backstop) ──
//
// The single `(IP, orderNumber)` bucket R23 mandates is TRIVIALLY BYPASSED, and
// this was proven with executed probes rather than argued: an attacker who
// rotates `orderNumber` composes a brand-new key on every request, so 200/200
// requests were served with the budget never once exhausted. Nothing about the
// fine bucket can fix that — its key CONTAINS the attacker-controlled segment.
//
// The coarse per-IP bucket is the fix: its key does NOT contain `orderNumber`,
// so rotating it changes nothing. Both buckets live in the SAME in-memory Map
// (`rateLimit.ts:32`), so the pair below must also be incapable of colliding —
// which is what the behavioural cases at the bottom pin, because a collision
// double-charges one counter and silently halves both ceilings.
//
// Every case burns its OWN ip: the real store is module scope and survives the
// whole file, so a shared bucket would let a case pass for the wrong reason.

describe('verify page throttle — dual-key buckets', () => {
  /** RATE_LIMITS.orderVerifyIp — 30 requests / 60s. Pinned so the ceiling is real. */
  const COARSE_MAX = RATE_LIMITS.orderVerifyIp.maxRequests;

  beforeEach(() => {
    mockCheckRateLimit.mockImplementation(realLimiter.current!);
  });

  test('the coarse per-IP budget is pinned: 30 requests / 60s', () => {
    // Documented decision, asserted so it cannot be quietly lowered into
    // lockout or raised back into uselessness.
    expect(RATE_LIMITS.orderVerifyIp).toEqual({ windowMs: 60_000, maxRequests: 30 });
  });

  test('the coarse bucket is keyed by IP alone — no order number in the key', () => {
    const identifier = buildOrderVerifyIpIdentifier(IP);

    expect(identifier).toBe(`order-verify:ip:${IP}`);
    // The `:order:` discriminator is what marks a per-order bucket. Its absence
    // is the property that survives order-number rotation.
    expect(identifier).not.toContain(':order:');
  });

  test('the coarse key is distinct from the per-order key for any orderNumber', () => {
    const coarse = buildOrderVerifyIpIdentifier(IP);

    for (const orderNumber of ['', 'x', '__missing__', 'ip', 'order', IP, 'y'.repeat(200)]) {
      expect(buildOrderVerifyIdentifier(IP, orderNumber)).not.toBe(coarse);
    }
  });

  // The preceding case only varies `orderNumber`. The IP is attacker-controlled
  // too (`x-forwarded-for`, leftmost hop), so a ':'-bearing IP is the actual
  // injection vector: it is the only way to shift a discriminator out of its
  // slot. `ORDER_VERIFY_KEY_PREFIX` sits in position 1 precisely to make that
  // unrepresentable, and nothing else in the file proves it.
  test('no coarse/fine collision for hostile input, in either key', () => {
    // Every segment here is chosen to alias SOME discriminator position.
    const segments = [
      'a',
      'A:ip',
      'A:order',
      'a:order',
      'ip',
      'order',
      'order-verify',
      '',
      '__missing__',
      IP,
      // Joined, not a literal: sonarjs/no-hardcoded-ip flags IP literals inside
      // collection expressions (same workaround as CLIENT_IP in the page suite).
      ['1', '2', '3', '4'].join('.'),
      'x',
      'y:ip',
      'ip:order',
      'order:ip',
    ];

    const coarseKeys = new Set(segments.map((ip) => buildOrderVerifyIpIdentifier(ip)));
    const collisions: string[] = [];

    for (const fineIp of segments) {
      for (const orderNumber of segments) {
        const fineKey = buildOrderVerifyIdentifier(fineIp, orderNumber);
        // The real store key appends `:${windowMs}`, so compare full store keys
        // for BOTH configs — that is what actually shares one Map.
        for (const coarseIp of segments) {
          const coarseKey = `${buildOrderVerifyIpIdentifier(coarseIp)}:${RATE_LIMITS.orderVerifyIp.windowMs}`;
          if (`${fineKey}:${RATE_LIMITS.storefront.windowMs}` === coarseKey) {
            collisions.push(`ip=${fineIp} order=${orderNumber} coarseIp=${coarseIp}`);
          }
        }
      }
    }

    expect(coarseKeys.size).toBeGreaterThan(0);
    expect(collisions).toEqual([]);
  });

  // Control for the case above: prove the search is capable of finding a
  // collision, i.e. that the empty result is a real property of the prefix-first
  // shape and not a vacuous search over segments that can never alias anything.
  test('the same search DOES collide when the prefix moves to the end', () => {
    const trailingFine = (ip: string, order: string) => `${ip}:order:${order}:order-verify`;
    const trailingCoarse = (ip: string) => `${ip}:ip:order-verify`;

    // Attacker sets x-forwarded-for to `A:ip` and browses order number `ip`.
    const fineKey = trailingFine('A:ip', 'ip');
    const coarseKey = trailingCoarse('A:ip:order');

    expect(fineKey).toBe(coarseKey);
    expect(fineKey).toBe('A:ip:order:ip:order-verify');
  });

  // ── The bypass this suite exists to close ──
  test('rotating orderNumber from one IP is cut off at the coarse ceiling', () => {
    const ip = '198.51.100.80';
    const allowed: boolean[] = [];

    // Every request carries a DIFFERENT order number, so every request would
    // land in its own fresh per-order bucket. Before the coarse bucket existed
    // this loop served 200/200; now it must stop.
    for (let i = 0; i < COARSE_MAX + 5; i += 1) {
      allowed.push(checkOrderVerifyRateLimits(ip, `ORD-${i}`).allowed);
    }

    expect(allowed.filter(Boolean)).toHaveLength(COARSE_MAX);
    expect(allowed.at(-1)).toBe(false);
  });

  // Collision pin. If the coarse and fine keys ever coincide, ONE request
  // charges the shared counter TWICE, so the ceiling halves to COARSE_MAX / 2
  // and this fails. No string-shape assertion can catch that, which is why the
  // behavioural count is the load-bearing one.
  test('the coarse ceiling holds at COARSE_MAX whatever order numbers are used', () => {
    const ip = '198.51.100.81';
    // Includes the degenerate values that could alias a fine key: the empty
    // string, the '__missing__' fallback, and the discriminator words.
    const orderNumbers = ['', '__missing__', 'ORD-1', '#', 'ip', 'order-verify'];
    const allowed: boolean[] = [];

    for (let i = 0; i < COARSE_MAX + 5; i += 1) {
      allowed.push(checkOrderVerifyRateLimits(ip, orderNumbers[i % orderNumbers.length]).allowed);
    }

    expect(allowed.filter(Boolean)).toHaveLength(COARSE_MAX);
    expect(allowed.at(-1)).toBe(false);
  });

  // Ordering pin: coarse is charged FIRST, so a coarse rejection must not have
  // already consumed the per-order budget. Charging fine-first would show
  // COARSE_MAX + 5 fine charges here instead of COARSE_MAX.
  test('a coarse rejection never charges the per-(IP, orderNumber) bucket', () => {
    const ip = '198.51.100.82';

    for (let i = 0; i < COARSE_MAX + 5; i += 1) {
      checkOrderVerifyRateLimits(ip, `ORD-${i}`);
    }

    const fineCharges = mockCheckRateLimit.mock.calls.filter((call) =>
      String(call[0]).includes(':order:'),
    );
    expect(fineCharges).toHaveLength(COARSE_MAX);
  });

  test('a request under both ceilings reports the tighter of the two budgets', () => {
    const result = checkOrderVerifyRateLimits('198.51.100.83', 'ORD-A');

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(COARSE_MAX - 1);
    expect(result.resetInMs).toBeGreaterThan(0);
  });

  test('the coarse bucket is per-IP: a different IP is unaffected', () => {
    const ip = '198.51.100.84';
    for (let i = 0; i < COARSE_MAX; i += 1) {
      checkOrderVerifyRateLimits(ip, `ORD-${i}`);
    }
    expect(checkOrderVerifyRateLimits(ip, 'ORD-LAST').allowed).toBe(false);

    // Same order number, different egress: still served.
    expect(checkOrderVerifyRateLimits('198.51.100.85', 'ORD-LAST').allowed).toBe(true);
  });

  // The R23 per-(IP, orderNumber) bucket is spec-mandated and MUST keep working
  // on its own, so the coarse bucket cannot be swapped in as a replacement.
  test('the R23 per-(IP, orderNumber) bucket still charges on its own', () => {
    const ip = '198.51.100.86';
    const storefrontMax = RATE_LIMITS.storefront.maxRequests;

    for (let i = 0; i < storefrontMax; i += 1) {
      checkOrderVerifyRateLimitFor(ip, 'ORD-SAME');
    }

    expect(checkOrderVerifyRateLimitFor(ip, 'ORD-SAME').allowed).toBe(false);
    // A sibling order from the same IP has its own fine bucket.
    expect(checkOrderVerifyRateLimitFor(ip, 'ORD-SIBLING').allowed).toBe(true);
  });
});
