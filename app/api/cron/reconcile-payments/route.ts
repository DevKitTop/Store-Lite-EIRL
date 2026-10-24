// =====================================================
// app/api/cron/reconcile-payments/route.ts
// =====================================================
// W-P3.2: reconcile payments whose confirmation webhook was lost.
// A Culqi `charge.paid` webhook that out-races the charge route's INSERT (or a
// dropped delivery) leaves a `pending` payment forever. This cron re-reads the
// charge from Culqi and settles the row idempotently.
//
// NEW-8 / design D10: the route runs TWO passes:
//   1. the settlement pass — a `pending` payment whose Culqi charge is already
//      paid is marked `paid` (unchanged behaviour);
//   2. the fulfillment backstop — every PAID sale that is not claimed yet is
//      fulfilled through the shared `fulfillPaidSale` helper, so a sale that
//      every other trigger missed is still decremented exactly once.
//
// Auth mirrors app/api/cron/order-timeouts: shared secret via `x-cron-secret`.
// A Bearer token (`Authorization: Bearer <CRON_SECRET>`) is ALSO accepted, so
// a scheduler that can only set an Authorization header can trigger the route.
// The check is ADDITIVE: either header authenticates, neither weakens the
// secret comparison (still timing-safe).
//
// Unlike the other crons this one queries with a `GET`, so it is reachable both
// as GET (cron schedulers) and POST (manual/ops trigger).
// =====================================================

import { NextResponse } from 'next/server';

import { db } from '@/core/database/client';
import { paymentOrders, payments } from '@/core/database/schema';
import { getCulqiCharge, isCulqiChargePaid } from '@/core/payments/culqiCharges';
import { getCulqiOrder, isCulqiOrderPaid } from '@/core/payments/culqiOrders';
import { resolveCulqiSecretKey } from '@/core/payments/culqiSecretKey';
import { claimedSaleFilter, resolveSaleSnapshot } from '@/core/payments/reconcileFulfillment';
import type { ResolvedSale, SaleIdentity } from '@/core/payments/saleIdentity';
import { resolveClaimKeys } from '@/core/payments/saleIdentity';
import {
  emitFulfillmentAlerts,
  FULFILLMENT_WATERMARK,
  fulfillPaidSale,
} from '@/core/payments/stockFulfillment';
import { and, eq, gte, isNotNull, lt, or } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';

// A payment younger than this may still be mid-flight (the charge route's own
// insert runs seconds after Culqi captures) so it is left alone.
const RECONCILE_AGE_MINUTES = 5;
const MAX_PER_RUN = 100;

/** Read the bearer token from the Authorization header, if there is one. */
function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/** Timing-safe comparison of two secrets. Length mismatch is a mismatch. */
function secretsMatch(provided: string, expected: string): boolean {
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

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return false;
  }

  const headerSecret = request.headers.get('x-cron-secret');
  if (headerSecret && secretsMatch(headerSecret, expected)) {
    return true;
  }

  const bearerToken = readBearerToken(request);
  if (bearerToken && secretsMatch(bearerToken, expected)) {
    return true;
  }

  return false;
}

