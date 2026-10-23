// =====================================================
// src/core/payments/stockFulfillment.ts
// =====================================================
// The ONE implementation of "decrement stock for a paid sale" (NEW-8).
//
// Design: design.md D1-D7. Every fulfillment trigger (charge transaction,
// webhook charge upsert, order.status.changed flip, reconcile backstop) calls
// `fulfillPaidSale`, which claims a `stock_movements` ledger row via a
// compare-and-swap (INSERT ... ON CONFLICT DO NOTHING ... RETURNING) in the
// SAME transaction as the stock decrement (and, where already transactional,
// the paid-state write). Exactly one trigger wins per sale; the losers observe
// 0 rows and skip the decrement without failing.
//
// This module is server-only. It imports the Drizzle client lazily inside
// `fulfillPaidSale` so the pure helpers below stay trivially unit-testable and
// nothing here reaches for the network at module load.
// =====================================================

import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';

import type * as schema from '@/core/database/schema';
import { products, stockMovements } from '@/core/database/schema';
import type { SaleClaimKey, SaleIdentity } from '@/core/payments/saleIdentity';
import { resolveClaimKeys, saleAlertScope } from '@/core/payments/saleIdentity';

// The claim-key contract lives with the sale identity (design D4/D14): every
// trigger derives its key set from the SAME canonical identity, so two
// triggers of one sale always collide on the same first key. Re-exported here
// because `stockFulfillment` is the module the fulfillment contract lives in.
export { resolveClaimKeys };
export type { SaleClaimKey, SaleIdentity };

// =====================================================
// R7 watermark
// =====================================================

/**
 * The cutover instant for this change (design D7). A paid row updated BEFORE
 * this constant is history and MUST NOT be fulfilled (no retro-decrement).
 *
 * VALUE AND RATIONALE (PR3, 2026-10-22)
 * The change merged on 2026-10-22, so the cutover is `2026-10-22T00:00:00.000Z`:
 * the start of the merge day, never a prior day. Keeping it at or before the
 * merge instant is the R7 contract — a candidate set that starts later than the
 * deploy would silently skip legitimate sales. It must NOT be moved into the
 * past afterwards: any date earlier than the merge day retro-classifies rows
 * that were already paid, which is exactly the retro-fulfilment R7 forbids.
 * `tests/unit/stockFulfillment.test.ts` pins a fixed floor so a stale constant
 * fails the suite instead of leaking into production.
 *
 * Any pending row that transitions to paid AFTER this instant is always
 * fulfilled (the predicate inspects the row's status at pre-read time, not the
 * transition time) — invariant required by R7/D7.
 */
export const FULFILLMENT_WATERMARK = new Date('2026-10-22T00:00:00.000Z');

/** A paid row whose last update predates the watermark is history, not a task. */
export function isHistoricalPaidRow(row: { status: string; updatedAt: Date | string }): boolean {
  if (row.status !== 'paid') return false;
  const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) return false;
  return updatedAt.getTime() < FULFILLMENT_WATERMARK.getTime();
}

// =====================================================
// Public types
// =====================================================

export interface FulfillmentSnapshot {
  /** Exact `validateAmount` shape persisted in `payment_orders.metadata.cartItems`. */
  cartItems?: { id: string; quantity: number }[] | null;
  /** Scalar `qty` echoed back on the Culqi charge metadata (token flow). */
  qty?: number | null;
  /** The single bound product for the token flow. */
  productId?: string | null;
}

export interface FulfillmentResult {
  outcome: 'fulfilled' | 'partial' | 'already_claimed' | 'no_product' | 'unresolved';
  claimed: { sourceType: 'payments' | 'payment_orders'; id: string }[];
  items: { productId: string; quantity: number; applied: boolean }[];
  oversold: { productId: string; requested: number }[];
  b1: boolean;
}

/**
 * The transaction surface the helper writes through. This is exactly the type
 * of the callback parameter Drizzle hands to `db.transaction`, so a caller that
 * owns its own transaction passes `tx` with no cast.
 */
export type TxLike = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

