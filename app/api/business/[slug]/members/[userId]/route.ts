import { resolvePublicBusinessSlug } from '@/core/business/publicSlug';
import { db } from '@/core/database/client';
import { businessTeamMembers } from '@/core/database/schema';
import type { Permission } from '@/lib/permissions';
import { isBusinessOwner } from '@/lib/permissions/checkPermission';
import { createClient } from '@/lib/supabase/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

/**
 * PATCH /api/business/[slug]/members/[userId]
 *
 * Actualiza el rol o permisos de un miembro del equipo.
 *
 * Body:
 * - role?: 'admin' | 'member'
 * - permissions?: Permission[] (para overrides custom)
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; userId: string }> },
) {
  const { slug, userId } = await params;

  // Obtener usuario actual
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  // Obtener negocio por slug
  const business = await resolvePublicBusinessSlug(slug);

  if (!business) {
    return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 404 });
  }

  // Verificar que el usuario actual es el owner
  if (!(await isBusinessOwner(business.id, user.id))) {
    return NextResponse.json(
      { error: 'Solo el dueño puede gestionar miembros del equipo' },
      { status: 403 },
    );
  }

  // Obtener el miembro a actualizar
  const member = await db.query.businessTeamMembers.findFirst({
    where: and(
      eq(businessTeamMembers.businessId, business.id),
      eq(businessTeamMembers.userId, userId),
    ),
  });

  if (!member) {
    return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 });
  }

  // Parsear body
  const body = await request.json();
  const { role, permissions } = body;

  // Validaciones
  if (role && !['admin', 'member'].includes(role)) {
    return NextResponse.json(
      { error: 'Rol inválido. Debe ser "admin" o "member"' },
      { status: 400 },
    );
  }

  if (permissions && !Array.isArray(permissions)) {
    return NextResponse.json({ error: 'permissions debe ser un array' }, { status: 400 });
  }

  // Validar permisos si se envían
  if (permissions) {
    const { PERMISSION_LABELS } = await import('@/lib/permissions/definitions');
    const validPermissions = Object.keys(PERMISSION_LABELS);
    const invalidPermissions = permissions.filter((p: string) => !validPermissions.includes(p));
    if (invalidPermissions.length > 0) {
      return NextResponse.json(
        { error: `Permisos inválidos: ${invalidPermissions.join(', ')}` },
        { status: 400 },
      );
    }
  }

  // Actualizar
  try {
    if (role) {
      await db
        .update(businessTeamMembers)
        .set({ role })
        .where(eq(businessTeamMembers.id, member.id));
    }

    if (permissions !== undefined) {
      await db
        .update(businessTeamMembers)
        .set({ customPermissions: permissions as Permission[] })
        .where(eq(businessTeamMembers.id, member.id));
    }

    // Obtener miembro actualizado
    const updatedMember = await db.query.businessTeamMembers.findFirst({
      where: eq(businessTeamMembers.id, member.id),
      with: {
        user: {
          columns: { id: true, email: true, fullName: true, avatarUrl: true },
        },
      },
    });

    return NextResponse.json({
      success: true,
      member: updatedMember
        ? {
            id: updatedMember.id,
            userId: updatedMember.userId,
            email: updatedMember.user?.email,
            fullName: updatedMember.user?.fullName,
            avatarUrl: updatedMember.user?.avatarUrl,
            role: updatedMember.role,
            customPermissions: updatedMember.customPermissions,
            joinedAt: updatedMember.joinedAt,
          }
        : null,
    });
  } catch (error) {
    console.error('[PATCH member] Error:', error);
    return NextResponse.json({ error: 'Error al actualizar el miembro' }, { status: 500 });
  }
}

/**
 * DELETE /api/business/[slug]/members/[userId]
 *
 * Elimina un miembro del equipo.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string; userId: string }> },
) {
  const { slug, userId } = await params;

  // Obtener usuario actual
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  // Obtener negocio por slug
  const business = await resolvePublicBusinessSlug(slug);

  if (!business) {
    return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 404 });
  }

  // Verificar que el usuario actual es el owner
  if (!(await isBusinessOwner(business.id, user.id))) {
    return NextResponse.json(
      { error: 'Solo el dueño puede eliminar miembros del equipo' },
      { status: 403 },
    );
  }

  // No permitir eliminarse a sí mismo
  if (await isBusinessOwner(business.id, userId)) {
    return NextResponse.json(
      { error: 'No puedes eliminarte a ti mismo del equipo' },
      { status: 400 },
    );
  }

  try {
    await db
      .delete(businessTeamMembers)
      .where(
        and(
          eq(businessTeamMembers.businessId, business.id),
          eq(businessTeamMembers.userId, userId),
        ),
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE member] Error:', error);
    return NextResponse.json({ error: 'Error al eliminar el miembro' }, { status: 500 });
  }
}