async function reconcile() {
  const cutoff = new Date(Date.now() - RECONCILE_AGE_MINUTES * 60 * 1000);

  // A pending row is settled through the id of its OWN kind (design D15 #4):
  // a CHARGE id (`chr_...`) ⇒ `getCulqiCharge`, an ORDER id (`ord_...`) ⇒
  // `getCulqiOrder`. The old query only looked at `culqi_charge_id`, so every
  // order-backed sale was invisible to the settlement pass and stayed
  // `pending` forever.
  const candidates = await db.query.payments.findMany({
    where: and(
      eq(payments.status, 'pending'),
      or(isNotNull(payments.culqiChargeId), isNotNull(payments.culqiOrderId)),
      lt(payments.createdAt, cutoff),
    ),
    columns: { id: true, businessId: true, culqiChargeId: true, culqiOrderId: true },
    limit: MAX_PER_RUN,
  });

  let reconciled = 0;
  let skipped = 0;

  for (const payment of candidates) {
    const { secretKey, error: keyError } = await resolveCulqiSecretKey(payment.businessId);
    if (keyError) {
      skipped += 1;
      continue;
    }

    let paid = false;
    try {
      if (payment.culqiChargeId) {
        paid = isCulqiChargePaid(await getCulqiCharge(payment.culqiChargeId, secretKey));
      } else if (payment.culqiOrderId) {
        paid = isCulqiOrderPaid(await getCulqiOrder(payment.culqiOrderId, secretKey));
      } else {
        // No id of any kind: nothing to read, nothing to settle.
        skipped += 1;
        continue;
      }
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

// =====================================================
// The fulfillment backstop (NEW-8 / design D10)
// =====================================================

/** One paid sale the backstop may fulfil. */
interface FulfillmentSale extends ResolvedSale {
  updatedAt: Date | string;
}

/**
 * Collect the paid sales that are still unclaimed, one entry per SALE.
 *
 * The two candidate reads look at the two sides of a sale; the persisted link
 * (the SAME-KIND `culqi_order_id` equality + the business) is what joins them.
 * A sale found through both sides is collected ONCE, from the order row — the
 * side that carries the persisted cart and the first claim key.
 */
async function collectFulfillmentSales(): Promise<FulfillmentSale[]> {
  const paymentRows = await db.query.payments.findMany({
    where: and(
      eq(payments.status, 'paid'),
      gte(payments.updatedAt, FULFILLMENT_WATERMARK),
      claimedSaleFilter('payments'),
    ),
    columns: {
      id: true,
      businessId: true,
      productId: true,
      culqiChargeId: true,
      culqiOrderId: true,
      metadata: true,
      updatedAt: true,
    },
    orderBy: payments.updatedAt,
    limit: MAX_PER_RUN,
  });

  const orderRows = await db.query.paymentOrders.findMany({
    where: and(
      eq(paymentOrders.status, 'paid'),
      gte(paymentOrders.updatedAt, FULFILLMENT_WATERMARK),
      claimedSaleFilter('payment_orders'),
    ),
    columns: {
      id: true,
      businessId: true,
      culqiOrderId: true,
      metadata: true,
      updatedAt: true,
    },
    orderBy: paymentOrders.updatedAt,
    limit: MAX_PER_RUN,
  });

  const sales = new Map<string, FulfillmentSale>();
  const salesByPaymentId = new Map<string, FulfillmentSale>();

  // The order rows first: they carry the persisted cart (W-B) and their uuid is
  // the FIRST claim key of an order-backed sale (N1).
  for (const order of orderRows) {
    // The SAME-KIND link (design D15 #6): the sale's `payments` row carries the
    // ORDER id in `culqi_order_id` — the charge id would never match.
    const linkedPayment = await db.query.payments.findFirst({
      where: and(
        eq(payments.culqiOrderId, order.culqiOrderId),
        eq(payments.businessId, order.businessId),
      ),
      columns: { id: true, productId: true, metadata: true, culqiChargeId: true },
    });

    const sale: FulfillmentSale = {
      paymentOrderId: order.id,
      paymentId: linkedPayment?.id ?? null,
      businessId: order.businessId,
      culqiOrderId: order.culqiOrderId,
      culqiChargeId: linkedPayment?.culqiChargeId ?? null,
      orderMetadata: order.metadata,
      paymentMetadata: linkedPayment?.metadata ?? null,
      productId: linkedPayment?.productId ?? null,
      updatedAt: order.updatedAt,
    };

    sales.set(order.id, sale);
    if (sale.paymentId) {
      salesByPaymentId.set(sale.paymentId, sale);
    }
  }

  // Then the payment rows that no order row already covers. The reverse index
  // makes the dedupe independent of WHICH side resolved the persisted link: a
  // sale collected from its order row is never collected again from its payment
  // row.
  for (const payment of paymentRows) {
    if (salesByPaymentId.has(payment.id)) {
      continue;
    }

    // The SAME-KIND link, in the other direction.
    const linkedOrder = payment.culqiOrderId
      ? await db.query.paymentOrders.findFirst({
          where: and(
            eq(paymentOrders.culqiOrderId, payment.culqiOrderId),
            eq(paymentOrders.businessId, payment.businessId),
          ),
          columns: { id: true, culqiOrderId: true, metadata: true },
        })
      : null;

    const saleKey = linkedOrder ? linkedOrder.id : `payments:${payment.id}`;
    if (sales.has(saleKey)) continue;

    const sale: FulfillmentSale = {
      paymentOrderId: linkedOrder?.id ?? null,
      paymentId: payment.id,
      businessId: payment.businessId,
      culqiOrderId: linkedOrder?.culqiOrderId ?? payment.culqiOrderId ?? null,
      culqiChargeId: payment.culqiChargeId ?? null,
      orderMetadata: linkedOrder?.metadata ?? null,
      paymentMetadata: payment.metadata,
      productId: payment.productId,
      updatedAt: payment.updatedAt,
    };

    sales.set(saleKey, sale);
    salesByPaymentId.set(payment.id, sale);
  }

  return [...sales.values()]
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    .slice(0, MAX_PER_RUN);
}

/**
 * Fulfil every unclaimed paid sale through the shared helper.
 *
 * The helper owns the claim (the compare-and-swap on the `stock_movements`
 * ledger) and the decrement, so the backstop cannot double-decrement a sale
 * another trigger already claimed: it observes `already_claimed` and skips.
 */
async function reconcileFulfillment(): Promise<{
  fulfilled: number;
  fulfillmentSkipped: number;
  fulfillmentScanned: number;
}> {
  const sales = await collectFulfillmentSales();

  let fulfilled = 0;
  let fulfillmentSkipped = 0;

  for (const sale of sales) {
    // The CANONICAL identity of the sale (design D11/D14). Every trigger
    // resolves the SAME identity, so the backstop collides with them on the
    // same first claim key and exactly one of them moves the stock.
    const identity: SaleIdentity = {
      paymentOrderId: sale.paymentOrderId,
      paymentId: sale.paymentId,
      businessId: sale.businessId,
      culqiOrderId: sale.culqiOrderId,
      culqiChargeId: sale.culqiChargeId,
    };

    // No resolved row id means no safe claim key (design D4): fail closed.
    if (resolveClaimKeys(identity).length === 0) {
      fulfillmentSkipped += 1;
      continue;
    }

    try {
      const result = await fulfillPaidSale(
        identity,
        resolveSaleSnapshot({
          orderMetadata: sale.orderMetadata,
          paymentMetadata: sale.paymentMetadata,
          productId: sale.productId,
        }),
      );

      emitFulfillmentAlerts('reconcile', identity, result);

      if (result.outcome === 'fulfilled' || result.outcome === 'partial') {
        fulfilled += 1;
      } else {
        fulfillmentSkipped += 1;
      }
    } catch (error) {
      // One bad sale must never abort the run: log it and keep going.
      fulfillmentSkipped += 1;
      console.error('[reconcile-payments] fulfillment failed for a paid sale', {
        businessId: sale.businessId,
        paymentOrderId: sale.paymentOrderId,
        paymentId: sale.paymentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { fulfilled, fulfillmentSkipped, fulfillmentScanned: sales.length };
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await reconcile();
  const fulfillment = await reconcileFulfillment();

  return NextResponse.json(
    {
      reconciled: result.reconciled,
      skipped: result.skipped,
      scanned: result.scanned,
      fulfilled: fulfillment.fulfilled,
      fulfillmentSkipped: fulfillment.fulfillmentSkipped,
      fulfillmentScanned: fulfillment.fulfillmentScanned,
    },
    { status: 200 },
  );
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
