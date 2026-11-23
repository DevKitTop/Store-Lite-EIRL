import { selectPurchasePromotion } from '@/features/promotions/purchaseRules';
import type {
  EligiblePromotionEvaluation,
  PromotionDefinition,
  PromotionEvaluation,
} from '@/features/promotions/types';
import { describe, expect, test } from 'vitest';

function definition(overrides: Partial<PromotionDefinition> = {}): PromotionDefinition {
  return {
    id: 'promo-default',
    code: 'DEFAULT',
    type: 'percent_off',
    planScope: 'lite_pago',
    periodScope: 'monthly',
    durationDays: null,
    percentOff: 10,
    amountOffCents: null,
    eligibility: 'all_users',
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    endsAt: null,
    maxRedemptions: null,
    isActive: true,
    ...overrides,
  };
}

function eligible(
  overrides: Partial<EligiblePromotionEvaluation> = {},
): EligiblePromotionEvaluation {
  return {
    eligible: true,
    promotionId: 'promo-default',
    code: 'DEFAULT',
    type: 'percent_off',
    discountCents: 390,
    finalPriceCents: 3510,
    grantedDays: null,
    ...overrides,
  };
}

function rejected(reason: PromotionEvaluation extends { reason: infer R } ? R : never) {
  return {
    eligible: false as const,
    promotionId: 'promo-rejected',
    code: 'REJECTED',
    reason,
  };
}

describe('selectPurchasePromotion', () => {
  test('ignores free_period campaigns even when they are the global best', () => {
    const result = selectPurchasePromotion({
      best: eligible({
        promotionId: 'promo-free',
        code: 'WELCOME',
        type: 'free_period',
        discountCents: 3900,
        finalPriceCents: 0,
        grantedDays: 30,
      }),
      candidates: [
        {
          promotion: definition({ id: 'promo-free', code: 'WELCOME', type: 'free_period' }),
          evaluation: eligible({
            promotionId: 'promo-free',
            code: 'WELCOME',
            type: 'free_period',
            discountCents: 3900,
            finalPriceCents: 0,
            grantedDays: 30,
          }),
        },
        {
          promotion: definition({ id: 'promo-30', code: 'SAVE30' }),
          evaluation: eligible({
            promotionId: 'promo-30',
            code: 'SAVE30',
            discountCents: 1170,
            finalPriceCents: 2730,
          }),
        },
      ],
    });

    expect(result?.promotionId).toBe('promo-30');
    expect(result?.finalPriceCents).toBe(2730);
  });

  test('selects the single best discount without stacking campaigns', () => {
    const result = selectPurchasePromotion({
      best: eligible({ promotionId: 'promo-10', code: 'SAVE10' }),
      candidates: [
        {
          promotion: definition({ id: 'promo-10', code: 'SAVE10', percentOff: 10 }),
          evaluation: eligible({
            promotionId: 'promo-10',
            code: 'SAVE10',
            discountCents: 390,
            finalPriceCents: 3510,
          }),
        },
        {
          promotion: definition({ id: 'promo-fixed', code: 'SAVE15', type: 'fixed_off' }),
          evaluation: eligible({
            promotionId: 'promo-fixed',
            code: 'SAVE15',
            type: 'fixed_off',
            discountCents: 1500,
            finalPriceCents: 2400,
          }),
        },
      ],
    });

    expect(result?.promotionId).toBe('promo-fixed');
    expect(result?.discountCents).toBe(1500);
  });

  test('returns null when only free periods or rejections are present', () => {
    const result = selectPurchasePromotion({
      best: null,
      candidates: [
        {
          promotion: definition({ id: 'promo-free', code: 'WELCOME', type: 'free_period' }),
          evaluation: eligible({
            promotionId: 'promo-free',
            code: 'WELCOME',
            type: 'free_period',
            finalPriceCents: 0,
            grantedDays: 30,
          }),
        },
        {
          promotion: definition({ id: 'promo-no', code: 'NOPE' }),
          evaluation: rejected('code_mismatch'),
        },
      ],
    });

    expect(result).toBeNull();
  });
});
