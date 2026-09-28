// ──────────────────────────────────────────
// SASS Broadcast Notification API
// ──────────────────────────────────────────
// Uso: POST /api/sass/notifications/broadcast
// Header: x-sass-key: <SASS_API_KEY>
//
// Body:
// {
//   title: "Novedad en Store Lite",
//   message: "Ahora podés ...",
//   category: "sistema",              // opcional, default "sistema"
//   type: "system",                    // opcional, default "system"
//   target: "all" | ["business-id-1"] // "all" = todos los negocios activos
// }
// ──────────────────────────────────────────

import { env } from '@/config/env';
import { db } from '@/core/database/client';
import type { NotificationCategory, NotificationType } from '@/core/database/schema';
import { businessSubscriptions } from '@/core/database/schema';
import { createBusinessNotification } from '@/lib/notifications';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  // ── 1. Validar API key ──────────────────
  const apiKey = request.headers.get('x-sass-key');
  if (!apiKey || apiKey !== env.sassApiKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Validar body ─────────────────────
  const body: {
    title?: string;
    message?: string;
    category?: string;
    type?: string;
    target?: string | string[];
  } = await request.json().catch(() => ({}));

  if (!body.title || !body.message) {
    return NextResponse.json({ error: 'title y message son requeridos' }, { status: 400 });
  }

  const category = body.category ?? 'sistema';
  const type = body.type ?? 'system';

  // ── 3. Resolver destinatarios ───────────
  let targetBusinessIds: string[];

  if (!body.target || body.target === 'all') {
    // Todos los negocios con subscripción activa
    const subs = await db
      .select({ businessId: businessSubscriptions.businessId })
      .from(businessSubscriptions)
      .where(eq(businessSubscriptions.planStatus, 'active'));

    targetBusinessIds = subs.map((s) => s.businessId);
  } else if (Array.isArray(body.target)) {
    targetBusinessIds = body.target;
  } else {
    return NextResponse.json(
      { error: 'target debe ser "all" o un array de business IDs' },
      { status: 400 },
    );
  }

  if (targetBusinessIds.length === 0) {
    return NextResponse.json({
      sent: 0,
      message: 'No hay destinatarios para este target',
    });
  }

  // ── 4. Crear notificaciones ─────────────
  // Usamos Promise.allSettled para no fallar por completo si un negocio falla
  const results = await Promise.allSettled(
    targetBusinessIds.map((businessId) =>
      createBusinessNotification({
        businessId,
        type: type as NotificationType,
        category: category as NotificationCategory,
        title: body.title!,
        message: body.message!,
      }),
    ),
  );

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  const errors = results.filter((r) => r.status === 'rejected');

  // ── 5. Respuesta ────────────────────────
  return NextResponse.json({
    sent,
    total: targetBusinessIds.length,
    errors: errors.length,
    errorDetails:
      errors.length > 0
        ? errors.map((e) => (e as PromiseRejectedResult).reason?.message ?? 'unknown')
        : undefined,
  });
}
