'use server';

import { env } from '@/config/env';
import { db } from '@/core/database/client';
import {
  businessTeamMembers,
  businesses,
  payments,
  productCategories,
  productMedia,
  products,
} from '@/core/database/schema';
import { logger, toErrorDetail } from '@/lib/logger';
import type { CookieOptions } from '@supabase/ssr';
import { createServerClient } from '@supabase/ssr';
import { and, asc, avg, count, desc, eq, inArray, sum } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

export async function getProductStats(businessId: string) {
  const [productCount] = await db
    .select({ count: count() })
    .from(products)
    .where(eq(products.businessId, businessId));

  const [categoryCount] = await db
    .select({ count: count() })
    .from(productCategories)
    .where(eq(productCategories.businessId, businessId));

  const lastProduct = await db.query.products.findFirst({
    where: eq(products.businessId, businessId),
    orderBy: [desc(products.createdAt)],
    columns: {
      title: true,
      createdAt: true,
      price: true,
    },
  });

  return {
    productCount: productCount?.count ?? 0,
    categoryCount: categoryCount?.count ?? 0,
    lastProduct: lastProduct
      ? {
          title: lastProduct.title,
          createdAt: lastProduct.createdAt.toISOString(),
          price: lastProduct.price,
        }
      : null,
  };
}

export async function getBusinessResults(businessId: string) {
  const paidStatuses = ['paid', 'completed', 'delivered'] as const;

  const [totals] = await db
    .select({
      totalSales: sum(payments.amount).mapWith(Number),
      orderCount: count(),
      avgTicket: avg(payments.amount).mapWith(Number),
    })
    .from(payments)
    .where(and(eq(payments.businessId, businessId), inArray(payments.status, paidStatuses)));

  const lastOrder = await db.query.payments.findFirst({
    where: and(eq(payments.businessId, businessId), inArray(payments.status, paidStatuses)),
    orderBy: [desc(payments.createdAt)],
    columns: {
      amount: true,
      createdAt: true,
      orderNumber: true,
    },
  });

  const pendingCount = await db
    .select({ count: count() })
    .from(payments)
    .where(and(eq(payments.businessId, businessId), eq(payments.status, 'pending')))
    .then((r) => r[0]?.count ?? 0);

  return {
    totalSales: totals?.totalSales ?? 0,
    orderCount: totals?.orderCount ?? 0,
    avgTicket: totals?.avgTicket ?? 0,
    pendingOrders: pendingCount,
    lastOrder: lastOrder
      ? {
          amount: lastOrder.amount,
          createdAt: lastOrder.createdAt.toISOString(),
          orderNumber: lastOrder.orderNumber,
        }
      : null,
  };
}

export async function getBusinessTeam(businessId: string) {
  const members = await db.query.businessTeamMembers.findMany({
    where: eq(businessTeamMembers.businessId, businessId),
    with: {
      user: {
        columns: {
          fullName: true,
          email: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: [asc(businessTeamMembers.joinedAt)],
  });

  return members.map((member) => ({
    id: member.id,
    userId: member.userId,
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
    fullName: member.user.fullName,
    email: member.user.email,
    avatarUrl: member.user.avatarUrl,
  }));
}

export async function removeTeamMemberAction(memberId: string) {
  const cookieStore = await cookies();

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: '', ...options });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'No autenticado' };
  }

  // Get the member record to find the businessId
  const member = await db.query.businessTeamMembers.findFirst({
    where: eq(businessTeamMembers.id, memberId),
    columns: { id: true, businessId: true, userId: true },
  });

  if (!member) {
    return { success: false, error: 'Miembro no encontrado' };
  }

  // Verify the requester is the business owner
  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, member.businessId),
    columns: { ownerId: true },
  });

  if (!business) {
    return { success: false, error: 'Empresa no encontrada' };
  }

  if (business.ownerId !== user.id) {
    return { success: false, error: 'Solo el propietario puede quitar miembros del equipo' };
  }

  // Prevent removing the owner themselves (shouldn't happen, but safety check)
  if (member.userId === user.id) {
    return { success: false, error: 'No puedes eliminarte a ti mismo como propietario' };
  }

  try {
    await db.delete(businessTeamMembers).where(eq(businessTeamMembers.id, memberId));
    revalidatePath('/list-business');
    return { success: true };
  } catch (error) {
    logger.error('Error removing team member:', { error: toErrorDetail(error) });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al quitar miembro del equipo',
    };
  }
}

