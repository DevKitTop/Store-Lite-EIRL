import type { PromotionCandidatesResult } from './getApplicablePromotion';
import { selectPurchasePromotion } from './purchaseRules';

export interface PricingPromotionSummary {
  code: string;
  name: string;
  originalPriceCents: number;
  discountCents: number;
  finalPriceCents: number;
}

export interface ResolvedPricingPromotion {
  promotion: PricingPromotionSummary | null;
  invalidCode: boolean;
}

function normalizeCode(code: string | null | undefined): string {
  return (code ?? '').trim().toLowerCase();
}

/**
 * Resolves the promotion shown on /pricing from the same server-evaluated
 * candidates used by the checkout API. The client never supplies prices or
 * eligibility; it only carries the resulting code to the purchase request.
 */
export function resolvePricingPromotion(
  result: PromotionCandidatesResult,
  listPriceCents: number,
  providedCode?: string | null,
): ResolvedPricingPromotion {
  const selected = selectPurchasePromotion(result);

  if (providedCode && (!selected || normalizeCode(selected.code) !== normalizeCode(providedCode))) {
    return { promotion: null, invalidCode: true };
  }

  if (!selected) return { promotion: null, invalidCode: false };

  return {
    invalidCode: false,
    promotion: {
      code: selected.code,
      name: selected.code,
      originalPriceCents: listPriceCents,
      discountCents: selected.discountCents,
      finalPriceCents: selected.finalPriceCents,
    },
  };
}
