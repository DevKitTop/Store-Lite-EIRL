/**
 * =====================================================
 * API: POST /api/billing/purchase-plan
 * Compra de plan SaaS: cobra via Culqi, genera boleta SUNAT
 * =====================================================
 *
 * Flujo:
 *  1. Valida request y propiedad del negocio
 *  2. Reevalúa la promoción en servidor; el cliente sólo sugiere un código
 *  3. Calcula montos: total final (INCLUYE IGV) y desglosa subtotal + IGV 18%
 *  4. Cobra en Culqi (claves del SaaS, no del merchant)
 *  5. INSERT plan_payments (correlativo B001 automático por secuencia)
 *  6. UPSERT business_subscriptions (activa/renueva el plan)
 *  7. Confirma la reserva de la promoción en la misma transacción del pago
 *  8. Retorna { success, planPaymentId, ticketNumber, planActivatedUntil }
 */

import { db } from '@/core/database/client';
import {
  businessSubscriptions,
  formatTicketNumber,
  planPayments,
  promotionRedemptions,
  type SubscriptionPlan,
} from '@/core/database/schema';
import { getPromotionCandidates } from '@/features/promotions/getApplicablePromotion';
import { selectPurchasePromotion } from '@/features/promotions/purchaseRules';
import type { EligiblePromotionEvaluation } from '@/features/promotions/types';
import { requireOwnedBusinessById } from '@/features/storage/actions/authz';
import { captureEvent } from '@/lib/analytics/capture';
import { AnalyticsEvents } from '@/lib/analytics/taxonomy';
import { getConsentState } from '@/lib/consent/consentServer';
import { logger, toErrorDetail } from '@/lib/logger';
import { fireEvent } from '@/lib/meta/capi';
import { generateEventId } from '@/lib/meta/eventId';
import { extractFbclid, getCookie } from '@/lib/meta/payload';
import { createClient } from '@/lib/supabase/server';
import { PLAN_PRICES, splitIgv } from '@/shared/billing/planPrices';
import { splitFullName } from '@/shared/payments/fullName';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

// Duración de cada período en días
const PERIOD_DAYS: Record<'monthly' | 'annual', number> = {
  monthly: 30,
  annual: 365,
};

interface PurchasePlanBody {
  token: string;
  planType: SubscriptionPlan;
  period: 'monthly' | 'annual';
  businessId: string;
  // Datos del comprador para SUNAT
  buyerEmail: string;
  buyerFullName: string;
  buyerDocumentType: 'DNI' | 'RUC';
  buyerDocumentNumber: string;
  buyerAddress?: string;
  promotionCode?: string | null;
}

interface CulqiChargeResponse {
  object: string;
  id: string;
  amount: number;
  currency_code: string;
  email: string;
  paid?: boolean;
  user_message?: string;
  merchant_message?: string;
  outcome?: { type: string; user_message: string; merchant_message: string };
  reference_code?: string;
  creation_date?: number;
}

type TransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

type PromotionResolution =
  | { ok: true; promotion: EligiblePromotionEvaluation | null }
  | { ok: false; error: string };

class PromotionAlreadyRedeemedError extends Error {
  constructor() {
    super('PROMOTION_ALREADY_REDEEMED');
    this.name = 'PromotionAlreadyRedeemedError';
  }
}

function normalizePromotionCode(code: string | null | undefined): string {
  return (code ?? '').trim().toLowerCase();
}

interface ResolvePurchasePromotionParams {
  ownerId: string;
  planType: 'lite_pago' | 'lite_plus';
  period: 'monthly' | 'annual';
  listPriceCents: number;
  providedCode: string | null;
}

async function resolvePurchasePromotion({
  ownerId,
  planType,
  period,
  listPriceCents,
  providedCode,
}: ResolvePurchasePromotionParams): Promise<PromotionResolution> {
  const candidates = await getPromotionCandidates({
    ownerId,
    planType,
    period,
    listPriceCents,
    providedCode,
  });
  const promotion = selectPurchasePromotion(candidates);

  if (
    providedCode &&
    (!promotion || normalizePromotionCode(promotion.code) !== normalizePromotionCode(providedCode))
  ) {
    return { ok: false, error: 'Código de descuento inválido o no aplicable' };
  }

  return { ok: true, promotion };
}

