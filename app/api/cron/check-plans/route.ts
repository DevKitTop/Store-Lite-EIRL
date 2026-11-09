// ──────────────────────────────────────────
// Cron: Plan Expiration Checker
// Vercel Cron Job — runs daily at 8:00 AM
// Notifica a sellers sobre expiración de planes
// ──────────────────────────────────────────

import { env } from '@/config/env';
import { db } from '@/core/database/client';
import type { NotificationType } from '@/core/database/schema';
import { businessSubscriptions, notifications } from '@/core/database/schema';
import { logger, toErrorDetail } from '@/lib/logger';
import { notifyPlanExpired, notifyPlanExpiring } from '@/lib/notifications';
import { and, eq, gte, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

// Vercel Cron: 0 8 * * *  (todos los días a las 8am)
// Triggered via Supabase pg_cron → HTTP POST to storelite.app/api/cron/check-plans
export async function GET(request: Request) {
  // Auth: requires CRON_SECRET via ?token= or Authorization: Bearer header
  const url = new URL(request.url);
  const token =
    url.searchParams.get('token') ||
    request.headers.get('authorization')?.replace('Bearer ', '') ||
    '';
  if (!token || token !== env.cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const in7Days = new Date(today);
    in7Days.setDate(in7Days.getDate() + 7);
    const in3Days = new Date(today);
    in3Days.setDate(in3Days.getDate() + 3);
    const in1Day = new Date(today);
    in1Day.setDate(in1Day.getDate() + 1);

    // ── 1. Buscar subscriptiones activas por expirar ──
    const subscriptions = await db
      .select({
        businessId: businessSubscriptions.businessId,
        planType: businessSubscriptions.planType,
        planEndDate: businessSubscriptions.planEndDate,
      })
      .from(businessSubscriptions)
      .where(
        and(
          eq(businessSubscriptions.planStatus, 'active'),
          sql`${businessSubscriptions.planEndDate} IS NOT NULL`,
        ),
      );

    let notified = 0;
    let skipped = 0;
    let errors = 0;

    for (const sub of subscriptions) {
      if (!sub.planEndDate) continue;

      const endDate = new Date(sub.planEndDate);
      const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      try {
        const planData = {
          planName: getPlanLabel(sub.planType),
          expiryDate: endDate.toLocaleDateString('es-AR'),
        };

        const planExpiringData = {
          ...planData,
          daysRemaining: diffDays,
        };

        if (diffDays === 7) {
          // ── D-7: "Plan expira en 7 días" ──
          if (await alreadyNotified(sub.businessId, 'plan_expiring', 7)) {
            skipped++;
            continue;
          }
          await notifyPlanExpiring(sub.businessId, planExpiringData);
          notified++;
        } else if (diffDays === 3) {
          // ── D-3: "Plan expira en 3 días" ──
          if (await alreadyNotified(sub.businessId, 'plan_expiring', 3)) {
            skipped++;
            continue;
          }
          await notifyPlanExpiring(sub.businessId, planExpiringData);
          notified++;
        } else if (diffDays === 1) {
          // ── D-1: "Plan expira mañana" ──
          if (await alreadyNotified(sub.businessId, 'plan_expiring', 1)) {
            skipped++;
            continue;
          }
          await notifyPlanExpiring(sub.businessId, planExpiringData);
          notified++;
        } else if (diffDays <= 0) {
          // ── Plan expirado ──
          if (await alreadyNotified(sub.businessId, 'plan_expired')) {
            skipped++;
            continue;
          }
          await notifyPlanExpired(sub.businessId, planData);
          notified++;
        }
      } catch (error) {
        logger.error('Cron: check-plans error for business', {
          businessId: sub.businessId,
          error: toErrorDetail(error),
        });
        errors++;
      }
    }

    return NextResponse.json({
      success: true,
      notified,
      skipped,
      errors,
      total: subscriptions.length,
    });
  } catch (error) {
    logger.error('[Cron] check-plans: error —', { error: toErrorDetail(error) });
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// ── Helpers ──────────────────────────────

function getPlanLabel(planType: string): string {
  const labels: Record<string, string> = {
    lite: 'Lite',
    lite_pago: 'Lite Pago',
    lite_plus: 'Lite Plus',
  };
  return labels[planType] ?? planType;
}

/**
 * Evita notificaciones duplicadas: verifica si ya existe una notificación
 * del mismo tipo para este negocio desde el inicio del día.
 */
async function alreadyNotified(
  businessId: string,
  type: string,
  daysRemaining?: number,
): Promise<boolean> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const conditions: any[] = [
    eq(notifications.businessId, businessId),
    eq(notifications.type, type as NotificationType),
    gte(notifications.createdAt, today),
  ];

  if (daysRemaining !== undefined) {
    conditions.push(sql`${notifications.data}->>'daysRemaining' = ${String(daysRemaining)}`);
  }

  const [existing] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(...conditions))
    .limit(1);

  return !!existing;
}
