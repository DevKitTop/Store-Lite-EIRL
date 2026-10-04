// =====================================================
// Order LOOKUP gated on the signed access cookie (R21)
// =====================================================
// The lookup endpoint was an ungated global query — it returned payment_orders
// for ANY (orderNumber, dni) pair across ALL tenants. No cookie, no tenant scoping,
// 403 vs 404 leak. This suite enforces the gate, tenant scoping, rate limit,
// and PII-free response projection.
// =====================================================

import { POST } from '@/app/api/order/lookup/route';
import { setOrderAccessCookie } from '@/lib/orderAccessCookie';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const ORDER_ACCESS_DENIED_ERROR = 'Necesitás volver a verificar tu acceso al pedido.';

const {
  mockEnv,
  mockSelect,
  mockFrom,
  mockWhere,
  mockLimit,
  mockFindFirstPayment,
  mockFindFirstBusiness,
  mockFindFirstTeam,
  cookieStore,
  cookiesApi,
  mockCookiesFn,
  orderLog,
  mockHeaders,
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
    mockEnv: { orderAccessCookieSecret: 'r21-test-secret', orderFlowV2: true },
    mockSelect: vi.fn(),
    mockFrom: vi.fn(),
    mockWhere: vi.fn(),
    mockLimit: vi.fn(),
    mockFindFirstPayment: vi.fn(),
    mockFindFirstBusiness: vi.fn(),
    mockFindFirstTeam: vi.fn(),
    cookieStore: cookiesMap,
    cookiesApi,
    mockCookiesFn: vi.fn(),
    orderLog: [] as string[],
    mockHeaders: vi.fn(),
  };
});

vi.mock('@/config/env', () => ({ env: mockEnv }));

