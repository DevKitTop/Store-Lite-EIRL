// =====================================================
// PROMOTIONS — Claim server action
// =====================================================
// Grants a free_period campaign to a business. No Culqi charge, no
// plan_payments, no ticket: the subscription becomes active with an explicit
// end date and the origin is recorded in promotion_redemptions.
// =====================================================

'use server';

import { db } from '@/core/database/client';
import { businessSubscriptions, promotionRedemptions } from '@/core/database/schema';
import { requireOwnedBusinessById } from '@/features/storage/actions/authz';
import { logger, toErrorDetail } from '@/lib/logger';
import { PLAN_PRICES } from '@/shared/billing/planPrices';
import type { ActionState } from '@/types/actions';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { resolveFreePeriodWindow } from './claimRules';
import { getPromotionCandidates } from './getApplicablePromotion';

const claimPromotionSchema = z.object({
  businessId: z.string().uuid(),
});

export interface ClaimPromotionResult extends ActionState {
  planEndDate?: string;
}

export async function claimPromotionAction(input: {
  businessId: string;
}): Promise<ClaimPromotionResult> {
  const validation = claimPromotionSchema.safeParse(input);
  if (!validation.success) {
    return { success: false, error: 'Solicitud inválida.' };
  }

  const { businessId } = validation.data;

  try {
    const { ownerId, slug } = await requireOwnedBusinessById(businessId);
    const now = new Date();

    const currentSubscription = await db.query.businessSubscriptions.findFirst({
      where: eq(businessSubscriptions.businessId, businessId),
      columns: { planType: true, planStatus: true, planEndDate: true },
    });

    // The offer is Lite Pago: never downgrade a running Lite Plus.
    if (
      currentSubscription?.planStatus === 'active' &&
      currentSubscription.planType === 'lite_plus' &&
      (currentSubscription.planEndDate === null || currentSubscription.planEndDate > now)
    ) {
      return { success: false, error: 'Ya tenés Lite Plus activo. Esta oferta es para Lite Pago.' };
    }

    const { best } = await getPromotionCandidates({
      ownerId,
      planType: 'lite_pago',
      period: 'monthly',
      listPriceCents: PLAN_PRICES.lite_pago.monthly,
      now,
    });

    if (!best) {
      return { success: false, error: 'No hay ninguna oferta disponible para tu cuenta.' };
    }

    if (best.type !== 'free_period') {
      return { success: false, error: 'Esta oferta requiere una compra.' };
    }

    if (!best.grantedDays) {
      return { success: false, error: 'La oferta está mal configurada.' };
    }

    const { planStartDate, planEndDate } = resolveFreePeriodWindow({
      now,
      durationDays: best.grantedDays,
      currentPlanType: currentSubscription?.planType ?? null,
      currentPlanEndDate: currentSubscription?.planEndDate ?? null,
    });

    const outcome = await db.transaction(async (tx) => {
      // The unique (promotion_id, owner_id) constraint is the real guard:
      // two concurrent claims can pass the pre-check, only one inserts.
      const [redemption] = await tx
        .insert(promotionRedemptions)
        .values({
          promotionId: best.promotionId,
          businessId,
          ownerId,
          originalAmountCents: PLAN_PRICES.lite_pago.monthly,
          discountAmountCents: best.discountCents,
          finalAmountCents: 0,
          status: 'granted',
          redeemedAt: now,
        })
        .onConflictDoNothing({
          target: [promotionRedemptions.promotionId, promotionRedemptions.ownerId],
        })
        .returning({ id: promotionRedemptions.id });

      if (!redemption) return { alreadyRedeemed: true } as const;

      await tx
        .insert(businessSubscriptions)
        .values({
          businessId,
          planType: 'lite_pago',
          planStatus: 'active',
          planStartDate,
          planEndDate,
        })
        .onConflictDoUpdate({
          target: businessSubscriptions.businessId,
          set: {
            planType: 'lite_pago',
            planStatus: 'active',
            planStartDate,
            planEndDate,
            updatedAt: now,
          },
        });

      return { alreadyRedeemed: false } as const;
    });

    if (outcome.alreadyRedeemed) {
      return { success: false, error: 'Ya reclamaste esta oferta.' };
    }

    revalidatePath(`/${slug}/settings`);
    revalidatePath(`/${slug}/dashboard`);
    revalidatePath('/pricing');

    return {
      success: true,
      message: '¡Listo! Tu mes de Lite Pago ya está activo.',
      planEndDate: planEndDate.toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    const isKnownAuthError = message === 'No autorizado' || message === 'Negocio no encontrado';

    logger.error('[claimPromotionAction] Error:', { error: toErrorDetail(err) });

    return {
      success: false,
      error: isKnownAuthError ? message : 'No pudimos aplicar la oferta. Intentá de nuevo.',
    };
  }
}
