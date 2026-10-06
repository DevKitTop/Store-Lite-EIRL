import { db } from '@/core/database/client';
import { businesses, businessTeamMembers, payments } from '@/core/database/schema';
import { checkOrderAccessRateLimit } from '@/lib/orderAccessRateLimit';
import { createClient } from '@/lib/supabase/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * POST /api/order/lookup
 * Busca el tracking_token usando DNI, Nro de Orden y businessSlug
 * 🔒 SECURITY: Blocks authenticated sellers/team members from looking up
 * orders from their own business to prevent self-confirmation attacks.
 * 🔒 SECURITY: Auth-intent rate limit keyed (IP, dni) — BEFORE zod, so a
 * brute-forcer cannot probe for free by sending malformed bodies (C11 / D2).
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();

    // 0. Rate limit BEFORE validation and before any database access.
    const rateLimit = checkOrderAccessRateLimit(request, rawBody);
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

    // 1. Validate Data using Zod
    const { lookupOrderSchema } = await import('@/features/billing/schemas');
    const validationResult = lookupOrderSchema.safeParse(rawBody);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error:
            validationResult.error.issues[0]?.message || 'Faltan datos (DNI, Nro Orden o Slug)',
        },
        { status: 400 },
      );
    }

    const { dni, orderNumber: cleanOrderNumber, businessSlug } = validationResult.data;

    // 🔒 SECURITY: Check if the requester is a seller/team member of this business.
    // Sellers should NOT be able to lookup trackingTokens for their own orders.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      // Find businesses owned by this user that match the slug
      const ownedBusiness = await db.query.businesses.findFirst({
        where: and(eq(businesses.ownerId, user.id)),
        columns: { id: true, slug: true },
      });

      // Check if owned business matches the requested slug
      if (ownedBusiness && ownedBusiness.slug.toLowerCase() === businessSlug.toLowerCase()) {
        return NextResponse.json(
          {
            success: false,
            error: 'Acceso denegado: usa el panel de vendedor para gestionar pedidos',
          },
          { status: 403 },
        );
      }

      // Also check team membership
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

    // Buscar el pago que coincida con DNI y Nro de Orden
    const payment = await db.query.payments.findFirst({
      where: and(eq(payments.buyerDni, dni), eq(payments.orderNumber, cleanOrderNumber)),
      columns: {
        trackingToken: true,
        businessId: true,
      },
      with: {
        business: {
          columns: {
            slug: true,
          },
        },
      },
    });

    // Verificar que la orden exista Y que pertenezca al negocio correcto
    if (!payment || !payment.trackingToken) {
      return NextResponse.json(
        {
          success: false,
          error: `No encontramos un pedido con el DNI ${dni} y la orden #${cleanOrderNumber}. Revisá que los datos sean correctos.`,
        },
        { status: 404 },
      );
    }

    if (payment.business?.slug !== businessSlug) {
      return NextResponse.json(
        { success: false, error: 'Esta orden no pertenece a este negocio' },
        { status: 403 },
      );
    }

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
