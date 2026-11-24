// =====================================================
// getBusinessEntitlements — Unit tests
// =====================================================
// Verifies SCD-001: expiration check, plan selection,
// edge cases (no subscription, expired, inactive), and
// the resolvePlan migration shim (new + legacy + unknown keys).
// =====================================================

import { getBusinessEntitlements } from '@/core/entitlements/getBusinessEntitlements';
import { DEFAULT_PLAN, resolvePlan } from '@/core/entitlements/plans';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────

const { mockBusinessFindFirst, mockSubscriptionFindFirst, mockSettingsFindFirst } = vi.hoisted(
  () => {
    const mockBusinessFindFirst = vi.fn();
    const mockSubscriptionFindFirst = vi.fn();
    const mockSettingsFindFirst = vi.fn();

    return { mockBusinessFindFirst, mockSubscriptionFindFirst, mockSettingsFindFirst };
  },
);

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      businesses: { findFirst: mockBusinessFindFirst },
      businessSubscriptions: { findFirst: mockSubscriptionFindFirst },
      businessSettings: { findFirst: mockSettingsFindFirst },
    },
  },
}));

const mockDisableExcessProducts = vi.hoisted(() =>
  vi.fn(async () => ({
    disabledCount: 0,
    disabledProducts: [] as { id: string; title: string }[],
  })),
);
vi.mock('@/core/entitlements/enforceProductLimit', () => ({
  disableExcessProducts: mockDisableExcessProducts,
}));

// ── Helpers ──────────────────────────────────────────

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    planType: 'lite_pago',
    planEndDate: new Date('2026-12-31T23:59:59Z'), // far future
    ...overrides,
  };
}

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    culqiPublicKey: 'pk_test_xxx',
    culqiSecretKey: 'sk_test_xxx',
    ...overrides,
  };
}

// ── Suite ────────────────────────────────────────────

describe('getBusinessEntitlements', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockBusinessFindFirst.mockResolvedValue({ isActive: true });
    mockSettingsFindFirst.mockResolvedValue(makeSettings());
  });

  test('returns plan entitlements for active valid subscription', async () => {
    mockSubscriptionFindFirst.mockResolvedValue(makeSubscription());

    const result = await getBusinessEntitlements('biz_123');

    expect(result.plan).toBe('lite_pago');
    expect(result.maxProducts).toBe(300);
    expect(result.canImportProducts).toBe(true);
    expect(result.hasPaymentGateway).toBe(true);
    expect(result.planEndDate).toBe('2026-12-31T23:59:59.000Z');
  });

  test('resolves a legacy plan key to its lite_pago replacement', async () => {
    mockSubscriptionFindFirst.mockResolvedValue(
      makeSubscription({ planType: 'business_pro' }), // legacy DB value
    );

    const result = await getBusinessEntitlements('biz_123');

    expect(result.plan).toBe('lite_pago');
    expect(result.maxProducts).toBe(300);
  });

  test('returns DEFAULT_PLAN when subscription is expired', async () => {
    // planEndDate in the past
    mockSubscriptionFindFirst.mockResolvedValue(
      makeSubscription({ planEndDate: new Date('2024-01-01T00:00:00Z') }),
    );

    const result = await getBusinessEntitlements('biz_123');

    expect(result.plan).toBe('lite');
    expect(result.maxProducts).toBe(50);
    expect(result.hasPaymentGateway).toBe(false);
    expect(result.planEndDate).toBe('2024-01-01T00:00:00.000Z');
  });

  test('returns DEFAULT_PLAN when no subscription exists', async () => {
    mockSubscriptionFindFirst.mockResolvedValue(null);

    const result = await getBusinessEntitlements('biz_123');

    expect(result.plan).toBe('lite');
    expect(result.maxProducts).toBe(50);
    expect(result.planEndDate).toBeNull();
  });

  test('returns DEFAULT_PLAN when subscription status is inactive', async () => {
    // The query already filters planStatus = 'active', so inactive → null
    mockSubscriptionFindFirst.mockResolvedValue(null);

    const result = await getBusinessEntitlements('biz_123');

    expect(result.plan).toBe('lite');
    expect(result.planEndDate).toBeNull();
  });

  test('includes isActive from business record', async () => {
    mockBusinessFindFirst.mockResolvedValue({ isActive: false });
    mockSubscriptionFindFirst.mockResolvedValue(makeSubscription());

    const result = await getBusinessEntitlements('biz_123');

    expect(result.isActive).toBe(false);
    expect(result.plan).toBe('lite_pago');
  });

  test('exposes culqiPublicKey when payment is configured', async () => {
    mockSubscriptionFindFirst.mockResolvedValue(makeSubscription());

    const result = await getBusinessEntitlements('biz_123');

    expect(result.culqiPublicKey).toBe('pk_test_xxx');
    expect(result.isPaymentConfigured).toBe(true);
  });

  describe('safety net — disableExcessProducts', () => {
    test('calls disableExcessProducts when subscription expired (plan degrades)', async () => {
      mockSubscriptionFindFirst.mockResolvedValue(
        makeSubscription({ planEndDate: new Date('2024-01-01T00:00:00Z') }),
      );

      await getBusinessEntitlements('biz_123');

      expect(mockDisableExcessProducts).toHaveBeenCalledTimes(1);
      expect(mockDisableExcessProducts).toHaveBeenCalledWith('biz_123', 50);
    });

    test('exposes the disabled products returned on degradation', async () => {
      mockSubscriptionFindFirst.mockResolvedValue(
        makeSubscription({ planEndDate: new Date('2024-01-01T00:00:00Z') }),
      );
      mockDisableExcessProducts.mockResolvedValueOnce({
        disabledCount: 1,
        disabledProducts: [{ id: 'prod_1', title: 'Producto antiguo' }],
      });

      const result = await getBusinessEntitlements('biz_123');

      expect(result.disabledProducts).toEqual([{ id: 'prod_1', title: 'Producto antiguo' }]);
    });

    test('does NOT call disableExcessProducts when plan stays same (active)', async () => {
      mockSubscriptionFindFirst.mockResolvedValue(makeSubscription());

      await getBusinessEntitlements('biz_123');

      expect(mockDisableExcessProducts).not.toHaveBeenCalled();
    });

    test('does NOT call disableExcessProducts when no subscription exists', async () => {
      mockSubscriptionFindFirst.mockResolvedValue(null);

      await getBusinessEntitlements('biz_123');

      expect(mockDisableExcessProducts).not.toHaveBeenCalled();
    });
  });
});

// ── resolvePlan (migration shim) ─────────────────────

describe('resolvePlan', () => {
  test('passes new catalog keys through unchanged', () => {
    expect(resolvePlan('lite')).toBe('lite');
    expect(resolvePlan('lite_pago')).toBe('lite_pago');
    expect(resolvePlan('lite_plus')).toBe('lite_plus');
  });

  test('maps legacy keys to their lite replacements', () => {
    expect(resolvePlan('basico')).toBe('lite');
    expect(resolvePlan('emprendedor')).toBe('lite_pago');
    expect(resolvePlan('business_pro')).toBe('lite_pago');
    expect(resolvePlan('enterprise_pro')).toBe('lite_plus');
  });

  test('falls back to DEFAULT_PLAN for unknown keys', () => {
    expect(resolvePlan('enterprise_ai')).toBe(DEFAULT_PLAN);
    expect(resolvePlan('future_mystery_plan')).toBe(DEFAULT_PLAN);
    expect(resolvePlan('')).toBe(DEFAULT_PLAN);
  });
});
