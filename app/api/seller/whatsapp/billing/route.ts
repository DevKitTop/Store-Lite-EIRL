import { db } from '@/core/database/client';
import { businesses } from '@/core/database/schema';
import { getMonthlyUsage, type MonthlyUsageOptions } from '@/core/whatsapp/billing/usageService';
import { createClient } from '@/lib/supabase/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

async function verifyBusinessAccess(businessId: string, userId: string): Promise<boolean> {
  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { ownerId: true },
  });

  if (!business) return false;
  if (business.ownerId === userId) return true;

  // Check team member - simplified for now
  return false;
}

function parsePeriodParam(value: string | null, min: number, max: number): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error('Invalid period param');
  }
  return parsed;
}

// GET /api/seller/whatsapp/billing?businessId=...&year=2026&month=9&channelId=...
// Returns the aggregated Meta cost usage report for a business's WhatsApp channels.
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('businessId');
    if (!businessId) {
      return NextResponse.json({ error: 'businessId es requerido' }, { status: 400 });
    }

    let year: number | null = null;
    let month: number | null = null;
    try {
      year = parsePeriodParam(searchParams.get('year'), 1970, 9999);
      month = parsePeriodParam(searchParams.get('month'), 1, 12);
    } catch {
      return NextResponse.json({ error: 'Parámetros de período inválidos' }, { status: 400 });
    }

    const channelId = searchParams.get('channelId') ?? undefined;

    const hasAccess = await verifyBusinessAccess(businessId, user.id);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Sin permisos para este negocio' }, { status: 403 });
    }

    const options: MonthlyUsageOptions = {};
    if (year !== null) options.year = year;
    if (month !== null) options.month = month;
    if (channelId) options.channelId = channelId;

    const report = await getMonthlyUsage(businessId, options);

    return NextResponse.json({ report });
  } catch (error) {
    console.error('[GET /api/seller/whatsapp/billing] Error:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}