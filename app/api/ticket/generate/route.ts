import { env } from '@/config/env';
import { db } from '@/core/database/client';
import { businesses, payments, products } from '@/core/database/schema';
import { sanitizeTicketFileName } from '@/core/payments/orderNumber';
import { requireOwnedBusinessById } from '@/features/storage/actions/authz';
import { safeTokenEqual } from '@/lib/tokenCompare';
import type { ServerTicketData, ServerTicketItem } from '@/shared/payments/serverTicketRenderer';
import { calculateTicketHeight, ServerTicket } from '@/shared/payments/serverTicketRenderer';
import { createClient } from '@supabase/supabase-js';
import { eq, inArray } from 'drizzle-orm';
import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import React from 'react';

const BUCKET_NAME = 'tickets';

/**
 * Creates a Supabase admin client (service role) for server-only uploads.
 */
function createAdminClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Maps the DB payment_method enum value to a human-readable label.
 */
function formatPaymentMethod(method: string): string {
  const map: Record<string, string> = {
    card: 'Tarjeta',
    yape: 'Yape',
    plin: 'Plin',
    pago_efectivo: 'PagoEfectivo',
    billetera_movil: 'Billetera Móvil',
    cuotealo: 'Cuotéalo',
  };
  return map[method] || method;
}

/**
 * POST /api/ticket/generate
 *
 * Generates an authoritative ticket PNG server-side using Postgres data.
 * W-P5 fix: Resolves by orderNumber with ownership/proof on that row, then UPDATEs by payments.id only.
 */
