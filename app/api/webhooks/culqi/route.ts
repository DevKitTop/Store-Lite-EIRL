import { NextResponse } from 'next/server';

import { db } from '@/core/database/client';
import { businesses, paymentOrders, payments, planPayments } from '@/core/database/schema';
import { getCulqiCharge } from '@/core/payments/culqiCharges';
import { isCulqiOrderPaid } from '@/core/payments/culqiOrders';
import { resolveCulqiSecretKey } from '@/core/payments/culqiSecretKey';
import { resolveOrderNumber } from '@/core/payments/orderNumber';
import { resolveSaleSnapshot } from '@/core/payments/reconcileFulfillment';
import { resolveSaleIdentity, type SaleIdentity } from '@/core/payments/saleIdentity';
import type { FulfillmentResult } from '@/core/payments/stockFulfillment';
import {
  emitFulfillmentAlerts,
  fulfillPaidSale,
  isHistoricalPaidRow,
} from '@/core/payments/stockFulfillment';
import { claimWebhookEvent } from '@/core/payments/webhookDedup';
import { buildWebhookPaymentValues } from '@/core/payments/webhookPaymentValues';
import { generateTrackingToken } from '@/core/utils/trackingToken';
import type { OrderStatus } from '@/types/order';
import { and, eq, or, sql } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'node:crypto';

const REPLAY_WINDOW_MS = 5 * 60 * 1000;

/**
 * The `data` member of a Culqi webhook envelope ("the affected resource").
 *
 * It carries BOTH shapes the API uses: the CHARGE object (`status`, `paid`
 * live there) and the ORDER object (`state` + `paid_at` live there, and it has
 * NO `status` property). `order_id` is the order↔charge link Culqi may supply.
 */
interface WebhookEventData {
  id?: string;
  charge_id?: string;
  reference_code?: string;
  /** CHARGE status. On an ORDER this key is fiction (see `culqiOrders.ts`). */
  status?: string;
  /** ORDER lifecycle state — the canonical payment state field. */
  state?: string;
  /** ORDER capture timestamp — non-null proves money moved. */
  paid_at?: unknown;
  /** The order this charge belongs to, when Culqi supplies the link. */
  order_id?: string;
  amount?: number;
  currency_code?: string;
  email?: string;
  metadata?: unknown;
  outcome?: { type?: string };
}

function safeTimingEquals(a: string, b: string) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

// Deduplication now uses shared DB store (webhook_events).

/**
 * Verify webhook authenticity via Basic Auth (CulqiPanel webhook configuration).
 * CulqiPanel uses username/password authentication instead of HMAC signatures.
 */
function verifyBasicAuth(request: Request): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return false;
  }

  const expectedUser = process.env.CULQI_WEBHOOK_USER;
  const expectedPass = process.env.CULQI_WEBHOOK_PASS;

  // If no credentials configured, reject in production, allow in development
  if (!expectedUser || !expectedPass) {
    return process.env.NODE_ENV !== 'production';
  }

  const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
  const [user, pass] = decoded.split(':');

  // Timing-safe comparison
  const userMatch = safeTimingEquals(user ?? '', expectedUser);
  const passMatch = safeTimingEquals(pass ?? '', expectedPass);

  return userMatch && passMatch;
}

function parseSignatureHeader(signatureHeader: string | null) {
  if (!signatureHeader) return null;

  const parts = signatureHeader.split(',').map((part) => part.trim());
  const kv = new Map<string, string>();
  for (const part of parts) {
    const [key, ...rest] = part.split('=');
    if (!key || rest.length === 0) continue;
    kv.set(key.trim().toLowerCase(), rest.join('=').trim());
  }

  const timestamp = kv.get('t') ?? kv.get('ts') ?? null;
  const signature = kv.get('v1') ?? kv.get('signature') ?? signatureHeader.trim();

  return { timestamp, signature };
}

