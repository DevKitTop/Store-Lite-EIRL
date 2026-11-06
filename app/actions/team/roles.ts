'use server';

import { businessTeamMembers, businessTeamRoles } from '@/core/database/schema';
import { withTenantContext } from '@/core/database/tenant';
import type { ActionState } from '@/types/actions';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { assertOwnership } from './_helpers';

/**
 * Update a member's role
 */
export async function updateMemberRole(
  businessId: string,
  memberUserId: string,
  newRole: 'admin' | 'member',
): Promise<ActionState> {
  // 0. Validate input
  const { updateMemberRoleSchema } = await import('@/features/team/schemas');
  const validation = updateMemberRoleSchema.safeParse({ businessId, memberUserId, newRole });
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0]?.message };
  }

  const ownership = await assertOwnership(businessId);
  if (ownership.error) {
    return { error: ownership.error };
  }

  // Can't change own role
  if (ownership.userId === memberUserId) {
    return { success: false, error: 'No puedes cambiar tu propio rol.' };
  }

  try {
    await withTenantContext({ sub: ownership.userId }, async (tenant) =>
      tenant
        .update(businessTeamMembers)
        .set({ role: newRole })
        .where(
          and(
            eq(businessTeamMembers.businessId, businessId),
            eq(businessTeamMembers.userId, memberUserId),
          ),
        ),
    );

    revalidatePath(`/${businessId}/settings`, 'page');

    return {
      success: true,
      message: `Rol actualizado a ${newRole === 'admin' ? 'Administrador' : 'Miembro'}.`,
    };
  } catch (err) {
    console.error('[updateMemberRole] Error:', err);
    return { success: false, error: 'Error al actualizar el rol.' };
  }
}

/**
 * Update a member's custom permissions (override role defaults)
 */
export async function updateMemberPermissions(
  businessId: string,
  memberUserId: string,
  permissions: string[],
): Promise<ActionState> {
  // 0. Validate input
  const { updateMemberPermissionsSchema } = await import('@/features/team/schemas');
  const validation = updateMemberPermissionsSchema.safeParse({
    businessId,
    memberUserId,
    permissions,
  });
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0]?.message };
  }

  const ownership = await assertOwnership(businessId);
  if (ownership.error) {
    return { error: ownership.error };
  }

  // Can't change own permissions
  if (ownership.userId === memberUserId) {
    return { success: false, error: 'No puedes cambiar tus propios permisos.' };
  }

  // Validate permissions using the master list from PERMISSION_LABELS
  const { PERMISSION_LABELS } = await import('@/lib/permissions/definitions');
  const validPermissions = Object.keys(PERMISSION_LABELS);

  const invalidPermissions = permissions.filter((p) => !validPermissions.includes(p));
  if (invalidPermissions.length > 0) {
    return {
      success: false,
      error: `Permisos inválidos: ${invalidPermissions.join(', ')}`,
    };
  }

  try {
    await withTenantContext({ sub: ownership.userId }, async (tenant) =>
      tenant
        .update(businessTeamMembers)
        .set({ customPermissions: permissions })
        .where(
          and(
            eq(businessTeamMembers.businessId, businessId),
            eq(businessTeamMembers.userId, memberUserId),
          ),
        ),
    );

    revalidatePath(`/${businessId}/settings`, 'page');

    return { success: true, message: 'Permisos actualizados.' };
  } catch (err) {
    console.error('[updateMemberPermissions] Error:', err);
    return { success: false, error: 'Error al actualizar los permisos.' };
  }
}

/**
 * Update default permissions for a role in a business
 */
export async function updateRolePermissions(
  businessId: string,
  role: string,
  permissions: string[],
): Promise<ActionState> {
  // 0. Validate input
  const { updateRolePermissionsSchema } = await import('@/features/team/schemas');
  const validation = updateRolePermissionsSchema.safeParse({ businessId, role, permissions });
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0]?.message };
  }

  const ownership = await assertOwnership(businessId);
  if (ownership.error) {
    return { error: ownership.error };
  }

  // Only for admin and member roles
  if (!['admin', 'member'].includes(role)) {
    return { success: false, error: 'Rol inválido.' };
  }

  try {
    // Read and write in one tenant transaction: the role row is resolved and
    // written under the same policy that guards the write itself.
    await withTenantContext({ sub: ownership.userId }, async (tenant) => {
      const existingRole = await tenant.query.businessTeamRoles.findFirst({
        where: and(eq(businessTeamRoles.businessId, businessId), eq(businessTeamRoles.role, role)),
      });

      if (existingRole) {
        await tenant
          .update(businessTeamRoles)
          .set({
            permissions: permissions,
            updatedAt: new Date(),
          })
          .where(eq(businessTeamRoles.id, existingRole.id));
      } else {
        await tenant.insert(businessTeamRoles).values({
          businessId,
          role,
          permissions: permissions,
          isDefault: true,
        });
      }
    });

    revalidatePath(`/${businessId}/settings`, 'page');

    return { success: true, message: `Permisos del rol ${role} actualizados.` };
  } catch (err) {
    console.error('[updateRolePermissions] Error:', err);
    return { success: false, error: 'Error al actualizar los permisos del rol.' };
  }
}

/**
 * Remove custom permissions override from a member (revert to role defaults)
 */
export async function removeMemberPermissionsOverride(
  businessId: string,
  memberUserId: string,
): Promise<ActionState> {
  // 0. Validate input
  const { memberActionSchema } = await import('@/features/team/schemas');
  const validation = memberActionSchema.safeParse({ businessId, memberUserId });
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0]?.message };
  }

  const ownership = await assertOwnership(businessId);
  if (ownership.error) {
    return { error: ownership.error };
  }

  try {
    await withTenantContext({ sub: ownership.userId }, async (tenant) =>
      tenant
        .update(businessTeamMembers)
        .set({ customPermissions: null })
        .where(
          and(
            eq(businessTeamMembers.businessId, businessId),
            eq(businessTeamMembers.userId, memberUserId),
          ),
        ),
    );

    revalidatePath(`/${businessId}/settings`, 'page');

    return { success: true, message: 'Se restauraron los permisos por defecto del rol.' };
  } catch (err) {
    console.error('[removeMemberPermissionsOverride] Error:', err);
    return { success: false, error: 'Error al restaurar los permisos.' };
  }
}
