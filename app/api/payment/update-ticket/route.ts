import { db } from '@/core/database/client';
import { payments } from '@/core/database/schema';
import { requireOwnedBusinessById } from '@/features/storage/actions/authz';
import { logger, toErrorDetail } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

/**
 * API: /api/payment/update-ticket
 * Description: Updates a payment record with the generated ticket image URL.
 *
 * The response is `{ success: true }` and nothing else. A caller only needs
 * `response.ok`; returning the updated row meant shipping the buyer's email,
 * phone, address and payment metadata to a browser that discards them.
 *
 * "Not found" and "found, but you do not own it" both answer 404 on purpose.
 * Distinguishing them turns this endpoint into an order-number oracle for any
 * signed-in user who owns some business.
 */
export async function POST(req: Request) {
  // ---- Auth check ----
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  }

  try {
    const { orderNumber, ticketUrl } = await req.json();

    if (!orderNumber || !ticketUrl) {
      return NextResponse.json({ error: 'Falta orderNumber o ticketUrl' }, { status: 400 });
    }

    // ---- Auth: lookup businessId from payment ----
    const [payment] = await db
      .select({ businessId: payments.businessId })
      .from(payments)
      .where(eq(payments.orderNumber, orderNumber))
      .limit(1);

    if (!payment) {
      return NextResponse.json(
        { error: 'Pago no encontrado con ese número de orden' },
        { status: 404 },
      );
    }

    try {
      await requireOwnedBusinessById(payment.businessId);
    } catch {
      // Same answer as "no such order": never confirm that an order number
      // exists in a business the caller does not own.
      return NextResponse.json(
        { error: 'Pago no encontrado con ese número de orden' },
        { status: 404 },
      );
    }

    // ---- Validate ticketUrl ----
    if (typeof ticketUrl !== 'string' || ticketUrl.trim().length === 0) {
      return NextResponse.json({ error: 'ticketUrl debe ser un texto válido' }, { status: 400 });
    }

    // Update payment where orderNumber matches. `order_number` is globally
    // unique, so this touches at most one row; `returning({ id })` is only
    // used to know whether it did.
    const result = await db
      .update(payments)
      .set({ ticketUrl: ticketUrl.trim(), updatedAt: new Date() })
      .where(eq(payments.orderNumber, orderNumber))
      .returning({ id: payments.id });

    if (!result || result.length === 0) {
      return NextResponse.json(
        { error: 'Pago no encontrado con ese número de orden' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Error updating payment ticket:', { error: toErrorDetail(error) });
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
