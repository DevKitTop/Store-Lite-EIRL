'use server';

import { env } from '@/config/env';
import { db } from '@/core/database/client';
import { productCategories } from '@/core/database/schema';
import { getUniqueCategorySlug } from '@/shared/utils/categorySlug';
import { createClient } from '@supabase/supabase-js';
import { eq, sql } from 'drizzle-orm';

import { getBusinessEntitlements } from '@/core/entitlements';
import { logError } from '@/lib/errorHandling';
import { logger, toErrorDetail } from '@/lib/logger';
import { revalidatePath } from 'next/cache';
import { requireAccess } from './authz';

const CATEGORY_BUCKET = 'products';
const CATEGORY_PREFIX = 'categories';

function createAdminClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Deletes a category image from storage, but only when its path belongs
 * to the given business. Never trusts raw URLs from the client.
 */
async function deleteCategoryImage(businessId: string, url: string | null): Promise<void> {
  if (!url || !url.includes(CATEGORY_BUCKET)) return;

  const parts = url.split(`${CATEGORY_BUCKET}/`);
  if (parts.length < 2) return;

  const filePath = parts[1];

  // Reject traversal attempts up front; the prefix check below does NOT stop "..".
  if (filePath.includes('..')) {
    logger.warn('[deleteCategoryImage] Path contains traversal, skipping deletion:', {
      error: toErrorDetail(filePath),
    });
    return;
  }

  const expectedPrefix = `${CATEGORY_PREFIX}/${businessId}/`;
  if (!filePath.startsWith(expectedPrefix)) {
    logger.warn('[deleteCategoryImage] Path outside categories, skipping deletion:', {
      error: toErrorDetail(filePath),
    });
    return;
  }

  const { error } = await createAdminClient().storage.from(CATEGORY_BUCKET).remove([filePath]);
  if (error) {
    logger.warn('[deleteCategoryImage] Failed to remove previous image:', { error: error.message });
  }
}

export async function getProductCategories(slug: string) {
  try {
    const { businessId: id } = await requireAccess(slug, 'categories.view');

    const categoriesList = await db.query.productCategories.findMany({
      where: eq(productCategories.businessId, id),
      columns: { id: true, name: true },
      orderBy: (table, { asc }) => [asc(table.name)],
    });

    const entitlements = await getBusinessEntitlements(id);

    return {
      categories: categoriesList,
      entitlements,
      error: null,
    };
  } catch (error) {
    logError('getProductCategories', error);
    return {
      categories: [],
      error: error instanceof Error ? error.message : 'Error al obtener categorias',
    };
  }
}

export async function syncProductCategories(slug: string, categoryNames: string[]) {
  try {
    // Usar requireAccess para soportar miembros del equipo con permisos
    const { businessId } = await requireAccess(slug, 'categories.edit');

    const existingCategories = await db.query.productCategories.findMany({
      where: eq(productCategories.businessId, businessId),
      columns: { id: true, name: true, slug: true },
    });

    const existingNames = existingCategories.map((c) => c.name);
    const usedSlugs = new Set(existingCategories.map((c) => c.slug));
    const newNames = categoryNames.map((n) => n.trim()).filter(Boolean);

    const toDelete = existingCategories.filter((c) => !newNames.includes(c.name));
    const toAdd = newNames.filter((name) => !existingNames.includes(name));

    if (toDelete.length > 0) {
      for (const cat of toDelete) {
        await db.delete(productCategories).where(eq(productCategories.id, cat.id));
      }
    }

    if (toAdd.length > 0) {
      // --- Entitlements Check for New Categories ---
      const entitlements = await getBusinessEntitlements(businessId);
      if (entitlements.maxCategories !== -1) {
        const [{ count: rawCount }] = await db
          .select({ count: sql<number>`count(*)` })
          .from(productCategories)
          .where(eq(productCategories.businessId, businessId));

        const currentCategoryCount = Number(rawCount) || 0;
        if (currentCategoryCount + toAdd.length > entitlements.maxCategories) {
          return {
            success: false,
            categories: existingCategories.map((c) => ({ id: c.id, name: c.name })),
            error: `No se pueden sincronizar las categorías. El plan actual solo permite hasta ${entitlements.maxCategories} categorías y estás intentando tener ${currentCategoryCount + toAdd.length}.`,
          };
        }
      }
      // ---------------------------------------------

      const newItems = toAdd.map((name) => ({
        businessId,
        name,
        slug: getUniqueCategorySlug(name, usedSlugs),
      }));
      await db.insert(productCategories).values(newItems);
    }

    const finalCategories = await db.query.productCategories.findMany({
      where: eq(productCategories.businessId, businessId),
      columns: { id: true, name: true },
      orderBy: (table, { asc }) => [asc(table.name)],
    });

    return {
      success: true,
      categories: finalCategories,
    };
  } catch (error) {
    logError('syncProductCategories', error);
    return {
      success: false,
      categories: [],
      error: error instanceof Error ? error.message : 'Error al sincronizar categorias',
    };
  }
}