function verifyCulqiSignature(rawBody: string, signatureHeader: string | null) {
  const secret = process.env.CULQI_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false as const, reason: 'Missing webhook secret' };
    }
    return { ok: true as const, timestamp: null };
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed?.signature) {
    return { ok: false as const, reason: 'Missing signature header' };
  }

  const expectedRaw = createHmac('sha256', secret).update(rawBody).digest('hex');
  let valid = safeTimingEquals(parsed.signature, expectedRaw);

  if (!valid && parsed.timestamp) {
    const expectedTimestamped = createHmac('sha256', secret)
      .update(`${parsed.timestamp}.${rawBody}`)
      .digest('hex');
    valid = safeTimingEquals(parsed.signature, expectedTimestamped);
  }

  if (!valid) {
    return { ok: false as const, reason: 'Invalid signature' };
  }

  if (parsed.timestamp) {
    const tsNum = Number(parsed.timestamp);
    if (Number.isFinite(tsNum)) {
      const now = Date.now();
      const timestampMs = tsNum > 1e12 ? tsNum : tsNum * 1000;
      if (Math.abs(now - timestampMs) > REPLAY_WINDOW_MS) {
        return { ok: false as const, reason: 'Expired signature timestamp' };
      }
    }
  }

  return { ok: true as const, timestamp: parsed.timestamp ?? null };
}

/**
 * Resolves the charge id for a refund event. The canonical field is
 * `data.charge_id` (chr_...); `data.id` is the refund id (ref_...) and is only
 * used as a last-resort fallback for legacy integrations.
 */
function resolveRefundChargeId(
  eventType: string,
  data: { charge_id?: string; id?: string } | undefined,
): string | undefined {
  const chargeId = data?.charge_id ?? data?.id;
  if (chargeId && !data?.charge_id) {
    console.warn(
      `[culqi-webhook] Refund event ${eventType} missing charge_id; falling back to data.id`,
    );
  }
  return chargeId;
}

/**
 * Marks a charge as refunded/failed on BOTH payment tables. Plan purchases
 * (plan_payments, S/39/79) are charged with the platform's own Culqi key,
 * so refund webhooks must update them too — otherwise plan refunds silently no-op.
 *
 * Status mapping: `refund.creation.succeeded` → 'refunded' (terminal, present in
 * both payment_status and plan_payment_status). `refund.creation.failed` → 'failed'
 * (the only sensible terminal in both enums; plan_payment_status has no
 * 'refund_requested', and the refund never completed).
 *
 * The lookup is KIND-CORRECT (design D15 #5): a refund carries a CHARGE id
 * (`chr_...`), but the sale's row is keyed by the charge id for a token-backed
 * sale and by the ORDER id (`ord_...`) for an order-backed one. Both columns
 * are therefore matched — the ORDER arm only fires when the refund event
 * actually carries an order id, because a `chr_...` can never equal one.
 */
async function applyRefundStatus(chargeId: string, status: 'refunded' | 'failed') {
  await db
    .update(payments)
    .set({ status, updatedAt: new Date() })
    .where(or(eq(payments.culqiChargeId, chargeId), eq(payments.culqiOrderId, chargeId)));
  await db
    .update(planPayments)
    .set({ status, updatedAt: new Date() })
    .where(eq(planPayments.culqiChargeId, chargeId));
}

/**
 * A scoped `payment_orders` flip that matched no row.
 *
 * The flip is the WRITE that makes a sale paid. A 0-row flip means the row we
 * pre-read is not the row we would have written (it vanished, or its business
 * scope changed). Failing open would fulfil a sale whose order was never
 * marked paid, so the transaction aborts and the route acks with a warning
 * (design D8). A genuine failure still surfaces as a 500 so Culqi retries.
 */
class FlipMissedError extends Error {
  constructor(culqiOrderId: string) {
    super(`payment_orders flip matched no row for ${culqiOrderId}`);
    this.name = 'FlipMissedError';
  }
}

/**
 * The sale the webhook resolved, as the fulfilment needs it.
 *
 * `businessId` is DB-derived whenever the database could supply it (R5) — the
 * event payload is only ever a HINT about which sale this is.
 */
interface ChargeStatusOutcome {
  /** The business scope of the sale (DB-derived whenever possible — R5). */
  businessId: string;
  /** The sale's Culqi ORDER id (`ord_...`), when it resolved. */
  culqiOrderId: string | null;
  /** The status the touched row had BEFORE this webhook wrote (R7 predicate). */
  preStatus: string | null;
  /** The `updated_at` the touched row had BEFORE this webhook wrote (R7). */
  preUpdatedAt: Date | string | null;
}