interface PromotionRedemptionParams {
  promotion: EligiblePromotionEvaluation;
  businessId: string;
  ownerId: string;
  listPriceCents: number;
  chargeCents: number;
  now: Date;
}

/**
 * Claims the one-redemption-per-owner slot BEFORE any external charge. The
 * unique (promotion_id, owner_id) constraint remains the final guard; losing
 * the claim now returns 409 while no money has moved.
 */
async function reservePromotionRedemption({
  promotion,
  businessId,
  ownerId,
  listPriceCents,
  chargeCents,
  now,
}: PromotionRedemptionParams): Promise<string> {
  const [redemption] = await db
    .insert(promotionRedemptions)
    .values({
      promotionId: promotion.promotionId,
      businessId,
      ownerId,
      planPaymentId: null,
      originalAmountCents: listPriceCents,
      discountAmountCents: promotion.discountCents,
      finalAmountCents: chargeCents,
      status: 'granted',
      redeemedAt: now,
    })
    .onConflictDoNothing({
      target: [promotionRedemptions.promotionId, promotionRedemptions.ownerId],
    })
    .returning({ id: promotionRedemptions.id });

  if (!redemption) throw new PromotionAlreadyRedeemedError();
  return redemption.id;
}

interface ConsumePromotionReservationParams {
  tx: TransactionClient;
  reservationId: string;
  planPaymentId: string;
  now: Date;
}

async function consumePromotionReservation({
  tx,
  reservationId,
  planPaymentId,
  now,
}: ConsumePromotionReservationParams): Promise<void> {
  const [updated] = await tx
    .update(promotionRedemptions)
    .set({ planPaymentId, status: 'consumed', redeemedAt: now })
    .where(
      and(eq(promotionRedemptions.id, reservationId), eq(promotionRedemptions.status, 'granted')),
    )
    .returning({ id: promotionRedemptions.id });

  if (!updated) throw new Error('PROMOTION_RESERVATION_LOST');
}

/** Releases a reservation that never reached a successful paid plan. */
async function releasePromotionReservation(reservationId: string): Promise<void> {
  try {
    await db
      .delete(promotionRedemptions)
      .where(
        and(eq(promotionRedemptions.id, reservationId), eq(promotionRedemptions.status, 'granted')),
      );
  } catch (error) {
    logger.error('[purchase-plan] No se pudo liberar la reserva de promoción', {
      reservationId,
      error: toErrorDetail(error),
    });
  }
}

