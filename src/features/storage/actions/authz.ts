'use server';

import { resolvePublicBusinessSlug } from '@/core/business/publicSlug';
import { db } from '@/core/database/client';
import { businesses, businessTeamMembers } from '@/core/database/schema';
import { checkPermission, type Permission } from '@/lib/permissions';
import { isBusinessOwner } from '@/lib/permissions/checkPermission';
import { createClient } from '@/lib/supabase/server';
import { and, eq } from 'drizzle-orm';

export async function requireAuthenticatedUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('No autorizado');
  }

  return user.id;
}

/**
 * Verifica que el usuario sea owner O tenga el permiso especificado.
 * Lanza error si no tiene acceso.
 */
export async function requireAccess(
  slug: string,
  permission: Permission,
): Promise<{ businessId: string; userId: string; isOwner: boolean }> {
  const userId = await requireAuthenticatedUserId();

  const business = await resolvePublicBusinessSlug(slug);

  if (!business) {
    throw new Error('Negocio no encontrado');
  }

  const isOwner = await isBusinessOwner(business.id, userId);

  // Si es owner, tiene acceso total
  if (isOwner) {
    return { businessId: business.id, userId, isOwner: true };
  }

  // Verificar si es miembro del equipo
  const membership = await db.query.businessTeamMembers.findFirst({
    where: and(
      eq(businessTeamMembers.businessId, business.id),
      eq(businessTeamMembers.userId, userId),
    ),
  });

  if (!membership) {
    throw new Error('No tienes acceso a este negocio');
  }

  // Verificar permiso específico
  const hasPermission = await checkPermission(business.id, userId, permission);

  if (!hasPermission) {
    throw new Error('No tienes permiso para realizar esta acción');
  }

  return { businessId: business.id, userId, isOwner: false };
}

/**
 * Verifica acceso basado en ID de negocio y permiso.
 */
export async function requireAccessOnId(
  businessId: string,
  permission: Permission,
): Promise<{ businessId: string; userId: string; isOwner: boolean }> {
  const userId = await requireAuthenticatedUserId();

  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { id: true },
  });

  if (!business) {
    throw new Error('Negocio no encontrado');
  }

  const isOwner = await isBusinessOwner(business.id, userId);

  if (isOwner) {
    return { businessId: business.id, userId, isOwner: true };
  }

  const hasPermission = await checkPermission(business.id, userId, permission);

  if (!hasPermission) {
    throw new Error('No tienes permiso para realizar esta acción');
  }

  return { businessId: business.id, userId, isOwner: false };
}

/**
 * Verifica que el usuario sea owner del negocio.
 */
export async function requireOwnedBusinessBySlug(slug: string) {
  const userId = await requireAuthenticatedUserId();

  const business = await resolvePublicBusinessSlug(slug);

  if (!business) {
    throw new Error('Negocio no encontrado');
  }

  if (!(await isBusinessOwner(business.id, userId))) {
    throw new Error('No autorizado');
  }

  return { businessId: business.id, ownerId: userId, slug: business.slug };
}

/**
 * Verifica que el usuario sea owner del negocio por ID.
 */
export async function requireOwnedBusinessById(businessId: string) {
  const userId = await requireAuthenticatedUserId();

  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { id: true, slug: true },
  });

  if (!business) {
    throw new Error('Negocio no encontrado');
  }

  if (!(await isBusinessOwner(business.id, userId))) {
    throw new Error('No autorizado');
  }

  return { businessId: business.id, ownerId: userId, slug: business.slug };
}
