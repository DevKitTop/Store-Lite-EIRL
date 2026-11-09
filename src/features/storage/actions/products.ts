'use server';

import { db } from '@/core/database/client';
import { productCategories, productLikes, productMedia, products } from '@/core/database/schema';
import { getBusinessEntitlements } from '@/core/entitlements';
import { FROZEN_FIELD_MESSAGE, hasLockingPayments } from '@/core/orders/paymentGuards';
import { captureEvent } from '@/lib/analytics/capture';
import { AnalyticsEvents } from '@/lib/analytics/taxonomy';
import { logError } from '@/lib/errorHandling';
import { logger, toErrorDetail } from '@/lib/logger';
import { notifyLowStock, notifyOutOfStock } from '@/lib/notifications';
import { setSentryContext } from '@/lib/sentryContext';
import { getUniqueCategorySlug } from '@/shared/utils/categorySlug';
import { getUniqueProductSlug } from '@/shared/utils/productSlug';
import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { requireAccess } from './authz';

export type SaleStatus = 'NORMAL' | 'MAS_VENDIDO' | 'NUEVO_PRODUCTO';
const LOW_STOCK_THRESHOLD = 5;

interface ProductActionInput {
  name: string;
  description?: string;
  price: number;
  stock: number;
  category: string;
  status: string;
  images: string[];
  brand?: string;
  tags?: string[];
  shippingInfo?: string;
  secondPrice?: number;
  saleStatus?: SaleStatus;
  seoTitle?: string | null;
  seoDescription?: string | null;
  metadata?: Record<string, unknown> | null;
}

function normalizeProductInput(input: ProductActionInput): ProductActionInput {
  const normalizedPrice = Number.isFinite(input.price) ? input.price : 0;
  const normalizedStock = Number.isFinite(input.stock) ? input.stock : 0;

  return {
    name: input.name.trim(),
    description: input.description?.trim() || '',
    price: Math.max(0, normalizedPrice),
    stock: Math.max(0, Math.trunc(normalizedStock)),
    category: input.category.trim(),
    status: input.status,
    images: input.images.map((url) => url.trim()).filter(Boolean),
    brand: input.brand?.trim(),
    tags: input.tags?.map((t) => t.trim()).filter(Boolean),
    shippingInfo: input.shippingInfo?.trim(),
    secondPrice: input.secondPrice,
    saleStatus: input.saleStatus,
    seoTitle: input.seoTitle?.trim() || null,
    seoDescription: input.seoDescription?.trim() || null,
    metadata: input.metadata || null,
  };
}

export async function getProductsByBusinessSlug(slug: string) {
  try {
    const { businessId: id } = await requireAccess(slug, 'products.view');

    const productsList = await db.query.products.findMany({
      where: eq(products.businessId, id),
      with: {
        category: {
          columns: {
            name: true,
          },
        },
        media: {
          orderBy: (media, { asc }) => [asc(media.displayOrder)],
          columns: {
            mediaUrl: true,
            displayOrder: true,
          },
        },
      },
      orderBy: (table, { desc }) => [desc(table.updatedAt)],
    });

    const transformedProducts = productsList.map((product) => ({
      id: product.id,
      name: product.title,
      category: product.category?.name || 'Sin categoria',
      stock: product.stock,
      price: String(product.price),
      status: product.isAvailable ? 'ACTIVO' : 'NO ACTIVO',
      image: product.media[0]?.mediaUrl || '',
      images: product.media.map((m) => m.mediaUrl),
      description: product.description || '',
      currency: product.currency,
      brand: product.brand,
      tags: product.tags,
      shippingInfo: product.shippingInfo,
      saleStatus: product.saleStatus,
      secondPrice: product.secondPrice ? String(product.secondPrice) : null,
      metadata: (product.metadata as Record<string, unknown>) || null,
    }));

    const entitlements = await getBusinessEntitlements(id);

    return {
      products: transformedProducts,
      businessId: id,
      entitlements,
      error: null,
    };
  } catch (error) {
    logError('getProductsByBusinessSlug', error);
    return {
      products: [],
      businessId: null,
      entitlements: null,
      error: error instanceof Error ? error.message : 'Error desconocido al obtener productos',
    };
  }
}

