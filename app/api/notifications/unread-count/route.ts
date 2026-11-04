import { resolvePublicBusinessSlug } from '@/core/business/publicSlug';
import { db } from '@/core/database/client';
import type { NotificationCategory } from '@/core/database/schema';
import { notificationCategoryEnum } from '@/core/database/schema';
import { getMemberPermissions } from '@/lib/permissions/checkPermission';
import { createClient } from '@/lib/supabase/server';
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

/**
 * GET /api/notifications/unread-count
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const businessId = searchParams.get('businessId');
  const slug = searchParams.get('slug');
  const category = searchParams.get('category');

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

  // Validar categoría
  if (category && !notificationCategoryEnum.enumValues.includes(category as NotificationCategory)) {
    return NextResponse.json({ error: 'Categoría inválida' }, { status: 400 });
  }

  try {
    let countQuery;
    if (category) {
      countQuery = sql<{ count: bigint }>`
        SELECT COUNT(*) as count
        FROM notifications
        WHERE business_id = ${resolvedBusinessId}
          AND is_read = false
          AND is_dismissed = false
          AND category = ${category as NotificationCategory}
      `;
    } else {
      countQuery = sql<{ count: bigint }>`
        SELECT COUNT(*) as count
        FROM notifications
        WHERE business_id = ${resolvedBusinessId}
          AND is_read = false
          AND is_dismissed = false
      `;
    }

    const result = await db.execute(countQuery);
    const totalUnread = Number(result[0]?.count ?? 0);

    let byCategory: Record<string, number> | undefined;

    if (!category) {
      const categoryCounts = await db.execute(
        sql<{ category: string; count: bigint }>`
          SELECT category, COUNT(*) as count
          FROM notifications
          WHERE business_id = ${resolvedBusinessId}
            AND is_read = false
            AND is_dismissed = false
          GROUP BY category
        `,
      );

      byCategory = {};
      for (const row of categoryCounts) {
        byCategory[row.category as string] = Number(row.count);
      }
    }

    return NextResponse.json({
      unreadCount: totalUnread,
      ...(byCategory && { byCategory }),
    });
  } catch (error) {
    console.error('[GET unread-count] Error:', error);
    return NextResponse.json({ error: 'Error al obtener contador' }, { status: 500 });
  }
}
