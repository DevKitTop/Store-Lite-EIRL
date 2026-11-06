// =====================================================
// ENTITLEMENTS — Server-side calculation function
// =====================================================
// ⚠️  SERVER ONLY — importar únicamente en:
//   - Server Components (layout.tsx, page.tsx)
//   - Server Actions ('use server')
// Nunca importar en archivos 'use client'
// =====================================================

import { db } from '@/core/database/client';
import { businessSettings, businessSubscriptions, businesses } from '@/core/database/schema';
import { and, desc, eq } from 'drizzle-orm';
import { cache } from 'react';

import { enforceProductLimit } from './enforceProductLimit';
import {
  DEFAULT_PLAN,
  PLAN_ENTITLEMENTS,
  resolvePlan,
  type BusinessEntitlements,
  type PlanType,
} from './plans';

/**
 * Calcula los entitlements de un negocio segǧn su plan de suscripci��n activo.
 * Ademǭs verifica si el negocio tiene configurada su pasarela de pago.
 *
 * Wrapped in React `cache`: a storefront request asks for the same business
 * from both the app layout and the page, and each call is three queries.
 * The cache is per request, never across requests or users.
 */
export const getBusinessEntitlements = cache(
  async (businessId: string): Promise<BusinessEntitlements> => {
    const [business, subscription, settings] = await Promise.all([
      db.query.businesses.findFirst({
        where: eq(businesses.id, businessId),
        columns: { isActive: true },
      }),
      db.query.businessSubscriptions.findFirst({
        where: and(
          eq(businessSubscriptions.businessId, businessId),
          eq(businessSubscriptions.planStatus, 'active'),
        ),
        orderBy: [desc(businessSubscriptions.createdAt)],
        columns: { planType: true, planEndDate: true },
      }),
      db.query.businessSettings.findFirst({
        where: eq(businessSettings.businessId, businessId),
        columns: { culqiPublicKey: true, culqiSecretKey: true },
      }),
    ]);

    // Verificar expiración: si planEndDate ya pasó, degradar a Free
    const now = new Date();
    const isExpired = subscription?.planEndDate instanceof Date && subscription.planEndDate < now;

    // Track previous plan for enforcement comparison
    // (resolvePlan shims legacy DB keys during the pricing-restructure rollout)
    const previousPlan = !subscription ? null : resolvePlan(subscription.planType);

    let plan: PlanType;
    if (!subscription || isExpired) {
      if (isExpired) {
        console.warn(
          `[entitlements] Business ${businessId} plan expired (${subscription?.planEndDate?.toISOString()}), degrading to ${DEFAULT_PLAN}`,
        );
      }
      plan = DEFAULT_PLAN;
    } else {
      plan = resolvePlan(subscription.planType);
    }

    // Safety net: ensure product count is within plan limits on degradation
    if (previousPlan !== null && previousPlan !== plan) {
      await enforceProductLimit(businessId, PLAN_ENTITLEMENTS[plan].maxProducts);
    }

    const isPaymentConfigured = Boolean(settings?.culqiPublicKey && settings?.culqiSecretKey);
    const planEndDate = subscription?.planEndDate?.toISOString() ?? null;

    return {
      plan,
      isActive: business?.isActive ?? false,
      ...PLAN_ENTITLEMENTS[plan],
      isPaymentConfigured,
      culqiPublicKey: settings?.culqiPublicKey ?? undefined,
      planEndDate,
    };
  },
);
