// =====================================================
// PROMOTIONS — Purchase-flow selection
// =====================================================
// Free periods are claimed through their own server action and never
// purchased. A checkout may use at most one discount campaign, chosen by the
// shared best-benefit rule so the client cannot stack or pick a worse deal.
// =====================================================

import { selectBestPromotion } from './evaluatePromotion';
import type { PromotionCandidatesResult } from './getApplicablePromotion';
import type { EligiblePromotionEvaluation } from './types';

export function selectPurchasePromotion(
  result: PromotionCandidatesResult,
): EligiblePromotionEvaluation | null {
  const discounts = result.candidates.flatMap(({ evaluation }) =>
    evaluation.eligible && evaluation.type !== 'free_period' ? [evaluation] : [],
  );

  return selectBestPromotion(discounts);
}
