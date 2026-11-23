import type { PromotionCandidatesResult } from '@/features/promotions/getApplicablePromotion';
import { resolvePricingPromotion } from '@/features/promotions/pricingPromotions';
import type {
  EligiblePromotionEvaluation,
  PromotionDefinition,
  PromotionEvaluation,
} from '@/features/promotions/types';
import { describe, expect, test } from 'vitest';

function promotionDefinition(overrides: Partial<PromotionDefinition> = {}): PromotionDefinition {
  return {
    id: 'promo-1',
    code: 'AUTO10',
    type: 'percent_off',
    planScope: 'lite_pago',
    periodScope: 'any',
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
    promotionId: 'promo-1',
    code: 'AUTO10',
    type: 'percent_off',
    discountCents: 390,
    finalPriceCents: 3510,
    grantedDays: null,
    ...overrides,
  };
}

function candidates(
  evaluation: PromotionEvaluation,
  definition: PromotionDefinition = promotionDefinition(),
): PromotionCandidatesResult {
  return {
    best: evaluation.eligible ? evaluation : null,
    candidates: [{ promotion: definition, evaluation }],
  };
}

describe('resolvePricingPromotion', () => {
  test('returns the server-evaluated final price for an auto-applicable campaign', () => {
    const result = resolvePricingPromotion(candidates(eligible()), 3900);

    expect(result.invalidCode).toBe(false);
    expect(result.promotion).toEqual({
      code: 'AUTO10',
      name: 'AUTO10',
      originalPriceCents: 3900,
      discountCents: 390,
      finalPriceCents: 3510,
    });
  });

  test('accepts a matching explicit code with different case and whitespace', () => {
    const result = resolvePricingPromotion(candidates(eligible()), 3900, '  auto10  ');

    expect(result.invalidCode).toBe(false);
    expect(result.promotion?.code).toBe('AUTO10');
  });

  test('marks an unmatched explicit code as invalid and hides the discount', () => {
    const result = resolvePricingPromotion(candidates(eligible()), 3900, 'BOGUS');

    expect(result.invalidCode).toBe(true);
    expect(result.promotion).toBeNull();
  });

  test('ignores free-period promotions in the purchase price display', () => {
    const freeEvaluation = eligible({
      type: 'free_period',
      discountCents: 3900,
      finalPriceCents: 0,
      grantedDays: 30,
    });

    expect(resolvePricingPromotion(candidates(freeEvaluation), 3900).promotion).toBeNull();
  });
});