export async function deleteCategory(businessSlug: string, categoryId: string) {
  try {
    const { businessId } = await requireAccess(businessSlug, 'categories.delete');

    const category = await db.query.productCategories.findFirst({
      where: (categories, { and, eq }) =>
        and(eq(categories.id, categoryId), eq(categories.businessId, businessId)),
      columns: { id: true, name: true, imageUrl: true },
    });

    if (!category) {
      return { success: false, error: 'Categoría no encontrada o acceso denegado' };
    }

    await db.delete(productCategories).where(eq(productCategories.id, categoryId));

    // Clean up the stored image (if any) after the DB row is gone.
    await deleteCategoryImage(businessId, category.imageUrl);

    revalidatePath(`/${businessSlug}`);
    revalidatePath(`/${businessSlug}/storage`);

    return { success: true, error: null };
  } catch (error) {
    logError('deleteCategory', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al eliminar la categoría',
    };
  }
}

export async function updateCategory(
  businessSlug: string,
  categoryId: string,
  data: {
    name?: string;
    imageUrl?: string | null;
  },
) {
  try {
    const { businessId } = await requireAccess(businessSlug, 'categories.edit');

    const category = await db.query.productCategories.findFirst({
      where: (categories, { and, eq }) =>
        and(eq(categories.id, categoryId), eq(categories.businessId, businessId)),
      columns: { id: true, imageUrl: true },
    });

    if (!category) {
      return { success: false, error: 'Categoria no encontrada o acceso denegado' };
    }

    const updateData: Partial<{ name: string; imageUrl: string | null }> = {};
    if (data.name !== undefined) {
      updateData.name = data.name.trim();
    }
    if (data.imageUrl !== undefined) {
      updateData.imageUrl = data.imageUrl;
    }

    if (Object.keys(updateData).length === 0) {
      return { success: true };
    }

    const previousImageUrl = category.imageUrl;

    await db.update(productCategories).set(updateData).where(eq(productCategories.id, categoryId));

    // Clean up the previous image only when it was replaced or removed.
    if (data.imageUrl !== undefined && previousImageUrl && previousImageUrl !== data.imageUrl) {
      await deleteCategoryImage(businessId, previousImageUrl);
    }

    revalidatePath(`/${businessSlug}`);
    revalidatePath(`/${businessSlug}/storage`);

    return { success: true, error: null };
  } catch (error) {
    logError('updateCategory', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al actualizar categoria',
    };
  }
}

export async function createCategory(
  businessSlug: string,
  data: {
    name: string;
    imageUrl?: string | null;
  },
) {
  try {
    const { businessId } = await requireAccess(businessSlug, 'categories.create');

    // --- Entitlements Check ---
    const entitlements = await getBusinessEntitlements(businessId);
    if (entitlements.maxCategories !== -1) {
      const [{ count: currentCategoryCount }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(productCategories)
        .where(eq(productCategories.businessId, businessId));

      if (currentCategoryCount >= entitlements.maxCategories) {
        return {
          success: false,
          error: `Has alcanzado el límite de categorías de tu plan (${entitlements.maxCategories}).`,
        };
      }
    }
    // -------------------------

    const existingCategories = await db.query.productCategories.findMany({
      where: eq(productCategories.businessId, businessId),
      columns: { slug: true },
    });
    const usedSlugs = new Set(existingCategories.map((c) => c.slug));

    const [newCategory] = await db
      .insert(productCategories)
      .values({
        businessId,
        name: data.name.trim(),
        slug: getUniqueCategorySlug(data.name.trim(), usedSlugs),
        imageUrl: data.imageUrl || null,
        displayOrder: 0,
      })
      .returning();

    revalidatePath(`/${businessSlug}`);
    revalidatePath(`/${businessSlug}/storage`);

    return { success: true, category: newCategory, error: null };
  } catch (error) {
    logError('createCategory', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al crear la categoria',
    };
  }
}
