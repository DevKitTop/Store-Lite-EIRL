// =====================================================
// PROMOTIONS — Pure public landing resolver
// =====================================================
// The landing is shown to logged-out visitors, so it cannot use the
// owner-scoped resolver. It still delegates all eligibility, window and
// discount math to the same pure evaluator via buildPromotionCandidates.
// =====================================================

import type { Promotion } from '@/core/database/schema/promotions';
import { PLAN_PRICES } from '@/shared/billing/planPrices';

import { isNewOwnerForCampaign } from './claimRules';
import { evaluatePromotion, selectBestPromotion } from './evaluatePromotion';
import type {
  EligiblePromotionEvaluation,
  PromotionDefinition,
  PromotionEvaluationContext,
} from './types';

function toDefinition(row: Promotion): PromotionDefinition {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    planScope: row.planScope,
    periodScope: row.periodScope,
    durationDays: row.durationDays,
    percentOff: row.percentOff,
    amountOffCents: row.amountOffCents,
    eligibility: row.eligibility,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    maxRedemptions: row.maxRedemptions,
    isActive: row.isActive,
  };
}

export interface PublicLandingPromotion {
  code: string;
  name: string;
  percentOff: number;
  originalMonthlyPriceCents: number;
  finalMonthlyPriceCents: number;
  originalAnnualMonthlyPriceCents: number;
  finalAnnualMonthlyPriceCents: number;
}

const ANNUAL_MONTHLY_PRICE_CENTS = Math.round(PLAN_PRICES.lite_pago.annual / 12);

interface BestForPeriodInput {
  catalog: Promotion[];
  period: 'monthly' | 'annual';
  listPriceCents: number;
  now: Date;
}

function bestForPeriod({
  catalog,
  period,
  listPriceCents,
  now,
}: BestForPeriodInput): EligiblePromotionEvaluation | null {
  const evaluations = catalog.map((row) => {
    const promotion = toDefinition(row);
    const context: PromotionEvaluationContext = {
      now,
      planType: 'lite_pago',
      period,
      listPriceCents,
      ownerHasRedeemed: false,
      ownerIsNew: isNewOwnerForCampaign({
        firstBusinessCreatedAt: null,
        startsAt: promotion.startsAt,
        endsAt: promotion.endsAt,
      }),
      totalRedemptions: 0,
      providedCode: null,
    };

    return evaluatePromotion(promotion, context);
  });

  const best = selectBestPromotion(evaluations);
  return best?.type === 'percent_off' ? best : null;
}

/** Pure resolver: safe to unit test without a database. */
export function resolvePublicLandingPromotion(
  catalog: Promotion[],
  now: Date = new Date(),
): PublicLandingPromotion | null {
  const publicCampaigns = catalog.filter(
    (row) =>
      row.isActive &&
      row.type === 'percent_off' &&
      row.eligibility === 'all_users' &&
      (row.planScope === 'lite_pago' || row.planScope === 'any'),
  );

  const monthly = bestForPeriod({
    catalog: publicCampaigns,
    period: 'monthly',
    listPriceCents: PLAN_PRICES.lite_pago.monthly,
    now,
  });
  const annual = bestForPeriod({
    catalog: publicCampaigns,
    period: 'annual',
    listPriceCents: ANNUAL_MONTHLY_PRICE_CENTS,
    now,
  });

  if (!monthly || !annual || monthly.code !== annual.code) return null;

  const campaign = publicCampaigns.find((row) => row.id === monthly.promotionId);
  if (!campaign?.percentOff) return null;

  return {
    code: campaign.code,
    name: campaign.name,
    percentOff: campaign.percentOff,
    originalMonthlyPriceCents: PLAN_PRICES.lite_pago.monthly,
    finalMonthlyPriceCents: monthly.finalPriceCents,
    originalAnnualMonthlyPriceCents: ANNUAL_MONTHLY_PRICE_CENTS,
    finalAnnualMonthlyPriceCents: annual.finalPriceCents,
  };
}