// =====================================================
// Pure helpers
// =====================================================

/**
 * Recover the scalar quantity carried on the Culqi charge metadata. Returns an
 * integer >= 1, or null when nothing usable is present (the caller then applies
 * B1: qty = 1 + alert).
 */
export function readFulfillmentQty(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const raw = (metadata as { qty?: unknown }).qty;
  let parsed: number;
  if (typeof raw === 'number') {
    parsed = raw;
  } else if (typeof raw === 'string') {
    parsed = Number(raw);
  } else {
    parsed = NaN;
  }
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

/**
 * Recover the persisted cart array from a row's `metadata.cartItems`.
 *
 * This is the ONLY sanctioned way to read the multi-item snapshot:
 * - the order flow persists the FULL cart in `payment_orders.metadata.cartItems`
 *   (W-B) — the transient request cart is never trusted;
 * - the token flow's charge-route rows persist the same array in
 *   `payments.metadata.cartItems` (W-A) — the scalar `qty` the charge route
 *   echoes on the Culqi charge metadata is a DIFFERENT shape and must not be
 *   mistaken for a cart (that is the W-A defect this reader exists to close).
 *
 * Returns `null` when the row carries no usable array; the caller then applies
 * its own channel rules: the charge route's ORDER branch fails closed (the
 * backstop heals the sale), while the token branch falls back to the scalar
 * `qty` (design D6).
 */
export function readFulfillmentCartItems(
  metadata: unknown,
): { id: string; quantity: number }[] | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const raw = (metadata as { cartItems?: unknown }).cartItems;
  if (!Array.isArray(raw)) return null;

  const items: { id: string; quantity: number }[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== 'string' || id === '') continue;
    const quantity = (entry as { quantity?: unknown }).quantity;
    const parsed = typeof quantity === 'number' ? quantity : Number(quantity);
    items.push({ id, quantity: Math.max(1, Number.isFinite(parsed) ? parsed : 1) });
  }

  return items.length > 0 ? items : null;
}

/**
 * Resolve the concrete line items to decrement from a recovered snapshot
 * (design D6). Pure — no I/O — so the truth table is trivially testable.
 *
 * - `cartItems` present ⇒ one item per line (product-less = impossible, so the
 *   product bound is satisfied).
 * - otherwise the bound `productId` with the scalar `qty` (clamped to >= 1), or
 *   `qty = 1` with `b1 = true` when no snapshot exists at all.
 * - neither ⇒ product-less: no items, `productBound = false` (terminal, recorded
 *   as `no_product` so the backstop does not re-process it).
 */
export function resolveFulfillmentItems(s: FulfillmentSnapshot): {
  items: FulfillmentResult['items'];
  b1: boolean;
  productBound: boolean;
} {
  const cartItems = (s.cartItems ?? []).filter(
    (item) => item && typeof item.id === 'string' && item.id !== '',
  );
  if (cartItems.length > 0) {
    return {
      items: cartItems.map((item) => ({
        productId: item.id,
        quantity: Math.max(1, Number(item.quantity) || 1),
        applied: false,
      })),
      b1: false,
      productBound: true,
    };
  }

  const productId = typeof s.productId === 'string' && s.productId !== '' ? s.productId : null;
  if (!productId) {
    return { items: [], b1: false, productBound: false };
  }

  const scalar = typeof s.qty === 'number' && Number.isFinite(s.qty) ? s.qty : null;
  if (scalar !== null && scalar >= 1) {
    return {
      items: [{ productId, quantity: Math.floor(scalar), applied: false }],
      b1: false,
      productBound: true,
    };
  }

  // B1: product-bound but no recoverable snapshot ⇒ honest minimum of 1.
  return {
    items: [{ productId, quantity: 1, applied: false }],
    b1: true,
    productBound: true,
  };
}

// =====================================================
// The shared fulfillment routine
// =====================================================

type ClaimKey = SaleClaimKey;

interface ClaimArgs {
  tx: TxLike;
  businessId: string;
  keys: ClaimKey[];
  items: FulfillmentResult['items'];
  productBound: boolean;
  b1: boolean;
}

