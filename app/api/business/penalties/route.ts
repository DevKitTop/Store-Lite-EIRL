/**
 * =====================================================
 * API: GET /api/business/penalties
 * List penalties for a business with optional status filter
 * =====================================================
 */

import { db } from '@/core/database/client';
import { penalties } from '@/core/database/schema';
import { requireOwnedBusinessById } from '@/features/storage/actions/authz';
import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const VALID_STATUSES = ['pending', 'paid', 'cancelled', 'disputed'] as const;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('businessId');
    const status = searchParams.get('status') || 'all';

    if (!businessId) {
      return NextResponse.json({ error: 'businessId es requerido' }, { status: 400 });
    }

    if (status !== 'all' && !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
      return NextResponse.json(
        { error: `Status inválido. Valores permitidos: ${VALID_STATUSES.join(', ')} o 'all'` },
        { status: 400 },
      );
    }

    // ── Auth: owner-only (team roles are not widened) ──────────
    try {
      await requireOwnedBusinessById(businessId);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'No autorizado' },
        { status: 401 },
      );
    }

    const conditions = [eq(penalties.businessId, businessId)];
    if (status !== 'all') {
      conditions.push(
        eq(penalties.status, status as 'pending' | 'paid' | 'cancelled' | 'disputed'),
      );
    }

    const penaltyRecords = await db
      .select()
      .from(penalties)
      .where(and(...conditions))
      .orderBy(desc(penalties.createdAt));

    return NextResponse.json({ penalties: penaltyRecords });
  } catch (error) {
    console.error('[business/penalties] Error:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