export async function POST(request: Request) {
  // ── Auth check ──────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  }

  const now = new Date();
  let promotionReservationId: string | null = null;

  try {
    const body: PurchasePlanBody = await request.json();

    const {
      token,
      planType,
      period,
      businessId,
      buyerEmail,
      buyerFullName,
      buyerDocumentType,
      buyerDocumentNumber,
      buyerAddress,
      promotionCode,
    } = body;

    // ── Auth: verify ownership ────────────────────────────────────────────────
    let ownerId: string | null = null;
    try {
      ownerId = (await requireOwnedBusinessById(businessId)).ownerId;
    } catch (err) {
      return NextResponse.json(
        { success: false, error: err instanceof Error ? err.message : 'No autorizado' },
        { status: 401 },
      );
    }
    if (!ownerId) {
      return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
    }

    // ── Validación ────────────────────────────────────────────────────────────
    if (!token || !planType || !period || !businessId || !buyerEmail || !buyerDocumentNumber) {
      return NextResponse.json(
        {
          error:
            'Faltan campos requeridos: token, planType, period, businessId, buyerEmail, buyerDocumentNumber',
        },
        { status: 400 },
      );
    }

    const planConfig = PLAN_PRICES[planType];
    if (!planConfig) {
      return NextResponse.json({ error: `Plan desconocido: ${planType}` }, { status: 400 });
    }

    const priceInCentimos = planConfig[period];
    if (priceInCentimos === 0) {
      return NextResponse.json(
        { error: `El plan ${planConfig.label} es gratuito y no requiere cobro` },
        { status: 400 },
      );
    }

    // ── Resolver promoción (siempre en servidor) ─────────────────────────────
    // El cliente sólo puede sugerir un código. El monto final y la campaña
    // elegida se recalculan aquí; free_period no aplica a una compra.
    const providedCode = typeof promotionCode === 'string' ? promotionCode.trim() || null : null;
    const resolution = await resolvePurchasePromotion({
      ownerId,
      planType: planType === 'lite_plus' ? 'lite_plus' : 'lite_pago',
      period,
      listPriceCents: priceInCentimos,
      providedCode,
    });
    if (!resolution.ok) {
      return NextResponse.json({ success: false, error: resolution.error }, { status: 400 });
    }
    const promotion = resolution.promotion;

    captureEvent(AnalyticsEvents.PLAN_PURCHASE_STARTED, {
      plan: planType,
      period,
      business_id: businessId,
      promotion_code: promotion?.code ?? providedCode ?? undefined,
      amount_total_cents: promotion?.finalPriceCents ?? priceInCentimos,
    }).catch(() => {});

    // ── Calcular montos (en soles, con 2 decimales) ───────────────────────────
    // El monto final es el TOTAL que se cobra (incluye IGV). Nunca se toma del
    // cliente; desglosamos subtotal e IGV para la boleta SUNAT sobre ese total.
    const chargeCents = promotion?.finalPriceCents ?? priceInCentimos;
    const totalSoles = chargeCents / 100;
    const { subtotalSoles, igvSoles } = splitIgv(totalSoles);
    const totalCentimos = chargeCents; // Para Culqi — sin agregar IGV encima

    // ── Obtener datos del emisor ──────────────────────────────────────────────
    const issuer = await db.query.saasIssuerConfig.findFirst();
    if (!issuer) {
      logger.error('[purchase-plan] saas_issuer_config no configurada');
      return NextResponse.json(
        { error: 'Configuración del emisor no encontrada. Contacta al soporte.' },
        { status: 500 },
      );
    }

    // ── Cobrar en Culqi (claves del SaaS, NO del merchant) ───────────────────
    const culqiSecretKey = process.env.CULQI_SK;
    if (!culqiSecretKey) {
      logger.error('[purchase-plan] CULQI_SK no configurada');
      return NextResponse.json({ error: 'Pasarela de pagos no configurada' }, { status: 500 });
    }

    // ── Reservar la redención ANTES de cobrar ───────────────────────────────
    // Un conflicto aquí devuelve 409 sin tocar Culqi. La fila `granted` se
    // libera si el cobro falla y se confirma como `consumed` en la transacción.
    if (promotion) {
      promotionReservationId = await reservePromotionRedemption({
        promotion,
        businessId,
        ownerId,
        listPriceCents: priceInCentimos,
        chargeCents,
        now,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let culqiData: CulqiChargeResponse;
    try {
      const culqiResponse = await fetch('https://api.culqi.com/v2/charges', {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${culqiSecretKey}`,
        },
        body: JSON.stringify({
          amount: totalCentimos,
          currency_code: 'PEN',
          email: buyerEmail,
          source_id: token,
          description: `Plan ${planConfig.label} ${period === 'monthly' ? 'Mensual' : 'Anual'} - Store Lite`,
          antifraud_details: {
            email: buyerEmail,
            ...splitFullName(buyerFullName),
          },
          metadata: {
            businessId,
            planType,
            period,
            platform: 'store-lite-saas',
            promotionCode: promotion?.code ?? null,
            promotionId: promotion?.promotionId ?? null,
          },
        }),
      });
      clearTimeout(timeout);
      culqiData = await culqiResponse.json();

      const isSuccess = culqiData.outcome?.type === 'venta_exitosa' || culqiData.paid === true;
      if (!culqiResponse.ok || !isSuccess) {
        if (promotionReservationId) {
          await releasePromotionReservation(promotionReservationId);
          promotionReservationId = null;
        }
        return NextResponse.json(
          {
            error: 'Error al procesar el pago',
            details:
              culqiData?.user_message ||
              culqiData?.outcome?.user_message ||
              'Error desconocido de Culqi',
          },
          { status: culqiResponse.ok ? 400 : culqiResponse.status },
        );
      }
    } catch (err) {
      clearTimeout(timeout);
      if (promotionReservationId) {
        await releasePromotionReservation(promotionReservationId);
        promotionReservationId = null;
      }
      const isAbort = err instanceof Error && err.name === 'AbortError';
      return NextResponse.json(
        { error: isAbort ? 'Timeout al procesar el pago' : 'Error de conexión con la pasarela' },
        { status: isAbort ? 504 : 502 },
      );
    }

    // ── Determinar método de pago ─────────────────────────────────────────────
    const paymentMethod = token.startsWith('ype_') ? 'yape' : 'card';

    // ── Transacción: leer suscripción actual, calcular prorrateo, insertar pago y upsert ──
    const { planPayment, planEndDate } = await db.transaction(async (tx) => {
      // Leer suscripción activa actual para prorrateo
      const currentSubscription = await tx.query.businessSubscriptions.findFirst({
        where: and(
          eq(businessSubscriptions.businessId, businessId),
          eq(businessSubscriptions.planStatus, 'active'),
        ),
        columns: { planType: true, planEndDate: true, planStartDate: true },
      });

      // Calcular fechas con prorrateo
      let planStartDate: Date;
      let planEndDate: Date;

      const isRenewal =
        currentSubscription &&
        currentSubscription.planType === planType &&
        currentSubscription.planEndDate &&
        currentSubscription.planEndDate > now;

      if (isRenewal) {
        // Mismo plan vigente → extender desde el fin actual
        // isRenewal garantiza que currentSubscription.planEndDate no es null
        planStartDate = currentSubscription.planStartDate ?? now;
        planEndDate = new Date(currentSubscription.planEndDate!.getTime());
        planEndDate.setDate(planEndDate.getDate() + PERIOD_DAYS[period]);
      } else {
        // Plan diferente o primera compra → comenzar desde hoy
        planStartDate = now;
        planEndDate = new Date(now);
        planEndDate.setDate(planEndDate.getDate() + PERIOD_DAYS[period]);
      }

      // ── Insertar plan_payment ───────────────────────────────────────────────
      // Dejamos que la DB maneje el default del ticketCorrelative via secuencia
      const [planPayment] = await tx
        .insert(planPayments)
        .values({
          businessId,
          planType,
          period,
          amountSubtotal: String(subtotalSoles),
          amountIgv: String(igvSoles),
          amountTotal: String(totalSoles),
          currency: 'PEN',
          paymentMethod: paymentMethod as 'card' | 'yape',
          culqiChargeId: culqiData.id,
          culqiReferenceCode: culqiData.reference_code || null,
          status: 'paid',
          buyerEmail,
          buyerFullName: buyerFullName || null,
          buyerDocumentType: buyerDocumentType || null,
          buyerDocumentNumber: buyerDocumentNumber || null,
          buyerAddress: buyerAddress || null,
          ticketSeries: 'B001',
          ticketIssuedAt: new Date(),
          planStartDate,
          planEndDate,
          metadata: {
            culqiRaw: {
              chargeId: culqiData.id,
              createdAt: culqiData.creation_date
                ? new Date(culqiData.creation_date * 1000).toISOString()
                : new Date().toISOString(),
            },
            ip: request.headers.get('x-forwarded-for'),
            userAgent: request.headers.get('user-agent'),
            ...(promotion
              ? {
                  promotionCode: promotion.code,
                  promotionId: promotion.promotionId,
                  originalAmountCents: priceInCentimos,
                  discountAmountCents: promotion.discountCents,
                }
              : {}),
          },
        })
        .returning();

      // ── Activar / renovar suscripción ───────────────────────────────────────
      await tx
        .insert(businessSubscriptions)
        .values({
          businessId,
          planType,
          planStatus: 'active',
          planStartDate,
          planEndDate,
        })
        .onConflictDoUpdate({
          target: businessSubscriptions.businessId,
          set: {
            planType,
            planStatus: 'active',
            planStartDate,
            planEndDate,
            updatedAt: new Date(),
          },
        });

      // ── Confirmar la reserva en la MISMA transacción del cobro ───────────
      if (promotion && promotionReservationId) {
        await consumePromotionReservation({
          tx,
          reservationId: promotionReservationId,
          planPaymentId: planPayment.id,
          now,
        });
      }

      return { planPayment, planEndDate };
    });

    // Payment + redemption are committed: do not release the reservation.
    promotionReservationId = null;

    const ticketNumber = formatTicketNumber(
      planPayment.ticketSeries,
      planPayment.ticketCorrelative,
    );

    captureEvent(AnalyticsEvents.PLAN_PURCHASED, {
      plan: planType,
      period,
      business_id: businessId,
      amount_total_cents: chargeCents,
      payment_method: paymentMethod,
      culqi_charge_id: culqiData.id,
      plan_payment_id: planPayment.id,
    }).catch(() => {});

    if (promotion) {
      captureEvent(AnalyticsEvents.PROMOTION_APPLIED, {
        promotion_id: promotion.promotionId,
        promotion_code: promotion.code,
        promotion_type: promotion.type,
        discount_cents: promotion.discountCents,
        final_amount_cents: promotion.finalPriceCents,
        plan: planType,
        period,
        business_id: businessId,
      }).catch(() => {});
    }

    // ── Meta CAPI: fire-and-forget Purchase ──────────────────────────────────
    // Marketing attribution must NEVER slow down or break the purchase (design
    // D4). Consent is re-checked server-side (client state alone never
    // authorizes server sends); `cookies()` can throw outside the request scope
    // in tests, so the whole block fails silently into a normal purchase.
    let eventId: string | undefined;
    let consentState: string | undefined;
    try {
      consentState = await getConsentState();
    } catch {
      consentState = undefined;
    }

    if (consentState === 'accepted') {
      eventId = generateEventId();
      const cookieHeader = request.headers.get('cookie');
      const referer = request.headers.get('referer');
      const eventSourceUrl = referer ?? '/pricing';
      const fbclid = referer ? extractFbclid(new URL(referer), referer) : undefined;

      // fireEvent never throws and never rejects (capi.ts swallows internally);
      // it is deliberately NOT awaited — tracking must never slow the purchase.
      fireEvent('Purchase', {
        eventId,
        eventSourceUrl,
        externalId: user.id,
        email: buyerEmail,
        fullName: buyerFullName,
        clientIpAddress: request.headers.get('x-forwarded-for') ?? undefined,
        clientUserAgent: request.headers.get('user-agent') ?? undefined,
        fbp: getCookie(cookieHeader, '_fbp'),
        fbc: getCookie(cookieHeader, '_fbc'),
        fbclid,
        customData: {
          value: totalSoles,
          currency: 'PEN',
          plan_type: planType,
          period,
          payment_method: paymentMethod,
          culqi_charge_id: culqiData.id,
        },
      });
    }

    return NextResponse.json({
      success: true,
      planPaymentId: planPayment.id,
      ticketNumber,
      planActivatedUntil: planEndDate.toISOString(),
      amountTotal: totalSoles,
      ...(promotion
        ? {
            promotion: {
              code: promotion.code,
              type: promotion.type,
              discountCents: promotion.discountCents,
              finalAmountCents: promotion.finalPriceCents,
            },
          }
        : {}),
      ...(eventId ? { eventId } : {}),
      issuer: {
        ruc: issuer.ruc,
        name: issuer.razonSocial,
        address: issuer.direccion,
        district: issuer.distrito,
        province: issuer.provincia,
        department: issuer.departamento,
      },
    });
  } catch (error) {
    if (promotionReservationId) {
      await releasePromotionReservation(promotionReservationId);
      promotionReservationId = null;
    }

    if (error instanceof PromotionAlreadyRedeemedError) {
      logger.error('[purchase-plan] Promoción ya redimida antes del cobro', {
        error: toErrorDetail(error),
      });
      return NextResponse.json(
        { error: 'Esta promoción ya fue utilizada para este plan' },
        { status: 409 },
      );
    }

    logger.error('[purchase-plan] Error inesperado:', { error: toErrorDetail(error) });
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
