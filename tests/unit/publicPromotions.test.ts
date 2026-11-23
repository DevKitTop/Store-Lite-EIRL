import { describe, expect, it } from 'vitest';

import type { Promotion } from '@/core/database/schema/promotions';
import { resolvePublicLandingPromotion } from '@/features/promotions/publicPromotionResolver';

const START = new Date('2026-12-01T00:00:00-05:00');
const END = new Date('2026-12-26T00:00:00-05:00');
const ACTIVE_NOW = new Date('2026-12-10T12:00:00-05:00');

function campaign(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'navidad-2026',
    name: 'Navidad 2026 — 20% Lite Pago',
    type: 'percent_off',
    planScope: 'lite_pago',
    periodScope: 'any',
    durationDays: null,
    percentOff: 20,
    amountOffCents: null,
    eligibility: 'all_users',
    startsAt: START,
    endsAt: END,
    maxRedemptions: null,
    isActive: true,
    createdAt: new Date('2026-11-22T00:00:00Z'),
    updatedAt: new Date('2026-11-22T00:00:00Z'),
    ...overrides,
  };
}

describe('resolvePublicLandingPromotion', () => {
  it('returns null before the campaign window opens', () => {
    expect(
      resolvePublicLandingPromotion([campaign()], new Date('2026-11-22T00:00:00Z')),
    ).toBeNull();
  });

  it('returns null after the campaign window closes', () => {
    expect(
      resolvePublicLandingPromotion([campaign()], new Date('2026-12-27T00:00:00Z')),
    ).toBeNull();
  });

  it('resolves the 20% Lite Pago discount for monthly and annual landing prices', () => {
    expect(resolvePublicLandingPromotion([campaign()], ACTIVE_NOW)).toEqual({
      code: 'navidad-2026',
      name: 'Navidad 2026 — 20% Lite Pago',
      percentOff: 20,
      originalMonthlyPriceCents: 3900,
      finalMonthlyPriceCents: 3120,
      originalAnnualMonthlyPriceCents: 3250,
      finalAnnualMonthlyPriceCents: 2600,
    });
  });

  it('ignores campaigns that are not public all-users percent discounts', () => {
    expect(
      resolvePublicLandingPromotion(
        [
          campaign({
            code: 'bienvenida-2026',
            type: 'free_period',
            percentOff: null,
            durationDays: 15,
          }),
          campaign({ code: 'codigo-2026', eligibility: 'code' }),
          campaign({ code: 'manual-2026', eligibility: 'manual' }),
          campaign({ code: 'plus-2026', planScope: 'lite_plus' }),
        ],
        ACTIVE_NOW,
      ),
    ).toBeNull();
  });

  it('requires the campaign to cover both monthly and annual landing prices', () => {
    expect(
      resolvePublicLandingPromotion([campaign({ periodScope: 'monthly' })], ACTIVE_NOW),
    ).toBeNull();
  });
});