export async function getProductById(businessSlug: string, productId: string) {
  try {
    const { businessId } = await requireAccess(businessSlug, 'products.view');

    const product = await db.query.products.findFirst({
      where: (p, { and, eq, or }) =>
        and(or(eq(p.id, productId), eq(p.slug, productId)), eq(p.businessId, businessId)),
      with: {
        category: {
          columns: {
            name: true,
          },
        },
        media: {
          orderBy: (media, { asc }) => [asc(media.displayOrder)],
          columns: {
            mediaUrl: true,
            displayOrder: true,
          },
        },
      },
    });

    if (!product) {
      return { product: null, error: 'Producto no encontrado' };
    }

    const transformedProduct = {
      id: product.id,
      name: product.title,
      category: product.category?.name || 'Sin categoria',
      stock: product.stock,
      price: String(product.price),
      status: product.isAvailable ? 'ACTIVO' : 'NO ACTIVO',
      slug: product.slug,
      seoTitle: product.seoTitle,
      seoDescription: product.seoDescription,
      image: product.media[0]?.mediaUrl || '',
      images: product.media.map((m) => m.mediaUrl),
      description: product.description || '',
      currency: product.currency,
      displayOrder: product.displayOrder,
      createdAt: product.createdAt,
      brand: product.brand,
      tags: product.tags,
      shippingInfo: product.shippingInfo,
      saleStatus: product.saleStatus,
      secondPrice: product.secondPrice ? String(product.secondPrice) : null,
    };

    return { product: transformedProduct, error: null };
  } catch (error) {
    logError('getProductById', error);
    return {
      product: null,
      error: error instanceof Error ? error.message : 'Error al obtener el producto',
    };
  }
}

