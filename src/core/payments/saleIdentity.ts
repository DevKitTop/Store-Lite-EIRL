// =====================================================
// src/core/payments/saleIdentity.ts
// =====================================================
// The CANONICAL identity of ONE paid sale (design D13/D14, spec R2).
//
// THE DEFECT THIS MODULE CLOSES
// The order flow stored its Culqi ORDER id (`ord_...`) in
// `payments.culqi_charge_id`, a column that means the Culqi CHARGE id
// (`chr_...`) and nothing else. The webhook upserted on `culqi_charge_id =
// 'chr_...'`, so it never matched the order-flow row and created a SECOND
// `payments` row for the SAME sale. Two rows meant two claim keys, so the
// stock decrement ran twice for one paid sale.
//
// THE FIX
// One sale has ONE identity, resolved the same way by every trigger:
//
//   payments.culqi_charge_id  -> the CHARGE id (`chr_...`) ONLY
//   payments.culqi_order_id   -> the ORDER  id (`ord_...`) ONLY
//
// and the link between a sale's `payments` row and its `payment_orders` row is
// the SAME-KIND equality `payments.culqi_order_id = payment_orders.culqi_order_id`.
//
// The arbiter of a sale follows its NATURE (design D13): an order-backed sale
// is arbitrated by `culqi_order_id`; a token-backed sale by `culqi_charge_id`.
// There is no third option and no "either column matches" fallback — that
// fallback is what allowed one sale to answer to two different names.
//
// This module is server-only at its edges (it reaches the DB) but its decision
// functions are pure, so the claim-set contract is trivially unit-testable.
// =====================================================

import type { SQL } from 'drizzle-orm';
import { and, eq } from 'drizzle-orm';

import { paymentOrders, payments } from '@/core/database/schema';

// =====================================================
// Public types
// =====================================================

/**
 * The identity of one paid sale.
 *
 * Both row ids are DB-derived uuids (R5) — NEVER a Culqi text id. A Culqi text
 * id would crash the uuid `stock_movements.source_id` column and the unique
 * `(source_type, source_id)` would never protect the sale.
 */
export interface SaleIdentity {
  /** The `payment_orders` row uuid — the FIRST claim slot (design D4). */
  paymentOrderId: string | null;
  /** The `payments` row uuid — the SECOND claim slot (design D4). */
  paymentId: string | null;
  /** Always DB-derived (R5) — never a client-supplied id. */
  businessId: string;
  /** The Culqi ORDER id (`ord_...`) — a resolution hint, NEVER a claim key. */
  culqiOrderId: string | null;
  /** The Culqi CHARGE id (`chr_...`) — a resolution hint, NEVER a claim key. */
  culqiChargeId: string | null;
}

/** A resolved sale plus the persisted snapshot rows it was resolved from. */
export interface ResolvedSale extends SaleIdentity {
  /** The persisted `payment_orders.metadata` — the durable cart (W-B). */
  orderMetadata: unknown;
  /** The persisted `payments.metadata` — the token flow's cart (W-A). */
  paymentMetadata: unknown;
  /** The product bound to the `payments` row (the B1 fallback). */
  productId: string | null;
}

/** One ledger claim slot: a table plus the uuid of the row that owns it. */
export interface SaleClaimKey {
  sourceType: 'payments' | 'payment_orders';
  id: string;
}

// =====================================================
// Pure decision functions
// =====================================================

/**
 * The ordered claim key set of a sale (design D4).
 *
 * The contract — stable for EVERY fulfillment trigger (charge route, webhook,
 * order flip, reconcile backstop), so any two triggers of one sale collide and
 * exactly one wins:
 *
 *   1. an order-backed sale claims `('payment_orders', paymentOrderId)` FIRST;
 *   2. then `('payments', paymentId)` when the payments row resolved;
 *   3. a token-only sale claims `('payments', paymentId)` alone.
 *
 * An identity with no resolved row id yields an EMPTY set — it fails closed.
 * It does NOT throw: the old per-anchor contract threw, and a throw here would
 * turn "we could not resolve the sale" into a 500 on a webhook that must be
 * acknowledged. The caller turns the empty set into the `unresolved` outcome.
 */
