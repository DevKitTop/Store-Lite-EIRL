import { db } from '@/core/database/client';
import { businesses, businessTeamMembers, payments } from '@/core/database/schema';
import { verifyOrderAccessCookie } from '@/lib/orderAccessCookie';
import { ORDER_ACCESS_DENIED_ERROR } from '@/lib/orderAccessGate';
import { checkOrderAccessRateLimit } from '@/lib/orderAccessRateLimit';
import { checkRateLimit } from '@/lib/rateLimit';
import { createClient } from '@/lib/supabase/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Post-cookie lookup throttle (R21): 10 requests / minute per verified
 * `(paymentId, businessId)`. The cookie is the authority, so the bucket can be
 * keyed on the row it authorizes rather than on anything caller-controlled.
 */
const COOKIE_LOOKUP_RATE_LIMIT = { windowMs: 60 * 1000, maxRequests: 10 };

/** Columns the cookie-gated lookup may read — never buyer PII. */
const PUBLIC_ORDER_COLUMNS = {
  id: true,
  businessId: true,
  orderNumber: true,
  trackingToken: true,
} as const;

/** Strips the legacy `#` prefix and collapses empty/blank to `null`. */
function normalizeOrderNumber(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/^#/, '') ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * One neutral 404 for every cookie-gated miss (unknown cookie row, order-number
 * mismatch, slug/tenant mismatch, missing DNI match). Byte-identical on purpose:
 * a caller must not be able to tell "wrong tenant" from "no such order", and the
 * body never echoes the DNI or order number (R21).
 */
function neutralOrderNotFound() {
  return NextResponse.json(
    { success: false, error: 'No encontramos esa orden.', reason: 'order_not_found' },
    { status: 404 },
  );
}

function cookieLookupRateLimited(resetInMs: number) {
  const retryAfter = String(Math.ceil(resetInMs / 1000));
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

/**
 * POST /api/order/lookup
 *
 * Two paths (R21):
 *   1. Body carries a `trackingToken` → the signed order-access cookie is the
 *      authority. The gate runs BEFORE zod and before any DB read; the query is
 *      tenant-scoped and the response is PII-free.
 *   2. No `trackingToken` → the legacy DNI+orderNumber guess, rate-limited
 *      `(IP, dni)` BEFORE zod so a brute-forcer cannot probe for free (C11 / D2).
 *
 * 🔒 SECURITY: Blocks authenticated sellers/team members from looking up orders
 * from their own business on the legacy path, to prevent self-confirmation.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = (await request.json()) as Record<string, unknown> | null;

    // ── Path 1 — cookie-gated lookup (R21) ──────────────
    const bodyToken = rawBody?.trackingToken;
    const trackingToken = typeof bodyToken === 'string' && bodyToken.length > 0 ? bodyToken : null;

    if (trackingToken) {
      // The signed cookie is the authority. Run it BEFORE zod and before the
      // first DB read, so an unauthenticated caller cannot make us touch
      // `payments` (R21).
      const hasAccess = await verifyOrderAccessCookie(trackingToken);
      if (!hasAccess) {
        return NextResponse.json(
          { success: false, error: ORDER_ACCESS_DENIED_ERROR, reason: 'reauth_required' },
          { status: 401 },
        );
      }

      const { lookupOrderSchema } = await import('@/features/billing/schemas');
      const validation = lookupOrderSchema.safeParse(rawBody);
      if (!validation.success) {
        return NextResponse.json(
          { success: false, error: validation.error.issues[0]?.message || 'Datos inválidos' },
          { status: 400 },
        );
      }
      const { dni, orderNumber: requestedOrderNumber, businessSlug } = validation.data;

      // Q1 — resolve the order the cookie authorizes. Its order number and
      // tenant are the authority; the body cannot point the lookup elsewhere.
      const cookieOrder = await db.query.payments.findFirst({
        where: eq(payments.trackingToken, trackingToken),
        columns: { id: true, businessId: true, orderNumber: true, trackingToken: true },
      });
      if (!cookieOrder) return neutralOrderNotFound();

      const cookieOrderNumber = normalizeOrderNumber(cookieOrder.orderNumber);
      if (!cookieOrderNumber || cookieOrderNumber !== requestedOrderNumber) {
        return neutralOrderNotFound();
      }

      const business = await db.query.businesses.findFirst({
        where: eq(businesses.slug, businessSlug),
        columns: { id: true, slug: true },
      });
      if (!business || business.slug !== businessSlug || business.id !== cookieOrder.businessId) {
        return neutralOrderNotFound();
      }

      // Q2 — tenant-scoped, PII-free confirmation that (dni, orderNumber,
      // businessId) still resolves to the same order.
      const payment = await db.query.payments.findFirst({
        where: and(
          eq(payments.buyerDni, dni),
          eq(payments.orderNumber, requestedOrderNumber),
          eq(payments.businessId, business.id),
        ),
        columns: PUBLIC_ORDER_COLUMNS,
      });
      if (!payment || !payment.trackingToken) return neutralOrderNotFound();

      const rateLimit = await checkRateLimit(
        `${cookieOrder.id}:${business.id}`,
        COOKIE_LOOKUP_RATE_LIMIT,
      );
      if (!rateLimit.allowed) {
        return cookieLookupRateLimited(rateLimit.resetInMs);
      }

      return NextResponse.json({ success: true, token: payment.trackingToken });
    }

    // ── Path 2 — legacy unauthenticated lookup (C11 / D2) ─
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

    // R21 (legacy path): resolve the tenant from the slug FIRST, then scope the
    // payment lookup by `businessId`. A `(dni, orderNumber)` pair owned by
    // another tenant must not be usable to mint that order's tracking token.
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.slug, businessSlug),
      columns: { id: true },
    });
    if (!business) {
      return neutralOrderNotFound();
    }

    const payment = await db.query.payments.findFirst({
      where: and(
        eq(payments.buyerDni, dni),
        eq(payments.orderNumber, cleanOrderNumber),
        eq(payments.businessId, business.id),
      ),
      columns: {
        trackingToken: true,
        businessId: true,
      },
    });

    // ONE neutral 404 for every miss. Never echo the DNI/orderNumber and never
    // emit a 403 — a distinguishable refusal is the oracle this change closes.
    if (!payment || !payment.trackingToken) {
      return neutralOrderNotFound();
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
