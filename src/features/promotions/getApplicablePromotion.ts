// =====================================================
// PROMOTIONS — Server resolver
// =====================================================
// Loads the campaign catalog and the redemption history of one owner, then
// evaluates every campaign with the pure evaluator. The server is the only
// source of truth: the client never decides eligibility or price.
// =====================================================

import { db } from '@/core/database/client';
import { businesses, promotionRedemptions, promotions } from '@/core/database/schema';
import { asc, count, eq } from 'drizzle-orm';

import { isNewOwnerForCampaign } from './claimRules';
import { evaluatePromotion, selectBestPromotion } from './evaluatePromotion';
import type {
  EligiblePromotionEvaluation,
  PromotionDefinition,
  PromotionEvaluation,
  PromotionEvaluationContext,
} from './types';

export interface PromotionCandidate {
  promotion: PromotionDefinition;
  evaluation: PromotionEvaluation;
}

export interface PromotionCandidatesResult {
  /** Best eligible campaign, or null when nothing applies. */
  best: EligiblePromotionEvaluation | null;
  /** Every campaign with its evaluation, for UI state and diagnostics. */
  candidates: PromotionCandidate[];
}

export interface GetPromotionCandidatesParams {
  ownerId: string;
  /** Plan the campaign would apply to (the target plan of the purchase). */
  planType: 'lite_pago' | 'lite_plus';
  period: 'monthly' | 'annual';
  listPriceCents: number;
  providedCode?: string | null;
  now?: Date;
}

export interface BuildPromotionCandidatesParams extends Omit<
  GetPromotionCandidatesParams,
  'ownerId'
> {
  catalog: (typeof promotions.$inferSelect)[];
  firstBusinessCreatedAt: Date | null;
  redeemedPromotionIds: Iterable<string>;
  globalRedemptionCounts: Map<string, number>;
}

function toDefinition(row: typeof promotions.$inferSelect): PromotionDefinition {
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

/**
 * Pure mapping from loaded rows to evaluations. Kept separate from the
 * queries so the wiring (owner history, global caps, new-owner window) is
 * unit testable without a database.
 */
export function buildPromotionCandidates({
  catalog,
  firstBusinessCreatedAt,
  redeemedPromotionIds,
  globalRedemptionCounts,
  planType,
  period,
  listPriceCents,
  providedCode = null,
  now = new Date(),
}: BuildPromotionCandidatesParams): PromotionCandidatesResult {
  const redeemedIds = new Set(redeemedPromotionIds);

  const candidates = catalog.map((row): PromotionCandidate => {
    const promotion = toDefinition(row);
    const context: PromotionEvaluationContext = {
      now,
      planType,
      period,
      listPriceCents,
      ownerHasRedeemed: redeemedIds.has(promotion.id),
      ownerIsNew: isNewOwnerForCampaign({
        firstBusinessCreatedAt,
        startsAt: promotion.startsAt,
        endsAt: promotion.endsAt,
      }),
      totalRedemptions: globalRedemptionCounts.get(promotion.id) ?? 0,
      providedCode,
    };

    return { promotion, evaluation: evaluatePromotion(promotion, context) };
  });

  return {
    best: selectBestPromotion(candidates.map((candidate) => candidate.evaluation)),
    candidates,
  };
}

export async function getPromotionCandidates({
  ownerId,
  planType,
  period,
  listPriceCents,
  providedCode = null,
  now = new Date(),
}: GetPromotionCandidatesParams): Promise<PromotionCandidatesResult> {
  const [catalog, firstBusiness, ownerRedemptions, globalCounts] = await Promise.all([
    db.select().from(promotions),
    db
      .select({ createdAt: businesses.createdAt })
      .from(businesses)
      .where(eq(businesses.ownerId, ownerId))
      .orderBy(asc(businesses.createdAt))
      .limit(1),
    db
      .select({ promotionId: promotionRedemptions.promotionId })
      .from(promotionRedemptions)
      .where(eq(promotionRedemptions.ownerId, ownerId)),
    db
      .select({ promotionId: promotionRedemptions.promotionId, total: count() })
      .from(promotionRedemptions)
      .groupBy(promotionRedemptions.promotionId),
  ]);

  return buildPromotionCandidates({
    catalog,
    firstBusinessCreatedAt: firstBusiness[0]?.createdAt ?? null,
    redeemedPromotionIds: ownerRedemptions.map((row) => row.promotionId),
    globalRedemptionCounts: new Map(
      globalCounts.map((row) => [row.promotionId, Number(row.total)]),
    ),
    planType,
    period,
    listPriceCents,
    providedCode,
    now,
  });
}

export async function getApplicablePromotion(
  params: GetPromotionCandidatesParams,
): Promise<EligiblePromotionEvaluation | null> {
  const { best } = await getPromotionCandidates(params);
  return best;
}