export function resolveClaimKeys(identity: SaleIdentity): SaleClaimKey[] {
  const keys: SaleClaimKey[] = [];
  if (identity.paymentOrderId) {
    keys.push({ sourceType: 'payment_orders', id: identity.paymentOrderId });
  }
  if (identity.paymentId) {
    keys.push({ sourceType: 'payments', id: identity.paymentId });
  }
  return keys;
}

/**
 * The alert scope of a sale: the FIRST claim slot, so the alert points at the
 * row that actually owns the claim (the order row for an order-backed sale,
 * the payments row for a token-backed sale).
 */
export function saleAlertScope(identity: SaleIdentity): {
  sourceType: 'payments' | 'payment_orders';
  sourceId: string | null;
} {
  if (identity.paymentOrderId) {
    return { sourceType: 'payment_orders', sourceId: identity.paymentOrderId };
  }
  if (identity.paymentId) {
    return { sourceType: 'payments', sourceId: identity.paymentId };
  }
  return { sourceType: 'payments', sourceId: null };
}

// =====================================================
// The resolver
// =====================================================

/** The hints a caller has about which sale this is. NEVER authoritative. */
export interface SaleIdentityAnchor {
  /** The Culqi ORDER id (`ord_...`). */
  culqiOrderId?: string | null;
  /** The Culqi CHARGE id (`chr_...`). */
  culqiChargeId?: string | null;
}

/** The subset of a row the resolver reads. */
export interface SaleIdentitySourceRow {
  id: string;
  businessId: string;
  metadata?: unknown;
  productId?: string | null;
  culqiOrderId?: string | null;
  culqiChargeId?: string | null;
}

/**
 * The read surface the resolver needs.
 *
 * Both `db` and a Drizzle transaction expose this shape. The concrete
 * Drizzle signatures are generic over the selected columns, so the reader is
 * narrowed with one cast at the boundary instead of leaking Drizzle's type
 * machinery into every caller.
 */
export interface SaleIdentityReader {
  query: {
    paymentOrders: {
      findFirst: (args: {
        where: SQL;
        columns?: Record<string, boolean>;
      }) => Promise<SaleIdentitySourceRow | null | undefined>;
    };
    payments: {
      findFirst: (args: {
        where: SQL;
        columns?: Record<string, boolean>;
      }) => Promise<SaleIdentitySourceRow | null | undefined>;
    };
  };
}

/**
 * `and()` is typed `SQL | undefined`; every scoped read here always has
 * conditions, so the narrowing happens in ONE place.
 */
function scoped(...conditions: SQL[]): SQL {
  return and(...conditions) as SQL;
}

export interface ResolveSaleIdentityInput {
  /** The business scope — ALWAYS required (R5). */
  businessId: string;
  /** The hints (never authoritative) about which sale this is. */
  anchor: SaleIdentityAnchor;
  /** An open transaction; when omitted the resolver opens its own on `db`. */
  tx?: unknown;
}

const ORDER_COLUMNS: Record<string, boolean> = {
  id: true,
  businessId: true,
  metadata: true,
  culqiOrderId: true,
};

const PAYMENT_COLUMNS: Record<string, boolean> = {
  id: true,
  businessId: true,
  metadata: true,
  productId: true,
  culqiChargeId: true,
  culqiOrderId: true,
};

/** Trim a text id and reject the empty string — an empty id is not a hint. */
function normalizeId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Narrow an unknown value to a plain object (never an array), or an empty
 * object. Used when MERGING a row's persisted `metadata` with the writer's
 * own metadata — the persisted shape wins for the keys it already carries.
 */
export function asMetadataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function getReader(tx: unknown): Promise<SaleIdentityReader> {
  if (tx) return tx as unknown as SaleIdentityReader;
  const { db } = await import('@/core/database/client');
  return db as unknown as SaleIdentityReader;
}

/**
 * Find the `payments` row of a sale — KIND-CORRECT (design D13).
 *
 * The caller passes ONLY the id of the sale's own kind: the ORDER id for an
 * order-backed sale, the CHARGE id for a token-backed sale. There is no
 * "match either column" fallback — that fallback is exactly what let one sale
 * answer to two different names.
 *
 * When both ids are known the ORDER id wins: the order link is the stronger
 * one (the order row is created before the charge exists).
 */
