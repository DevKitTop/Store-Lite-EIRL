/**
 * =====================================================
 * API: GET /api/business/penalty-status
 * Get the current penalty status for a business
 *
 * Two-branch response:
 *   - owner  → the banner fields plus penaltyDebt / penaltyCount
 *   - anyone → only the banner fields the checkout banner consumes
 * Both branches answer 200 so the public storefront flow needs no session.
 * =====================================================
 */

import { db } from '@/core/database/client';
import { businesses } from '@/core/database/schema';
import { requireOwnedBusinessById } from '@/features/storage/actions/authz';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('businessId');

    if (!businessId) {
      return NextResponse.json({ error: 'businessId es requerido' }, { status: 400 });
    }

    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, businessId),
      columns: {
        culqiBlocked: true,
        blacklisted: true,
        penaltyDebt: true,
        penaltyCount: true,
      },
    });

    if (!business) {
      return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 404 });
    }

    const bannerStatus = {
      canAcceptPayments: !business.culqiBlocked && !business.blacklisted,
      culqiBlocked: business.culqiBlocked,
      blacklisted: business.blacklisted,
    };

    // ── Auth: the penalty figures are owner-only (debt / count) ──────────
    try {
      await requireOwnedBusinessById(businessId);

      return NextResponse.json({
        ...bannerStatus,
        penaltyDebt: business.penaltyDebt,
        penaltyCount: business.penaltyCount,
      });
    } catch {
      return NextResponse.json(bannerStatus);
    }
  } catch (error) {
    console.error('[business/penalty-status] Error:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