/**
 * Read `metadata.businessId` from a Culqi payload.
 *
 * The payload is a HINT, never an authority: the value only scopes the lookups
 * below and is REPLACED by the DB-derived scope as soon as a row resolves (R5).
 */
function readMetadataBusinessId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).businessId;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Resolve a Culqi ORDER event to the local `payment_orders.status` enum.
 *
 * Culqi's ORDER object carries its payment state in `state` + `paid_at` and has
 * NO `status` property — that is this repo's own contract
 * (`src/core/payments/culqiOrders.ts`), and the charge route's money gate uses
 * it verbatim. The money transition therefore requires the CANONICAL proof:
 * `isCulqiOrderPaid` (state === 'paid' OR a money timestamp in `paid_at`). A
 * payload carrying only the legacy `status: 'paid'` key DENIES, exactly like
 * the charge route denies it — the webhook must never honour a payment the
 * money gate would refuse.
 *
 * The two non-money terminals (`expired`, `cancelled`) accept the legacy
 * `status` alias: they move no money and touch no stock, so the historical
 * behaviour is preserved without weakening the money gate.
 */
function resolveOrderLifecycle(data: WebhookEventData | undefined): {
  mapped: OrderStatus | null;
  reason: 'missing' | 'unknown' | 'unproven' | null;
} {
  const canonicalState = typeof data?.state === 'string' && data.state !== '' ? data.state : null;
  const legacyStatus = typeof data?.status === 'string' && data.status !== '' ? data.status : null;
  const rawState = canonicalState ?? legacyStatus;

  if (isCulqiOrderPaid({ state: canonicalState, paid_at: data?.paid_at })) {
    return { mapped: 'paid', reason: null };
  }

  if (rawState === 'expired') return { mapped: 'expired', reason: null };
  if (rawState === 'cancelled') return { mapped: 'cancelled', reason: null };

  if (!rawState) return { mapped: null, reason: 'missing' };
  // The legacy key claims 'paid' but the canonical proof is missing.
  if (rawState === 'paid') return { mapped: null, reason: 'unproven' };
  return { mapped: null, reason: 'unknown' };
}

/**
 * Flip a Culqi order's local status and fulfil the sale it represents
 * (design D8).
 *
 * The flow is deliberately narrow:
 *   1. pre-read the `payment_orders` row — the ONLY source of a DB-derived
 *      `businessId` (R5) and of the pre-flip status/`updated_at` the R7
 *      predicate needs (D7). An unknown id keeps the historical contract:
 *      the exact `'Order not found in DB: <id>'` warning and a 200 ack;
 *   2. flip inside a transaction, business-scoped, asserted with
 *      `.returning()` — `rowCount` is `undefined` on postgres-js and would
 *      fail open (R5). A 0-row flip throws `FlipMissedError` → rollback →
 *      warn + 200;
 *   3. a PAID transition that is not history (R7) fulfils the sale from the
 *      CANONICAL identity (design D11) — the order row plus the sale's
 *      `payments` row, linked by the SAME-KIND `culqi_order_id` equality — and
 *      from the PERSISTED `metadata.cartItems` (W-B). The claim set is
 *      `payment_orders` FIRST and `payments` second (N1/D4);
 *   4. `expired` / `cancelled` flip only — zero stock effect.
 */
