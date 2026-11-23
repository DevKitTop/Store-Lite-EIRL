import { AnalyticsEvents } from '@/lib/analytics/taxonomy';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockFindFirst,
  mockInsert,
  mockValues,
  mockTransaction,
  mockGetPromotionCandidates,
  mockCaptureEvent,
  mockRevalidatePath,
} = vi.hoisted(() => {
  const mockFindFirst = vi.fn();
  const mockValues = vi.fn(() => ({
    onConflictDoNothing: vi.fn(() => ({
      returning: vi.fn().mockResolvedValue([{ id: 'redemption_1' }]),
    })),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  const mockTransaction = vi.fn((callback) =>
    callback({
      insert: mockInsert,
    }),
  );
  const mockGetPromotionCandidates = vi.fn();
  const mockCaptureEvent = vi.fn().mockResolvedValue(undefined);
  const mockRevalidatePath = vi.fn();

  return {
    mockFindFirst,
    mockInsert,
    mockValues,
    mockTransaction,
    mockGetPromotionCandidates,
    mockCaptureEvent,
    mockRevalidatePath,
  };
});

vi.mock('@/core/database/client', () => ({
  db: {
    insert: mockInsert,
    transaction: mockTransaction,
    query: {
      businessSubscriptions: { findFirst: mockFindFirst },
    },
  },
}));

vi.mock('@/features/storage/actions/authz', () => ({
  requireOwnedBusinessById: vi.fn(async () => ({
    businessId: '3f2a4c1e-8b6d-4a7f-9c2e-1d3f5a7b9c01',
    ownerId: 'owner_1',
    slug: 'test-business',
  })),
}));

vi.mock('@/features/promotions/getApplicablePromotion', () => ({
  getPromotionCandidates: mockGetPromotionCandidates,
}));

vi.mock('@/lib/analytics/capture', () => ({
  captureEvent: mockCaptureEvent,
}));

vi.mock('next/cache', () => ({
  revalidatePath: mockRevalidatePath,
}));

const { claimPromotionAction } = await import('@/features/promotions/actions');

describe('claim promotion analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFindFirst.mockResolvedValue(null);
    mockGetPromotionCandidates.mockResolvedValue({
      best: {
        eligible: true,
        promotionId: 'promo-trial',
        code: 'TRIAL30',
        type: 'free_period',
        discountCents: 3900,
        finalPriceCents: 0,
        grantedDays: 30,
      },
      candidates: [],
    });
  });

  test('captures promotion_claimed after a successful claim', async () => {
    const result = await claimPromotionAction({
      businessId: '3f2a4c1e-8b6d-4a7f-9c2e-1d3f5a7b9c01',
    });

    expect(result.success).toBe(true);
    expect(mockCaptureEvent).toHaveBeenCalledWith(
      AnalyticsEvents.PROMOTION_CLAIMED,
      expect.objectContaining({
        promotion_id: 'promo-trial',
        promotion_code: 'TRIAL30',
        promotion_type: 'free_period',
        business_id: '3f2a4c1e-8b6d-4a7f-9c2e-1d3f5a7b9c01',
        granted_days: 30,
      }),
    );
  });
});
