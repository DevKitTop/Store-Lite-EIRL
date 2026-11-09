import { resolvePublicBusinessSlug } from '@/core/business/publicSlug';
import { db } from '@/core/database/client';
import { businessTeamMembers, importJobs, importRows, products } from '@/core/database/schema';
import { withTenantContext } from '@/core/database/tenant';
import { getBusinessEntitlements } from '@/core/entitlements/getBusinessEntitlements';
import { logger, toErrorDetail } from '@/lib/logger';
import { checkPermission, isBusinessOwner } from '@/lib/permissions/checkPermission';
import { createClient } from '@/lib/supabase/server';
import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { processRows } from '../lib';

interface ImportRowInput {
  name: string;
  description?: string;
  category: string;
  stock: number;
  price: number;
  status: string;
  imageUrl?: string;
  brand?: string;
  externalCode?: string;
  tags?: string[];
  secondPrice?: number;
  saleStatus?: string;
  shippingInfo?: string;
  seoTitle?: string;
  seoDescription?: string;
  metadata?: Record<string, unknown>;
}

interface CreateImportBody {
  businessSlug: string;
  rows: ImportRowInput[];
}

export async function POST(request: Request) {
  try {
    // ─── Auth ───────────────────────────────────────────────
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body: CreateImportBody = await request.json();

    if (!body.businessSlug || !body.rows?.length) {
      return NextResponse.json(
        { error: 'Faltan datos: businessSlug y rows son requeridos' },
        { status: 400 },
      );
    }

    // ─── Verify access (owner or team member with products.create) ──
    const resolved = await resolvePublicBusinessSlug(body.businessSlug);
    if (!resolved) {
      return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 404 });
    }

    const businessId = resolved.id;
    const isOwner = await isBusinessOwner(businessId, user.id);

    if (!isOwner) {
      const membership = await db.query.businessTeamMembers.findFirst({
        where: and(
          eq(businessTeamMembers.businessId, businessId),
          eq(businessTeamMembers.userId, user.id),
        ),
      });

      if (!membership) {
        return NextResponse.json({ error: 'No tienes acceso a este negocio' }, { status: 403 });
      }

      const hasPermission = await checkPermission(businessId, user.id, 'products.create');
      if (!hasPermission) {
        return NextResponse.json(
          { error: 'No tienes permiso para importar productos' },
          { status: 403 },
        );
      }
    }

    // ─── Validate plan limit ─────────────────────────────────
    const entitlements = await getBusinessEntitlements(businessId);
    if (entitlements.maxProducts !== -1) {
      const [{ count: rawCount }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(products)
        .where(eq(products.businessId, businessId));

      // rawCount puede ser string si el driver serializa bigint como string
      const currentCount = Number(rawCount) || 0;
      const totalAfterImport = currentCount + body.rows.length;
      if (totalAfterImport > entitlements.maxProducts) {
        const remaining = entitlements.maxProducts - currentCount;
        return NextResponse.json(
          {
            error:
              remaining <= 0
                ? `Has alcanzado el límite de ${entitlements.maxProducts} productos.`
                : `Solo puedes importar ${remaining} producto${remaining !== 1 ? 's' : ''} más (límite: ${entitlements.maxProducts}).`,
          },
          { status: 400 },
        );
      }
    }

    // ─── Create job ─────────────────────────────────────────
    const job = await withTenantContext({ sub: user.id }, async (tenant) => {
      const [created] = await tenant
        .insert(importJobs)
        .values({
          businessId,
          status: 'pending',
          totalRows: body.rows.length,
          fileName: body.rows.length > 0 ? `import-${Date.now()}` : null,
        })
        .returning({ id: importJobs.id });

      // ─── Insert rows ─────────────────────────────────────────
      const rowValues = body.rows.map((row, idx) => ({
        jobId: created.id,
        rowNumber: idx + 1,
        status: 'pending' as const,
        rawData: {
          name: row.name.trim(),
          description: row.description?.trim() || '',
          category: row.category.trim(),
          stock: Math.max(0, Math.trunc(Number.isFinite(row.stock) ? row.stock : 0)),
          price: Math.max(0, Number.isFinite(row.price) ? row.price : 0),
          status: row.status,
          imageUrl: row.imageUrl?.trim() || null,
          brand: row.brand?.trim() || null,
          externalCode: row.externalCode?.trim() || null,
          tags: row.tags || null,
          secondPrice: row.secondPrice !== null ? Number(row.secondPrice) : null,
          saleStatus: row.saleStatus || null,
          shippingInfo: row.shippingInfo?.trim() || null,
          seoTitle: row.seoTitle?.trim() || null,
          seoDescription: row.seoDescription?.trim() || null,
          metadata: row.metadata || {},
        },
      }));

      // Insert in batches of 500 to avoid payload limits
      const BATCH_SIZE = 500;
      for (let i = 0; i < rowValues.length; i += BATCH_SIZE) {
        await tenant.insert(importRows).values(rowValues.slice(i, i + BATCH_SIZE));
      }

      return created;
    });

    // ─── Process ALL rows synchronously ───────────────────────
    const pendingRows = await db.query.importRows.findMany({
      where: and(eq(importRows.jobId, job.id), eq(importRows.status, 'pending')),
      orderBy: (rows, { asc }) => [asc(rows.rowNumber)],
    });

    const results = await withTenantContext({ sub: user.id }, (tenant) =>
      processRows(pendingRows, businessId, tenant),
    );
    const processedCount = results.filter((r) => !r.error).length;
    const errorCount = results.filter((r) => r.error).length;

    // ─── Mark job as completed ────────────────────────────────
    await withTenantContext({ sub: user.id }, async (tenant) =>
      tenant
        .update(importJobs)
        .set({
          status: 'completed',
          processedRows: processedCount,
          errorRows: errorCount,
          completedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(importJobs.id, job.id)),
    );

    const errors = results
      .filter((r) => r.error)
      .map((r) => ({ row: r.rowNumber, error: r.error }));

    return NextResponse.json({
      jobId: job.id,
      status: 'completed',
      totalRows: body.rows.length,
      processedRows: processedCount,
      errorRows: errorCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    logger.error('[POST /api/imports/create]', { error: toErrorDetail(error) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al crear la importación' },
      { status: 500 },
    );
  }
}
