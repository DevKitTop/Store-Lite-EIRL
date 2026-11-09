import { db } from '@/core/database/client';
import { notifications } from '@/core/database/schema';
import { logger, toErrorDetail } from '@/lib/logger';
import { getMemberPermissions } from '@/lib/permissions/checkPermission';
import { createClient } from '@/lib/supabase/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

/**
 * PATCH /api/notifications/[id]
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  // Verificar que la notificación existe
  const notification = await db.query.notifications.findFirst({
    where: eq(notifications.id, id),
  });

  if (!notification) {
    return NextResponse.json({ error: 'Notificación no encontrada' }, { status: 404 });
  }

  // --- AUTORIZACIÓN ---
  const { role } = await getMemberPermissions(notification.businessId, user.id);
  if (!role) {
    return NextResponse.json({ error: 'No tienes acceso a esta notificación' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { isRead } = body;

    if (isRead !== undefined) {
      const updates: any = { isRead };

      if (isRead && !notification.isRead) {
        updates.readAt = new Date();
      }

      await db.update(notifications).set(updates).where(eq(notifications.id, id));
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Se requiere isRead en el body' }, { status: 400 });
  } catch (error) {
    logger.error('[PATCH notification] Error:', { error: toErrorDetail(error) });
    return NextResponse.json({ error: 'Error al actualizar la notificación' }, { status: 500 });
  }
}

/**
 * DELETE /api/notifications/[id]
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  // Verificar que la notificación existe
  const notification = await db.query.notifications.findFirst({
    where: eq(notifications.id, id),
  });

  if (!notification) {
    return NextResponse.json({ error: 'Notificación no encontrada' }, { status: 404 });
  }

  // --- AUTORIZACIÓN ---
  const { role } = await getMemberPermissions(notification.businessId, user.id);
  if (!role) {
    return NextResponse.json({ error: 'No tienes acceso a esta notificación' }, { status: 403 });
  }

  try {
    await db.update(notifications).set({ isDismissed: true }).where(eq(notifications.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[DELETE notification] Error:', { error: toErrorDetail(error) });
    return NextResponse.json({ error: 'Error al descartar la notificación' }, { status: 500 });
  }
}
