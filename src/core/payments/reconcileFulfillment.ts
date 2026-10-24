// =====================================================
// src/core/payments/reconcileFulfillment.ts
// =====================================================
// The reconcile backstop's two pure pieces (NEW-8, design D10 / spec R4):
//   - `claimedSaleFilter` — the candidate predicate: a paid sale is a candidate
//     only when NEITHER of its claim keys has been claimed yet;
//   - `resolveSaleSnapshot` — the snapshot recovery (the persisted cart array
//     first, the scalar `qty` only as the fallback).
//
// Both are pure: no I/O, no transaction. The route owns the reads and the
// fulfillment call.
//
// WHY THE PREDICATE IS OVER THE SALE, NOT OVER ONE ROW
// The claim key set of a sale is ORDERED (design D4): an order-backed sale
// claims ('payment_orders', uuid) FIRST and then ('payments', uuid). A trigger
// that only looked at ITS OWN row would re-select a sale whose sibling key was
// already claimed, and would then race the other trigger for the same stock.
// The predicate therefore excludes a sale when EITHER key is already present in
// the `stock_movements` ledger — the same key set every other trigger claims.
//
// The sibling row is resolved through the PERSISTED SAME-KIND link
// (`payments.culqi_order_id = payment_orders.culqi_order_id` plus the
// business), never through a client-supplied value, so the predicate is
// business-scoped (R5) and cannot leak another business's sale.
// =====================================================

import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import { paymentOrders, payments, stockMovements } from '@/core/database/schema';
import type { FulfillmentSnapshot } from '@/core/payments/stockFulfillment';
import { readFulfillmentCartItems, readFulfillmentQty } from '@/core/payments/stockFulfillment';

/** Which table the candidate is read from — the trigger's own side of the sale. */
export type FulfillmentCandidateSource = 'payments' | 'payment_orders';

/**
 * The candidate predicate for one side of a sale.
 *
 * A paid row is a candidate only when the sale has NOT been claimed yet: the
 * ledger must contain NEITHER ('payment_orders', <order uuid>) NOR ('payments',
 * <payment uuid>). Both slots are checked, so the backstop and the other
 * triggers collide on the SAME keys and exactly one of them wins the sale.
 *
 * The sibling row is found through the SAME-KIND link (design D15 #6):
 * `payments.culqi_order_id = payment_orders.culqi_order_id`. The old
 * cross-kind link (`payments.culqi_charge_id = <order id>`) could not see the
 * order-flow row at all — that row holds the ORDER id — so the backstop
 * treated one sale as two independent sales.
 */
export function claimedSaleFilter(source: FulfillmentCandidateSource): SQL {
  if (source === 'payments') {
    return sql`not exists (
      select 1 from ${stockMovements}
      where (${stockMovements.sourceType} = 'payment_orders' and ${stockMovements.sourceId} = (
               select ${paymentOrders.id} from ${paymentOrders}
               where ${paymentOrders.culqiOrderId} = ${payments.culqiOrderId}
                 and ${paymentOrders.businessId} = ${payments.businessId}
               limit 1
             ))
         or (${stockMovements.sourceType} = 'payments' and ${stockMovements.sourceId} = ${payments.id})
    )`;
  }

  return sql`not exists (
    select 1 from ${stockMovements}
    where (${stockMovements.sourceType} = 'payment_orders' and ${stockMovements.sourceId} = ${paymentOrders.id})
       or (${stockMovements.sourceType} = 'payments' and ${stockMovements.sourceId} = (
             select ${payments.id} from ${payments}
             where ${payments.culqiOrderId} = ${paymentOrders.culqiOrderId}
               and ${payments.businessId} = ${paymentOrders.businessId}
             limit 1
           ))
  )`;
}

/**
 * Recover the snapshot of one paid sale (W-A).
 *
 * The PERSISTED cart array always wins — `payment_orders.metadata.cartItems`
 * first, then `payments.metadata.cartItems` — because the scalar `qty` echoed
 * on the Culqi charge metadata is a DIFFERENT shape and must never be mistaken
 * for a cart. Only a sale with no cart array falls back to the scalar `qty`,
 * and a product-bound sale with no snapshot at all keeps its product so the
 * shared helper can apply B1 (qty = 1 + alert).
 */
export function resolveSaleSnapshot(input: {
  orderMetadata?: unknown;
  paymentMetadata?: unknown;
  productId?: string | null;
}): FulfillmentSnapshot {
  const cartItems =
    readFulfillmentCartItems(input.orderMetadata) ??
    readFulfillmentCartItems(input.paymentMetadata);

  if (cartItems) {
    return { cartItems };
  }

  return {
    qty: readFulfillmentQty(input.paymentMetadata),
    productId: input.productId ?? null,
  };
}
