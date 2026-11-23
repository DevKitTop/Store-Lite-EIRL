// =====================================================
// Promotions — pure evaluator unit tests (T2)
// =====================================================
// Covers the campaign types, every rejection reason and the
// deterministic selection between several eligible campaigns.
// =====================================================

import {
  evaluatePromotion,
  selectBestPromotion,
  type PromotionDefinition,
  type PromotionEvaluationContext,
} from '@/features/promotions';
import { describe, expect, test } from 'vitest';

function makePromotion(overrides: Partial<PromotionDefinition> = {}): PromotionDefinition {
  return {
    id: 'promo-1',
    code: 'bienvenida-2026',
    type: 'free_period',
    planScope: 'lite_pago',
    periodScope: 'any',
    durationDays: 30,
    percentOff: null,
    amountOffCents: null,
    eligibility: 'new_owner',
    startsAt: new Date('2026-01-01T00:00:00Z'),
    endsAt: null,
    maxRedemptions: null,
    isActive: true,
    ...overrides,
  };
}

function makeContext(
  overrides: Partial<PromotionEvaluationContext> = {},
): PromotionEvaluationContext {
  return {
    now: new Date('2026-11-21T12:00:00Z'),
    planType: 'lite_pago',
    period: 'monthly',
    listPriceCents: 3900,
    ownerHasRedeemed: false,
    ownerIsNew: true,
    totalRedemptions: 0,
    providedCode: null,
    ...overrides,
  };
}

describe('evaluatePromotion — free_period', () => {
  test('grants the full list price for the configured duration', () => {
    const result = evaluatePromotion(makePromotion(), makeContext());

    expect(result).toEqual({
      eligible: true,
      promotionId: 'promo-1',
      code: 'bienvenida-2026',
      type: 'free_period',
      discountCents: 3900,
      finalPriceCents: 0,
      grantedDays: 30,
    });
  });

  test('rejects a free_period campaign without a valid duration', () => {
    const result = evaluatePromotion(makePromotion({ durationDays: null }), makeContext());

    expect(result).toMatchObject({ eligible: false, reason: 'invalid_config' });
  });
});

describe('evaluatePromotion — percent_off', () => {
  test('applies the percentage over the list price', () => {
    const result = evaluatePromotion(
      makePromotion({ type: 'percent_off', durationDays: null, percentOff: 25 }),
      makeContext(),
    );

    expect(result).toMatchObject({
      eligible: true,
      type: 'percent_off',
      discountCents: 975,
      finalPriceCents: 2925,
      grantedDays: null,
    });
  });

  test('rejects a percentage that leaves the charge below the Culqi minimum', () => {
    const result = evaluatePromotion(
      makePromotion({ type: 'percent_off', durationDays: null, percentOff: 99 }),
      makeContext(),
    );

    expect(result).toMatchObject({ eligible: false, reason: 'invalid_config' });
  });
});

describe('evaluatePromotion — fixed_off', () => {
  test('subtracts the fixed amount in cents', () => {
    const result = evaluatePromotion(
      makePromotion({ type: 'fixed_off', durationDays: null, amountOffCents: 1000 }),
      makeContext(),
    );

    expect(result).toMatchObject({
      eligible: true,
      type: 'fixed_off',
      discountCents: 1000,
      finalPriceCents: 2900,
    });
  });

  test('rejects a fixed discount that would leave nothing to charge', () => {
    const result = evaluatePromotion(
      makePromotion({ type: 'fixed_off', durationDays: null, amountOffCents: 3900 }),
      makeContext(),
    );

    expect(result).toMatchObject({ eligible: false, reason: 'invalid_config' });
  });
});

describe('evaluatePromotion — campaign window and limits', () => {
  test('rejects an inactive campaign', () => {
    const result = evaluatePromotion(makePromotion({ isActive: false }), makeContext());

    expect(result).toMatchObject({ eligible: false, reason: 'inactive' });
  });

  test('rejects a campaign that has not started', () => {
    const result = evaluatePromotion(
      makePromotion({ startsAt: new Date('2027-01-01T00:00:00Z') }),
      makeContext(),
    );

    expect(result).toMatchObject({ eligible: false, reason: 'not_started' });
  });

  test('rejects a campaign that already ended', () => {
    const result = evaluatePromotion(
      makePromotion({ endsAt: new Date('2026-11-21T11:59:59Z') }),
      makeContext(),
    );

    expect(result).toMatchObject({ eligible: false, reason: 'ended' });
  });

  test('rejects a campaign that reached its global redemption cap', () => {
    const result = evaluatePromotion(
      makePromotion({ maxRedemptions: 10 }),
      makeContext({ totalRedemptions: 10 }),
    );

    expect(result).toMatchObject({ eligible: false, reason: 'max_redemptions_reached' });
  });
});

