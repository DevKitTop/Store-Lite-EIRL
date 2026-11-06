'use server';

import { resolvePublicBusinessSlug } from '@/core/business/publicSlug';
import { db } from '@/core/database/client';
import { businessInvitations, businessTeamMembers, businesses } from '@/core/database/schema';
import { getBusinessEntitlements } from '@/core/entitlements/getBusinessEntitlements';
import { type AcceptInvitationResult, acceptBusinessInvitation } from '@/core/team/invitations';
import { isBusinessOwner } from '@/lib/permissions/checkPermission';
import type { ActionState } from '@/types/actions';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import type { InvitationInfo } from './_helpers';
import {
  assertOwnership,
  createUserAuthClient,
  generateCode,
  getTeamMemberCount,
  hashCode,
} from './_helpers';

/**
 * Generate a new invitation code for a business
 * Only the owner can call this action
 */
export async function generateInvitationCode(
  businessId: string,
): Promise<ActionState & { code?: string }> {
  // 0. Validate input
  const { businessIdParamSchema } = await import('@/features/team/schemas');
  const validation = businessIdParamSchema.safeParse({ businessId });
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0]?.message };
  }

  // 1. Verify ownership
  const ownership = await assertOwnership(businessId);
  if (ownership.error) {
    return { success: false, error: ownership.error };
  }

  const userId = ownership.userId!;

  // 2. Check entitlements (must be lite_pago or lite_plus)
  const entitlements = await getBusinessEntitlements(businessId);
  if (entitlements.maxTeamMembers <= 1) {
    return {
      success: false,
      error: 'Tu plan no incluye la función de equipos. Actualiza a Lite Pago o superior.',
    };
  }

  // 3. Check if team is at capacity
  const currentCount = await getTeamMemberCount(businessId);
  if (currentCount >= entitlements.maxTeamMembers) {
    return {
      success: false,
      error: `Has alcanzado el límite de ${entitlements.maxTeamMembers} miembros para tu plan.`,
    };
  }

  // 4. Invalidate old codes (soft delete by setting expires_at to now)
  try {
    await db
      .update(businessInvitations)
      .set({ expiresAt: new Date() })
      .where(
        and(
          eq(businessInvitations.businessId, businessId),
          or(isNull(businessInvitations.expiresAt), sql`${businessInvitations.expiresAt} > now()`),
        ),
      );
  } catch (err) {
    console.error('[generateInvitationCode] Error invalidating old codes:', err);
  }

  // 5. Generate and save new code
  const code = generateCode();
  const codeHash = await hashCode(code);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

  try {
    await db.insert(businessInvitations).values({
      businessId,
      code,
      codeHash,
      maxUses: 1, // 1 use per invitation
      usedCount: 0,
      expiresAt,
      createdBy: userId,
    });

    revalidatePath(`/${businessId}/settings`, 'page');

    return {
      success: true,
      message: 'Código de invitación generado exitosamente.',
      code,
    };
  } catch (err) {
    console.error('[generateInvitationCode] Error:', err);
    return { success: false, error: 'Error al generar el código de invitación.' };
  }
}

/**
 * Get current invitation code for a business
 */
export async function getInvitationCode(
  businessId: string,
): Promise<ActionState & { invitation?: InvitationInfo }> {
  // 0. Validate input
  const { businessIdParamSchema } = await import('@/features/team/schemas');
  const validation = businessIdParamSchema.safeParse({ businessId });
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0]?.message };
  }

  // Only owner can see the code
  const ownership = await assertOwnership(businessId);
  if (ownership.error) {
    return { success: false, error: ownership.error };
  }

  // Get the most recent active invitation
  const invitation = await db.query.businessInvitations.findFirst({
    where: and(
      eq(businessInvitations.businessId, businessId),
      or(isNull(businessInvitations.expiresAt), sql`${businessInvitations.expiresAt} > now()`),
    ),
    orderBy: (invitations, { desc }) => [desc(invitations.createdAt)],
  });

  if (!invitation) {
    return { success: true, invitation: undefined };
  }

  return {
    success: true,
    invitation: {
      code: invitation.code,
      maxUses: invitation.maxUses,
      usedCount: invitation.usedCount,
      expiresAt: invitation.expiresAt,
    },
  };
}

