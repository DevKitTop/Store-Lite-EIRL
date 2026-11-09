'use server';

import { db } from '@/core/database/client';
import { productCategories, productMedia, products } from '@/core/database/schema';
import { getBusinessEntitlements } from '@/core/entitlements';
import { logError } from '@/lib/errorHandling';
import { logger, toErrorDetail } from '@/lib/logger';
import { notifyLowStock, notifyOutOfStock } from '@/lib/notifications';
import { getUniqueCategorySlug } from '@/shared/utils/categorySlug';
import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { requireOwnedBusinessBySlug } from './authz';

interface ImportProductInput {
  name: string;
  description: string;
  category: string;
  stock: number;
  price: number;
  status: string;
  imageUrl?: string;
  brand?: string;
  metadata?: Record<string, unknown>;
}

const LOW_STOCK_THRESHOLD = 5;

export async function importProductsBatch(
  businessSlug: string,
  productsList: ImportProductInput[],
) {
  try {
    const normalizedProductsList = productsList.map((p) => ({
      ...p,
      name: p.name.trim(),
      description: p.description?.trim() || '',
      category: p.category.trim(),
      stock: Math.max(0, Math.trunc(Number.isFinite(p.stock) ? p.stock : 0)),
      price: Math.max(0, Number.isFinite(p.price) ? p.price : 0),
      imageUrl: p.imageUrl?.trim(),
    }));

    const { businessId } = await requireOwnedBusinessBySlug(businessSlug);

    // ─── Entitlements Check ─────────────────────────────
    const entitlements = await getBusinessEntitlements(businessId);

    if (entitlements.maxProducts !== -1) {
      const incomingCount = normalizedProductsList.filter((p) => p.status === 'ACTIVO').length;

      if (incomingCount > 0) {
        const [{ count: existingCount }] = await db
          .select({ count: sql<number>`count(*)` })
          .from(products)
          .where(and(eq(products.businessId, businessId), eq(products.isAvailable, true)));

        if (existingCount + incomingCount > entitlements.maxProducts) {
          return {
            success: false,
            error: `No puedes importar ${incomingCount} producto(s). Tu plan actual permite hasta ${entitlements.maxProducts} productos activos y ya tienes ${existingCount}. Reduce la cantidad a importar o mejora tu plan.`,
          };
        }
      }
    }
    // ─────────────────────────────────────────────────────

    const uniqueCategoryNames = Array.from(
      new Set(normalizedProductsList.map((p) => p.category).filter(Boolean)),
    );

    const categoryMap = new Map<string, string>();

    if (uniqueCategoryNames.length > 0) {
      const existingCategories = await db.query.productCategories.findMany({
        where: eq(productCategories.businessId, businessId),
        columns: { id: true, name: true, slug: true },
      });

      const usedSlugs = new Set(existingCategories.map((c) => c.slug));

      for (const cat of existingCategories) {
        categoryMap.set(cat.name, cat.id);
      }

      const toCreate = uniqueCategoryNames.filter((name) => !categoryMap.has(name));

      if (toCreate.length > 0) {
        const newCategoryRows = await db
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
    }

    const newProductsData = normalizedProductsList.map((p) => ({
      businessId,
      categoryId: p.category ? categoryMap.get(p.category) || null : null,
      title: p.name,
      description: p.description,
      price: String(p.price),
      stock: p.stock,
      isAvailable: p.status === 'ACTIVO',
      brand: p.brand || null,
      metadata: p.metadata || {},
    }));

    if (newProductsData.length > 0) {
      const insertedProducts = await db
        .insert(products)
        .values(newProductsData)
        .returning({ id: products.id });

      const mediaValues = insertedProducts
        .map((inserted, idx) => {
          const imgUrl = normalizedProductsList[idx]?.imageUrl;
          if (!imgUrl) return null;
          return {
            productId: inserted.id,
            mediaUrl: imgUrl,
            mediaType: 'image' as const,
            displayOrder: 1,
          };
        })
        .filter(Boolean) as {
        productId: string;
        mediaUrl: string;
        mediaType: 'image';
        displayOrder: number;
      }[];

      if (mediaValues.length > 0) {
        await db.insert(productMedia).values(mediaValues);
      }

      // ─── Notificar stock bajo para productos importados ───
      for (const [idx, inserted] of insertedProducts.entries()) {
        const importedStock = normalizedProductsList[idx]?.stock ?? 0;
        if (importedStock === 0) {
          notifyOutOfStock(businessId, {
            productId: inserted.id,
            productName: normalizedProductsList[idx].name,
          }).catch((notifyErr) => {
            logger.error('[notifyOutOfStock] Error:', { error: toErrorDetail(notifyErr) });
          });
        } else if (importedStock <= LOW_STOCK_THRESHOLD) {
          notifyLowStock(businessId, {
            productId: inserted.id,
            productName: normalizedProductsList[idx].name,
            currentStock: importedStock,
            minStock: LOW_STOCK_THRESHOLD,
          }).catch((notifyErr) => {
            logger.error('[notifyLowStock] Error:', { error: toErrorDetail(notifyErr) });
          });
        }
      }
    }

    revalidatePath(`/${businessSlug}/storage`);

    return { success: true };
  } catch (error) {
    logError('importProductsBatch', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al importar productos masivamente',
    };
  }
}
