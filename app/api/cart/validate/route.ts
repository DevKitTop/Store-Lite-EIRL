import { db } from '@/core/database/client';
import { products } from '@/core/database/schema';
import { logger, toErrorDetail } from '@/lib/logger';
import { inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { ids } = await request.json();

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ items: [], removed: [] });
    }

    const dbProducts = await db
      .select({
        id: products.id,
        stock: products.stock,
        price: products.price,
        secondPrice: products.secondPrice,
        currency: products.currency,
        isAvailable: products.isAvailable,
      })
      .from(products)
      .where(inArray(products.id, ids));

    const foundIds = new Set(dbProducts.map((p) => p.id));
    const removed = ids.filter((id: string) => !foundIds.has(id));

    return NextResponse.json({
      items: dbProducts.map((p) => ({
        id: p.id,
        stock: p.stock,
        price: p.price,
        secondPrice: p.secondPrice,
        currency: p.currency,
        isAvailable: p.isAvailable,
      })),
      removed,
    });
  } catch (error) {
    logger.error('[cart/validate] Error:', { error: toErrorDetail(error) });
    return NextResponse.json({ error: 'Error al validar el carrito' }, { status: 500 });
  }
}
