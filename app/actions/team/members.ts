'use server';

import { businessTeamMembers } from '@/core/database/schema';
import { withTenantContext } from '@/core/database/tenant';
import type { TeamMember } from '@/core/team/directory';
import { resolveTeamDirectory, resolveUserTeams } from '@/core/team/directory';
import type { ActionState } from '@/types/actions';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { assertOwnership, createUserAuthClient } from './_helpers';

/**
 * Get team members for a business
 */
export async function getTeamMembers(
  businessId: string,
): Promise<ActionState & { members?: TeamMember[] }> {
  // 0. Validate input
  const { businessIdParamSchema } = await import('@/features/team/schemas');
  const validation = businessIdParamSchema.safeParse({ businessId });
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0]?.message };
  }

  const supabase = await createUserAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'No autenticado.' };
  }

  // The roster, the membership check and the profile join happen inside one
  // governed function: a caller who does not belong to the business gets
  // nothing, and no query here can reach another tenant's team.
  const members = await resolveTeamDirectory(businessId, user.id);

  if (!members) {
    return { success: false, error: 'No tienes acceso a este equipo.' };
  }

  return { success: true, members };
}

/**
 * Remove a team member (only owner can do this)
 */
export async function removeTeamMember(
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

  // Can't remove yourself
  if (ownership.userId === memberUserId) {
    return { success: false, error: 'No puedes eliminarte a ti mismo del equipo.' };
  }

  try {
    await withTenantContext({ sub: ownership.userId }, async (tenant) =>
      tenant
        .delete(businessTeamMembers)
        .where(
          and(
            eq(businessTeamMembers.businessId, businessId),
            eq(businessTeamMembers.userId, memberUserId),
          ),
        ),
    );

    revalidatePath(`/${businessId}/settings`, 'page');

    return { success: true, message: 'Miembro eliminado del equipo.' };
  } catch (err) {
    console.error('[removeTeamMember] Error:', err);
    return { success: false, error: 'Error al eliminar el miembro.' };
  }
}

/**
 * Leave a team (member removes themselves)
 */
export async function leaveTeam(businessId: string): Promise<ActionState> {
  // 0. Validate input
  const { businessIdParamSchema } = await import('@/features/team/schemas');
  const validation = businessIdParamSchema.safeParse({ businessId });
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0]?.message };
  }

  const supabase = await createUserAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'No autenticado.' };
  }

  try {
    await withTenantContext({ sub: user.id }, async (tenant) =>
      tenant
        .delete(businessTeamMembers)
        .where(
          and(
            eq(businessTeamMembers.businessId, businessId),
            eq(businessTeamMembers.userId, user.id),
          ),
        ),
    );

    revalidatePath('/', 'page');

    return { success: true, message: 'Has salido del equipo.' };
  } catch (err) {
    console.error('[leaveTeam] Error:', err);
    return { success: false, error: 'Error al salir del equipo.' };
  }
}

/**
 * Get all teams a user is a member of
 */
export async function getUserTeams(): Promise<
  ActionState & { teams?: { businessId: string; name: string; slug: string; role: string }[] }
> {
  const supabase = await createUserAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'No autenticado.' };
  }

  try {
    const teams = await resolveUserTeams(user.id);

    return { success: true, teams };
  } catch (err) {
    console.error('[getUserTeams] Error:', err);
    return { success: false, error: 'Error al obtener tus equipos.' };
  }
}