export async function getProductsForExport(businessId: string) {
  const rows = await db.query.products.findMany({
    where: eq(products.businessId, businessId),
    columns: { title: true, stock: true },
    with: {
      category: {
        columns: { name: true },
      },
    },
    orderBy: [asc(products.title)],
  });

  // Compute count per category in a single pass
  const categoryCounts = new Map<string, number>();
  for (const row of rows) {
    const catName = row.category?.name ?? 'Sin categoría';
    categoryCounts.set(catName, (categoryCounts.get(catName) ?? 0) + 1);
  }

  const productsData = rows.map((row) => {
    const catName = row.category?.name ?? 'Sin categoría';
    return {
      title: row.title,
      category: catName,
      stock: row.stock,
      categoryCount: categoryCounts.get(catName) ?? 0,
    };
  });

  const categorySummary = [...categoryCounts.entries()]
    .map(([name, count]) => ({ name, productCount: count }))
    .sort((a, b) => b.productCount - a.productCount);

  return { products: productsData, categorySummary };
}

export async function deleteBusinessAction(businessId: string) {
  const cookieStore = await cookies();

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: '', ...options });
      },
    },
  });

  // 1. Authenticate user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('No autenticado');
  }

  // 2. Verify ownership and existence
  const business = await db.query.businesses.findFirst({
    where: (businesses, { and, eq }) =>
      and(eq(businesses.id, businessId), eq(businesses.ownerId, user.id)),
  });

  if (!business) {
    throw new Error('Empresa no encontrada o no tienes permisos para eliminarla');
  }

  // 3. Check for pending payments — can't delete with unresolved orders
  const [pendingPayments] = await db
    .select({ count: count() })
    .from(payments)
    .where(and(eq(payments.businessId, businessId), eq(payments.status, 'pending')));

  if (pendingPayments && pendingPayments.count > 0) {
    return {
      success: false,
      error: `No se puede eliminar la empresa porque tiene ${pendingPayments.count} ${pendingPayments.count === 1 ? 'orden pendiente' : 'órdenes pendientes'}. Finaliza todas las órdenes antes de eliminar.`,
    };
  }

  try {
    // 5. Collect image paths to delete from storage
    // We need to find all products of this business first
    const businessProducts = await db.query.products.findMany({
      where: eq(products.businessId, businessId),
      columns: { id: true },
    });

    const productIds = businessProducts.map((p) => p.id);

    if (productIds.length > 0) {
      const media = await db.query.productMedia.findMany({
        where: inArray(productMedia.productId, productIds),
        columns: { mediaUrl: true },
      });

      const pathsToDelete = media
        .map((m) => {
          // Extract path from URL (Assuming URL format includes bucket name or similar)
          // Usually Supabase public URL is https://.../storage/v1/object/public/product-images/path/to/file
          const parts = m.mediaUrl.split('/product-images/');
          return parts.length > 1 ? parts[1] : null;
        })
        .filter((path): path is string => !!path);

      if (pathsToDelete.length > 0) {
        // Use service role if available or appropriate, but here we use the user client
        // Actually, for storage we need to ensure the user has permissions to delete from bucket
        const { error: storageError } = await supabase.storage
          .from('product-images')
          .remove(pathsToDelete);

        if (storageError) {
          logger.error('Error deleting images from storage:', {
            error: toErrorDetail(storageError),
          });
          // We might continue anyway to delete the DB record, but logging it is good
        }
      }
    }

    // 6. Delete business (cascades in DB)
    await db.delete(businesses).where(eq(businesses.id, businessId));

    // 5. Revalidate
    revalidatePath('/list-business');

    return { success: true };
  } catch (error) {
    logger.error('Error in deleteBusinessAction:', { error: toErrorDetail(error) });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido al eliminar la empresa',
    };
  }
}
