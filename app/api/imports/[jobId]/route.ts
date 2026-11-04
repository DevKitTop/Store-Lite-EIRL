import { db } from '@/core/database/client';
import { importJobs, importRows } from '@/core/database/schema';
import { logError } from '@/lib/errorHandling';
import { isBusinessOwner } from '@/lib/permissions/checkPermission';
import { createClient } from '@/lib/supabase/server';
import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { CHUNK_SIZE, processRows } from '../lib';

// ─── GET: poll progress + process next chunk ────────────────────────────────

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await params;

    // ─── Auth ───────────────────────────────────────────────
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    // ─── Fetch job ──────────────────────────────────────────
    const job = await db.query.importJobs.findFirst({
      where: eq(importJobs.id, jobId),
    });

    if (!job) {
      return NextResponse.json({ error: 'Trabajo no encontrado' }, { status: 404 });
    }

    // ─── Verify business ownership ──────────────────────────
    // Ownership comes from the definer function: the business row is no longer
    // readable through a helper, and this route must not be the exception.
    if (!(await isBusinessOwner(job.businessId, user.id))) {
      return NextResponse.json({ error: 'No tienes acceso a este trabajo' }, { status: 403 });
    }

    // ─── If terminal state, return immediately ──────────────
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return NextResponse.json({
        jobId: job.id,
        status: job.status,
        totalRows: job.totalRows,
        processedRows: job.processedRows,
        errorRows: job.errorRows,
        completedAt: job.completedAt,
      });
    }

    // ─── Transition to 'processing' if still 'pending' ──────
    if (job.status === 'pending') {
      await db
        .update(importJobs)
        .set({ status: 'processing', updatedAt: sql`now()` })
        .where(eq(importJobs.id, jobId));
    }

    // ─── Grab next pending chunk ────────────────────────────
    const pendingRows = await db.query.importRows.findMany({
      where: and(eq(importRows.jobId, jobId), eq(importRows.status, 'pending')),
      limit: CHUNK_SIZE,
      orderBy: (rows, { asc }) => [asc(rows.rowNumber)],
    });

    if (pendingRows.length === 0) {
      // All done
      await db
        .update(importJobs)
        .set({
          status: 'completed',
          completedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(importJobs.id, jobId));

      return NextResponse.json({
        jobId: job.id,
        status: 'completed',
        totalRows: job.totalRows,
        processedRows: job.processedRows,
        errorRows: job.errorRows,
        completedAt: new Date().toISOString(),
      });
    }

    // ─── Process chunk ──────────────────────────────────────
    const results = await processRows(pendingRows, job.businessId);
    const processedCount = results.filter((r) => !r.error).length;
    const errorCount = results.filter((r) => r.error).length;

    // Update job counters atomically
    const [updated] = await db
      .update(importJobs)
      .set({
        processedRows: sql`processed_rows + ${processedCount}`,
        errorRows: sql`error_rows + ${errorCount}`,
        updatedAt: sql`now()`,
      })
      .where(eq(importJobs.id, jobId))
      .returning({
        processedRows: importJobs.processedRows,
        errorRows: importJobs.errorRows,
        totalRows: importJobs.totalRows,
        status: importJobs.status,
      });

    const firstError = results.find((r) => r.error)?.error ?? null;

    return NextResponse.json({
      jobId: job.id,
      status: updated.status,
      totalRows: updated.totalRows,
      processedRows: updated.processedRows,
      errorRows: updated.errorRows,
      chunkProcessed: pendingRows.length,
      firstError,
    });
  } catch (error) {
    logError('[GET /api/imports/[jobId]]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al procesar importación' },
      { status: 500 },
    );
  }
}
