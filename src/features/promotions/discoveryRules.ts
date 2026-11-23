// =====================================================
// PROMOTIONS — Discovery and lifecycle rules (T5)
// =====================================================
// Pure helpers shared by the owner banner, the welcome email and the
// five-day reminder. No database or network access here.
// =====================================================

export type PromotionOfferState = 'available' | 'active' | 'used';

export interface DiscoveryBannerInput {
  isOwner: boolean;
  offerState: PromotionOfferState | null | undefined;
}

/**
 * The discovery banner is an owner-only acquisition nudge. Once the owner
 * redeems the offer it becomes noise, so it disappears in active/used states.
 */
export function isDiscoveryBannerVisible({ isOwner, offerState }: DiscoveryBannerInput): boolean {
  return isOwner && offerState === 'available';
}

export interface PromotionReminderInput {
  planEndDate: Date | string | null | undefined;
  now?: Date;
  daysBefore?: number;
}

/**
 * True only on the exact calendar day that starts the reminder window.
 * Uses UTC date boundaries so a timezone offset cannot produce two emails.
 */
export function isPromotionReminderDue({
  planEndDate,
  now = new Date(),
  daysBefore = 5,
}: PromotionReminderInput): boolean {
  if (!planEndDate) return false;

  const end = planEndDate instanceof Date ? planEndDate : new Date(planEndDate);
  if (Number.isNaN(end.getTime())) return false;

  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysRemaining = Math.round((endDay - nowDay) / (1000 * 60 * 60 * 24));

  return daysRemaining === daysBefore;
}

export function buildPromotionSettingsPath(slug: string): string {
  return `/${slug}/settings`;
}

export interface PromotionOfferView {
  code: string;
  name: string;
  durationDays: number;
  state: PromotionOfferState;
  planEndDate: string | null;
  /** Days left in an active grant, computed on the server to keep renders pure. */
  daysRemaining: number | null;
}

/** Structural subset of a server-resolved promotion candidate. */
export interface PromotionCandidateLike {
  promotion: {
    code: string;
    name?: string | null;
    type: string;
    durationDays: number | null;
  };
  evaluation: {
    eligible: boolean;
    reason?: string;
  };
}

export interface ResolvePromotionOfferInput {
  candidates: readonly PromotionCandidateLike[];
  plan: string;
  isActive: boolean;
  planEndDate: Date | string | null | undefined;
  now?: Date;
}

/**
 * Maps server-evaluated campaigns to the single offer card shown to the owner.
 *
 * The free-period campaign must be found even when it was already redeemed:
 * filtering by `eligible` hides the active and used states instead of reporting
 * them. Lite Plus never shows a Lite Pago acquisition offer.
 */
export function resolvePromotionOffer({
  candidates,
  plan,
  isActive,
  planEndDate,
  now = new Date(),
}: ResolvePromotionOfferInput): PromotionOfferView | null {
  if (plan === 'lite_plus' && isActive) return null;

  const freePeriod = candidates.find((candidate) => candidate.promotion.type === 'free_period');
  if (!freePeriod) return null;

  const base = {
    code: freePeriod.promotion.code,
    name: freePeriod.promotion.name || freePeriod.promotion.code,
    durationDays: freePeriod.promotion.durationDays ?? 0,
  };

  if (freePeriod.evaluation.eligible) {
    return { ...base, state: 'available', planEndDate: null, daysRemaining: null };
  }

  if (freePeriod.evaluation.reason !== 'already_redeemed') return null;

  let end: Date | null = null;
  if (planEndDate instanceof Date) {
    end = planEndDate;
  } else if (planEndDate) {
    const parsed = new Date(planEndDate);
    if (!Number.isNaN(parsed.getTime())) end = parsed;
  }

  const isActiveGrant = plan === 'lite_pago' && isActive && !!end && end > now;

  let planEndDateIso: string | null = null;
  let daysRemaining: number | null = null;

  if (isActiveGrant && end) {
    planEndDateIso = end.toISOString();
    daysRemaining = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));
  }

  return {
    ...base,
    state: isActiveGrant ? 'active' : 'used',
    planEndDate: planEndDateIso,
    daysRemaining,
  };
}