/** Claim the ordered key set; return the won keys, or null when already claimed. */
async function claimKeys({
  tx,
  businessId,
  keys,
  items,
  productBound,
  b1,
}: ClaimArgs): Promise<ClaimKey[] | null> {
  const claimed: ClaimKey[] = [];
  let wonFirstClaim = false;

  for (const key of keys) {
    const inserted = (await tx
      .insert(stockMovements)
      .values({
        businessId,
        sourceType: key.sourceType,
        sourceId: key.id,
        items,
        outcome: productBound ? 'fulfilled' : 'no_product',
        fallbackQty1: b1,
      })
      .onConflictDoNothing()
      .returning({ id: stockMovements.id })) as { id: string }[];

    if (inserted && inserted.length > 0) {
      if (!wonFirstClaim) {
        wonFirstClaim = true;
        claimed.push(key);
      }
    } else if (!wonFirstClaim) {
      // First key refused: the sale is already claimed. Skip everything.
      return null;
    }
    // A later key that conflicts is fine: the fulfillment is already ours.
  }
  return claimed;
}

/** Apply the conditional, business-scoped decrement; report applied items and oversells. */
async function decrementItems(
  tx: TxLike,
  businessId: string,
  items: FulfillmentResult['items'],
): Promise<{
  appliedItems: FulfillmentResult['items'];
  oversold: FulfillmentResult['oversold'];
}> {
  const oversold: FulfillmentResult['oversold'] = [];
  const appliedItems: FulfillmentResult['items'] = [];

  for (const item of items) {
    const requested = Math.max(1, item.quantity);
    const applied = (await tx
      .update(products)
      .set({ stock: sql`${products.stock} - ${requested}` })
      .where(
        and(
          eq(products.id, item.productId),
          eq(products.businessId, businessId),
          gte(products.stock, requested),
        ),
      )
      .returning({ id: products.id })) as { id: string }[];

    const didApply = Array.isArray(applied) && applied.length > 0;
    appliedItems.push({ ...item, applied: didApply });
    if (!didApply) oversold.push({ productId: item.productId, requested });
  }

  return { appliedItems, oversold };
}

interface CorrectArgs {
  tx: TxLike;
  businessId: string;
  claimed: ClaimKey[];
  items: FulfillmentResult['items'];
  oversold: FulfillmentResult['oversold'];
  b1: boolean;
}

/**
 * Correct the just-written claim(s) to the truthful `partial` outcome. The
 * claim INSERT precedes the decrement, so without this the ledger would record
 * `fulfilled` for a sale that oversold.
 *
 * The correction UPSERTS on the claim's own unique key. It mutates only the row
 * this transaction just inserted; a losing transaction returns `already_claimed`
 * before reaching here, so the upsert can never touch another transaction's row.
 * `tx.update` stays reserved for the flip + decrement (tests pin that exact
 * count). One correction per won key; fail closed if the just-written row
 * vanished.
 */
async function correctClaimOutcome({
  tx,
  businessId,
  claimed,
  items,
  oversold,
  b1,
}: CorrectArgs): Promise<void> {
  const correctedItems = items.map((item) => ({
    ...item,
    applied: !oversold.some((o) => o.productId === item.productId),
  }));

  for (const key of claimed) {
    const corrected = (await tx
      .insert(stockMovements)
      .values({
        businessId,

        sourceType: key.sourceType,
        sourceId: key.id,
        items: correctedItems,
        outcome: 'partial',
        fallbackQty1: b1,
      })
      .onConflictDoUpdate({
        target: [stockMovements.sourceType, stockMovements.sourceId],
        set: { outcome: 'partial', items: correctedItems },
        where: eq(stockMovements.businessId, businessId),
      })
      .returning({ id: stockMovements.id })) as { id: string }[];
    if (!corrected || corrected.length !== 1) {
      throw new Error('stock_movements outcome correction affected no row');
    }
  }
}

