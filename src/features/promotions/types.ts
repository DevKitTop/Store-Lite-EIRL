// =====================================================
// PROMOTIONS — Domain types
// =====================================================
// Pure, framework-free definitions shared by the evaluator, the
// server resolver and the UI. No database or React imports here.
// =====================================================

export const PROMOTION_TYPES = ['free_period', 'percent_off', 'fixed_off'] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

export const PROMOTION_PLAN_SCOPES = ['lite_pago', 'lite_plus', 'any'] as const;
export type PromotionPlanScope = (typeof PROMOTION_PLAN_SCOPES)[number];

export const PROMOTION_PERIOD_SCOPES = ['monthly', 'annual', 'any'] as const;
export type PromotionPeriodScope = (typeof PROMOTION_PERIOD_SCOPES)[number];

export const PROMOTION_ELIGIBILITIES = ['new_owner', 'all_users', 'code', 'manual'] as const;
export type PromotionEligibility = (typeof PROMOTION_ELIGIBILITIES)[number];

export const PROMOTION_REJECTION_REASONS = [
  'inactive',
  'not_started',
  'ended',
  'max_redemptions_reached',
  'plan_mismatch',
  'period_mismatch',
  'already_redeemed',
  'not_new_owner',
  'code_required',
  'code_mismatch',
  'manual_only',
  'invalid_config',
] as const;
export type PromotionRejectionReason = (typeof PROMOTION_REJECTION_REASONS)[number];

/** The smallest charge Culqi accepts, in cents (S/ 1.00). */
export const MIN_CHARGE_CENTS = 100;

/**
 * A campaign as stored in `promotions`. Amounts are integers in cents so the
 * evaluator never does floating-point arithmetic.
 */
export interface PromotionDefinition {
  id: string;
  code: string;
  type: PromotionType;
  planScope: PromotionPlanScope;
  periodScope: PromotionPeriodScope;
  durationDays: number | null;
  percentOff: number | null;
  amountOffCents: number | null;
  eligibility: PromotionEligibility;
  startsAt: Date;
  endsAt: Date | null;
  maxRedemptions: number | null;
  isActive: boolean;
}

/** Everything the evaluator needs to know about this business and purchase. */
export interface PromotionEvaluationContext {
  now: Date;
  planType: 'lite_pago' | 'lite_plus';
  period: 'monthly' | 'annual';
  /** Authoritative list price from PLAN_PRICES, in cents. */
  listPriceCents: number;
  ownerHasRedeemed: boolean;
  /** True only when the owner qualifies as a new user for `new_owner`. */
  ownerIsNew: boolean;
  totalRedemptions: number;
  providedCode?: string | null;
}

export interface EligiblePromotionEvaluation {
  eligible: true;
  promotionId: string;
  code: string;
  type: PromotionType;
  discountCents: number;
  finalPriceCents: number;
  /** Days granted for `free_period`; null for discounted purchases. */
  grantedDays: number | null;
}

export interface RejectedPromotionEvaluation {
  eligible: false;
  promotionId: string;
  code: string;
  reason: PromotionRejectionReason;
}

export type PromotionEvaluation = EligiblePromotionEvaluation | RejectedPromotionEvaluation;
