// =====================================================
// PROMOTIONS — Pure evaluator
// =====================================================
// Decides whether a campaign applies to one business/purchase and how much
// it is worth. No database, no network, no clock: `now` is injected so the
// result is deterministic and testable.
// =====================================================

import {
  MIN_CHARGE_CENTS,
  type EligiblePromotionEvaluation,
  type PromotionDefinition,
  type PromotionEvaluation,
  type PromotionEvaluationContext,
  type PromotionRejectionReason,
} from './types';

function reject(
  promotion: PromotionDefinition,
  reason: PromotionRejectionReason,
): PromotionEvaluation {
  return {
    eligible: false,
    promotionId: promotion.id,
    code: promotion.code,
    reason,
  };
}

function normalizeCode(code: string | null | undefined): string {
  return (code ?? '').trim().toLowerCase();
}

/**
 * Checks the conditions that are independent of the campaign type.
 * Returns a rejection reason, or null when the campaign may proceed.
 */
function checkAvailability(
  promotion: PromotionDefinition,
  context: PromotionEvaluationContext,
): PromotionRejectionReason | null {
  if (!promotion.isActive) return 'inactive';
  if (context.now < promotion.startsAt) return 'not_started';
  if (promotion.endsAt && context.now >= promotion.endsAt) return 'ended';

  if (promotion.maxRedemptions !== null && context.totalRedemptions >= promotion.maxRedemptions) {
    return 'max_redemptions_reached';
  }

  if (promotion.planScope !== 'any' && promotion.planScope !== context.planType) {
    return 'plan_mismatch';
  }

  if (promotion.periodScope !== 'any' && promotion.periodScope !== context.period) {
    return 'period_mismatch';
  }

  return null;
}

function checkEligibility(
  promotion: PromotionDefinition,
  context: PromotionEvaluationContext,
): PromotionRejectionReason | null {
  switch (promotion.eligibility) {
    case 'manual':
      // Operator-granted campaigns are never self-service claimable.
      return 'manual_only';
    case 'code':
      if (!normalizeCode(context.providedCode)) return 'code_required';
      if (normalizeCode(context.providedCode) !== normalizeCode(promotion.code)) {
        return 'code_mismatch';
      }
      return null;
    case 'new_owner':
      return context.ownerIsNew ? null : 'not_new_owner';
    case 'all_users':
      return null;
  }
}

/**
 * Computes the benefit for a campaign whose availability and eligibility
 * already passed. Returns a rejection for an unusable configuration instead
 * of silently charging an invalid amount.
 */
function computeBenefit(
  promotion: PromotionDefinition,
  context: PromotionEvaluationContext,
): EligiblePromotionEvaluation | PromotionRejectionReason {
  switch (promotion.type) {
    case 'free_period': {
      if (promotion.durationDays === null || promotion.durationDays <= 0) {
        return 'invalid_config';
      }

      return {
        eligible: true,
        promotionId: promotion.id,
        code: promotion.code,
        type: promotion.type,
        discountCents: context.listPriceCents,
        finalPriceCents: 0,
        grantedDays: promotion.durationDays,
      };
    }

    case 'percent_off': {
      if (promotion.percentOff === null || promotion.percentOff < 1 || promotion.percentOff > 99) {
        return 'invalid_config';
      }

      const discountCents = Math.round((context.listPriceCents * promotion.percentOff) / 100);
      const finalPriceCents = context.listPriceCents - discountCents;
      if (finalPriceCents < MIN_CHARGE_CENTS) return 'invalid_config';

      return {
        eligible: true,
        promotionId: promotion.id,
        code: promotion.code,
        type: promotion.type,
        discountCents,
        finalPriceCents,
        grantedDays: null,
      };
    }

    case 'fixed_off': {
      if (promotion.amountOffCents === null || promotion.amountOffCents <= 0) {
        return 'invalid_config';
      }

      const finalPriceCents = context.listPriceCents - promotion.amountOffCents;
      if (finalPriceCents < MIN_CHARGE_CENTS) return 'invalid_config';

      return {
        eligible: true,
        promotionId: promotion.id,
        code: promotion.code,
        type: promotion.type,
        discountCents: promotion.amountOffCents,
        finalPriceCents,
        grantedDays: null,
      };
    }
  }
}

export function evaluatePromotion(
  promotion: PromotionDefinition,
  context: PromotionEvaluationContext,
): PromotionEvaluation {
  const unavailable = checkAvailability(promotion, context);
  if (unavailable) return reject(promotion, unavailable);

  const ineligible = checkEligibility(promotion, context);
  if (ineligible) return reject(promotion, ineligible);

  if (context.ownerHasRedeemed) return reject(promotion, 'already_redeemed');

  const benefit = computeBenefit(promotion, context);
  if (typeof benefit === 'string') return reject(promotion, benefit);

  return benefit;
}

function compareEvaluations(
  a: EligiblePromotionEvaluation,
  b: EligiblePromotionEvaluation,
): number {
  // Lowest final price wins; a free period (0) beats any discount.
  if (a.finalPriceCents !== b.finalPriceCents) return a.finalPriceCents - b.finalPriceCents;

  // Same price: the longest granted period wins.
  const daysA = a.grantedDays ?? 0;
  const daysB = b.grantedDays ?? 0;
  if (daysA !== daysB) return daysB - daysA;

  // Full tie: deterministic order by code.
  if (a.code < b.code) return -1;
  if (a.code > b.code) return 1;
  return 0;
}

/**
 * Picks one campaign among several evaluations. One promotion per purchase:
 * the best benefit, never a stack.
 */
export function selectBestPromotion(
  evaluations: PromotionEvaluation[],
): EligiblePromotionEvaluation | null {
  const eligible = evaluations.filter(
    (evaluation): evaluation is EligiblePromotionEvaluation => evaluation.eligible,
  );

  if (eligible.length === 0) return null;

  return [...eligible].sort(compareEvaluations)[0];
}