/**
 * Fulfill one paid sale: claim its ordered key set, then decrement.
 *
 * The claim is the FIRST write in the transaction (design D3). If it returns 0
 * rows the sale is already claimed — skip the decrement entirely and report
 * `already_claimed`. The ordered key set (D4) is `payment_orders` first, then
 * `payments`, so every order-backed path collides on the same first key and no
 * two triggers can each win their own key.
 *
 * The key set comes from the CANONICAL sale identity (design D14), never from a
 * per-trigger anchor: every trigger resolves the same identity, so every pair
 * of triggers of one sale collides.
 *
 * An identity that resolved NO row id yields an EMPTY key set and the sale
 * fails closed with the `unresolved` outcome — no claim, no decrement, no
 * throw. A throw here would turn "we could not resolve this sale" into a 500
 * on a webhook that must be acknowledged.
 *
 * @param identity The canonical sale identity (DB-derived row ids, R5).
 * @param snapshot The recovered snapshot (see `resolveFulfillmentItems`).
 * @param opts.tx The caller's transaction; when omitted, this opens its own.
 */
export async function fulfillPaidSale(
  identity: SaleIdentity,
  snapshot: FulfillmentSnapshot,
  opts?: { tx?: TxLike },
): Promise<FulfillmentResult> {
  const run = async (tx: TxLike): Promise<FulfillmentResult> => {
    const { items, b1, productBound } = resolveFulfillmentItems(snapshot);
    const keys = resolveClaimKeys(identity);

    // Fail closed: an unresolved sale never touches stock (design D14).
    if (keys.length === 0) {
      return { outcome: 'unresolved', claimed: [], items, oversold: [], b1 };
    }

    const claimed = await claimKeys({
      tx,
      businessId: identity.businessId,
      keys,
      items,
      productBound,
      b1,
    });
    if (claimed === null) {
      return { outcome: 'already_claimed', claimed: [], items, oversold: [], b1 };
    }

    // Product-less: the claim is terminal, no stock effect (R3).
    if (!productBound) {
      return { outcome: 'no_product', claimed, items, oversold: [], b1: false };
    }

    const { appliedItems, oversold } = await decrementItems(tx, identity.businessId, items);
    if (oversold.length > 0) {
      await correctClaimOutcome({
        tx,
        businessId: identity.businessId,
        claimed,
        items,
        oversold,
        b1,
      });
    }

    const outcome: FulfillmentResult['outcome'] = oversold.length > 0 ? 'partial' : 'fulfilled';
    return { outcome, claimed, items: appliedItems, oversold, b1 };
  };

  if (opts?.tx) return run(opts.tx);
  const { db } = await import('@/core/database/client');
  return db.transaction((tx) => run(tx));
}

// =====================================================
// Alerts (post-commit ONLY)
// =====================================================

/**
 * Emit the observable fulfillment alerts. Call this AFTER the transaction
 * commits — a rolled-back sale must never raise an incident.
 *
 * Deliberately `console.error`, NEVER `logger`/Sentry: the structured logger
 * runs `scrubPII`, whose PHONE_REGEX matches any 6-11 digit run and therefore
 * mangles UUIDs ("...446655440001" -> "...44665[REDACTED_PHONE]"), destroying
 * the businessId/productId that make these alerts actionable. Do NOT "upgrade"
 * this call until the scrubber stops corrupting identifiers (B-07).
 */
export function emitFulfillmentAlerts(
  channel: 'charge' | 'culqi-webhook' | 'reconcile',
  identity: SaleIdentity,
  result: FulfillmentResult,
): void {
  const alertScope = saleAlertScope(identity);
  const scope = {
    channel,
    businessId: identity.businessId,
    sourceType: alertScope.sourceType,
    sourceId: alertScope.sourceId,
  };

  for (const oversold of result.oversold) {
    console.error('[stockFulfillment] oversold: conditional stock decrement matched no row', {
      ...scope,
      productId: oversold.productId,
      requested: oversold.requested,
    });
  }

  if (result.b1) {
    console.error('[stockFulfillment] B1: no recoverable snapshot, decremented qty = 1', {
      ...scope,
      productId: result.items[0]?.productId ?? null,
    });
  }
}