export async function findSalePaymentRow<T extends object = SaleIdentitySourceRow>(
  reader: unknown,
  input: { businessId: string; culqiOrderId?: string | null; culqiChargeId?: string | null },
  columns?: Record<string, boolean>,
): Promise<T | null> {
  const businessId = normalizeId(input.businessId);
  if (!businessId) return null;

  const queries = (reader as SaleIdentityReader).query.payments;
  const orderId = normalizeId(input.culqiOrderId);
  const chargeId = normalizeId(input.culqiChargeId);

  const find = async (where: SQL): Promise<T | null> => {
    const args = columns ? { where, columns } : { where };
    const row = await queries.findFirst(args);
    return (row as T | null | undefined) ?? null;
  };

  if (orderId) {
    const row = await find(
      scoped(eq(payments.culqiOrderId, orderId), eq(payments.businessId, businessId)),
    );
    if (row) return row;
  }

  if (chargeId) {
    const row = await find(
      scoped(eq(payments.culqiChargeId, chargeId), eq(payments.businessId, businessId)),
    );
    if (row) return row;
  }

  return null;
}

/**
 * Resolve the canonical identity of the sale these hints point at.
 *
 * The resolution order is fixed and business-scoped on EVERY read:
 *
 *   1. the `payment_orders` row by `culqi_order_id`   (business-scoped);
 *   2. the `payments` row by `culqi_charge_id`        (business-scoped);
 *   3. the `payments` row by `culqi_order_id`         (business-scoped) —
 *      the order-flow row the webhook could not match on the charge id;
 *   4. the `payment_orders` row by the payment row's own `culqi_order_id` —
 *      the reverse link, for a sale whose order hint was missing.
 *
 * Steps 3 and 4 are the SAME-KIND links. They are what make the identity
 * canonical: a sale answers to exactly one name per kind, so two triggers
 * resolving the same sale always resolve the SAME pair of row uuids and their
 * claim sets collide on the first key.
 *
 * Returns `null` when nothing resolves — the sale is unknown to this business
 * and the caller MUST fail closed (no row creation, no stock movement).
 */
export async function resolveSaleIdentity(
  input: ResolveSaleIdentityInput,
): Promise<ResolvedSale | null> {
  const businessId = normalizeId(input.businessId);
  if (!businessId) return null;

  const orderId = normalizeId(input.anchor.culqiOrderId);
  const chargeId = normalizeId(input.anchor.culqiChargeId);
  if (!orderId && !chargeId) return null;

  const reader = await getReader(input.tx);

  let order: SaleIdentitySourceRow | null | undefined = null;
  if (orderId) {
    order = await reader.query.paymentOrders.findFirst({
      where: scoped(
        eq(paymentOrders.culqiOrderId, orderId),
        eq(paymentOrders.businessId, businessId),
      ),
      columns: ORDER_COLUMNS,
    });
  }

  let payment: SaleIdentitySourceRow | null | undefined = null;
  if (chargeId) {
    payment = await reader.query.payments.findFirst({
      where: scoped(eq(payments.culqiChargeId, chargeId), eq(payments.businessId, businessId)),
      columns: PAYMENT_COLUMNS,
    });
  }

  // The order-flow row: it is keyed by the ORDER id, never by the charge id.
  if (!payment && orderId) {
    payment = await reader.query.payments.findFirst({
      where: scoped(eq(payments.culqiOrderId, orderId), eq(payments.businessId, businessId)),
      columns: PAYMENT_COLUMNS,
    });
  }

  // The reverse link: the payments row knows which order it belongs to.
  if (!order && payment?.culqiOrderId) {
    order = await reader.query.paymentOrders.findFirst({
      where: scoped(
        eq(paymentOrders.culqiOrderId, payment.culqiOrderId),
        eq(paymentOrders.businessId, businessId),
      ),
      columns: ORDER_COLUMNS,
    });
  }

  if (!order && !payment) return null;

  return {
    paymentOrderId: order?.id ?? null,
    paymentId: payment?.id ?? null,
    businessId,
    culqiOrderId: order?.culqiOrderId ?? payment?.culqiOrderId ?? orderId,
    culqiChargeId: payment?.culqiChargeId ?? chargeId,
    orderMetadata: order?.metadata ?? null,
    paymentMetadata: payment?.metadata ?? null,
    productId: payment?.productId ?? null,
  };
}
