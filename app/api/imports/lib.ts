import { importRows, productCategories, productMedia, products } from '@/core/database/schema';
import type { TenantDb } from '@/core/database/tenant';
import { logger, toErrorDetail } from '@/lib/logger';
import { notifyLowStock, notifyOutOfStock } from '@/lib/notifications';
import { getUniqueCategorySlug } from '@/shared/utils/categorySlug';
import { eq, inArray, sql } from 'drizzle-orm';

export const CHUNK_SIZE = 50;
export const LOW_STOCK_THRESHOLD = 5;

// ─── Process a batch of rows ────────────────────────────────────────────────

export async function processRows(
  rows: (typeof importRows.$inferSelect)[],
  businessId: string,
  tenant: TenantDb,
) {
  const rowIds = rows.map((r) => r.id);

  // Mark rows as 'processing'
  await tenant
    .update(importRows)
    .set({ status: 'processing' })
    .where(inArray(importRows.id, rowIds));

  // Collect unique categories across all rows
  const categorySet = new Set<string>();
  for (const row of rows) {
    const raw = row.rawData as Record<string, unknown> | null;
    const cat = raw?.category as string | undefined;
    if (cat?.trim()) categorySet.add(cat.trim());
  }

  // Resolve or create categories
  const existingCategories = await tenant.query.productCategories.findMany({
    where: eq(productCategories.businessId, businessId),
    columns: { id: true, name: true, slug: true },
  });

  const categoryMap = new Map<string, string>();
  const usedSlugs = new Set(existingCategories.map((c) => c.slug));

  for (const cat of existingCategories) {
    categoryMap.set(cat.name, cat.id);
  }

  const toCreate = [...categorySet].filter((name) => !categoryMap.has(name));

  if (toCreate.length > 0) {
    const newCategoryRows = await tenant
      .insert(productCategories)
      .values(
        toCreate.map((name) => ({
          businessId,
          name,
          slug: getUniqueCategorySlug(name, usedSlugs),
        })),
      )
      .returning({ id: productCategories.id, name: productCategories.name });

    for (const cat of newCategoryRows) {
      categoryMap.set(cat.name, cat.id);
    }
  }

  // Process each row
  const results: {
    rowId: string;
    rowNumber: number;
    productId?: string;
    error?: string;
  }[] = [];

  for (const row of rows) {
    const raw = (row.rawData ?? {}) as Record<string, unknown>;

    const name = ((raw.name as string) ?? '').trim();
    if (!name) {
      results.push({
        rowId: row.id,
        rowNumber: row.rowNumber,
        error: 'El nombre del producto es requerido',
      });
      continue;
    }

    const description = ((raw.description as string) ?? '').trim();
    const category = ((raw.category as string) ?? '').trim();
    const stock = Math.max(0, Math.trunc(Number.isFinite(raw.stock) ? Number(raw.stock) : 0));
    const price = Math.max(0, Number.isFinite(raw.price) ? Number(raw.price) : 0);
    const productStatus = (raw.status as string) ?? 'ACTIVO';
    const imageUrl = (raw.imageUrl as string) ?? undefined;
    const brand = (raw.brand as string) ?? null;
    const externalCode = (raw.externalCode as string) ?? null;
    const metadata = (raw.metadata as Record<string, unknown>) ?? {};

    // ── New fields ──
    const rawTags = raw.tags as string[] | null | undefined;
    const rawSecondPrice = raw.secondPrice as number | null | undefined;
    const rawSaleStatus = (raw.saleStatus as string) ?? 'NORMAL';
    const rawShippingInfo = (raw.shippingInfo as string) ?? null;
    const rawSeoTitle = (raw.seoTitle as string) ?? null;
    const rawSeoDescription = (raw.seoDescription as string) ?? null;

    try {
      // One savepoint per row. The whole batch shares a single transaction, and
      // PostgreSQL aborts a transaction on the first statement error: without
      // this, one row rejected by a CHECK constraint would take down every
      // other row in the batch, which is not what this worker did before it
      // moved to the tenant role.
      const productId = await tenant.transaction(async (tx) => {
        const [product] = await tx
          .insert(products)
          .values({
            businessId,
            categoryId: category ? (categoryMap.get(category) ?? null) : null,
            title: name,
            description,
            price: String(price),
            secondPrice: rawSecondPrice !== null ? String(rawSecondPrice) : null,
            stock,
            isAvailable: productStatus === 'ACTIVO',
            tags: rawTags && rawTags.length > 0 ? rawTags : null,
            saleStatus: ['MAS_VENDIDO', 'NUEVO_PRODUCTO', 'NORMAL'].includes(rawSaleStatus)
              ? (rawSaleStatus as 'MAS_VENDIDO' | 'NUEVO_PRODUCTO' | 'NORMAL')
              : 'NORMAL',
            brand,
            externalCode,
            seoTitle: rawSeoTitle || null,
            seoDescription: rawSeoDescription || null,
            shippingInfo: rawShippingInfo || null,
            metadata,
          })
          .returning({ id: products.id });

        if (imageUrl) {
          await tx.insert(productMedia).values({
            productId: product.id,
            mediaUrl: imageUrl,
            mediaType: 'image',
            displayOrder: 1,
          });
        }

        return product.id;
      });

      // Only after the row is actually persisted: a notification for a product
      // that a rolled-back savepoint discarded would be a lie.
      if (stock === 0) {
        notifyOutOfStock(businessId, {
          productId,
          productName: name,
        }).catch((err) =>
          logger.error('imports: out-of-stock notification failed', { error: toErrorDetail(err) }),
        );
      } else if (stock <= LOW_STOCK_THRESHOLD) {
        notifyLowStock(businessId, {
          productId,
          productName: name,
          currentStock: stock,
          minStock: LOW_STOCK_THRESHOLD,
        }).catch((err) =>
          logger.error('imports: low-stock notification failed', { error: toErrorDetail(err) }),
        );
      }

      results.push({ rowId: row.id, rowNumber: row.rowNumber, productId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      results.push({ rowId: row.id, rowNumber: row.rowNumber, error: msg });
    }
  }

  // Update row statuses
  for (const r of results) {
    await tenant
      .update(importRows)
      .set({
        status: r.error ? 'error' : 'completed',
        productId: r.productId ?? null,
        errorMessage: r.error ?? null,
        processedAt: sql`now()`,
      })
      .where(eq(importRows.id, r.rowId));
  }

  return results;
}