async function applyOrderStatusChanged(culqiOrderId: string, mapped: OrderStatus): Promise<void> {
  const preRead = await db.query.paymentOrders.findFirst({
    where: eq(paymentOrders.culqiOrderId, culqiOrderId),
    columns: {
      id: true,
      businessId: true,
      metadata: true,
      status: true,
      updatedAt: true,
    },
  });

  if (!preRead) {
    console.warn(`[culqi-webhook] Order not found in DB: ${culqiOrderId}`);
    return;
  }

  // Only a REAL state change bumps `updated_at`. Bumping it on a no-op flip
  // would drag a pre-watermark paid row PAST the watermark and let the
  // reconcile backstop fulfil it — a retro-fulfilment (R7).
  const statusChanged = preRead.status !== mapped;
  const patch = statusChanged ? { status: mapped, updatedAt: new Date() } : { status: mapped };

  let saleIdentity: SaleIdentity | null = null;
  let fulfillmentResult: FulfillmentResult | null = null;

  try {
    await db.transaction(async (tx) => {
      const flipped = await tx
        .update(paymentOrders)
        .set(patch)
        .where(
          and(
            eq(paymentOrders.culqiOrderId, culqiOrderId),
            eq(paymentOrders.businessId, preRead.businessId),
          ),
        )
        .returning({
          id: paymentOrders.id,
          businessId: paymentOrders.businessId,
          metadata: paymentOrders.metadata,
        });

      if (!flipped || flipped.length !== 1) {
        throw new FlipMissedError(culqiOrderId);
      }

      // Only a PAID transition moves stock.
      if (mapped !== 'paid') return;

      // R7 (D7): the decision is made on the PRE-READ row. A pending row that
      // transitions now is always fulfilled; a row that was ALREADY paid
      // before the watermark is history and is never fulfilled.
      if (isHistoricalPaidRow({ status: preRead.status, updatedAt: preRead.updatedAt })) return;

      // The CANONICAL identity of the sale (design D11): the order row plus
      // the sale's `payments` row, linked by the SAME-KIND equality
      // `payments.culqi_order_id = payment_orders.culqi_order_id`. The old
      // cross-kind lookup (`payments.culqi_charge_id = <order id>`) could not
      // see the order-flow row at all — that row holds the ORDER id.
      const identity = await resolveSaleIdentity({
        businessId: preRead.businessId,
        anchor: { culqiOrderId },
        tx,
      });

      if (!identity) {
        console.warn(
          `[culqi-webhook] Could not resolve the sale for order ${culqiOrderId}; no stock moved`,
        );
        return;
      }

      const snapshot = resolveSaleSnapshot({
        orderMetadata: flipped[0].metadata,
        paymentMetadata: identity.paymentMetadata,
        productId: identity.productId,
      });

      const result = await fulfillPaidSale(identity, snapshot, { tx });
      saleIdentity = identity;
      fulfillmentResult = result;
    });
  } catch (error) {
    if (error instanceof FlipMissedError) {
      console.warn(
        `[culqi-webhook] Order flip missed for ${culqiOrderId}: the scoped update matched no row`,
      );
      return;
    }
    throw error;
  }

  // Alerts are emitted POST-COMMIT only (D5).
  if (saleIdentity && fulfillmentResult) {
    emitFulfillmentAlerts('culqi-webhook', saleIdentity, fulfillmentResult);
  }
}

/**
 * Fulfill a paid sale the webhook learned about (design D9/D11).
 *
 * The snapshot comes from the PERSISTED rows, never from the event payload:
 * the Culqi charge metadata carries a scalar `qty` (and NO cart array — R1-A2),
 * so a multi-item cart can only be recovered from `metadata.cartItems` on the
 * `payment_orders` row (W-B) or on the `payments` row (W-A). The scalar `qty`
 * is only the fallback for a row that has no cart array at all.
 *
 * The CLAIM SET comes from the CANONICAL sale identity (design D11), not from
 * a per-trigger anchor: every trigger resolves the same identity, so the
 * webhook and the charge route collide on the same first key and exactly one
 * of them moves stock for the sale.
 */
async function fulfillChargeSale(chargeId: string, outcome: ChargeStatusOutcome): Promise<void> {
  // R7: a row that was ALREADY paid before the watermark is history.
  if (
    outcome.preStatus !== null &&
    isHistoricalPaidRow({
      status: outcome.preStatus,
      updatedAt: outcome.preUpdatedAt ?? new Date(),
    })
  ) {
    return;
  }

  const identity = await resolveSaleIdentity({
    businessId: outcome.businessId,
    anchor: { culqiOrderId: outcome.culqiOrderId, culqiChargeId: chargeId },
  });

  if (!identity) {
    console.warn(
      `[culqi-webhook] Could not resolve the sale for charge ${chargeId}; no stock moved`,
    );
    return;
  }

  const snapshot = resolveSaleSnapshot({
    orderMetadata: identity.orderMetadata,
    paymentMetadata: identity.paymentMetadata,
    productId: identity.productId,
  });

  // The helper opens its OWN transaction: the flip/upsert write above is
  // already committed, and R2 explicitly allows the crash window here (the
  // reconcile backstop heals it).
  const result = await fulfillPaidSale(identity, snapshot);
  emitFulfillmentAlerts('culqi-webhook', identity, result);
}