/**
 * Revoke/delete an invitation code
 */
export async function revokeInvitationCode(businessId: string, code: string): Promise<ActionState> {
  // 0. Validate input
  const { revokeInvitationSchema } = await import('@/features/team/schemas');
  const validation = revokeInvitationSchema.safeParse({ businessId, code });
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0]?.message };
  }

  const ownership = await assertOwnership(businessId);
  if (ownership.error) {
    return { error: ownership.error };
  }

  try {
    await db
      .update(businessInvitations)
      .set({ expiresAt: new Date() }) // Invalidate by setting expiry to now
      .where(
        and(eq(businessInvitations.code, code), eq(businessInvitations.businessId, businessId)),
      );

    revalidatePath(`/${businessId}/settings`, 'page');

    return { success: true, message: 'Código de invitación revocado.' };
  } catch (err) {
    console.error('[revokeInvitationCode] Error:', err);
    return { success: false, error: 'Error al revocar el código.' };
  }
}

/**
 * Join a team with invitation code
 * Returns info about the team and business if user has their own business
 */
export async function joinTeam(
  slug: string,
  code: string,
): Promise<
  ActionState & {
    business?: { id: string; name: string; slug: string };
    hasOwnBusiness?: boolean;
    ownBusinessId?: string;
  }
> {
  // 0. Validate input
  const { joinTeamSchema } = await import('@/features/team/schemas');
  const validation = joinTeamSchema.safeParse({ slug, code: code.toUpperCase() });
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0]?.message };
  }

  // 1. Verify user is authenticated
  const supabase = await createUserAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Debes iniciar sesión para unirte a un equipo.' };
  }

  // 2. Find business by slug
  const business = await resolvePublicBusinessSlug(slug);

  if (!business) {
    return { success: false, error: 'Negocio no encontrado. Verificá el nombre.' };
  }

  // 3. Find invitation by code AND business
  const invitation = await db.query.businessInvitations.findFirst({
    where: and(
      eq(businessInvitations.businessId, business.id),
      eq(businessInvitations.code, code.toUpperCase()),
      or(isNull(businessInvitations.expiresAt), sql`${businessInvitations.expiresAt} > now()`),
      or(
        isNull(businessInvitations.maxUses),
        sql`${businessInvitations.usedCount} < ${businessInvitations.maxUses}`,
      ),
    ),
  });

  if (!invitation) {
    return { success: false, error: 'Código de invitación inválido o expirado para este negocio.' };
  }

  // 5. Check if already a member
  const existingMembership = await db.query.businessTeamMembers.findFirst({
    where: and(
      eq(businessTeamMembers.businessId, business.id),
      eq(businessTeamMembers.userId, user.id),
    ),
  });

  if (existingMembership) {
    return { success: false, error: 'Ya eres miembro de este equipo.' };
  }

  // 6. Check if user is the owner of this business
  if (await isBusinessOwner(business.id, user.id)) {
    return { success: false, error: 'Ya eres el dueño de este negocio.' };
  }

  // 7. Check business entitlements
  const entitlements = await getBusinessEntitlements(business.id);
  if (entitlements.maxTeamMembers <= 1) {
    return { success: false, error: 'Este negocio no acepta miembros de equipo.' };
  }

  // 8. Check if team is at capacity
  const currentCount = await getTeamMemberCount(business.id);
  if (currentCount >= entitlements.maxTeamMembers) {
    return {
      success: false,
      error: `El equipo ya está completo (${entitlements.maxTeamMembers} miembros).`,
    };
  }

  // 9. Check if user has their own business
  const userOwnsBusiness = await db.query.businesses.findFirst({
    where: eq(businesses.ownerId, user.id),
    columns: { id: true },
  });

  // 10. If user has own business, return info for the webhook/modal decision
  if (userOwnsBusiness) {
    return {
      success: true,
      message: 'Tienes un negocio propio. ¿Deseas cambiarte a este equipo?',
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
      },
      hasOwnBusiness: true,
      ownBusinessId: userOwnsBusiness.id,
    };
  }

  // 11. User has no own business - proceed to join directly
  return completeJoin({
    business,
    code,
    userId: user.id,
    successMessage: `¡Bienvenido al equipo de ${business.name}!`,
  });
}