describe('evaluatePromotion — scope and eligibility', () => {
  test('rejects a campaign scoped to another plan', () => {
    const result = evaluatePromotion(
      makePromotion({ planScope: 'lite_plus' }),
      makeContext({ planType: 'lite_pago' }),
    );

    expect(result).toMatchObject({ eligible: false, reason: 'plan_mismatch' });
  });

  test('rejects a campaign scoped to another billing period', () => {
    const result = evaluatePromotion(
      makePromotion({ periodScope: 'annual' }),
      makeContext({ period: 'monthly' }),
    );

    expect(result).toMatchObject({ eligible: false, reason: 'period_mismatch' });
  });

  test('rejects new_owner eligibility for an existing owner', () => {
    const result = evaluatePromotion(makePromotion(), makeContext({ ownerIsNew: false }));

    expect(result).toMatchObject({ eligible: false, reason: 'not_new_owner' });
  });

  test('requires a code when eligibility is code', () => {
    const result = evaluatePromotion(
      makePromotion({ eligibility: 'code' }),
      makeContext({ providedCode: null }),
    );

    expect(result).toMatchObject({ eligible: false, reason: 'code_required' });
  });

  test('rejects a wrong code', () => {
    const result = evaluatePromotion(
      makePromotion({ eligibility: 'code' }),
      makeContext({ providedCode: 'otra-cosa' }),
    );

    expect(result).toMatchObject({ eligible: false, reason: 'code_mismatch' });
  });

  test('accepts the code ignoring case and surrounding spaces', () => {
    const result = evaluatePromotion(
      makePromotion({ eligibility: 'code' }),
      makeContext({ providedCode: '  BIENVENIDA-2026 ' }),
    );

    expect(result).toMatchObject({ eligible: true, promotionId: 'promo-1' });
  });

  test('rejects manual-only campaigns from the self-service flow', () => {
    const result = evaluatePromotion(makePromotion({ eligibility: 'manual' }), makeContext());

    expect(result).toMatchObject({ eligible: false, reason: 'manual_only' });
  });

  test('rejects an owner that already redeemed the campaign', () => {
    const result = evaluatePromotion(makePromotion(), makeContext({ ownerHasRedeemed: true }));

    expect(result).toMatchObject({ eligible: false, reason: 'already_redeemed' });
  });
});

describe('selectBestPromotion', () => {
  test('returns null when nothing is eligible', () => {
    const result = selectBestPromotion([
      evaluatePromotion(makePromotion({ isActive: false }), makeContext()),
    ]);

    expect(result).toBeNull();
  });

  test('picks the campaign with the lowest final price', () => {
    const ten = evaluatePromotion(
      makePromotion({
        id: 'ten',
        code: 'ten',
        type: 'percent_off',
        durationDays: null,
        percentOff: 10,
      }),
      makeContext(),
    );
    const twentyFive = evaluatePromotion(
      makePromotion({
        id: 'twenty-five',
        code: 'twenty-five',
        type: 'percent_off',
        durationDays: null,
        percentOff: 25,
      }),
      makeContext(),
    );

    const result = selectBestPromotion([ten, twentyFive]);

    expect(result).toMatchObject({ eligible: true, promotionId: 'twenty-five' });
  });

  test('prefers the free period over a discounted purchase', () => {
    const free = evaluatePromotion(makePromotion({ id: 'free', code: 'free' }), makeContext());
    const discounted = evaluatePromotion(
      makePromotion({
        id: 'discount',
        code: 'discount',
        type: 'percent_off',
        durationDays: null,
        percentOff: 25,
      }),
      makeContext(),
    );

    const result = selectBestPromotion([discounted, free]);

    expect(result).toMatchObject({ eligible: true, promotionId: 'free' });
  });

  test('breaks a tie on the longest granted period', () => {
    const thirty = evaluatePromotion(
      makePromotion({ id: 'thirty', code: 'thirty', durationDays: 30 }),
      makeContext(),
    );
    const sixty = evaluatePromotion(
      makePromotion({ id: 'sixty', code: 'sixty', durationDays: 60 }),
      makeContext(),
    );

    const result = selectBestPromotion([thirty, sixty]);

    expect(result).toMatchObject({ eligible: true, promotionId: 'sixty' });
  });

  test('breaks a full tie deterministically by code', () => {
    const bravo = evaluatePromotion(makePromotion({ id: 'bravo', code: 'bravo' }), makeContext());
    const alpha = evaluatePromotion(makePromotion({ id: 'alpha', code: 'alpha' }), makeContext());

    const result = selectBestPromotion([bravo, alpha]);

    expect(result).toMatchObject({ eligible: true, promotionId: 'alpha' });
  });
});
