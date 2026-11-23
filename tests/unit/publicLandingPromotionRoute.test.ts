import { GET } from '@/app/api/promotions/public-landing/route';
import type { PublicLandingPromotion } from '@/features/promotions/publicPromotionResolver';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetPublicLandingPromotion } = vi.hoisted(() => ({
  mockGetPublicLandingPromotion: vi.fn(),
}));

vi.mock('@/features/promotions/publicPromotions', () => ({
  getPublicLandingPromotion: mockGetPublicLandingPromotion,
}));

const NAVIDAD_PROMOTION: PublicLandingPromotion = {
  code: 'navidad-2026',
  name: 'Navidad 2026 — 20% Lite Pago',
  percentOff: 20,
  originalMonthlyPriceCents: 3900,
  finalMonthlyPriceCents: 3120,
  originalAnnualMonthlyPriceCents: 3250,
  finalAnnualMonthlyPriceCents: 2600,
};

describe('GET /api/promotions/public-landing', () => {
  beforeEach(() => {
    mockGetPublicLandingPromotion.mockReset();
  });

  it('returns the resolved promotion with a no-store response', async () => {
    mockGetPublicLandingPromotion.mockResolvedValue(NAVIDAD_PROMOTION);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ promotion: NAVIDAD_PROMOTION });
  });

  it('degrades to no promotion when resolution fails', async () => {
    mockGetPublicLandingPromotion.mockRejectedValue(new Error('database unavailable'));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ promotion: null });
  });
});
