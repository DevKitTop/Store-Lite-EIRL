/**
 * =====================================================
 * API: POST /api/business/penalties/pay
 * Pay one or multiple pending penalties via Culqi
 * =====================================================
 */

import { db } from '@/core/database/client';
import { businesses, businessSettings, penalties } from '@/core/database/schema';
import { requireOwnedBusinessById } from '@/features/storage/actions/authz';
import { logger, toErrorDetail } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import { splitFullName } from '@/shared/payments/fullName';
import type { CulqiChargeResponse } from '@/types/culqi';
import { decrypt } from '@/utils/crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  // ── Auth check ──────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { businessId, penaltyIds, culqiToken } = await request.json();

    // ── Validate required fields ────────────────────────────
    if (!businessId || !penaltyIds?.length || !culqiToken) {
      return NextResponse.json(
        { error: 'businessId, penaltyIds y culqiToken son requeridos' },
        { status: 400 },
      );
    }

    // ── Auth: verify ownership ──────────────────────────────
    try {
      await requireOwnedBusinessById(businessId);
    } catch (err) {
      return NextResponse.json(
        { success: false, error: err instanceof Error ? err.message : 'No autorizado' },
        { status: 401 },
      );
    }

    // ── Fetch pending penalties ─────────────────────────────
    const pendingPenalties = await db
      .select()
      .from(penalties)
      .where(
        and(
          eq(penalties.businessId, businessId),
          inArray(penalties.id, penaltyIds),
          eq(penalties.status, 'pending'),
        ),
      );

    if (pendingPenalties.length !== penaltyIds.length) {
      return NextResponse.json(
        {
          error: 'Una o más multas no existen, no pertenecen al negocio o ya no están pendientes',
        },
        { status: 400 },
      );
    }

    // ── Calculate total amount ──────────────────────────────
    const totalAmountDecimal = pendingPenalties.reduce((sum, p) => sum + parseFloat(p.amount), 0);

    const totalAmountCents = Math.round(totalAmountDecimal * 100);

    if (totalAmountCents <= 0) {
      return NextResponse.json(
        { error: 'El monto total a pagar debe ser mayor a cero' },
        { status: 400 },
      );
    }

    // ── Resolve Culqi secret key ────────────────────────────
    const settings = await db.query.businessSettings.findFirst({
      where: eq(businessSettings.businessId, businessId),
      columns: { culqiSecretKey: true },
    });

    if (!settings?.culqiSecretKey) {
      return NextResponse.json(
        { error: 'El negocio no tiene configurada pasarela de pagos' },
        { status: 400 },
      );
    }

    const secretKey = decrypt(settings.culqiSecretKey);

    // ── Buyer identity: el dueño del negocio paga sus multas ──────────
    // Usamos el email del usuario autenticado (Supabase) en lugar del
    // email hardcodeado de soporte. Si el email del dueño falta, abortamos
    // en vez de cobrar con un email falso.
    if (!user.email) {
      return NextResponse.json(
        { error: 'No se pudo obtener el email de tu cuenta para procesar el pago' },
        { status: 400 },
      );
    }
    const ownerEmail = user.email;
    const ownerName = user.user_metadata?.full_name as string | undefined;

    // ── Execute Culqi charge ────────────────────────────────
    const response = await fetch('https://api.culqi.com/v2/charges', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secretKey}`,
      },
      body: JSON.stringify({
        amount: totalAmountCents,
        currency_code: 'PEN',
        email: ownerEmail,
        source_id: culqiToken,
        description: `Pago de ${pendingPenalties.length} multa(s) - Store Lite`,
        antifraud_details: {
          email: ownerEmail,
          ...splitFullName(ownerName),
        },
        metadata: {
          businessId,
          penaltyCount: pendingPenalties.length,
          platform: 'store-lite',
          type: 'penalty_payment',
        },
      }),
    });

    const culqiData: CulqiChargeResponse = await response.json();
    const isSuccess = culqiData?.outcome?.type === 'venta_exitosa' || culqiData?.paid === true;

    if (!response.ok || !isSuccess) {
      return NextResponse.json(
        {
          error: 'Error en Culqi',
          details: culqiData?.user_message || culqiData?.outcome?.user_message || 'Pago rechazado',
        },
        { status: 400 },
      );
    }

    // ── Update DB within a transaction ──────────────────────
    const paidIds = pendingPenalties.map((p) => p.id);

    await db.transaction(async (tx) => {
      // Mark penalties as paid
      await tx
        .update(penalties)
        .set({
          status: 'paid',
          paidAt: sql`now()`,
          paymentMethod: 'culqi',
          paymentId: culqiData.id,
        })
        .where(inArray(penalties.id, paidIds));

      // Check if there are remaining pending penalties after this payment
      const [remaining] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(penalties)
        .where(and(eq(penalties.businessId, businessId), eq(penalties.status, 'pending')));

      const hasNoMorePenalties = (remaining?.count ?? 0) === 0;

      // Update business penalty counters + unblock Culqi if no more pending
      await tx
        .update(businesses)
        .set({
          penaltyCount: sql`GREATEST(${businesses.penaltyCount} - ${pendingPenalties.length}, 0)`,
          penaltyDebt: sql`GREATEST(${businesses.penaltyDebt} - ${totalAmountDecimal}, 0)`,
          culqiBlocked: hasNoMorePenalties ? false : undefined,
        })
        .where(eq(businesses.id, businessId));
    });

    return NextResponse.json({
      success: true,
      paid: paidIds,
      culqiChargeId: culqiData.id,
    });
  } catch (error) {
    logger.error('[business/penalties/pay] Error:', { error: toErrorDetail(error) });
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