export async function createProduct(businessSlug: string, productData: ProductActionInput) {
  try {
    const normalizedProduct = normalizeProductInput(productData);
    const { businessId, userId } = await requireAccess(businessSlug, 'products.create');

    // --- Entitlements Check ---
    const entitlements = await getBusinessEntitlements(businessId);

    if (entitlements.maxProducts !== -1) {
      const [{ count: currentProductCount }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(products)
        .where(eq(products.businessId, businessId));

      if (currentProductCount >= entitlements.maxProducts) {
        return {
          success: false,
          productId: null,
          error: `Has alcanzado el límite de productos de tu plan (${entitlements.maxProducts}).`,
        };
      }
    }
    // -------------------------

    let categoryId: string | null = null;
    const cleanCategory = normalizedProduct.category;

    if (cleanCategory) {
      const existingCategory = await db.query.productCategories.findFirst({
        where: (categories, { and, eq }) =>
          and(eq(categories.businessId, businessId), eq(categories.name, cleanCategory)),
        columns: { id: true },
      });

      if (existingCategory) {
        categoryId = existingCategory.id;
      } else {
        // --- Entitlements Check for New Category ---
        if (entitlements.maxCategories !== -1) {
          const [{ count: currentCategoryCount }] = await db
            .select({ count: sql<number>`count(*)` })
            .from(productCategories)
            .where(eq(productCategories.businessId, businessId));

          if (currentCategoryCount >= entitlements.maxCategories) {
            return {
              success: false,
              productId: null,
              error: `Has alcanzado el límite de categorías de tu plan (${entitlements.maxCategories}). No pudimos crear la categoría "${cleanCategory}".`,
            };
          }
        }
        // ------------------------------------------

        const siblingCategories = await db.query.productCategories.findMany({
          where: eq(productCategories.businessId, businessId),
          columns: { slug: true },
        });
        const usedSlugs = new Set(siblingCategories.map((c) => c.slug));

        const [newCategory] = await db
          .insert(productCategories)
          .values({
            businessId,
            name: cleanCategory,
            slug: getUniqueCategorySlug(cleanCategory, usedSlugs),
          })
          .returning({ id: productCategories.id });
        categoryId = newCategory.id;
      }
    }

    // Generate valid slug
    const siblingProducts = await db.query.products.findMany({
      where: eq(products.businessId, businessId),
      columns: { slug: true },
    });
    const usedProductSlugs = new Set(
      siblingProducts.map((p) => p.slug).filter(Boolean) as string[],
    );
    const newSlug = getUniqueProductSlug(normalizedProduct.name, usedProductSlugs);

    const [newProduct] = await db
      .insert(products)
      .values({
        businessId,
        categoryId: categoryId,
        title: normalizedProduct.name,
        slug: newSlug,
        description: normalizedProduct.description,
        price: String(normalizedProduct.price),
        stock: normalizedProduct.stock,
        isAvailable: normalizedProduct.status === 'ACTIVO',
        brand: normalizedProduct.brand,
        tags: normalizedProduct.tags,
        shippingInfo: normalizedProduct.shippingInfo,
        saleStatus: (normalizedProduct.saleStatus || 'NORMAL') as
          | 'NORMAL'
          | 'MAS_VENDIDO'
          | 'NUEVO_PRODUCTO',
        secondPrice:
          normalizedProduct.secondPrice !== undefined && normalizedProduct.secondPrice !== null
            ? String(normalizedProduct.secondPrice)
            : null,
        seoTitle: normalizedProduct.seoTitle,
        seoDescription: normalizedProduct.seoDescription,
        metadata: normalizedProduct.metadata || {},
      })
      .returning({ id: products.id });

    if (normalizedProduct.images.length > 0) {
      const mediaValues = normalizedProduct.images.map((url, index) => ({
        productId: newProduct.id,
        mediaUrl: url,
        mediaType: 'image' as const,
        displayOrder: index + 1,
      }));

      await db.insert(productMedia).values(mediaValues);
    }

    // Fire-and-forget: capture product creation event
    captureEvent(AnalyticsEvents.PRODUCT_CREATED, {
      product_id: newProduct.id,
    }).catch(() => {});

    // Attach user + business context to Sentry for multi-tenant error tracing
    setSentryContext({ id: userId }, { id: businessId, plan: entitlements.plan });

    // ─── Notificar stock bajo si aplica ───
    if (normalizedProduct.stock === 0) {
      notifyOutOfStock(businessId, {
        productId: newProduct.id,
        productName: normalizedProduct.name,
      }).catch((notifyErr) => {
        logger.error('[notifyOutOfStock] Error:', { error: toErrorDetail(notifyErr) });
      });
    } else if (normalizedProduct.stock <= LOW_STOCK_THRESHOLD) {
      notifyLowStock(businessId, {
        productId: newProduct.id,
        productName: normalizedProduct.name,
        currentStock: normalizedProduct.stock,
        minStock: LOW_STOCK_THRESHOLD,
      }).catch((notifyErr) => {
        logger.error('[notifyLowStock] Error:', { error: toErrorDetail(notifyErr) });
      });
    }

    revalidatePath(`/${businessSlug}`);
    revalidatePath(`/${businessSlug}/storage`);

    return { success: true, productId: newProduct.id, error: null };
  } catch (error) {
    logError('createProduct', error);
    return {
      success: false,
      productId: null,
      error: error instanceof Error ? error.message : 'Error al crear producto',
    };
  }
}

export async function updateProduct(
  businessSlug: string,
  productId: string,
  productData: ProductActionInput,
) {
  try {
    const normalizedProduct = normalizeProductInput(productData);
    const { businessId } = await requireAccess(businessSlug, 'products.edit');

    const existingProduct = await db.query.products.findFirst({
      where: (table, { and, eq }) => and(eq(table.id, productId), eq(table.businessId, businessId)),
      columns: {
        id: true,
        stock: true,
        title: true,
        isAvailable: true,
        price: true,
        secondPrice: true,
      },
    });

    if (!existingProduct) {
      throw new Error('Producto no encontrado o no autorizado');
    }

    // Payment lock guard — title and price frozen when payments exist
    if (
      (await hasLockingPayments({ productId })) &&
      (normalizedProduct.name !== existingProduct.title ||
        String(normalizedProduct.price) !== existingProduct.price ||
        String(normalizedProduct.secondPrice ?? '') !== String(existingProduct.secondPrice ?? ''))
    ) {
      return { success: false, productId: null, error: FROZEN_FIELD_MESSAGE };
    }

    // 🚫 PLAN CHECK: Si se está habilitando un producto que estaba desactivado,
    // verificar que no exceda el límite del plan
    const isBeingEnabled = normalizedProduct.status === 'ACTIVO' && !existingProduct.isAvailable;
    if (isBeingEnabled) {
      const entitlements = await getBusinessEntitlements(businessId);
      if (entitlements.maxProducts !== -1) {
        const [{ count: currentActiveCount }] = await db
          .select({ count: sql<number>`count(*)` })
          .from(products)
          .where(and(eq(products.businessId, businessId), eq(products.isAvailable, true)));

        if (currentActiveCount >= entitlements.maxProducts) {
          return {
            success: false,
            productId: null,
            error: `Has alcanzado el límite de productos activos de tu plan (${entitlements.maxProducts}). Desactiva otros productos o mejora tu plan.`,
          };
        }
      }
    }

    let categoryId: string | null = null;
    const cleanCategory = normalizedProduct.category;

    if (cleanCategory) {
      const existingCategory = await db.query.productCategories.findFirst({
        where: (categories, { and, eq }) =>
          and(eq(categories.businessId, businessId), eq(categories.name, cleanCategory)),
        columns: { id: true },
      });

      if (existingCategory) {
        categoryId = existingCategory.id;
      } else {
        const siblingCategories = await db.query.productCategories.findMany({
          where: eq(productCategories.businessId, businessId),
          columns: { slug: true },
        });
        const usedSlugs = new Set(siblingCategories.map((c) => c.slug));

        const [newCategory] = await db
          .insert(productCategories)
          .values({
            businessId,
            name: cleanCategory,
            slug: getUniqueCategorySlug(cleanCategory, usedSlugs),
          })
          .returning({ id: productCategories.id });
        categoryId = newCategory.id;
      }
    }

    await db
      .update(products)
      .set({
        categoryId: categoryId,
        title: normalizedProduct.name,
        description: normalizedProduct.description,
        price: String(normalizedProduct.price),
        stock: normalizedProduct.stock,
        isAvailable: normalizedProduct.status === 'ACTIVO',
        brand: normalizedProduct.brand,
        tags: normalizedProduct.tags,
        shippingInfo: normalizedProduct.shippingInfo,
        saleStatus: (normalizedProduct.saleStatus || 'NORMAL') as
          | 'NORMAL'
          | 'MAS_VENDIDO'
          | 'NUEVO_PRODUCTO',
        secondPrice:
          normalizedProduct.secondPrice !== undefined && normalizedProduct.secondPrice !== null
            ? String(normalizedProduct.secondPrice)
            : null,
        seoTitle: normalizedProduct.seoTitle,
        seoDescription: normalizedProduct.seoDescription,
        metadata: normalizedProduct.metadata || {},
      })
      .where(and(eq(products.id, productId), eq(products.businessId, businessId)));

    await db.delete(productMedia).where(eq(productMedia.productId, productId));

    if (normalizedProduct.images.length > 0) {
      const mediaValues = normalizedProduct.images.map((url, index) => ({
        productId,
        mediaUrl: url,
        mediaType: 'image' as const,
        displayOrder: index + 1,
      }));

      await db.insert(productMedia).values(mediaValues);
    }

    // ─── Notificar stock bajo si aplica ───
    if (existingProduct.stock > 0 && normalizedProduct.stock === 0) {
      notifyOutOfStock(businessId, {
        productId,
        productName: normalizedProduct.name,
      }).catch((notifyErr) => {
        logger.error('[notifyOutOfStock] Error:', { error: toErrorDetail(notifyErr) });
      });
    } else if (
      existingProduct.stock > LOW_STOCK_THRESHOLD &&
      normalizedProduct.stock <= LOW_STOCK_THRESHOLD &&
      normalizedProduct.stock > 0
    ) {
      notifyLowStock(businessId, {
        productId,
        productName: normalizedProduct.name,
        currentStock: normalizedProduct.stock,
        minStock: LOW_STOCK_THRESHOLD,
      }).catch((notifyErr) => {
        logger.error('[notifyLowStock] Error:', { error: toErrorDetail(notifyErr) });
      });
    }

    revalidatePath(`/${businessSlug}`);
    revalidatePath(`/${businessSlug}/storage`);

    return { success: true, productId, error: null };
  } catch (error) {
    logError('updateProduct', error);
    return {
      success: false,
      productId: null,
      error: error instanceof Error ? error.message : 'Error al actualizar producto',
    };
  }
}

/**
 * Returns whether a product has locking payment history.
 * Used by the UI to mirror frozen fields (UX only — server guards are authoritative).
 */
export async function getProductLockState(
  productId: string,
): Promise<{ locked: boolean; error?: string }> {
  try {
    const locked = await hasLockingPayments({ productId });
    return { locked };
  } catch (error) {
    logError('getProductLockState', error);
    return { locked: false, error: 'Error al verificar el estado del producto.' };
  }
}

export async function toggleLikeProduct(productId: string, businessSlug?: string) {
  try {
    const headersList = await headers();
    const xForwardedFor = headersList.get('x-forwarded-for');
    const xRealIp = headersList.get('x-real-ip');

    // Determine IP with better fallbacks
    const rawIp = xForwardedFor ? xForwardedFor.split(',')[0] : xRealIp || 'unknown';
    const ipAddress = rawIp.trim() || 'unknown';

    // 1. Check if already liked using standard select
    const existing = await db
      .select({ id: productLikes.id })
      .from(productLikes)
      .where(and(eq(productLikes.productId, productId), eq(productLikes.ipAddress, ipAddress)))
      .limit(1);

    if (existing.length > 0) {
      return { success: true, alreadyLiked: true };
    }

    // 2. Insert like and increment stars
    await db.transaction(async (tx) => {
      await tx
        .insert(productLikes)
        .values({
          productId,
          ipAddress,
        })
        .onConflictDoNothing();

      await tx
        .update(products)
        .set({
          stars: sql`coalesce(${products.stars}, 0) + 1`,
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId));
    });

    if (businessSlug) {
      revalidatePath(`/${businessSlug}`);
    }
    revalidatePath('/', 'layout');
    return { success: true, alreadyLiked: false };
  } catch (error) {
    logError('toggleLikeProduct', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al dar like',
    };
  }
}

/**
 * Updates the public visibility of extra metadata fields for a product.
 * Stores the list of public keys inside metadata._public.
 */
export async function updateProductPublicMetadata(
  businessSlug: string,
  productId: string,
  publicKeys: string[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const { businessId } = await requireAccess(businessSlug, 'products.edit');

    const product = await db.query.products.findFirst({
      where: and(eq(products.id, productId), eq(products.businessId, businessId)),
      columns: { id: true, metadata: true },
    });

    if (!product) {
      throw new Error('Producto no encontrado o no autorizado');
    }

    const currentMetadata = (product.metadata as Record<string, unknown>) ?? {};
    const updatedMetadata = {
      ...currentMetadata,
      _public: publicKeys,
    };

    await db
      .update(products)
      .set({ metadata: updatedMetadata })
      .where(and(eq(products.id, productId), eq(products.businessId, businessId)));

    revalidatePath(`/${businessSlug}`);
    revalidatePath(`/${businessSlug}/storage`);

    return { success: true };
  } catch (error) {
    logError('updateProductPublicMetadata', error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Error al actualizar visibilidad de metadatos',
    };
  }
}

export async function deleteProduct(businessSlug: string, productId: string) {
  try {
    // Usar requireAccess para soportar miembros del equipo con permisos
    const { businessId } = await requireAccess(businessSlug, 'products.delete');

    const product = await db.query.products.findFirst({
      where: eq(products.id, productId),
      columns: { businessId: true },
    });

    if (!product || product.businessId !== businessId) {
      throw new Error('Producto no encontrado o no autorizado');
    }

    await db.delete(productMedia).where(eq(productMedia.productId, productId));
    await db
      .delete(products)
      .where(and(eq(products.id, productId), eq(products.businessId, businessId)));

    revalidatePath(`/${businessSlug}`);
    revalidatePath(`/${businessSlug}/storage`);

    return { success: true, error: null };
  } catch (error) {
    logError('deleteProduct', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al eliminar producto',
    };
  }
}
