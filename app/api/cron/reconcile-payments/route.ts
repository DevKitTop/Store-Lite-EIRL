// =====================================================
// app/api/cron/reconcile-payments/route.ts
// =====================================================
// W-P3.2: reconcile payments whose confirmation webhook was lost.
// A Culqi `charge.paid` webhook that out-races the charge route's INSERT (or a
// dropped delivery) leaves a `pending` payment forever. This cron re-reads the
// charge from Culqi and settles the row idempotently.
//
// Auth mirrors app/api/cron/order-timeouts: shared secret via `x-cron-secret`.
// Unlike the other crons this one queries with a `GET`, so it is reachable both
// as GET (cron schedulers) and POST (manual/ops trigger).
// =====================================================

import { NextResponse } from 'next/server';

import { db } from '@/core/database/client';
import { payments } from '@/core/database/schema';
import { getCulqiCharge, isCulqiChargePaid } from '@/core/payments/culqiCharges';
import { resolveCulqiSecretKey } from '@/core/payments/culqiSecretKey';
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';

// A payment younger than this may still be mid-flight (the charge route's own
// insert runs seconds after Culqi captures) so it is left alone.
const RECONCILE_AGE_MINUTES = 5;
const MAX_PER_RUN = 100;

function isAuthorized(request: Request): boolean {
  const provided = request.headers.get('x-cron-secret');
  const expected = process.env.CRON_SECRET;

  if (!provided || !expected) {
    return false;
  }

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);

  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  try {
    return timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

async function reconcile() {
  const cutoff = new Date(Date.now() - RECONCILE_AGE_MINUTES * 60 * 1000);

  const candidates = await db.query.payments.findMany({
    where: and(
      eq(payments.status, 'pending'),
      isNotNull(payments.culqiChargeId),
      lt(payments.createdAt, cutoff),
    ),
    columns: { id: true, businessId: true, culqiChargeId: true },
    limit: MAX_PER_RUN,
  });

  let reconciled = 0;
  let skipped = 0;

  for (const payment of candidates) {
    const chargeId = payment.culqiChargeId;
    if (!chargeId) {
      skipped += 1;
      continue;
    }

    const { secretKey, error: keyError } = await resolveCulqiSecretKey(payment.businessId);
    if (keyError) {
      skipped += 1;
      continue;
    }

    let paid = false;
    try {
      paid = isCulqiChargePaid(await getCulqiCharge(chargeId, secretKey));
    } catch {
      // A read fault is non-deterministic: leave the row untouched and retry
      // on the next run rather than guess at the money state.
      skipped += 1;
      continue;
    }

    if (!paid) {
      skipped += 1;
      continue;
    }

    const updated = await db
      .update(payments)
      .set({ status: 'paid', updatedAt: new Date() })
      .where(and(eq(payments.id, payment.id), eq(payments.status, 'pending')))
      .returning({ id: payments.id });

    if (updated.length > 0) {
      reconciled += 1;
    } else {
      skipped += 1;
    }
  }

  return { reconciled, skipped, scanned: candidates.length };
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await reconcile();
  return NextResponse.json(result, { status: 200 });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
