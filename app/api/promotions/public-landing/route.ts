import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { getPublicLandingPromotion } = await import('@/features/promotions/publicPromotions');
    const promotion = await getPublicLandingPromotion();

    return NextResponse.json({ promotion }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ promotion: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