interface JoinRequest {
  business: { id: string; name: string; slug: string };
  code: string;
  userId: string;
  successMessage: string;
}

/**
 * Redeem the code and translate what the database decided into a message.
 * Shared by both entry points so a code behaves the same way whichever path
 * the user took to reach it.
 */
async function completeJoin({ business, code, userId, successMessage }: JoinRequest): Promise<
  ActionState & {
    business?: { id: string; name: string; slug: string };
    hasOwnBusiness?: boolean;
    ownBusinessId?: string;
  }
> {
  let result: AcceptInvitationResult;

  try {
    result = await acceptBusinessInvitation(business.id, code.toUpperCase(), userId);
  } catch (err) {
    console.error('[joinTeam] Error:', err);
    return { success: false, error: 'Error al unirte al equipo.' };
  }

  switch (result.status) {
    case 'joined':
      revalidatePath('/', 'page');
      return {
        success: true,
        message: successMessage,
        business: { id: business.id, name: business.name, slug: business.slug },
      };
    case 'already_member':
      return { success: false, error: 'Ya eres miembro de este equipo.' };
    case 'owner':
      return { success: false, error: 'Ya eres el dueño de este negocio.' };
    case 'unauthenticated':
      return { success: false, error: 'Debes iniciar sesión para unirte a un equipo.' };
    default:
      return {
        success: false,
        error: 'Código de invitación inválido o expirado para este negocio.',
      };
  }
}

/**
 * Confirm joining a team (after user decides to leave their own business)
 */
export async function confirmJoinTeam(code: string, ownBusinessId: string): Promise<ActionState> {
  // 0. Validate input
  const { confirmJoinTeamSchema } = await import('@/features/team/schemas');
  const validation = confirmJoinTeamSchema.safeParse({ code: code.toUpperCase(), ownBusinessId });
  if (!validation.success) {
    return { success: false, error: validation.error.issues[0]?.message };
  }

  // 1. Verify user is authenticated
  const supabase = await createUserAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'No autenticado.' };
  }

  // 2. Verify user owns the specified business
  if (!(await isBusinessOwner(ownBusinessId, user.id))) {
    return { success: false, error: 'Negocio no encontrado o no te pertenece.' };
  }

  // 3. Verify invitation code
  const invitation = await db.query.businessInvitations.findFirst({
    where: eq(businessInvitations.code, code.toUpperCase()),
    with: {
      business: {
        columns: { id: true, name: true, slug: true },
      },
    },
  });

  if (!invitation) {
    return { success: false, error: 'Código de invitación inválido.' };
  }

  // 4. Check team capacity again
  const entitlements = await getBusinessEntitlements(invitation.businessId);
  const currentCount = await getTeamMemberCount(invitation.businessId);

  if (currentCount >= entitlements.maxTeamMembers) {
    return {
      success: false,
      error: `El equipo ya está completo (${entitlements.maxTeamMembers} miembros).`,
    };
  }

  // 5. Join the team (but keep ownership of own business)
  return completeJoin({
    business: invitation.business,
    code,
    userId: user.id,
    successMessage: `Te has unido al equipo de ${invitation.business.name}. Puedes volver a tu negocio en cualquier momento.`,
  });
}
