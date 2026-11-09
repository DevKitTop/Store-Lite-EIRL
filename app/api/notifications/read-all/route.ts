import { resolvePublicBusinessSlug } from '@/core/business/publicSlug';
import { db } from '@/core/database/client';
import { notifications } from '@/core/database/schema';
import { logger, toErrorDetail } from '@/lib/logger';
import { getMemberPermissions } from '@/lib/permissions/checkPermission';
import { createClient } from '@/lib/supabase/server';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

/**
 * PUT /api/notifications/read-all
 *
 * Marca todas las notificaciones de un negocio como leídas.
 */
export async function PUT(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('businessId');
    const slug = searchParams.get('slug');

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    // Resolver businessId
    let resolvedBusinessId = businessId;
    if (!resolvedBusinessId && slug) {
      const resolved = await resolvePublicBusinessSlug(slug);
      if (!resolved) {
        return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 404 });
      }
      resolvedBusinessId = resolved.id;
    }

    if (!resolvedBusinessId) {
      return NextResponse.json({ error: 'Se requiere businessId o slug' }, { status: 400 });
    }

    // --- AUTORIZACIÓN ---
    const { role } = await getMemberPermissions(resolvedBusinessId, user.id);
    if (!role) {
      return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
    }

    // Actualizar todas las no leídas del negocio
    await db
      .update(notifications)
      .set({
        isRead: true,
        readAt: new Date(),
      })
      .where(
        and(
          eq(notifications.businessId, resolvedBusinessId),
          eq(notifications.isRead, false),
          eq(notifications.isDismissed, false),
        ),
      );

    return NextResponse.json({
      success: true,
      message: 'Todas las notificaciones marcadas como leídas',
    });
  } catch (error) {
    logger.error('[PUT read-all] Error:', { error: toErrorDetail(error) });
    return NextResponse.json({ error: 'Error al marcar todas como leídas' }, { status: 500 });
  }
}
