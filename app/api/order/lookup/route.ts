import { db } from '@/core/database/client';
import { businesses, businessTeamMembers, payments } from '@/core/database/schema';
import { verifyOrderAccessCookie } from '@/lib/orderAccessCookie';
import { checkRateLimit } from '@/lib/rateLimit';
import { createClient } from '@/lib/supabase/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

// Rate limit for cookie-gated lookup: 10 req/min per order (keyed by paymentId:businessId)
const LOOKUP_RATE_LIMIT = { windowMs: 60 * 1000, maxRequests: 10 };

const ORDER_ACCESS_DENIED_ERROR = 'Necesitás volver a verificar tu acceso al pedido.';

/**
 * POST /api/order/lookup
 * Busca el tracking_token usando DNI, Nro de Orden, businessSlug y trackingToken
 * 🔒 SECURITY: Requires signed access cookie for the trackingToken (R21)
 * 🔒 SECURITY: Tenant scoping — query filters by payments.businessId from verified cookie
 * 🔒 SECURITY: Rate limit keyed by verified cookie's paymentId + businessId (10 req/min)
 * 🔒 SECURITY: Blocks authenticated sellers/team members from looking up orders from their own business
 * 🔒 SECURITY: Neutral 404 for cross-tenant and non-existent orders (no 403 leak)
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();

    // 0. Validate Data using Zod (includes trackingToken)
    const { lookupOrderSchema } = await import('@/features/billing/schemas');
    const validationResult = lookupOrderSchema.safeParse(rawBody);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error:
            validationResult.error.issues[0]?.message ||
            'Faltan datos (DNI, Nro Orden, Slug o Token)',
        },
        { status: 400 },
      );
    }

    const {
      dni,
      orderNumber: cleanOrderNumber,
      businessSlug,
      trackingToken,
    } = validationResult.data;

    // 1. GATE: Verify the signed access cookie for THIS trackingToken (R21)
    // Must run BEFORE any DB read
    const hasAccess = await verifyOrderAccessCookie(trackingToken);
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: ORDER_ACCESS_DENIED_ERROR, reason: 'reauth_required' },
        { status: 401 },
      );
    }

    // 2. Look up the payment by trackingToken to get businessId and orderNumber for tenant scoping
    const paymentByToken = await db.query.payments.findFirst({
      where: eq(payments.trackingToken, trackingToken),
      columns: {
        id: true,
        businessId: true,
        orderNumber: true,
        trackingToken: true,
      },
    });

    if (!paymentByToken || !paymentByToken.trackingToken) {
      // Cookie verified but no payment found for this token — neutral 404
      return NextResponse.json(
        {
          success: false,
          error: 'No encontramos un pedido con los datos proporcionados.',
          reason: 'order_not_found',
        },
        { status: 404 },
      );
    }

    // Cross-order protection: the orderNumber in the body must match the payment's orderNumber
    if (paymentByToken.orderNumber !== cleanOrderNumber) {
      return NextResponse.json(
        {
          success: false,
          error: 'No encontramos un pedido con los datos proporcionados.',
          reason: 'order_not_found',
        },
        { status: 404 },
      );
    }

    const sessionBusinessId = paymentByToken.businessId;
    const paymentId = paymentByToken.id;

    // 3. Rate limit: keyed by verified cookie's paymentId + businessId (10 req/min)
    const rateLimit = checkRateLimit(`${paymentId}:${sessionBusinessId}`, LOOKUP_RATE_LIMIT);
    if (!rateLimit.allowed) {
      const retryAfter = String(Math.ceil(rateLimit.resetInMs / 1000));
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': retryAfter,
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': retryAfter,
          },
        },
      );
    }

    // 4. Check if the requester is a seller/team member of this business
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const ownedBusiness = await db.query.businesses.findFirst({
        where: and(eq(businesses.ownerId, user.id)),
        columns: { id: true, slug: true },
      });

      if (ownedBusiness && ownedBusiness.slug.toLowerCase() === businessSlug.toLowerCase()) {
        return NextResponse.json(
          {
            success: false,
            error: 'Acceso denegado: usa el panel de vendedor para gestionar pedidos',
          },
          { status: 403 },
        );
      }

      if (ownedBusiness) {
        const teamMembership = await db.query.businessTeamMembers.findFirst({
          where: and(eq(businessTeamMembers.userId, user.id)),
          with: { business: { columns: { slug: true } } },
        });

        if (
          teamMembership &&
          teamMembership.business?.slug?.toLowerCase() === businessSlug.toLowerCase()
        ) {
          return NextResponse.json(
            {
              success: false,
              error: 'Acceso denegado: usa el panel de vendedor para gestionar pedidos',
            },
            { status: 403 },
          );
        }
      }
    }

    // 5. Look up the payment with tenant scoping (businessId from verified cookie)
    const payment = await db.query.payments.findFirst({
      where: and(
        eq(payments.buyerDni, dni),
        eq(payments.orderNumber, cleanOrderNumber),
        eq(payments.businessId, sessionBusinessId),
      ),
      columns: {
        trackingToken: true,
      },
    });

    // 6. Neutral 404 for both non-existent and cross-tenant (no 403 leak, no echoed PII)
    if (!payment || !payment.trackingToken) {
      return NextResponse.json(
        {
          success: false,
          error: 'No encontramos un pedido con los datos proporcionados.',
          reason: 'order_not_found',
        },
        { status: 404 },
      );
    }

    // 7. Verify businessSlug matches (but return neutral 404, not 403)
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, sessionBusinessId),
      columns: { slug: true },
    });

    if (!business || business.slug !== businessSlug) {
      return NextResponse.json(
        {
          success: false,
          error: 'No encontramos un pedido con los datos proporcionados.',
          reason: 'order_not_found',
        },
        { status: 404 },
      );
    }

    // 8. Success: return only the trackingToken (PII-free)
    return NextResponse.json({
      success: true,
      token: payment.trackingToken,
    });
  } catch (error) {
    console.error('[order/lookup] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Error interno al buscar el pedido' },
      { status: 500 },
    );
  }
}
