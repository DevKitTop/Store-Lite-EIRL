// =====================================================
// PROMOTIONS — Transactional emails (T5)
// =====================================================
// Welcome and five-day reminder emails for the new-owner free period.
// Delivery is best-effort: an email failure never rolls back a business,
// changes a subscription or blocks the cron response.
// =====================================================

import { env } from '@/config/env';
import { db } from '@/core/database/client';
import { profiles, promotionRedemptions, promotions } from '@/core/database/schema';
import { ReminderEmail, WelcomeEmail } from '@/emails';
import {
  buildPromotionSettingsPath,
  isPromotionReminderDue,
} from '@/features/promotions/discoveryRules';
import { getPromotionCandidates } from '@/features/promotions/getApplicablePromotion';
import { logger, toErrorDetail } from '@/lib/logger';
import { PLAN_PRICES } from '@/shared/billing/planPrices';
import { render } from '@react-email/components';
import { and, eq } from 'drizzle-orm';

import { sendEmail } from './resend';

function appUrl(): string {
  return env.nextPublicAppUrl.replace(/\/+$/, '');
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('es-PE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Lima',
  });
}

export interface SendPromotionWelcomeEmailInput {
  ownerId: string;
  ownerEmail: string;
  ownerName: string;
  businessName: string;
  slug: string;
}

/** Sends the welcome email only while the free-period offer is actually available. */
export async function sendPromotionWelcomeEmail({
  ownerId,
  ownerEmail,
  ownerName,
  businessName,
  slug,
}: SendPromotionWelcomeEmailInput): Promise<void> {
  if (!ownerEmail) return;

  try {
    const { best } = await getPromotionCandidates({
      ownerId,
      planType: 'lite_pago',
      period: 'monthly',
      listPriceCents: PLAN_PRICES.lite_pago.monthly,
    });

    if (!best || best.type !== 'free_period' || !best.grantedDays) return;

    const html = await render(
      WelcomeEmail({
        ownerName: ownerName || ownerEmail.split('@')[0],
        businessName,
        durationDays: best.grantedDays,
        settingsUrl: `${appUrl()}${buildPromotionSettingsPath(slug)}`,
      }),
    );

    await sendEmail({
      to: ownerEmail,
      subject: 'Tu bienvenida a Store Lite: oferta de bienvenida',
      html,
    });
  } catch (error) {
    logger.error('PromotionEmails: welcome email failed', {
      ownerId,
      error: toErrorDetail(error),
    });
  }
}

export interface SendPromotionReminderEmailInput {
  businessId: string;
  ownerId: string;
  businessName: string;
  slug: string;
  planEndDate: Date;
  now?: Date;
}

/**
 * Sends the five-day reminder only for an actual redeemed free period.
 * Returns whether an email was sent, so the cron can count real side effects.
 */
export async function sendPromotionReminderEmail({
  businessId,
  ownerId,
  businessName,
  slug,
  planEndDate,
  now = new Date(),
}: SendPromotionReminderEmailInput): Promise<boolean> {
  if (!isPromotionReminderDue({ planEndDate, now })) return false;

  try {
    const [owner, redemption] = await Promise.all([
      db.query.profiles.findFirst({
        where: eq(profiles.id, ownerId),
        columns: { email: true, fullName: true },
      }),
      db
        .select({ id: promotionRedemptions.id })
        .from(promotionRedemptions)
        .innerJoin(promotions, eq(promotionRedemptions.promotionId, promotions.id))
        .where(
          and(
            eq(promotionRedemptions.businessId, businessId),
            eq(promotionRedemptions.ownerId, ownerId),
            eq(promotions.type, 'free_period'),
            eq(promotionRedemptions.status, 'granted'),
            eq(promotionRedemptions.finalAmountCents, 0),
          ),
        )
        .limit(1),
    ]);

    if (!owner?.email || redemption.length === 0) return false;

    const html = await render(
      ReminderEmail({
        ownerName: owner.fullName || owner.email.split('@')[0],
        businessName,
        planEndDate: formatDate(planEndDate),
        daysRemaining: 5,
        settingsUrl: `${appUrl()}${buildPromotionSettingsPath(slug)}`,
      }),
    );

    await sendEmail({
      to: owner.email,
      subject: 'Tu oferta de Store Lite vence en 5 días',
      html,
    });

    return true;
  } catch (error) {
    logger.error('PromotionEmails: reminder email failed', {
      businessId,
      ownerId,
      error: toErrorDetail(error),
    });
    return false;
  }
}