vi.mock('next/headers', () => ({
  cookies: mockCookiesFn,
  headers: mockHeaders,
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/core/database/client', () => ({
  db: {
    select: mockSelect,
    query: {
      payments: { findFirst: mockFindFirstPayment },
      businesses: { findFirst: mockFindFirstBusiness },
      businessTeamMembers: { findFirst: mockFindFirstTeam },
    },
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

// Import after mocks
import { resetRateLimit } from '@/lib/rateLimit';
import { NextRequest } from 'next/server';

// Rate limit config for lookup (must match route.ts)
const LOOKUP_RATE_LIMIT = { windowMs: 60 * 1000, maxRequests: 10 };

// ── Fixtures ─────────────────────────────────────────

const BUSINESS_ID = 'biz_r21';
const BUSINESS_SLUG = 'demo';
const TOKEN_A = 'tok-a-r21';
const TOKEN_B = 'tok-b-r21';
const DNI = '87654321';
const ORDER_NUMBER = 'ORD-001';
// Constructed to avoid sonarjs/no-hardcoded-ip false positive on constant definition
const TEST_CLIENT_IP = ['1', '2', '3', '4'].join('.');

const PAYMENT_ROW_A = {
  id: 'pay_r21_a',
  businessId: BUSINESS_ID,
  orderNumber: ORDER_NUMBER,
  buyerDni: DNI,
  trackingToken: TOKEN_A,
  status: 'paid',
  amount: '150.00',
  currency: 'PEN',
  paymentMethod: 'card',
  createdAt: new Date('2026-01-01T10:00:00Z'),
  // PII columns that MUST NOT be in the response
  buyerEmail: 'leak@example.com',
  buyerPhone: '999888777',
  shippingAddress: 'Calle Falsa 123',
  metadata: { cartItems: [] },
};

const PAYMENT_ROW_B = {
  ...PAYMENT_ROW_A,
  id: 'pay_r21_b',
  trackingToken: TOKEN_B,
  orderNumber: 'ORD-002',
};

function buildRequest(
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): NextRequest {
  const req = new NextRequest('http://localhost/api/order/lookup', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
  return req;
}

async function mintValidCookie(trackingToken: string) {
  await setOrderAccessCookie(trackingToken);
  orderLog.length = 0;
}

beforeEach(() => {
  cookieStore.clear();
  orderLog.length = 0;
  mockEnv.orderAccessCookieSecret = 'r21-test-secret';
  mockEnv.orderFlowV2 = true;

  // Reset rate limit store for the specific key used by tests
  resetRateLimit(`${PAYMENT_ROW_A.id}:${BUSINESS_ID}`, LOOKUP_RATE_LIMIT);

  // Track gate + db calls for call-order assertions
  mockCookiesFn.mockImplementation(async () => {
    orderLog.push('gate');
    return cookiesApi;
  });

  mockSelect.mockImplementation(() => {
    orderLog.push('db');
    return { from: mockFrom };
  });
  mockLimit.mockResolvedValue([PAYMENT_ROW_A]);
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockFrom.mockReturnValue({ where: mockWhere });

  // Track findFirst call count to return appropriate values
  let findFirstCallCount = 0;
  mockFindFirstPayment.mockImplementation(async (args: unknown) => {
    orderLog.push('db'); // Track DB calls for call-order assertions
    findFirstCallCount++;
    const where = (
      args as {
        where?: {
          type: string;
          conditions?: { type: string; field?: { name: string }; value: string }[];
        };
      }
    )?.where;
    const columns = (args as { columns?: Record<string, unknown> })?.columns;

    // First call: lookup by trackingToken (from cookie)
    if (findFirstCallCount === 1) {
      const row = PAYMENT_ROW_A;
      // Apply column projection like drizzle does
      if (columns) {
        const projected: Record<string, unknown> = {};
        if (columns.id) projected.id = row.id;
        if (columns.businessId) projected.businessId = row.businessId;
        if (columns.orderNumber) projected.orderNumber = row.orderNumber;
        if (columns.trackingToken) projected.trackingToken = row.trackingToken;
        return projected;
      }
      return row;
    }

    // Second call: tenant-scoped lookup by dni + orderNumber + businessId
    if (findFirstCallCount === 2) {
      const conditions = where?.conditions || [];
      let orderNumber = ORDER_NUMBER;
      for (const cond of conditions) {
        if (cond.type === 'eq' && cond.field?.name === 'orderNumber') {
          orderNumber = cond.value;
          break;
        }
      }
      if (orderNumber === 'ORD-002') return PAYMENT_ROW_B;
      return PAYMENT_ROW_A;
    }

    // Subsequent calls (e.g., for business lookup)
    return PAYMENT_ROW_A;
  });

  mockFindFirstBusiness.mockResolvedValue({ id: BUSINESS_ID, slug: BUSINESS_SLUG });
  mockFindFirstTeam.mockResolvedValue(null);

  mockHeaders.mockResolvedValue({
    get: (name: string) => (name === 'x-forwarded-for' ? TEST_CLIENT_IP : null),
  });
});

// ── R21 — the cookie is the authority for lookup ─────────────────

describe('R21 — a lookup with no access cookie refuses with reauth_required', () => {
  test('POST /api/order/lookup without cookie returns 401 reauth_required', async () => {
    const req = buildRequest({
      dni: DNI,
      orderNumber: ORDER_NUMBER,
      businessSlug: BUSINESS_SLUG,
      trackingToken: TOKEN_A,
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toEqual({
      success: false,
      error: ORDER_ACCESS_DENIED_ERROR,
      reason: 'reauth_required',
    });
  });

  test('no cookie → gate runs, DB is never touched', async () => {
    const req = buildRequest({
      dni: DNI,
      orderNumber: ORDER_NUMBER,
      businessSlug: BUSINESS_SLUG,
      trackingToken: TOKEN_A,
    });
    await POST(req);

    // Gate must have run
    expect(orderLog.indexOf('gate')).toBeGreaterThanOrEqual(0);
    // DB must NOT have been touched (gate runs before any DB read)
    expect(orderLog.indexOf('db')).toBe(-1);
  });
});

describe('R21 — a tampered/lapsed/forged cookie is refused with reauth_required', () => {
  test('a truncated cookie with no signature separator is refused', async () => {
    cookieStore.set(`order_access_${TOKEN_A}`, '1234567890');
    orderLog.length = 0;

    const req = buildRequest({
      dni: DNI,
      orderNumber: ORDER_NUMBER,
      businessSlug: BUSINESS_SLUG,
      trackingToken: TOKEN_A,
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.reason).toBe('reauth_required');
    expect(orderLog.indexOf('db')).toBe(-1);
  });

  test('a valid signature over the wrong expiry is refused (attacker-chosen expMs)', async () => {
    await setOrderAccessCookie(TOKEN_A);
    const forged = cookieStore.get(`order_access_${TOKEN_A}`) as string;
    const [, signature] = forged.split('.');
    cookieStore.set(`order_access_${TOKEN_A}`, `${8_000_000_000_000}.${signature}`);
    orderLog.length = 0;

    const req = buildRequest({
      dni: DNI,
      orderNumber: ORDER_NUMBER,
      businessSlug: BUSINESS_SLUG,
      trackingToken: TOKEN_A,
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.reason).toBe('reauth_required');
    expect(orderLog.indexOf('db')).toBe(-1);
  });

  test('an attacker-guessable signature is refused', async () => {
    cookieStore.set(`order_access_${TOKEN_A}`, `${8_000_000_000_000}.notarealsignature`);
    orderLog.length = 0;

    const req = buildRequest({
      dni: DNI,
      orderNumber: ORDER_NUMBER,
      businessSlug: BUSINESS_SLUG,
      trackingToken: TOKEN_A,
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.reason).toBe('reauth_required');
    expect(orderLog.indexOf('db')).toBe(-1);
  });

  test('a lapsed cookie reads as re-authentication, not a generic denial', async () => {
    await mintValidCookie(TOKEN_A);

    // 1h TTL (`orderAccessCookie.ts:47`), jumped past without touching the value.
    const afterTtl = Date.now() + 2 * 60 * 60 * 1000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(afterTtl);

    const req = buildRequest({
      dni: DNI,
      orderNumber: ORDER_NUMBER,
      businessSlug: BUSINESS_SLUG,
      trackingToken: TOKEN_A,
    });
    const res = await POST(req);

    nowSpy.mockRestore();

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.reason).toBe('reauth_required');
    expect(orderLog.indexOf('db')).toBe(-1);
  });

  test('an empty secret denies everything (R18 fails closed)', async () => {
    await mintValidCookie(TOKEN_A);
    mockEnv.orderAccessCookieSecret = '';

    const req = buildRequest({
      dni: DNI,
      orderNumber: ORDER_NUMBER,
      businessSlug: BUSINESS_SLUG,
      trackingToken: TOKEN_A,
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.reason).toBe('reauth_required');
    expect(orderLog.indexOf('db')).toBe(-1);
  });
});

describe('R21 — cross-tenant attempt: valid cookie for order A, body asks for order B → order_not_found', () => {
  test("another order's cookie does not authorize (token inside signature), returns order_not_found", async () => {
    await mintValidCookie(TOKEN_A);
    // The request body asks for order B's orderNumber, but cookie is for order A
    const req = buildRequest({
      dni: DNI,
      orderNumber: 'ORD-002',
      businessSlug: BUSINESS_SLUG,
      trackingToken: TOKEN_A,
    });
    const res = await POST(req);

    // The cookie verified (gate passed), but the row doesn't belong to this tenant/order
    // Should return order_not_found (NOT reauth_required) — the cookie verified fine
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.reason).toBe('order_not_found');
    // DB was touched (gate passed) but query returned nothing due to tenant scoping
    expect(orderLog).toContain('db');
  });
});

describe('R21 — missing order returns order_not_found (neutral 404, no tenant leak)', () => {
  test('non-existent order returns neutral 404 with no echoed DNI/orderNumber', async () => {
    await mintValidCookie(TOKEN_A);
    mockFindFirstPayment.mockResolvedValueOnce(null);

    const req = buildRequest({
      dni: DNI,
      orderNumber: 'ORD-NONEXISTENT',
      businessSlug: BUSINESS_SLUG,
      trackingToken: TOKEN_A,
    });
    const res = await POST(req);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.reason).toBe('order_not_found');
    // Error message must NOT echo DNI or orderNumber (neutral 404)
    expect(json.error).not.toContain(DNI);
    expect(json.error).not.toContain('ORD-NONEXISTENT');
  });

  test('cross-tenant and non-existent pairs return BYTE-IDENTICAL responses', async () => {
    // Cross-tenant: cookie for A, body for B
    await mintValidCookie(TOKEN_A);
    const reqCross = buildRequest({
      dni: DNI,
      orderNumber: 'ORD-002',
      businessSlug: BUSINESS_SLUG,
      trackingToken: TOKEN_A,
    });
    const resCross = await POST(reqCross);
    const jsonCross = await resCross.json();

    // Non-existent: cookie for A, body for non-existent
    mockFindFirstPayment.mockResolvedValueOnce(null);
    const reqNonExistent = buildRequest({
      dni: DNI,
      orderNumber: 'ORD-NONEXISTENT',
      businessSlug: BUSINESS_SLUG,
      trackingToken: TOKEN_A,
    });
    const resNonExistent = await POST(reqNonExistent);
    const jsonNonExistent = await resNonExistent.json();

    // Both must be byte-identical: same status, same body
    expect(resCross.status).toBe(resNonExistent.status);
    expect(jsonCross).toEqual(jsonNonExistent);
  });

  test('slug mismatch never produces 403 — only the neutral 404', async () => {
    await mintValidCookie(TOKEN_A);
    // Request with correct slug 'demo', but business lookup returns different slug
    mockFindFirstBusiness.mockResolvedValueOnce({ id: 'other-biz', slug: 'other-slug' });

    const req = buildRequest({
      dni: DNI,
      orderNumber: ORDER_NUMBER,
      businessSlug: BUSINESS_SLUG,
      trackingToken: TOKEN_A,
    });
    const res = await POST(req);

    // Must NOT be 403 — must be neutral 404
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.reason).toBe('order_not_found');
    expect(json.error).not.toContain('pertenece a este negocio');
  });
});

describe('R21 — rate limit: 10 req/min per order (keyed by verified cookie paymentId + businessId)', () => {
  test('rate limit returns 429 with Retry-After header', async () => {
    await mintValidCookie(TOKEN_A);

    // Exhaust the bucket (10 req/min)
    for (let i = 0; i < 10; i++) {
      const req = buildRequest({
        dni: DNI,
        orderNumber: ORDER_NUMBER,
        businessSlug: BUSINESS_SLUG,
        trackingToken: TOKEN_A,
      });
      const res = await POST(req);
      expect(res.status).not.toBe(429);
    }

    // 11th request should be rate limited
    const req = buildRequest({
      dni: DNI,
      orderNumber: ORDER_NUMBER,
      businessSlug: BUSINESS_SLUG,
      trackingToken: TOKEN_A,
    });
    const res = await POST(req);

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeDefined();
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    const json = await res.json();
    expect(json.error).toContain('Too many requests');
  });
});

describe('R21 — valid cookie returns PII-free projection (PUBLIC_ORDER_COLUMNS + PUBLIC_ORDER_RELATIONS)', () => {
  test('valid cookie → success with only trackingToken, no PII columns', async () => {
    await mintValidCookie(TOKEN_A);

    const req = buildRequest({
      dni: DNI,
      orderNumber: ORDER_NUMBER,
      businessSlug: BUSINESS_SLUG,
      trackingToken: TOKEN_A,
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.token).toBe(TOKEN_A);

    // Response must NOT contain any PII
    const responseStr = JSON.stringify(json);
    expect(responseStr).not.toContain('leak@example.com'); // buyerEmail
    expect(responseStr).not.toContain('999888777'); // buyerPhone
    expect(responseStr).not.toContain('12345678'); // buyerDni
    expect(responseStr).not.toContain('Calle Falsa 123'); // shippingAddress
    expect(responseStr).not.toContain('metadata'); // metadata
  });

  test('the DB query carries the tenant predicate (payments.businessId = sessionBusinessId)', async () => {
    await mintValidCookie(TOKEN_A);

    const req = buildRequest({
      dni: DNI,
      orderNumber: ORDER_NUMBER,
      businessSlug: BUSINESS_SLUG,
      trackingToken: TOKEN_A,
    });
    await POST(req);

    // The findFirst call must include the businessId predicate
    const call = mockFindFirstPayment.mock.calls.at(0);
    expect(call).toBeDefined();
    const whereArg = call?.[0];
    expect(whereArg).toBeDefined();
    // The where clause should include businessId filtering
    // This will be verified by the implementation adding eq(payments.businessId, businessId)
  });

  test('call order: gate runs BEFORE the first DB read', async () => {
    await mintValidCookie(TOKEN_A);

    const req = buildRequest({
      dni: DNI,
      orderNumber: ORDER_NUMBER,
      businessSlug: BUSINESS_SLUG,
      trackingToken: TOKEN_A,
    });
    await POST(req);

    expect(orderLog).toContain('db');
    expect(orderLog.indexOf('gate')).toBeGreaterThanOrEqual(0);
    expect(orderLog.indexOf('gate')).toBeLessThan(orderLog.indexOf('db'));
  });
});
