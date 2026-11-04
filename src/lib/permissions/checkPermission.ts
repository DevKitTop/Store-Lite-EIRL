'use server';

// =====================================================
// PERMISSIONS — Check Permission Helper
// =====================================================
// Server-side function to verify user permissions
// =====================================================

import { db } from '@/core/database/client';
import { businessTeamMembers, businessTeamRoles } from '@/core/database/schema';
import { and, eq, sql } from 'drizzle-orm';
import type { Permission, Role } from './definitions';
import { DEFAULT_ROLE_PERMISSIONS } from './definitions';

export interface MemberPermissions {
  isOwner: boolean;
  role: Role | null;
  permissions: Permission[];
}

/**
 * Resuelve si un usuario es dueño del negocio.
 *
 * Va contra `public.is_business_owner`, una función SECURITY DEFINER: la tabla
 * `businesses` no está concedida al rol de runtime porque también guarda
 * `tax_id`, `verification_data` y datos del representante legal, y RLS filtra
 * filas, nunca columnas. Cualquier autorización debe salir de acá, nunca de
 * comparar una columna que el llamador leyó por su cuenta.
 */
export async function isBusinessOwner(businessId: string, userId?: string): Promise<boolean> {
  if (!userId) {
    return false;
  }

  const ownerRows = (await db.execute(sql`
    select public.is_business_owner(${businessId}::uuid, ${userId}::uuid) as is_owner
  `)) as unknown as { is_owner: boolean }[];

  return ownerRows.at(0)?.is_owner === true;
}

/**
 * Obtiene los permisos efectivos de un usuario para un negocio.
 * 1. Si es owner → todos los permisos
 * 2. Si es miembro → usa el rol + permisos custom
 */
export async function getMemberPermissions(
  businessId: string,
  userId?: string,
): Promise<MemberPermissions> {
  if (!userId) {
    return {
      isOwner: false,
      role: null,
      permissions: [],
    };
  }

  // 1. Verificar si es owner.
  if (await isBusinessOwner(businessId, userId)) {
    return {
      isOwner: true,
      role: 'owner',
      permissions: DEFAULT_ROLE_PERMISSIONS.owner,
    };
  }

  // 2. Obtener rol y permisos custom del miembro
  const membership = await db.query.businessTeamMembers.findFirst({
    where: and(
      eq(businessTeamMembers.businessId, businessId),
      eq(businessTeamMembers.userId, userId),
    ),
    columns: {
      role: true,
      customPermissions: true,
    },
  });

  if (!membership) {
    return {
      isOwner: false,
      role: null,
      permissions: [],
    };
  }

  const memberRole = membership.role as Role;

  // 3. Si tiene permisos custom, usarlos
  if (membership.customPermissions && membership.customPermissions.length > 0) {
    return {
      isOwner: false,
      role: memberRole,
      permissions: membership.customPermissions as Permission[],
    };
  }

  // 4. Verificar si hay permisos custom definidos en business_team_roles
  const customRole = await db.query.businessTeamRoles.findFirst({
    where: and(
      eq(businessTeamRoles.businessId, businessId),
      eq(businessTeamRoles.role, memberRole),
    ),
    columns: { permissions: true },
  });

  if (customRole?.permissions && customRole.permissions.length > 0) {
    return {
      isOwner: false,
      role: memberRole,
      permissions: customRole.permissions as Permission[],
    };
  }

  // 5. Usar permisos por defecto del rol
  return {
    isOwner: false,
    role: memberRole,
    permissions: DEFAULT_ROLE_PERMISSIONS[memberRole] || [],
  };
}

/**
 * Verifica si un usuario tiene un permiso específico para un negocio.
 */
export async function checkPermission(
  businessId: string,
  userId: string | undefined,
  permission: Permission,
): Promise<boolean> {
  const { permissions } = await getMemberPermissions(businessId, userId);
  return permissions.includes(permission);
}

/**
 * Verifica múltiples permisos (AND - todos deben ser true)
 */
export async function checkPermissions(
  businessId: string,
  userId: string | undefined,
  requiredPermissions: Permission[],
): Promise<{ hasPermission: boolean; missingPermissions: Permission[] }> {
  const { permissions } = await getMemberPermissions(businessId, userId);
  const missingPermissions = requiredPermissions.filter((p) => !permissions.includes(p));

  return {
    hasPermission: missingPermissions.length === 0,
    missingPermissions,
  };
}

/**
 * Verifica si el usuario puede realizar una acción específica.
 * Uso: antes de ejecutar una server action.
 */
export async function assertPermission(
  businessId: string,
  userId: string | undefined,
  permission: Permission,
): Promise<void> {
  const hasPermission = await checkPermission(businessId, userId, permission);
  if (!hasPermission) {
    throw new Error(`No tienes permiso para realizar esta acción.`);
  }
}
