// =====================================================
// PROMOTIONS — Claim rules
// =====================================================
// Pure helpers shared by the server resolver and the claim action.
// =====================================================

export interface NewOwnerParams {
  firstBusinessCreatedAt: Date | null;
  startsAt: Date;
  endsAt: Date | null;
}

/**
 * A1: `new_owner` means the owner's first business was created inside the
 * campaign window. An owner with no business never qualifies.
 */
export function isNewOwnerForCampaign({
  firstBusinessCreatedAt,
  startsAt,
  endsAt,
}: NewOwnerParams): boolean {
  if (!firstBusinessCreatedAt) return false;
  if (firstBusinessCreatedAt < startsAt) return false;
  if (endsAt && firstBusinessCreatedAt >= endsAt) return false;
  return true;
}

export interface FreePeriodWindowParams {
  now: Date;
  durationDays: number;
  currentPlanType: 'lite' | 'lite_pago' | 'lite_plus' | null;
  currentPlanEndDate: Date | null;
}

export interface FreePeriodWindow {
  planStartDate: Date;
  planEndDate: Date;
}

/**
 * Resolves the subscription window for a granted free period.
 *
 * A running Lite Pago period is never shortened: the granted days are added
 * after the current end date. Every other case starts today. Lite Plus is
 * blocked by the caller before reaching this helper, so it does not extend.
 */
export function resolveFreePeriodWindow({
  now,
  durationDays,
  currentPlanType,
  currentPlanEndDate,
}: FreePeriodWindowParams): FreePeriodWindow {
  const hasRunningLitePago =
    currentPlanType === 'lite_pago' && currentPlanEndDate !== null && currentPlanEndDate > now;

  const base = hasRunningLitePago ? currentPlanEndDate : now;
  const planEndDate = new Date(base.getTime());
  planEndDate.setDate(planEndDate.getDate() + durationDays);

  return { planStartDate: new Date(now.getTime()), planEndDate };
}
