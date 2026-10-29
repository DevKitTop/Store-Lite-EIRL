import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      businesses: {
        findFirst: vi.fn(),
      },
      complaintBookRecords: {
        findMany: vi.fn(),
      },
      payments: {
        findMany: vi.fn(),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    })),
  },
}));

vi.mock('@/core/database/schema', () => ({
  businesses: {
    id: 'id',
    name: 'name',
    isActive: 'isActive',
    verificationStatus: 'verificationStatus',
  },
  complaintBookRecords: {
    id: 'id',
    businessId: 'businessId',
    isVerified: 'isVerified',
    verifiedAt: 'verifiedAt',
  },
}));

vi.mock('@/lib/incompleteOrderRate', () => ({
  calculateBusinessIncompleteOrderRate: vi.fn(),
}));

vi.mock('@/lib/incompleteOrderRateCore', () => ({
  get30DayWindowStart: vi.fn(() => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
}));

import { getBusinessTrustScore } from '@/actions/business/getBusinessTrustScore';
import { db } from '@/core/database/client';
import { calculateBusinessIncompleteOrderRate } from '@/lib/incompleteOrderRate';

describe('getBusinessTrustScore server action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_AUTO_DEACTIVATION = 'true';
  });

  afterEach(() => {
    delete process.env.ENABLE_AUTO_DEACTIVATION;
  });

  it('returns null when business not found', async () => {
    (db.query.businesses.findFirst as any).mockResolvedValue(null);

    const result = await getBusinessTrustScore('non-existent');

    expect(result).toBeNull();
  });

  it('returns trust score data for active business', async () => {
    const mockBusiness = {
      id: 'biz-1',
      slug: 'test-business',
      name: 'Test Business',
      isActive: true,
      verificationStatus: 'verified',
    };

    (db.query.businesses.findFirst as any).mockResolvedValue(mockBusiness);

    // Mock verified complaints via select chain
    const mockWhere = vi.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    (db.select as any).mockReturnValue({ from: mockFrom });

    // Mock incomplete order rate
    (calculateBusinessIncompleteOrderRate as any).mockResolvedValue({
      totalOrders: 10,
      incompleteOrders: 3,
      incompleteRate: 3000,
      exceedsThreshold: false,
    });

    const result = await getBusinessTrustScore('biz-1');

    expect(result).toEqual({
      businessId: 'biz-1',
      businessName: 'Test Business',
      kybVerified: true,
      trustLevel: 'warning', // 2 complaints >= 2 triggers warning
      verifiedComplaints30d: 2,
      incompleteRate30d: 3000,
      deactivationRisk: 'none',
      shouldShowBanner: true,
    });
  });

  it('returns warning trustLevel when verifiedComplaints30d >= 3', async () => {
    const mockBusiness = {
      id: 'biz-1',
      slug: 'test-business',
      name: 'Test Business',
      isActive: true,
      verificationStatus: 'verified',
    };

    (db.query.businesses.findFirst as any).mockResolvedValue(mockBusiness);

    const mockWhere = vi.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    (db.select as any).mockReturnValue({ from: mockFrom });

    (calculateBusinessIncompleteOrderRate as any).mockResolvedValue({
      totalOrders: 10,
      incompleteOrders: 2,
      incompleteRate: 2000,
      exceedsThreshold: false,
    });

    const result = await getBusinessTrustScore('biz-1');

    expect(result?.trustLevel).toBe('warning');
    expect(result?.verifiedComplaints30d).toBe(3);
    expect(result?.shouldShowBanner).toBe(true);
  });

  it('returns warning trustLevel when incomplete rate exceeds threshold', async () => {
    const mockBusiness = {
      id: 'biz-1',
      slug: 'test-business',
      name: 'Test Business',
      isActive: true,
      verificationStatus: 'pending',
    };

    (db.query.businesses.findFirst as any).mockResolvedValue(mockBusiness);

    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    (db.select as any).mockReturnValue({ from: mockFrom });

    (calculateBusinessIncompleteOrderRate as any).mockResolvedValue({
      totalOrders: 10,
      incompleteOrders: 5,
      incompleteRate: 5000,
      exceedsThreshold: true,
    });

    const result = await getBusinessTrustScore('biz-1');

    expect(result?.trustLevel).toBe('warning');
    expect(result?.incompleteRate30d).toBe(5000);
    expect(result?.deactivationRisk).toBe('incomplete_orders');
    expect(result?.shouldShowBanner).toBe(true);
  });

  it('returns deactivated trustLevel when business is inactive', async () => {
    const mockBusiness = {
      id: 'biz-1',
      slug: 'test-business',
      name: 'Test Business',
      isActive: false,
      verificationStatus: 'verified',
    };

    (db.query.businesses.findFirst as any).mockResolvedValue(mockBusiness);

    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    (db.select as any).mockReturnValue({ from: mockFrom });

    (calculateBusinessIncompleteOrderRate as any).mockResolvedValue({
      totalOrders: 0,
      incompleteOrders: 0,
      incompleteRate: 0,
      exceedsThreshold: false,
    });

    const result = await getBusinessTrustScore('biz-1');

    expect(result?.trustLevel).toBe('deactivated');
    expect(result?.shouldShowBanner).toBe(true);
  });

  it('returns confiable when kybVerified but < 2 complaints and low incomplete rate', async () => {
    const mockBusiness = {
      id: 'biz-1',
      slug: 'test-business',
      name: 'Test Business',
      isActive: true,
      verificationStatus: 'verified',
    };

    (db.query.businesses.findFirst as any).mockResolvedValue(mockBusiness);

    const mockWhere = vi.fn().mockResolvedValue([{ id: 'c1' }]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    (db.select as any).mockReturnValue({ from: mockFrom });

    (calculateBusinessIncompleteOrderRate as any).mockResolvedValue({
      totalOrders: 20,
      incompleteOrders: 2,
      incompleteRate: 1000,
      exceedsThreshold: false,
    });

    const result = await getBusinessTrustScore('biz-1');

    expect(result?.trustLevel).toBe('confiable');
    expect(result?.kybVerified).toBe(true);
  });

  it('returns null instead of throwing when the complaints query fails (schema drift)', async () => {
    const mockBusiness = {
      id: 'biz-1',
      slug: 'test-business',
      name: 'Test Business',
      isActive: true,
      verificationStatus: 'verified',
    };

    (db.query.businesses.findFirst as any).mockResolvedValue(mockBusiness);

    // Production drift: the deployed DB may not have the columns this optional
    // banner needs (e.g. complaint_book_records.is_verified). A decorative trust
    // signal must never take the whole storefront down.
    const mockWhere = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('column "is_verified" does not exist'), { code: '42703' }),
      );
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    (db.select as any).mockReturnValue({ from: mockFrom });

    (calculateBusinessIncompleteOrderRate as any).mockResolvedValue({
      totalOrders: 0,
      incompleteOrders: 0,
      incompleteRate: 0,
      exceedsThreshold: false,
    });

    await expect(getBusinessTrustScore('biz-1')).resolves.toBeNull();
  });

  it('returns null instead of throwing when the incomplete-rate query fails', async () => {
    const mockBusiness = {
      id: 'biz-1',
      slug: 'test-business',
      name: 'Test Business',
      isActive: true,
      verificationStatus: 'verified',
    };

    (db.query.businesses.findFirst as any).mockResolvedValue(mockBusiness);

    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    (db.select as any).mockReturnValue({ from: mockFrom });

    (calculateBusinessIncompleteOrderRate as any).mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    );

    await expect(getBusinessTrustScore('biz-1')).resolves.toBeNull();
  });

  it('returns new when kyb not verified and < 2 complaints', async () => {
    const mockBusiness = {
      id: 'biz-1',
      slug: 'test-business',
      name: 'Test Business',
      isActive: true,
      verificationStatus: 'pending',
    };

    (db.query.businesses.findFirst as any).mockResolvedValue(mockBusiness);

    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    (db.select as any).mockReturnValue({ from: mockFrom });

    (calculateBusinessIncompleteOrderRate as any).mockResolvedValue({
      totalOrders: 5,
      incompleteOrders: 1,
      incompleteRate: 2000,
      exceedsThreshold: false,
    });

    const result = await getBusinessTrustScore('biz-1');

    expect(result?.trustLevel).toBe('new');
    expect(result?.kybVerified).toBe(false);
  });
});
