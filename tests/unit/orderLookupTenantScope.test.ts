// =====================================================
// R21 (legacy tokenless path) — POST /api/order/lookup tenant scoping
// =====================================================
// The legacy path (no `trackingToken` in the body) was a reachable oracle: it
// resolved a payment by `(dni, orderNumber)` across ALL tenants, echoed the DNI
// and order number on a miss, and returned 403 vs 404 depending on the tenant.
// This suite pins the fix: the pair is scoped by `businessId`, every miss
// collapses to ONE neutral 404, and no 403 is reachable.
// =====================================================

import { POST } from '@/app/api/order/lookup/route';
import { PgDialect } from 'drizzle-orm/pg-core';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────

const { mockPaymentsFindFirst, mockBusinessesFindFirst, mockCheckRateLimit } = vi.hoisted(() => ({
  mockPaymentsFindFirst: vi.fn(),
  mockBusinessesFindFirst: vi.fn(),
  mockCheckRateLimit: vi.fn(),
}));

vi.mock('@/config/env', () => ({
  env: { orderAccessCookieSecret: 'legacy-test-secret', orderFlowV2: true },
}));

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      payments: { findFirst: mockPaymentsFindFirst },
      businesses: { findFirst: mockBusinessesFindFirst },
      businessTeamMembers: { findFirst: vi.fn() },
    },
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

// Keep the real limiter config; isolate the route from bucket exhaustion so the
// tenant-scope behavior is the only variable under test.
vi.mock('@/lib/rateLimit', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, checkRateLimit: mockCheckRateLimit };
});

// ── Fixtures ─────────────────────────────────────────

const BUSINESS_ID = 'biz-own';
const SLUG = 'own-store';
const DNI = '12345678';

function lookupRequest(orderNumber: string): NextRequest {
  return new NextRequest('http://localhost/api/order/lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify({ dni: DNI, orderNumber, businessSlug: SLUG }),
  });
}

function compileWhere(where: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(where as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 9, resetInMs: 60_000 });
  mockBusinessesFindFirst.mockResolvedValue({ id: BUSINESS_ID });
  mockPaymentsFindFirst.mockResolvedValue(null);
});

describe('R21 legacy lookup — unknown business slug', () => {
  test('an unresolvable slug returns the neutral 404 (no DNI/order echo)', async () => {
    mockBusinessesFindFirst.mockResolvedValueOnce(null);

    const res = await POST(lookupRequest('#2001'));

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).not.toContain(DNI);
    expect(json.error).not.toContain('2001');
  });
});

describe('R21 legacy lookup — cross-tenant is indistinguishable from 404', () => {
  test('a pair owned by another tenant returns 404, never 403', async () => {
    // Scoped by `businessId`, the other tenant's row simply does not match.
    mockPaymentsFindFirst.mockResolvedValueOnce(null);

    const res = await POST(lookupRequest('#9999'));

    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    // The refusal must not echo the submitted pair.
    expect(json.error).not.toContain(DNI);
    expect(json.error).not.toContain('9999');
  });

  test('cross-tenant and non-existent pairs are byte-identical', async () => {
    mockPaymentsFindFirst.mockResolvedValue(null);

    const crossTenant = await POST(lookupRequest('#9999'));
    const nonExistent = await POST(lookupRequest('#8888'));

    expect(crossTenant.status).toBe(nonExistent.status);
    expect(await crossTenant.json()).toEqual(await nonExistent.json());
  });
});

describe('R21 legacy lookup — the payment predicate is tenant-scoped', () => {
  test('the drizzle where carries buyer_dni, order_number AND business_id', async () => {
    await POST(lookupRequest('#2001'));

    const whereArg = mockPaymentsFindFirst.mock.calls[0]?.[0]?.where;
    expect(whereArg).toBeDefined();
    const { sql, params } = compileWhere(whereArg);

    expect(sql).toContain('buyer_dni');
    expect(sql).toContain('order_number');
    expect(sql).toContain('business_id');
    expect(params).toContain(BUSINESS_ID);
  });
});

describe('R21 legacy lookup — the success path stays PII-free', () => {
  test('a matching owned order returns { success, token } only', async () => {
    mockPaymentsFindFirst.mockResolvedValueOnce({
      trackingToken: 'tok-own',
      businessId: BUSINESS_ID,
      // Columns that must never leach into the response.
      buyerEmail: 'leak@example.com',
      buyerDni: DNI,
    });

    const res = await POST(lookupRequest('#2001'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true, token: 'tok-own' });

    const responseStr = JSON.stringify(json);
    expect(responseStr).not.toContain('leak@example.com');
    expect(responseStr).not.toContain(DNI);
  });
});
