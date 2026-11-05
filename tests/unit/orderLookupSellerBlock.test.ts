// =====================================================
// POST /api/order/lookup — the legacy path's seller block
// =====================================================
// The block exists so a seller cannot confirm their own order through the
// public DNI lookup and harvest the tracking token. It used to ask a weaker
// question: "does this user own some business whose slug happens to match?".
//
// Two consequences, both pinned here:
//   - a team member who owns no business of their own skipped the check
//     entirely, because the membership test was nested inside `ownedBusiness`;
//   - a user owning more than one business was compared against whichever row
//     `findFirst` returned, not against the business being looked up.
//
// The check now asks the only question that matters: is this user a seller of
// THIS business.
// =====================================================

import { POST } from '@/app/api/order/lookup/route';
import { PgDialect } from 'drizzle-orm/pg-core';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const SELLER_ID = 'seller-1';
const BUSINESS_ID = 'biz-target';
const OTHER_BUSINESS_ID = 'biz-other';
const SLUG = 'target-store';

const mocks = vi.hoisted(() => ({
  paymentsFindFirst: vi.fn(),
  businessesFindFirst: vi.fn(),
  membersFindFirst: vi.fn(),
  getUser: vi.fn(),
  isBusinessOwner: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/config/env', () => ({
  env: { orderAccessCookieSecret: 'seller-block-secret', orderFlowV2: true },
}));

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      payments: { findFirst: mocks.paymentsFindFirst },
      businesses: { findFirst: mocks.businessesFindFirst },
      businessTeamMembers: { findFirst: mocks.membersFindFirst },
    },
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

vi.mock('@/lib/permissions/checkPermission', () => ({
  isBusinessOwner: mocks.isBusinessOwner,
}));

vi.mock('@/lib/rateLimit', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, checkRateLimit: mocks.checkRateLimit };
});

function lookupRequest(ip: string): NextRequest {
  return new NextRequest('http://localhost/api/order/lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ dni: '12345678', orderNumber: '2001', businessSlug: SLUG }),
  });
}

function compileWhere(where: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(where as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockReturnValue({ allowed: true, remaining: 9, resetInMs: 60_000 });
  mocks.businessesFindFirst.mockResolvedValue({ id: BUSINESS_ID });
  mocks.paymentsFindFirst.mockResolvedValue(null);
  mocks.membersFindFirst.mockResolvedValue(null);
  mocks.isBusinessOwner.mockResolvedValue(false);
  mocks.getUser.mockResolvedValue({ data: { user: null } });
});

describe('legacy lookup — a team member of this business is refused', () => {
  test('membership alone is enough, with no business of their own', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: SELLER_ID } } });
    mocks.membersFindFirst.mockResolvedValue({ id: 'membership-1' });

    const res = await POST(lookupRequest('198.51.100.11'));

    expect(res.status).toBe(403);
    expect(mocks.paymentsFindFirst).not.toHaveBeenCalled();
  });

  test('the owner of this business is refused', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: SELLER_ID } } });
    mocks.isBusinessOwner.mockResolvedValue(true);

    const res = await POST(lookupRequest('198.51.100.12'));

    expect(res.status).toBe(403);
    expect(mocks.paymentsFindFirst).not.toHaveBeenCalled();
  });

  test('the membership test is scoped to the business being looked up', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: SELLER_ID } } });

    await POST(lookupRequest('198.51.100.13'));

    const whereArg = mocks.membersFindFirst.mock.calls[0]?.[0]?.where;
    expect(whereArg).toBeDefined();
    const { sql, params } = compileWhere(whereArg);

    expect(sql).toContain('business_id');
    expect(sql).toContain('user_id');
    expect(params).toContain(BUSINESS_ID);
    expect(params).toContain(SELLER_ID);
    expect(params).not.toContain(OTHER_BUSINESS_ID);
  });
});

describe('legacy lookup — a seller of another business is not refused', () => {
  test('a member elsewhere falls through to the normal lookup', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: SELLER_ID } } });
    mocks.membersFindFirst.mockResolvedValue(null);
    mocks.isBusinessOwner.mockResolvedValue(false);

    const res = await POST(lookupRequest('198.51.100.14'));

    // Nothing matches, and it stays the neutral miss rather than a refusal.
    expect(res.status).toBe(404);
  });
});

describe('legacy lookup — the seller check needs a session', () => {
  test('an anonymous caller never reaches the ownership question', async () => {
    const res = await POST(lookupRequest('198.51.100.15'));

    expect(res.status).toBe(404);
    expect(mocks.isBusinessOwner).not.toHaveBeenCalled();
    expect(mocks.membersFindFirst).not.toHaveBeenCalled();
  });
});
