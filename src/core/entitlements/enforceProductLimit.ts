// =====================================================
// ENFORCE PRODUCT LIMIT — Shared Helper
// =====================================================
// If a business has more active products than maxAllowed,
// disables the oldest excess products by setting
// isAvailable = false. Idempotent and safe for CRON and
// runtime use.
// =====================================================

import { db } from '@/core/database/client';
import { products } from '@/core/database/schema';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { DisabledProduct } from './plans';

/**
 * If a business has more active products than maxAllowed, disables the oldest
 * excess products by setting isAvailable = false.
 *
 * Idempotent: only disables products currently isAvailable = true.
 * Handles unlimited (-1): no-op.
 *
 * Returns the number of products disabled.
 */
export interface DisableExcessProductsResult {
  disabledCount: number;
  disabledProducts: DisabledProduct[];
}

export async function disableExcessProducts(
  businessId: string,
  maxAllowed: number,
): Promise<DisableExcessProductsResult> {
  const empty: DisableExcessProductsResult = { disabledCount: 0, disabledProducts: [] };
  if (maxAllowed === -1) return empty;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
    .where(and(eq(products.businessId, businessId), eq(products.isAvailable, true)));

  const excess = count - maxAllowed;
  if (excess <= 0) return empty;

  const oldestExcess = await db
    .select({ id: products.id, title: products.title })
    .from(products)
    .where(and(eq(products.businessId, businessId), eq(products.isAvailable, true)))
    .orderBy(asc(products.createdAt))
    .limit(excess);

  if (oldestExcess.length === 0) return empty;

  const ids = oldestExcess.map((p) => p.id);

  await db
    .update(products)
    .set({ isAvailable: false, updatedAt: new Date() })
    .where(inArray(products.id, ids));

  return {
    disabledCount: ids.length,
    disabledProducts: oldestExcess.map(({ id, title }) => ({ id, title })),
  };
}

export async function enforceProductLimit(businessId: string, maxAllowed: number): Promise<number> {
  const { disabledCount } = await disableExcessProducts(businessId, maxAllowed);
  return disabledCount;
}
