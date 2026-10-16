// W-P3.2: Reconcile payments that may have been missed by webhooks
import { NextResponse } from 'next/server';

import { db } from '@/core/database/client';
import { payments } from '@/core/database/schema';
import { CulqiReadError, getCulqiOrder, isCulqiOrderPaid } from '@/core/payments/culqiOrders';
import { resolveCulqiSecretKey } from '@/core/payments/culqiSecretKey';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';

const TERMINAL_STATUSES = ['paid', 'refunded', 'failed', 'cancelled'] as const;
const RECONCILE_AGE_MINUTES = 5;

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

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RECONCILE_AGE_MINUTES * 60 * 1000);

  const candidates = await db.query.payments.findMany({
    where: and(inArray(payments.status, ['pending', 'processing']), lt(payments.createdAt, cutoff)),
    columns: {
      id: true,
      businessId: true,
      culqiChargeId: true,
      culqiOrderId: true,
      status: true,
    },
    limit: 100,
  });

  if (candidates.length === 0) {
    return NextResponse.json({ reconciled: 0 }, { status: 200 });
  }

  let reconciled = 0;

  for (const payment of candidates) {
    const businessId = payment.businessId;

    const { secretKey, error: keyError } = await resolveCulqiSecretKey(businessId);
    if (keyError) {
      continue;
    }

    let isPaid = false;

    try {
      if (payment.culqiOrderId) {
        const order = await getCulqiOrder(payment.culqiOrderId, secretKey);
        isPaid = isCulqiOrderPaid(order);
      } else if (payment.culqiChargeId) {
        // Cannot deterministically confirm paid from charge id alone with current helpers.
        // Skip to avoid false positives.
        continue;
      } else {
        continue;
      }
    } catch (err) {
      if (err instanceof CulqiReadError) {
        continue;
      }
      continue;
    }

    if (isPaid) {
      await db
        .update(payments)
        .set({ status: 'paid', updatedAt: new Date() })
        .where(
          and(eq(payments.id, payment.id), inArray(payments.status, ['pending', 'processing'])),
        );
      reconciled += 1;
    }
  }

  return NextResponse.json({ reconciled }, { status: 200 });
}
