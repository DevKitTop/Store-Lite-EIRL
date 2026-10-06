// =====================================================
// GET /api/seller/whatsapp/billing — Route tests
// =====================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const getUser = vi.fn();
  const businessesFindFirst = vi.fn();
  const getMonthlyUsage = vi.fn();
  return { getUser, businessesFindFirst, getMonthlyUsage };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mocks.getUser },
  })),
}));

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      businesses: { findFirst: mocks.businessesFindFirst },
    },
  },
}));

vi.mock('@/core/whatsapp/billing/usageService', () => ({
  getMonthlyUsage: mocks.getMonthlyUsage,
}));

import { GET } from '@/app/api/seller/whatsapp/billing/route';

const sampleReport = {
  period: { year: 2026, month: 9 },
  totalMessages: 2,
  totalCostByCurrency: { USD: 0.11 },
  byDirection: {
    inbound: { count: 1, costByCurrency: { USD: 0.05 } },
    outbound: { count: 1, costByCurrency: { USD: 0.06 } },
  },
  byType: {
    text: { count: 1, costByCurrency: { USD: 0.05 } },
    template: { count: 1, costByCurrency: { USD: 0.06 } },
  },
  breakdown: [],
};

function billingUrl(query = ''): string {
  const base = 'http://localhost/api/seller/whatsapp/billing';
  return query ? `${base}?${query}` : base;
}

describe('GET /api/seller/whatsapp/billing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mocks.businessesFindFirst.mockResolvedValue({ ownerId: 'user-1' });
    mocks.getMonthlyUsage.mockResolvedValue(sampleReport);
  });

  it('returns 401 when unauthenticated', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await GET(new Request(billingUrl('businessId=bus-1')));

    expect(response.status).toBe(401);
    expect(mocks.businessesFindFirst).not.toHaveBeenCalled();
    expect(mocks.getMonthlyUsage).not.toHaveBeenCalled();
  });

  it('returns 400 when businessId is missing', async () => {
    const response = await GET(new Request(billingUrl()));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBeTruthy();
    expect(mocks.getMonthlyUsage).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid year or month', async () => {
    const badYear = await GET(new Request(billingUrl('businessId=bus-1&year=abc')));

    expect(badYear.status).toBe(400);

    const badMonth = await GET(new Request(billingUrl('businessId=bus-1&year=2026&month=13')));

    expect(badMonth.status).toBe(400);
    expect(mocks.getMonthlyUsage).not.toHaveBeenCalled();
  });

  it('returns 403 when the business does not exist', async () => {
    mocks.businessesFindFirst.mockResolvedValue(undefined);

    const response = await GET(new Request(billingUrl('businessId=bus-ghost')));

    expect(response.status).toBe(403);
    expect(mocks.getMonthlyUsage).not.toHaveBeenCalled();
  });

  it('returns 403 when the user is not the owner', async () => {
    mocks.businessesFindFirst.mockResolvedValue({ ownerId: 'someone-else' });

    const response = await GET(new Request(billingUrl('businessId=bus-1')));

    expect(response.status).toBe(403);
    expect(mocks.getMonthlyUsage).not.toHaveBeenCalled();
  });

  it('returns the usage report for the requested period and channel', async () => {
    const response = await GET(
      new Request(billingUrl('businessId=bus-1&year=2026&month=9&channelId=chan-1')),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.report).toEqual(sampleReport);
    expect(mocks.getMonthlyUsage).toHaveBeenCalledWith('bus-1', {
      year: 2026,
      month: 9,
      channelId: 'chan-1',
    });
  });

  it('omits period and channel options when not provided (service defaults)', async () => {
    const response = await GET(new Request(billingUrl('businessId=bus-1')));

    expect(response.status).toBe(200);
    expect(mocks.getMonthlyUsage).toHaveBeenCalledWith('bus-1', {});
  });

  it('returns 500 when the usage service fails', async () => {
    mocks.getMonthlyUsage.mockRejectedValue(new Error('db down'));

    const response = await GET(new Request(billingUrl('businessId=bus-1&year=2026&month=9')));

    expect(response.status).toBe(500);
  });
});