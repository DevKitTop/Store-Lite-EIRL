import { env } from '@/config/env';
import { db } from '@/core/database/client';
import { planPayments } from '@/core/database/schema';
import { requireAuthenticatedUserId } from '@/features/storage/actions/authz';
import { and, gte, lte } from 'drizzle-orm';
import { NextResponse } from 'next/server';

/**
 * /api/billing/sunat-report
 * GET ?month=04&year=2026
 *
 * Solo para administradores del SaaS.
 * El export es cross-tenant a propósito (el operador declara a SUNAT por todos
 * los negocios), por eso la autorización es la única barrera: o bien el header
 * `x-sass-key` con SASS_API_KEY (autoriza solo, sin sesión — misma semántica que
 * /api/sass/notifications/broadcast) o bien un usuario de PLATFORM_ADMIN_IDS.
 * Retorna las boletas en CSV/JSON del mes para declarar a SUNAT.
 */
export async function GET(request: Request) {
  // ── Auth check ──────────────────────────────────────────
  // La clave de servicio autoriza sin sesión; el guard `!!env.sassApiKey`
  // impide que una clave sin configurar valide un header vacío.
  const isSassScript = !!env.sassApiKey && request.headers.get('x-sass-key') === env.sassApiKey;

  if (!isSassScript) {
    let userId: string | null = null;
    try {
      userId = await requireAuthenticatedUserId();
    } catch {
      userId = null;
    }

    if (!userId || !env.platformAdminIds.includes(userId)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
  }

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const year = searchParams.get('year');

    if (!month || !year) {
      return NextResponse.json(
        { error: 'Faltan parámetros de mes (1-12) y año (YYYY)' },
        { status: 400 },
      );
    }

    const startOfMonth = new Date(Number(year), Number(month) - 1, 1);
    const endOfMonth = new Date(Number(year), Number(month), 0, 23, 59, 59, 999);

    const records = await db.query.planPayments.findMany({
      where: and(
        gte(planPayments.ticketIssuedAt, startOfMonth),
        lte(planPayments.ticketIssuedAt, endOfMonth),
      ),
      orderBy: (params, { asc }) => [asc(params.ticketCorrelative)],
      with: {
        business: {
          with: { owner: true },
        },
      },
    });

    const csvRows = [
      [
        'Fecha',
        'Serie-Correlativo',
        'Tipo Doc',
        'Nro Doc',
        'Cliente',
        'Subtotal',
        'IGV',
        'Total',
        'Moneda',
        'Estado',
      ],
    ];

    for (const record of records) {
      csvRows.push([
        record.ticketIssuedAt?.toISOString().split('T')[0] || '',
        `${record.ticketSeries}-${String(record.ticketCorrelative).padStart(8, '0')}`,
        record.buyerDocumentType || 'DNI',
        record.buyerDocumentNumber || '-',
        record.buyerFullName || record.business.owner.fullName,
        record.amountSubtotal,
        record.amountIgv,
        record.amountTotal,
        record.currency,
        record.status,
      ]);
    }

    const csvString = csvRows.map((row) => row.join(',')).join('\n');

    return new NextResponse(csvString, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="boletas-saas-${year}-${month}.csv"`,
      },
    });
  } catch (error) {
    console.error('[sunat-report] Error:', error);
    return NextResponse.json({ error: 'Error generando reporte' }, { status: 500 });
  }
}
