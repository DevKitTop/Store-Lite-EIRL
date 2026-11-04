import { resolvePublicBusinessSlug } from '@/core/business/publicSlug';
import { db } from '@/core/database/client';
import { businesses } from '@/core/database/schema';
import { getMemberPermissions } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

/**
 * GET /api/business/permissions
 *
 * Obtiene los permisos del usuario actual para un negocio.
 * Se puede especificar por businessId o por slug.
 *
 * Query params:
 * - businessId: UUID del negocio
 * - slug: slug del negocio
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const businessId = searchParams.get('businessId');
  const slug = searchParams.get('slug');

  // Obtener usuario actual
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  // Resolver businessId desde slug si es necesario
  let resolvedBusinessId = businessId;
  let businessInfo: { id: string; name: string; slug: string } | null = null;

  if (!resolvedBusinessId && slug) {
    const resolved = await resolvePublicBusinessSlug(slug);

    if (!resolved) {
      return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 404 });
    }

    resolvedBusinessId = resolved.id;
    businessInfo = { id: resolved.id, name: resolved.name, slug: resolved.slug };
  }

  if (!resolvedBusinessId) {
    return NextResponse.json({ error: 'Se requiere businessId o slug' }, { status: 400 });
  }

  // Obtener permisos
  const memberPermissions = await getMemberPermissions(resolvedBusinessId, user.id);

  // La proyección pública ya trae estos tres campos; solo hay que buscarlos
  // cuando el llamador pasó un businessId en vez de un slug.
  if (!businessInfo) {
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, resolvedBusinessId),
      columns: {
        id: true,
        name: true,
        slug: true,
      },
    });

    businessInfo = business ? { id: business.id, name: business.name, slug: business.slug } : null;
  }

  return NextResponse.json({
    isOwner: memberPermissions.isOwner,
    role: memberPermissions.role,
    permissions: memberPermissions.permissions,
    business: businessInfo,
  });
}
