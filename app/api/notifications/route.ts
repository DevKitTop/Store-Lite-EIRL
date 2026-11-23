import { resolvePublicBusinessSlug } from '@/core/business/publicSlug';
import { db } from '@/core/database/client';
import {
  notificationCategoryEnum,
  notifications,
  type NewNotification,
  type NotificationCategory,
} from '@/core/database/schema';
import { logger, toErrorDetail } from '@/lib/logger';
import { isValidUuid, validateNotificationCreateBody } from '@/lib/notifications/createValidation';
import { getMemberPermissions } from '@/lib/permissions/checkPermission';
import { checkRateLimitAsync, RATE_LIMITS } from '@/lib/rateLimit';
import { isJsonRequest, isSameOriginRequest } from '@/lib/security/csrf';
import { createClient } from '@/lib/supabase/server';
import { getErrorMessage } from '@/utils/errors';
import { and, desc, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

/**
 * GET /api/notifications
 *
 * Lista notificaciones de un negocio con filtros y paginado.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const businessId = searchParams.get('businessId');
  const slug = searchParams.get('slug');
  const category = searchParams.get('category');
  const isReadParam = searchParams.get('isRead');
  const limit = Math.min(Number(searchParams.get('limit')) || 20, 100);
  const offset = Number(searchParams.get('offset')) || 0;

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

  // Validar formato UUID
  if (!isValidUuid(resolvedBusinessId)) {
    return NextResponse.json({ error: 'businessId inválido' }, { status: 400 });
  }

  // --- AUTORIZACIÓN ---
  const { role } = await getMemberPermissions(resolvedBusinessId, user.id);
  if (!role) {
    return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
  }

  // Validar categoría
  if (category && !notificationCategoryEnum.enumValues.includes(category as NotificationCategory)) {
    return NextResponse.json({ error: 'Categoría inválida' }, { status: 400 });
  }

  const isReadFilter = isReadParam === 'true' ? true : isReadParam === 'false' ? false : undefined;
  const conditions = [
    eq(notifications.businessId, resolvedBusinessId),
    eq(notifications.isDismissed, false),
  ];

  if (category) {
    conditions.push(eq(notifications.category, category as NotificationCategory));
  }

  if (isReadFilter !== undefined) {
    conditions.push(eq(notifications.isRead, isReadFilter));
  }

  try {
    // Usar una forma más simple de contar para evitar errores de tipos con Postgres.js
    const totalResult = await db
      .select({ count: sql<string>`count(*)` })
      .from(notifications)
      .where(
        and(eq(notifications.businessId, resolvedBusinessId), eq(notifications.isDismissed, false)),
      );

    const total = parseInt(totalResult[0]?.count || '0', 10);

    const results = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    return NextResponse.json({
      notifications: results,
      pagination: { total, limit, offset, hasMore: offset + results.length < total },
    });
  } catch (error: unknown) {
    const message = getErrorMessage(error, 'Error al obtener notificaciones');
    logger.error('GET notifications: critical error', {
      message,
      stack: error instanceof Error ? error.stack : undefined,
      businessId: resolvedBusinessId,
      userId: user.id,
    });

    return NextResponse.json(
      {
        error: 'Error al obtener notificaciones',
        details: process.env.NODE_ENV === 'development' ? message : undefined,
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/notifications
 *
 * Creates an inbox record only. It never triggers push fan-out: T2.5 attaches
 * fan-out to trusted server-side producers, not to this HTTP surface.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request) || !isJsonRequest(request)) {
    return NextResponse.json({ error: 'Solicitud no permitida' }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const validation = validateNotificationCreateBody(rawBody);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { businessId, type, category, title, message, data } = validation.value;

  // --- AUTORIZACIÓN PARA CREAR ---
  const { role } = await getMemberPermissions(businessId, user.id);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return NextResponse.json(
      { error: 'No tienes permiso para crear notificaciones' },
      { status: 403 },
    );
  }

  const rateLimit = await checkRateLimitAsync(
    `${user.id}:${businessId}`,
    RATE_LIMITS.notificationCreate,
  );
  if (!rateLimit.allowed) {
    const retryAfter = Math.max(1, Math.ceil(rateLimit.resetInMs / 1000));
    return NextResponse.json(
      { error: 'Demasiadas notificaciones. Inténtalo nuevamente en unos segundos.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  try {
    const newNotification: NewNotification = {
      businessId,
      type,
      category,
      title,
      message,
      data,
    };

    const [created] = await db.insert(notifications).values(newNotification).returning();

    return NextResponse.json({ success: true, notification: created });
  } catch (error) {
    logger.error('[POST notifications] Error:', { error: toErrorDetail(error) });
    return NextResponse.json({ error: 'Error al crear la notificación' }, { status: 500 });
  }
}