export async function POST(req: Request) {
  try {
    const { orderNumber, forceRegenerate, trackingToken } = await req.json();

    if (!orderNumber || typeof orderNumber !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid orderNumber' }, { status: 400 });
    }

    // ── 1. Read payment + business data from DB ─────────────────────────
    const [payment] = await db
      .select({
        id: payments.id,
        orderNumber: payments.orderNumber,
        productId: payments.productId,
        amount: payments.amount,
        currency: payments.currency,
        paymentMethod: payments.paymentMethod,
        buyerEmail: payments.buyerEmail,
        buyerPhone: payments.buyerPhone,
        buyerDni: payments.buyerDni,
        shippingType: payments.shippingType,
        shippingAddress: payments.shippingAddress,
        shippingDistrict: payments.shippingDistrict,
        shippingProvince: payments.shippingProvince,
        shippingDepartment: payments.shippingDepartment,
        shippingAgency: payments.shippingAgency,
        metadata: payments.metadata,
        createdAt: payments.createdAt,
        ticketUrl: payments.ticketUrl,
        businessId: payments.businessId,
        // Buyer proof: the caller's token is compared against this value.
        trackingToken: payments.trackingToken,
        // Business join fields
        businessName: businesses.name,
        businessSlug: businesses.slug,
        businessRuc: businesses.taxId,
        businessAddress: businesses.address,
        businessLogoUrl: businesses.logoUrl,
      })
      .from(payments)
      .innerJoin(businesses, eq(payments.businessId, businesses.id))
      .where(eq(payments.orderNumber, orderNumber))
      .limit(1);

    if (!payment) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // ── 1b. Access proof (design D4) ──────────────────────────────────
    // Two proofs are accepted, in this order:
    //   OWNER — a session that owns the payment's business. The `await` is
    //           load-bearing: without it the rejection escapes the `try` and
    //           the handler answers 500 instead of branching.
    //   BUYER — the caller's trackingToken, compared in constant time against
    //           the value stored on THIS row. `forceRegenerate` is coerced to
    //           false so a buyer can never overwrite an existing ticket.
    let effectiveForceRegenerate = forceRegenerate;

    try {
      await requireOwnedBusinessById(payment.businessId);
    } catch {
      const presentedToken = typeof trackingToken === 'string' ? trackingToken : '';
      const storedToken = typeof payment.trackingToken === 'string' ? payment.trackingToken : '';

      // `safeTokenEqual('', '')` is true by contract, so blank proofs are
      // rejected here: an absent token is not a proof, and a row without a
      // stored token is not claimable at all.
      if (!presentedToken || !storedToken || !safeTokenEqual(presentedToken, storedToken)) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
      }

      effectiveForceRegenerate = false;
    }

    // If ticket already exists and regeneration not forced, return it (P5-2 short-circuit)
    if (payment.ticketUrl && !effectiveForceRegenerate) {
      return NextResponse.json({ success: true, publicUrl: payment.ticketUrl });
    }

    // ── 2. Build authoritative cart items from DB products ───────────────
    const metadata = payment.metadata as Record<string, unknown> | null;
    const rawCartItems =
      (metadata?.cartItems as {
        id?: string;
        productId?: string;
        name?: string;
        quantity?: number;
        price?: number | string;
      }[]) || [];

    const itemMap = new Map<string, number>();
    if (rawCartItems.length > 0) {
      for (const item of rawCartItems) {
        const pId = item.id || item.productId;
        if (pId) {
          itemMap.set(pId, (itemMap.get(pId) || 0) + (item.quantity || 1));
        }
      }
    } else if (payment.productId) {
      itemMap.set(payment.productId, 1);
    }

    const productIds = Array.from(itemMap.keys());
    const dbProducts =
      productIds.length > 0
        ? await db
            .select({
              id: products.id,
              title: products.title,
              price: products.price,
            })
            .from(products)
            .where(inArray(products.id, productIds))
        : [];

    const productDbMap = new Map(dbProducts.map((p) => [p.id, p]));

    let items: ServerTicketItem[] = [];
    if (productIds.length > 0) {
      items = productIds.map((pId) => {
        const dbProd = productDbMap.get(pId);
        const qty = itemMap.get(pId) || 1;
        return {
          name: dbProd?.title || 'Producto',
          quantity: qty,
          price: dbProd ? Number(dbProd.price) : Number(payment.amount) / qty,
        };
      });
    } else {
      items = [
        {
          name: 'Compra en tienda',
          quantity: 1,
          price: Number(payment.amount),
        },
      ];
    }

    // ── 3. Generate QR code data URL (always absolute link) ─────────────
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    const proto = req.headers.get('x-forwarded-proto') || 'http';
    const baseUrl = host ? `${proto}://${host}` : env.nextPublicAppUrl;
    // Use the resolved orderNumber from the payment row (not the request param)
    const verificationUrl = `${baseUrl}/${payment.businessSlug}/order/verify/${payment.orderNumber}`;

    let qrCodeDataUrl: string | null = null;
    try {
      qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, {
        width: 200,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#1c1b1f', light: '#ffffff' },
      });
    } catch (qrError) {
      console.error('[ticket/generate] QR generation failed:', qrError);
    }

    // ── 4. Build shipping address string ────────────────────────────────
    let shippingAddress: string | null = null;
    const shippingType = payment.shippingType;
    if (shippingType === 'recojo') {
      shippingAddress = payment.businessAddress || null;
    } else if (shippingType === 'agencia') {
      shippingAddress = [
        payment.shippingAgency,
        payment.shippingDistrict,
        payment.shippingProvince,
        payment.shippingDepartment,
      ]
        .filter(Boolean)
        .join(', ');
    } else {
      shippingAddress = [
        payment.shippingAddress,
        payment.shippingDistrict,
        payment.shippingProvince,
        payment.shippingDepartment,
      ]
        .filter(Boolean)
        .join(', ');
    }

    // ── 5. Build ticket data ────────────────────────────────────────────
    // payment.orderNumber is guaranteed to exist since we queried for it and checked !payment
    const resolvedOrderNumber = payment.orderNumber!;
    const resolvedShippingAddress = shippingAddress ?? undefined;
    const ticketData: ServerTicketData = {
      businessName: payment.businessName,
      businessRuc: payment.businessRuc,
      businessAddress: payment.businessAddress,
      businessLogoUrl: payment.businessLogoUrl,
      orderNumber: resolvedOrderNumber,
      date: payment.createdAt,
      items,
      totalAmount: Number(payment.amount),
      currency: payment.currency || 'PEN',
      paymentMethod: formatPaymentMethod(payment.paymentMethod),
      customerDni: payment.buyerDni,
      customerPhone: payment.buyerPhone,
      customerEmail: payment.buyerEmail,
      shippingType: shippingType === 'recojo' ? 'pickup' : 'delivery',
      shippingAddress: resolvedShippingAddress,
      qrCodeDataUrl,
    };

    // ── 6. Render PNG via Satori (ImageResponse) ────────────────────────
    const ticketWidth = 400;
    const ticketHeight = calculateTicketHeight(ticketData);

    const imageResponse = new ImageResponse(
      React.createElement(ServerTicket, { data: ticketData }),
      {
        width: ticketWidth,
        height: ticketHeight,
      },
    );

    const imageBuffer = await imageResponse.arrayBuffer();
    const blob = new Blob([imageBuffer], { type: 'image/png' });

    // ── 7. Upload to Supabase ───────────────────────────────────────────
    const supabase = createAdminClient();
    // Use shared sanitizer for filename (W-P5 / D1-D2)
    const fileName = `${sanitizeTicketFileName(resolvedOrderNumber)}.png`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, blob, { contentType: 'image/png', upsert: true });

    if (uploadError) {
      console.error('[ticket/generate] Upload error:', uploadError);
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 });
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET_NAME).getPublicUrl(fileName);

    // ── 8. Update payment record with ticket URL by primary key (W-P5 fix) ──────────────────
    // Never UPDATE order_number. Ownership/proof was already checked on the resolved row above.
    await db
      .update(payments)
      .set({ ticketUrl: publicUrl, updatedAt: new Date() })
      .where(eq(payments.id, payment.id))
      .returning();

    return NextResponse.json({ success: true, publicUrl });
  } catch (error) {
    console.error('[ticket/generate] Internal error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
