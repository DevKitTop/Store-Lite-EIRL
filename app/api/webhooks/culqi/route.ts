import { NextResponse } from 'next/server';

import { db } from '@/core/database/client';
import { businesses, paymentOrders, payments, planPayments } from '@/core/database/schema';
import { resolveOrderNumber } from '@/core/payments/orderNumber';
import { buildWebhookPaymentValues } from '@/core/payments/webhookPaymentValues';
import { generateTrackingToken } from '@/core/utils/trackingToken';
import type { OrderStatus } from '@/types/order';
import { eq } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'node:crypto';

const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const DEDUP_TTL_MS = 10 * 60 * 1000;
const seenEvents = new Map<string, number>();

function safeTimingEquals(a: string, b: string) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function cleanupSeenEvents(now: number) {
  for (const [key, expiresAt] of seenEvents.entries()) {
    if (expiresAt <= now) {
      seenEvents.delete(key);
    }
  }
}

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
 */
async function applyRefundStatus(chargeId: string, status: 'refunded' | 'failed') {
  await db
    .update(payments)
    .set({ status, updatedAt: new Date() })
    .where(eq(payments.culqiChargeId, chargeId));
  await db
    .update(planPayments)
    .set({ status, updatedAt: new Date() })
    .where(eq(planPayments.culqiChargeId, chargeId));
}

/**
 * Applies a terminal status to a charge (W-P3.1).
 *
 * Idempotent UPSERT keyed on `payments.culqiChargeId`:
 * - Row already exists → UPDATE its status (the previous, correct behaviour).
 * - Row not yet present → the webhook out-raced the charge route's insert (or
 *   the payment was created out-of-band). INSERT a complete row so the
 *   confirmation is not lost. The conflict target also makes a duplicate
 *   delivery safe.
 *
 * When the payload cannot yield a valid row (no resolvable business/product,
 * missing owner, or bad amount) the builder returns null and we fall back to
 * update-only, warning loudly so the gap is observable.
 */
async function applyChargeStatus(
  chargeId: string,
  status: 'paid' | 'failed',
  data:
    | {
        id?: string;
        amount?: number;
        currency_code?: string;
        email?: string;
        reference_code?: string;
        metadata?: unknown;
      }
    | undefined,
) {
  const now = new Date();

  const existing = await db.query.payments.findFirst({
    where: eq(payments.culqiChargeId, chargeId),
    columns: { id: true },
  });

  if (existing) {
    await db
      .update(payments)
      .set({ status, updatedAt: now })
      .where(eq(payments.culqiChargeId, chargeId));
    return;
  }

  const businessId = (() => {
    const metadata = data?.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const value = (metadata as Record<string, unknown>).businessId;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  })();

  const owner = businessId
    ? await db.query.businesses.findFirst({
        where: eq(businesses.id, businessId),
        columns: { ownerId: true },
      })
    : null;

  const values = buildWebhookPaymentValues({
    chargeId,
    data,
    sellerUserId: owner?.ownerId,
    trackingToken: generateTrackingToken(),
    orderNumber: resolveOrderNumber(undefined),
  });

  if (!values) {
    console.warn(
      `[culqi-webhook] Cannot upsert payment for charge ${chargeId} (missing business/product/owner); applied update-only`,
    );
    await db
      .update(payments)
      .set({ status, updatedAt: now })
      .where(eq(payments.culqiChargeId, chargeId));
    return;
  }

  await db
    .insert(payments)
    .values({ ...values, status })
    .onConflictDoUpdate({
      target: payments.culqiChargeId,
      set: { status, updatedAt: now },
    });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!rawBody) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  // Authentication: try Basic Auth first (CulqiPanel), then HMAC signature (API)
  const hasBasicAuth = request.headers.get('Authorization')?.startsWith('Basic ');
  const hasSignatureHeader = request.headers.get('Culqi-Signature');

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
      return NextResponse.json({ error: 'Missing authentication' }, { status: 401 });
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
    data?: {
      id?: string;
      charge_id?: string;
      reference_code?: string;
      status?: string;
      amount?: number;
      currency_code?: string;
      email?: string;
      metadata?: unknown;
      outcome?: { type?: string };
    };
  };

  const eventType = event.type;
  // For charge events, `data.id` IS the charge id (chr_...). For refund events,
  // `data.id` is the REFUND id (ref_...) and the charge id lives in `data.charge_id`.
  const chargeId = event.data?.charge_id ?? event.data?.id;

  if (!eventType || !chargeId) {
    return NextResponse.json({ received: true });
  }

  const dedupId = event.id ?? `${eventType}:${chargeId}`;
  const now = Date.now();
  cleanupSeenEvents(now);
  if (seenEvents.has(dedupId)) {
    return NextResponse.json({ received: true, duplicate: true });
  }
  seenEvents.set(dedupId, now + DEDUP_TTL_MS);

  try {
    switch (eventType) {
      case 'charge.paid': {
        await applyChargeStatus(chargeId, 'paid', event.data);
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
        const orderStatus = event.data?.status;
        const culqiOrderId = event.data?.id;

        if (!culqiOrderId || !orderStatus) {
          console.warn('[culqi-webhook] Missing order ID or status in order.status.changed');
          break;
        }

        const statusMap: Record<string, OrderStatus> = {
          paid: 'paid',
          expired: 'expired',
          cancelled: 'cancelled',
        };

        const mapped = statusMap[orderStatus];
        if (!mapped) {
          console.warn(`[culqi-webhook] Unknown order status: ${orderStatus}`);
          break;
        }

        const result = (await db
          .update(paymentOrders)
          .set({ status: mapped, updatedAt: new Date() })
          .where(eq(paymentOrders.culqiOrderId, culqiOrderId))) as unknown as {
          rowCount: number;
        };

        if (!result?.rowCount || result.rowCount === 0) {
          console.warn(`[culqi-webhook] Order not found in DB: ${culqiOrderId}`);
        }
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