/**
 * The `payment_orders` row of a Culqi ORDER id.
 *
 * The lookup is by the Culqi ORDER id — a merchant-scoped identifier — and the
 * business scope is taken FROM the row, never from the payload (R5).
 */
async function findOrderRow(culqiOrderId: string) {
  return db.query.paymentOrders.findFirst({
    where: eq(paymentOrders.culqiOrderId, culqiOrderId),
    columns: { id: true, businessId: true, metadata: true, culqiOrderId: true },
  });
}

/**
 * The ORDER id the CHARGE belongs to, read from Culqi (design D14/A2).
 *
 * The webhook payload does not always carry `order_id`, and the charge object
 * is the authoritative source of the link. The read is BEST EFFORT by
 * contract: a missing secret key, a transport failure and a charge without an
 * order link all yield `null`, and the caller then fails closed.
 */
async function readChargeOrderId(chargeId: string, businessId: string): Promise<string | null> {
  try {
    const { secretKey } = await resolveCulqiSecretKey(businessId);
    if (!secretKey) return null;
    const charge = await getCulqiCharge(chargeId, secretKey);
    const orderId = charge.order_id;
    return typeof orderId === 'string' && orderId.trim().length > 0 ? orderId.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Applies a terminal status to a charge (W-P3.1 + design D13/D14).
 *
 * IDEMPOTENT, KIND-CORRECT, RESOLVE-THEN-ADOPT (design D13):
 * - the sale's row is resolved by `culqi_charge_id` FIRST and by
 *   `culqi_order_id` SECOND — each column only ever holds an id of its own
 *   kind, so the lookup is never "either column matches";
 * - a row that resolves is ADOPTED: the id this writer owns that the row lacks
 *   is backfilled, a non-null id is never overwritten with null, and the row's
 *   ARBITER never changes;
 * - only when NO row resolves is a row INSERTED, and then with the arbiter of
 *   the sale's NATURE: an order-backed sale is arbitrated by `culqi_order_id`,
 *   a token-backed sale by `culqi_charge_id` (design D13/I3).
 *
 * The ORDER link is resolved BEFORE any row is touched (design D14/A2). A
 * charge that cannot be attributed to a sale — no business scope and no
 * resolvable order link — is NOT written at all: the route acknowledges it with
 * 200, and the order flip (D8) plus the reconcile backstop (D10) heal the
 * sale, both of which resolve by ORDER id.
 *
 * Returns the resolved sale so the caller can fulfil it (design D9), or null
 * when no sale could be resolved (nothing to fulfil).
 */
async function applyChargeStatus(
  chargeId: string,
  status: 'paid' | 'failed',
  data: WebhookEventData | undefined,
): Promise<ChargeStatusOutcome | null> {
  const now = new Date();

  // ── 1. The sale's `payments` row, by CHARGE id first (D13). The Culqi
  //       charge id is globally unique, so a match IS this sale's row — and
  //       the row's own `business_id` is the DB-derived scope (R5).
  const existingByCharge = await db.query.payments.findFirst({
    where: eq(payments.culqiChargeId, chargeId),
    columns: {
      id: true,
      businessId: true,
      productId: true,
      culqiChargeId: true,
      culqiOrderId: true,
      metadata: true,
      status: true,
      updatedAt: true,
    },
  });

  // ── 2. The ORDER hint (D14/A4): the payload's own link first, then the
  //       row's own `culqi_order_id`.
  let orderHint = data?.order_id ?? existingByCharge?.culqiOrderId ?? null;

  // ── 3. The business scope (R5): DB-derived whenever a row can supply it.
  const metadataBusinessId = readMetadataBusinessId(data?.metadata);
  const scopeBusinessId = existingByCharge?.businessId ?? metadataBusinessId;

  // ── 4. The ORDER row. The ORDER link is resolved BEFORE any row is
  //       touched (D14/A2): the payload's `order_id` first, then the charge
  //       object's own order link — the only source that survives a payload
  //       without `order_id`.
  let orderRow = orderHint ? await findOrderRow(orderHint) : null;
  if (!orderRow && !orderHint && scopeBusinessId) {
    const chargeOrderId = await readChargeOrderId(chargeId, scopeBusinessId);
    if (chargeOrderId) {
      orderHint = chargeOrderId;
      orderRow = await findOrderRow(chargeOrderId);
    }
  }

  const businessId = orderRow?.businessId ?? scopeBusinessId;

  // ── 5. ATTRIBUTION (D14/A2). A charge that resolves to no sale at all —
  //       no business scope and no order link — is NOT written.
  if (!businessId) {
    console.warn(
      `[culqi-webhook] Charge ${chargeId} is not attributable to a sale; no payment row created`,
    );
    return null;
  }

  // ── 6. The sale's row, by ORDER id second (D13) — the order-flow row the
  //       charge id could never match, because it holds the ORDER id.
  const existingByOrder =
    orderRow && !existingByCharge
      ? await db.query.payments.findFirst({
          where: and(
            eq(payments.culqiOrderId, orderRow.culqiOrderId),
            eq(payments.businessId, orderRow.businessId),
          ),
          columns: {
            id: true,
            businessId: true,
            productId: true,
            culqiChargeId: true,
            culqiOrderId: true,
            metadata: true,
            status: true,
            updatedAt: true,
          },
        })
      : null;

  const saleRow = existingByCharge ?? existingByOrder;

  // ── 7. ADOPT the row that resolves (D13/A3). The ARBITER never changes and
  //       a non-null id is never overwritten with null: this writer only
  //       BACKFILLS the id it owns that the row lacks.
  if (saleRow) {
    const statusChanged = saleRow.status !== status;
    const patch: Partial<typeof payments.$inferInsert> = { status };
    if (statusChanged) patch.updatedAt = now;
    if (!saleRow.culqiChargeId) patch.culqiChargeId = chargeId;

    const updated = await db
      .update(payments)
      .set(patch)
      .where(eq(payments.id, saleRow.id))
      .returning({ id: payments.id });

    // The affected-row assertion is the RETURNED row — `rowCount` is
    // `undefined` on postgres-js (R5). A 0-row update means the row vanished.
    if (!updated || updated.length === 0) return null;

    return {
      businessId: saleRow.businessId,
      culqiOrderId: saleRow.culqiOrderId ?? orderRow?.culqiOrderId ?? null,
      preStatus: saleRow.status,
      preUpdatedAt: saleRow.updatedAt,
    };
  }

  // ── 8. No row resolved ⇒ INSERT, arbitrated on the ARBITER of the sale's
  //       NATURE (D13/I3).
  const owner = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { ownerId: true },
  });

  const values = buildWebhookPaymentValues({
    chargeId,
    data,
    sellerUserId: owner?.ownerId,
    trackingToken: generateTrackingToken(),
    orderNumber: resolveOrderNumber(undefined),
    culqiOrderId: orderRow?.culqiOrderId ?? null,
  });

  if (!values) {
    console.warn(
      `[culqi-webhook] Cannot create a payment row for charge ${chargeId} (missing business/product/owner); no row created`,
    );
    return null;
  }

  const inserted = await db
    .insert(payments)
    .values({ ...values, businessId, status })
    .onConflictDoUpdate({
      target: orderRow ? payments.culqiOrderId : payments.culqiChargeId,
      set: {
        status,
        updatedAt: now,
        // A3: backfill the charge id the row lacks; never overwrite a
        // non-null id with null.
        culqiChargeId: sql`coalesce(${payments.culqiChargeId}, ${chargeId})`,
      },
    })
    .returning({ id: payments.id });

  if (!inserted || inserted.length === 0) return null;

  return {
    businessId,
    culqiOrderId: values.culqiOrderId,
    preStatus: null,
    preUpdatedAt: null,
  };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!rawBody) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  // Authentication: try Basic Auth first (CulqiPanel), then HMAC signature (API)
  const hasBasicAuth = request.headers.get('Authorization')?.startsWith('Basic ');
  const hasSignatureHeader =
    request.headers.get('Culqi-Signature') ?? request.headers.get('x-culqi-signature');

  if (hasBasicAuth) {
    // CulqiPanel webhook authentication
    if (!verifyBasicAuth(request)) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
  } else if (hasSignatureHeader) {
    // HMAC signature authentication (API-created webhooks)
    const verification = verifyCulqiSignature(rawBody, hasSignatureHeader);
    if (!verification.ok) {
      return NextResponse.json({ error: verification.reason }, { status: 401 });
    }
  } else {
    // No authentication provided
    if (process.env.NODE_ENV === 'production') {
      if (process.env.CULQI_WEBHOOK_STRICT_SIGNATURE === 'true') {
        return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
      }
      console.warn('[culqi-webhook] Missing authentication in production');
    }
    // Allow in development for testing
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const event = body as {
    id?: string;
    type?: string;
    data?: WebhookEventData;
  };

  const eventType = event.type;
  // For charge events, `data.id` IS the charge id (chr_...). For refund events,
  // `data.id` is the REFUND id (ref_...) and the charge id lives in `data.charge_id`.
  const chargeId = event.data?.charge_id ?? event.data?.id;

  if (!eventType || !chargeId) {
    return NextResponse.json({ received: true });
  }

  const dedupId = event.id ?? `${eventType}:${chargeId}`;
  try {
    const claimed = await claimWebhookEvent(dedupId, eventType);
    if (!claimed) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  } catch (err) {
    console.error('[culqi-webhook] Failed to claim webhook event:', err);
    // Fail open to avoid blocking on DB issues, but prefer to dedup
  }

  try {
    switch (eventType) {
      case 'charge.paid': {
        const outcome = await applyChargeStatus(chargeId, 'paid', event.data);
        // The sale is fulfilled from the CANONICAL identity and the PERSISTED
        // snapshot (W-A/W-B). The helper opens its own transaction (design D9).
        if (outcome) {
          await fulfillChargeSale(chargeId, outcome);
        }
        break;
      }
      case 'charge.failed': {
        await applyChargeStatus(chargeId, 'failed', event.data);
        break;
      }
      // Canonical Culqi event: refund.creation.succeeded. 'refund.created' kept
      // as a backward-compatible alias for legacy integrations.
      case 'refund.creation.succeeded':
      case 'refund.created': {
        const refundChargeId = resolveRefundChargeId(eventType, event.data);
        if (!refundChargeId) break;
        await applyRefundStatus(refundChargeId, 'refunded');
        break;
      }
      case 'refund.creation.failed': {
        const refundChargeId = resolveRefundChargeId(eventType, event.data);
        if (!refundChargeId) break;
        await applyRefundStatus(refundChargeId, 'failed');
        break;
      }
      case 'order.status.changed': {
        const culqiOrderId = event.data?.id;

        if (!culqiOrderId) {
          console.warn('[culqi-webhook] Missing order ID or status in order.status.changed');
          break;
        }

        const { mapped, reason } = resolveOrderLifecycle(event.data);

        if (!mapped) {
          if (reason === 'missing') {
            console.warn('[culqi-webhook] Missing order ID or status in order.status.changed');
          } else if (reason === 'unproven') {
            // The legacy `status` key claims 'paid' but the canonical proof
            // (`state` / `paid_at`) is missing — the same money gate the charge
            // route applies denies it.
            console.warn(
              `[culqi-webhook] Order payment state unproven for ${culqiOrderId}: no canonical state/paid_at`,
            );
          } else {
            console.warn(
              `[culqi-webhook] Unknown order status: ${event.data?.state ?? event.data?.status}`,
            );
          }
          break;
        }

        await applyOrderStatusChanged(culqiOrderId, mapped);
        break;
      }
      default:
        console.warn(`[culqi-webhook] Unhandled event type: ${eventType}`);
    }
  } catch (error) {
    console.error(`[culqi-webhook] DB error processing event ${eventType}:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
