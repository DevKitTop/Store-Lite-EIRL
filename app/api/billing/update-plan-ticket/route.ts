import { env } from '@/config/env';
import { db } from '@/core/database/client';
import { formatTicketNumber, planPayments } from '@/core/database/schema';
import { requireOwnedBusinessById } from '@/features/storage/actions/authz';
import { sendPlanPurchaseConfirmationEmail } from '@/lib/email/planEmails';
import { getSignedTicketUrl } from '@/lib/storage/signedTicket';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

/**
 * API: /api/billing/update-plan-ticket
 *
 * Stores the receipt image for a plan purchase. The browser renders the
 * receipt and posts the PNG here; this route is the only writer, so the
 * private `tickets_plans` bucket needs no client policy: uploads use the
 * service role and every reader gets a short-lived signed URL.
 */

const BUCKET_NAME = 'tickets_plans';
const MAX_TICKET_BYTES = 8 * 1024 * 1024;

function adminStorageClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function POST(req: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
  }

  try {
    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ success: false, error: 'Formulario inválido' }, { status: 400 });
    }

    const planPaymentId = form.get('planPaymentId');
    const file = form.get('file');
    // Structure, not `instanceof File`: the parsed entry can come from another
    // realm (undici vs. the request's globals) and would fail an identity check.
    if (
      typeof planPaymentId !== 'string' ||
      !planPaymentId ||
      !file ||
      typeof file === 'string' ||
      typeof file.arrayBuffer !== 'function'
    ) {
      return NextResponse.json(
        { success: false, error: 'Falta planPaymentId o el archivo del ticket' },
        { status: 400 },
      );
    }
    if (file.type !== 'image/png') {
      return NextResponse.json(
        { success: false, error: 'El ticket debe ser una imagen PNG' },
        { status: 415 },
      );
    }
    if (file.size === 0 || file.size > MAX_TICKET_BYTES) {
      return NextResponse.json(
        { success: false, error: 'El ticket está vacío o excede el tamaño permitido' },
        { status: 413 },
      );
    }

    const [planPayment] = await db
      .select({
        businessId: planPayments.businessId,
        status: planPayments.status,
        ticketSeries: planPayments.ticketSeries,
        ticketCorrelative: planPayments.ticketCorrelative,
      })
      .from(planPayments)
      .where(eq(planPayments.id, planPaymentId))
      .limit(1);

    if (!planPayment) {
      return NextResponse.json(
        { success: false, error: 'Pago de plan no encontrado' },
        { status: 404 },
      );
    }

    try {
      await requireOwnedBusinessById(planPayment.businessId);
    } catch (err) {
      return NextResponse.json(
        { success: false, error: err instanceof Error ? err.message : 'No autorizado' },
        { status: 401 },
      );
    }

    if (planPayment.status !== 'paid') {
      return NextResponse.json(
        { success: false, error: 'El pago del plan no está completado' },
        { status: 409 },
      );
    }

    const ticketNumber = formatTicketNumber(
      planPayment.ticketSeries,
      planPayment.ticketCorrelative,
    );
    const fileName = `${ticketNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const storage = adminStorageClient();
    const { error: uploadError } = await storage.storage
      .from(BUCKET_NAME)
      .upload(fileName, bytes, { contentType: 'image/png', upsert: true });

    if (uploadError) {
      console.error('[update-plan-ticket] Upload error:', uploadError.message);
      return NextResponse.json(
        { success: false, error: 'No se pudo guardar el ticket' },
        { status: 500 },
      );
    }

    const { data: publicUrlData } = storage.storage.from(BUCKET_NAME).getPublicUrl(fileName);
    const canonicalUrl = publicUrlData.publicUrl;

    const [result] = await db
      .update(planPayments)
      .set({ ticketUrl: canonicalUrl, ticketIssuedAt: new Date(), updatedAt: new Date() })
      .where(eq(planPayments.id, planPaymentId))
      .returning();

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Pago de plan no encontrado' },
        { status: 404 },
      );
    }

    const signedUrl = await getSignedTicketUrl(canonicalUrl);
    if (!signedUrl) {
      return NextResponse.json(
        { success: false, error: 'No se pudo firmar el ticket' },
        { status: 500 },
      );
    }

    // Fire-and-forget: notify the buyer that the boleta is ready.
    // The email includes the ticket link, so it never blocks the response.
    sendPlanPurchaseConfirmationEmail(result, result.businessId).catch((err) => {
      console.error('[update-plan-ticket] Plan purchase email error:', err);
    });

    return NextResponse.json({ success: true, signedUrl });
  } catch (error) {
    console.error('[update-plan-ticket] Error storing plan ticket:', error);
    return NextResponse.json(
      { success: false, error: 'Error interno del servidor' },
      { status: 500 },
    );
  }
}
