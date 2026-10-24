# Design: Stock Fulfillment on Payment (NEW-8)

> **AMENDED (R2).** Slice-3 adversarial verification (`verify-report-pass3.md`) proved the D4 claim set
> is derived from the wrong anchor: exactly-once ends up per-anchor, not per-sale. Read
> [Amendment R2 — Canonical sale identity](#amendment-r2--canonical-sale-identity) (D11–D18) together
> with D1–D10. D1–D10 are preserved verbatim; the superseded portions are listed, with reasons, in
> **D18**. The R2 spec delta is amended in the same change
> (`specs/stock-fulfillment/spec.md`, R2/R4/R5).

## Technical Approach

One shared server module — `src/core/payments/stockFulfillment.ts` — owns the only implementation of
"decrement stock for a paid sale". Every trigger (charge transaction, webhook `charge.paid`, webhook
`order.status.changed`, reconcile backstop) claims a new `stock_movements` ledger row via
`INSERT … ON CONFLICT DO NOTHING … RETURNING` **in the same transaction as its decrement** (and, where
already transactional, as its paid-state write). Snapshots follow `stock-fulfillment` R1 exactly:
order flow persists `payment_orders.metadata.cartItems` at `create-order`; token flow carries a scalar
`qty` on the Culqi charge `metadata` the charge route already sends. An explicit
`FULFILLMENT_WATERMARK` constant bounds every candidate set (R7). Alerts bypass `logger` (B-07:
`scrubPII` mangles UUIDs) via the existing `console.error` idiom. Delivered as **3 chained PRs**
(≤ 400 lines each), strict TDD. Server/client boundary: only `paymentApi.ts` /
`useCheckoutPayment.ts` change client-side (they forward the cart snapshot); the helper, watermark
and all claims are server-only.

## Architecture Decisions

| # | Decision | Choice | Why (alternatives rejected) |
|---|---|---|---|
| D1 | Completion marker | New `stock_movements` ledger, unique `(sourceType, sourceId)`, `sourceType ∈ {payments, payment_orders}` (proposal Q4) | Marker columns rejected: `payment_orders` flips create no `payments` row, so a `payments.stock_fulfilled_at` cannot cover that path (proposal Q4, `payment-orders` R5). Ledger also hosts the deferred refund path and keeps CAS mechanics in one table |
| D2 | Ledger shape | One row per **claim**: `items jsonb` (`[{productId, quantity, applied}]`), `outcome ('fulfilled'\|'partial'\|'no_product')`, `fallbackQty1 boolean`, `businessId NOT NULL`, **no FK on polymorphic `sourceId`**, indexes + partial-free `NOT EXISTS` support; RLS enabled with **zero policies** in the same migration (0050 pattern) | Per-line rows would multiply the CAS unit (multi-item sales must be ONE claim). RLS-without-policies is the repo's established table pattern: Drizzle runs as `postgres` (bypasses), PostgREST anon is denied |
| D3 | CAS idiom | Ledger claim = **first** fulfillment write in the tx: `.values(…).onConflictDoNothing().returning(…)`; 0 rows ⇒ skip decrement, ack normally | Must be an INSERT, never a 3rd `tx.update`: `tests/unit/chargeRoute.test.ts:685` pins exactly 2 `mockTxUpdate` calls (flip first, decrement second). `.returning()` rows are the affected-row assertion (R5); `rowCount` is `undefined` on postgres-js (order-integrity D5) |
| D4 | **Canonical two-key claim** | For every sale, claim **all resolvable keys in fixed order: `payment_orders` first, then `payments`**. Order-backed detection: `paymentOrders.findFirst(culqiOrderId = anchor-culqiOrderId, businessId)` (business-scoped, both ids DB-derived). Charge/token paths claim `('payments', payment.id)` **plus** the linked `('payment_orders', po.id)`; the flip claims `('payment_orders', po.id)` plus a linked `payments` row when one exists; token-only sales claim `payments` alone | The spec's per-trigger keying alone (charge ⇒ `payments`, flip ⇒ `payment_orders` — both required by the R2/R5 scenarios) leaves a **cross-key race**: charge tx and a later `order.status.changed` would each win their own key ⇒ 2 decrements. Claiming po-first makes every order-backed path collide on the same first key ⇒ exactly one winner (R2). Uniform order prevents deadlock (no path locks `payments` then waits on `payment_orders`). Alternative — one canonical key per sale — rejected: it violates the R2 scenario requiring a `sourceType: 'payments'` row committed by the charge transaction |
| D5 | Shared helper | `fulfillPaidSale(anchor, snapshot, { tx? })`: caller passes its tx (charge route, flip) or the helper opens one (webhook charge, cron); returns `{outcome, claimed, items, oversold, b1}`; decrements replicate the merged clamp idiom (`AND stock >= qty`, `.returning()`, `Math.max(1, quantity)`) byte-equivalent to `charge/route.ts:599-616`; alerts emitted **post-commit** via exported `emitFulfillmentAlerts(channel, …)` → `console.error` | Proposal D1 (extract into helper) over D2 (keep inline copy): two decrement implementations drift, and R2 forbids per-trigger copies. Post-commit emission only: charging routes must not alert on rolled-back txs (charge's existing `oversoldItems` pattern, `:618`+). `console.error` is mandatory — `piiScrubber.PHONE_REGEX` rewrites UUIDs to `…[REDACTED_PHONE]`, destroying alert identifiers (B-07; anti-upgrade comment travels with the helper) |
| D6 | Snapshot recovery hierarchy | Order path: `metadata.cartItems` → (no synthetic fallback; absent ⇒ today's behavior per `payment-orders` R2) ⇒ product-less terminal. Charge/event path: row `metadata.cartItems` (charge-route rows carry it) → `qty` (webhook rows, `readFulfillmentQty`) → B1 `qty = 1` + alert. Product-less ⇒ claim + `outcome='no_product'`, no decrement (R3). `qty` for Culqi metadata = `cartItems.find(i => i.id === productId)?.quantity ?? 1` — always reconciled by `validateAmount` (R6) | Delta R2 mandates "when `cartItems` is absent, behavior is identical to today" — a synthesized `[{productId,1}]` snapshot would write metadata today's code never writes. B1 needs no validation (system constant, not client input). Channel shapes stay non-interchangeable (R1): no cart array in charge metadata, no scalar in `payment_orders` |
| D7 | Watermark (R7) | Exported `FULFILLMENT_WATERMARK: Date` hard constant in the helper, set at PR3 cutover (≤ merge instant). Gates: webhook charge pre-read predicate `isHistoricalPaidRow({status, updatedAt})` (paid ∧ `< watermark` ⇒ skip fulfillment, still ack); flip decides on its **pre-read** row the same way (pending ⇒ transition now ⇒ always fulfill); cron candidates `gte(updatedAt, watermark)` | Rejected: module-load `new Date()` (differs per serverless instance ⇒ non-deterministic candidate sets); runtime read of the migration timestamp (extra query, no gain); DB settings row (machinery for one constant). Invariant: *already-paid before watermark ⇒ never fulfilled; any pending→paid transition after watermark ⇒ always fulfilled* (covers pending rows created pre-deploy — their transition is post-deploy, so R7 is satisfied) |
| D8 | Flip restructure (`payment-orders` R5) | Pre-read `findFirst(culqiOrderId)` → `{id, businessId, metadata, status, updatedAt}` (unknown ⇒ exact `'Order not found in DB: …'` warn + `{received:true}`, unchanged contract) → `db.transaction`: scoped flip `WHERE culqiOrderId AND businessId(read)` `.returning({id, businessId, metadata})`, `length !== 1` ⇒ throw `FlipMissedError` ⇒ rollback ⇒ warn + 200; `mapped==='paid' && !isHistoricalPaidRow` ⇒ `fulfillPaidSale` with the returned row. `expired/cancelled` ⇒ scoped flip only | The delta's "**business-scoped, `.returning()`-asserted flip** … yields `id` and `businessId`" **supersedes** the proposal's "flip idiom untouched" deferral — specs are the contract; the `rowCount` cast dies with the rewrite (it never worked on postgres-js anyway). `.returning({id, businessId, metadata})` gives row-derived `businessId` (R5) **and** the `cartItems` snapshot with no extra read. Business scoping now comes free from the pre-read. `FlipMissedError` (vs generic) lets the route ack 0-row misses while genuine failures still 500 for Culqi retry; keep the exact warn string so the unknown-id contract and its test stay green |
| D9 | Webhook charge path | `applyChargeStatus` gains a pre-read with `columns {id, businessId, productId, status, updatedAt}` (R7 predicate), update branch gains `.returning()`, then `fulfillPaidSale` **with its own tx**; po-resolution hint = `event.data.order_id \|\| row.culqiChargeId` | R2 explicitly allows the upsert↔claim crash window (healed by R4). `W-P3.1` upsert, no new notifications, no missing-row creation all preserved (non-requirements). `data.order_id` hint neutralizes risk #1 below when Culqi supplies it |
| D10 | Backstop (`stock-fulfillment` R4) | Separate pass after the untouched settle pass: `status='paid' ∧ updatedAt ≥ watermark ∧ NOT EXISTS (source_type, source_id)` over **both** tables, `ORDER BY updatedAt`, `limit 100`, one helper tx per row. `isAuthorized` additively accepts `Authorization: Bearer <CRON_SECRET>` (timing-safe, mirrors `check-plans`) alongside `x-cron-secret`. `vercel.json` gains `crons: [{ path, schedule: "0 3 * * *" }]` | `NOT EXISTS` is load-bearing: the paid set grows forever; CAS-only attempts would starve the 100-row window on already-fulfilled history. Vercel **Hobby allows only daily** expressions (hourly fails deployment; verified) ⇒ daily is safe on every plan; Pro may tighten later. Bearer is what Vercel actually sends — without it the "scheduled" backstop would 401 |

## Data Flow

### A — charge route transaction (both flows, D3/D4/D5)

    POST /api/payment/charge
      gate R8–R14 (unchanged) → reserve idem key → dedup replay?
      tx {
        insert payments (paid)
        [order flow] flip payment_orders … business-scoped .returning({id})  ← asserted, unchanged
        fulfillPaidSale(anchor, snapshot, tx):
          ① INSERT stock_movements ('payment_orders', po)  ON CONFLICT DO NOTHING → 0 rows ⇒ already ⇒ skip all
          ② INSERT stock_movements ('payments', pay)       ON CONFLICT DO NOTHING → 0 rows ⇒ throw ⇒ rollback
          ③ for item: UPDATE products SET stock -= qty WHERE id AND business_id AND stock >= qty
               .returning() → 0 rows ⇒ oversold[]   (clamp semantics preserved, no error)
      }
      post-commit: emitFulfillmentAlerts('charge', …)   ← byte-identical message/payload today
      notify → 200

### B — webhook `charge.paid` (D9)

    preRead = payments.findFirst(culqiChargeId) {id,businessId,productId,status,updatedAt}
      paid ∧ updatedAt < watermark ⇒ ack only (R7)
      applyChargeStatus: update-paid | W-P3.1 upsert (.returning) | update-only   ← unchanged writes
      items ← po(cartItems)  if po = findFirst(payment_orders, order_id || culqiChargeId, businessId)
            ← {productId, readFulfillmentQty(data.metadata)}  else (B1 when qty absent)
      fulfillPaidSale(…) in its OWN tx   ← crash window allowed, healed by D10 backstop
      ack {received:true}

### C — webhook `order.status.changed` (D8)

    read = paymentOrders.findFirst(culqiOrderId) {id,businessId,metadata,status,updatedAt}
      !read ⇒ warn 'Order not found in DB: …' ⇒ 200                (contract unchanged)
    db.transaction {
      flipped = UPDATE … SET paid WHERE culqiOrderId AND businessId(read)
                .returning({id,businessId,metadata})
      flipped.length !== 1 ⇒ throw FlipMissedError ⇒ rollback ⇒ warn ⇒ 200
      mapped==='paid' ∧ !isHistoricalPaidRow(read):
        fulfillPaidSale(('payment_orders', id), metadata, tx)   ← claim(s) + decrement, atomic with flip
    }
    expired/cancelled ⇒ scoped flip only, zero stock effect

### D — reconcile backstop (D10), scheduled daily 03:00 UTC

    GET /api/cron/reconcile-payments  (x-cron-secret OR Bearer CRON_SECRET, timing-safe)
      pass 1 (unchanged): pending ∧ age ≥ 5 min → Culqi read → settle
      pass 2 (new): both tables, paid ∧ ≥ watermark ∧ NOT EXISTS ledger, ORDER BY updatedAt, limit 100
        → fulfillPaidSale(row…) per row → counters
      200 {reconciled, skipped, scanned, fulfilled, fulfillmentSkipped, fulfillmentScanned}

### Cross-key race killed by D4

    sale = (payment_orders P, payments X with X.culqiChargeId = P.culqiOrderId)
    without canonical order:  charge tx claims X ✓  ·  flip claims P ✓  ⇒ TWO decrements
    with D4:                  every order-backed path claims P FIRST  ⇒ exactly one winner
    (loser: CAS returns 0 rows ⇒ skip ⇒ ack unaffected — R2 "the loser is not a failure")

## File Changes

| Slice | File | Action | Description |
|---|---|---|---|
| PR1 | `src/core/database/schema/orders.ts` | Modify | `stockMovements` model + `StockMovement`/`NewStockMovement` exports (D1, D2) |
| PR1 | `migrations/0051_stock_movements_ledger.sql` | Create | Table + unique `(source_type, source_id)` + indexes + `ENABLE ROW LEVEL SECURITY` (zero policies), 0050-style header, re-run safe |
| PR1 | `migrations/ledger.json` | Regenerate | `pnpm check:migrations --update` (CI `UNREGISTERED_MIGRATION` guard) |
| PR1 | `src/core/payments/stockFulfillment.ts` | Create | `FULFILLMENT_WATERMARK`, `isHistoricalPaidRow`, `readFulfillmentQty`, `resolveFulfillmentItems`, `fulfillPaidSale`, `emitFulfillmentAlerts` (D4–D7) |
| PR1 | `app/api/payment/charge/route.ts` | Modify | Replace `:587-618` decrement loop with `resolveFulfillmentItems` + `fulfillPaidSale(…, {tx})`; alert loop consumes the result, message/payload byte-compatible (D5) |
| PR1 | `tests/unit/stockFulfillment.test.ts` | Create | Helper truth tables, CAS-before-decrement ordering, tx injection, scoping (RED plan below) |
| PR2 | `src/features/billing/schemas.ts` | Modify | Export shared `cartItemsSchema`; `createOrderRequestSchema` gains optional `cartItems` (`payment-orders` R2) |
| PR2 | `app/api/payment/create-order/route.ts` | Modify | Persist `metadata.cartItems` beside `culqiRaw` at insert; pass `cartItems` to `validateAmount` whenever present (R6, 400 before Culqi); Culqi body byte-identical |
| PR2 | `src/shared/payments/paymentApi.ts` | Modify | `CreateOrderParams.cartItems?` + forward in `createOrder` body *(client)* |
| PR2 | `app/[slug]/(app)/components/hooks/useCheckoutPayment.ts` | Modify | Pass `cartItems` to `createOrder` at `:155` *(client)* |
| PR2 | `app/api/payment/charge/route.ts` | Modify | Add scalar `qty` to Culqi charge `metadata` (`:176`) from the validated cart (R1-A2, R6) |
| PR2 | `src/core/payments/webhookPaymentValues.ts` | Modify | Upsert values persist `qty` in `payments.metadata` (cron recovery) — builder stays pure |
| PR2 | tests: `createOrderSchema`, `createOrderRoute`, `billingSchemas`, `paymentApi`, `webhookPaymentValues`, `chargeRoute` | Modify | R1/R2/R6 RED anchors |
| PR3 | `app/api/webhooks/culqi/route.ts` | Modify | Pre-read + R7 predicate, `applyChargeStatus` returns the row, charge branch → helper, flip → pre-read + transaction + scoped `.returning()` + `FlipMissedError` (D8, D9) |
| PR3 | `app/api/cron/reconcile-payments/route.ts` | Modify | Fulfillment pass + Bearer auth + extended response (D10) |
| PR3 | `vercel.json` | Modify | `crons` entry (R4) |
| PR3 | tests: `webhookChargeStatus`, `webhookOrderStatus`, `reconcilePaymentsRoute`, `vercelCronConfig` (new) | Modify/Create | Trigger + backstop RED anchors |

Explicitly untouched: `readOrderProductBinding` / R13 binding key, W-P3.1 upsert semantics, `payments.status`
enum, notifications/emails/SMS, `order-timeouts`/`check-plans` crons, oversell-prevention design.

## Interfaces / Contracts

```ts
// src/core/payments/stockFulfillment.ts — server-only, no new dependencies
export const FULFILLMENT_WATERMARK: Date;               // cutover instant, set when PR3 merges (D7)
export function isHistoricalPaidRow(r: { status: string; updatedAt: Date | string }): boolean;
export function readFulfillmentQty(metadata: unknown): number | null;   // int ≥ 1 | null

export interface FulfillmentSnapshot {
  cartItems?: { id: string; quantity: number }[] | null;  // exact validateAmount shape
  qty?: number | null;                                    // scalar charge metadata
  productId?: string | null;
}
export type FulfillmentAnchor = {
  kind: 'payments' | 'payment_orders';
  id: string;
  businessId: string;                                     // always DB-derived (R5)
  culqiOrderId?: string | null;                           // resolution hint (order-backed detection)
};
export interface FulfillmentResult {
  outcome: 'fulfilled' | 'already_claimed' | 'no_product';
  claimed: Array<{ sourceType: 'payments' | 'payment_orders'; id: string }>;
  items: Array<{ productId: string; quantity: number; applied: boolean }>;
  oversold: Array<{ productId: string; requested: number }>;
  b1: boolean;
}
export function resolveFulfillmentItems(s: FulfillmentSnapshot):
  { items: FulfillmentResult['items']; b1: boolean; productBound: boolean };   // pure, unit-tested
export function fulfillPaidSale(
  a: FulfillmentAnchor, s: FulfillmentSnapshot, opts?: { tx?: TxLike },
): Promise<FulfillmentResult>;                            // owns db.transaction iff no tx passed
export function emitFulfillmentAlerts(                    // post-commit ONLY; console.error, never logger
  channel: 'charge' | 'culqi-webhook' | 'reconcile', a: FulfillmentAnchor, r: FulfillmentResult,
): void;

// migrations/0051 (sketch)
CREATE TABLE IF NOT EXISTS "public"."stock_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "business_id" uuid NOT NULL REFERENCES "businesses"("id"),
  "source_type" text NOT NULL CHECK ("source_type" IN ('payments','payment_orders')),
  "source_id" uuid NOT NULL,
  "items" jsonb NOT NULL DEFAULT '[]',
  "outcome" text NOT NULL CHECK ("outcome" IN ('fulfilled','partial','no_product')),
  "fallback_qty1" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "stock_movements_source_unique" UNIQUE ("source_type","source_id")
);
ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY;  -- zero policies (0050 pattern)

// cron response (superset — existing tests extend from {reconciled,skipped,scanned})
{ reconciled, skipped, scanned, fulfilled, fulfillmentSkipped, fulfillmentScanned }
```

## Testing Strategy (strict TDD — RED first, `pnpm test:unit`)

| Req | File | RED approach |
|---|---|---|
| R2/R3/R5 (helper) | `stockFulfillment.test.ts` (new) | Mock `@/core/database/client` with chainable `insert().values().onConflictDoNothing().returning()`, `update().set().where().returning()`, `transaction`. Assert: claim invoked **before** decrement (`invocationCallOrder`); claim conflict (`returning([])`) ⇒ zero `update` calls + `already_claimed`; compiled decrement `where` (PgDialect `compileWhere`) contains `business_id` AND `stock >=`; no-tx ⇒ `db.transaction` used, `tx` passed ⇒ it used and `db.transaction` NOT called; order-backed anchor ⇒ po claim precedes payments claim, token ⇒ payments only; `resolveFulfillmentItems` table (cartItems / qty / productId-only ⇒ b1 / none ⇒ product-less); `isHistoricalPaidRow` + `readFulfillmentQty` truth tables; `FULFILLMENT_WATERMARK` is a `Date` |
| R2 happy path | `chargeRoute.test.ts` | Extend hoisted chain: `mockTxValues` returns `{ returning, onConflictDoNothing: () => ({ returning }) }`. New cases: claim count (token ⇒ payments insert + 1 claim; order flow ⇒ + po claim), claim precedes decrement, oversold message string unchanged, replay ⇒ untouched. **Guard:** `:685` test (exactly 2 `mockTxUpdate`, flip first) stays green — CAS is an INSERT |
| R1-A2 / R6 | `chargeRoute.test.ts`, `createOrderRoute.test.ts`, `createOrderSchema.test.ts`, `billingSchemas.test.ts` | Charge: Culqi body `metadata.qty` equals the validated bound line's quantity, no cart array key. create-order: `validateAmount` spy called **with** `cartItems`; tampered quantity ⇒ 400, `mockFetch` not called, no insert; persisted `metadata.cartItems` exact, `culqiRaw` untouched, Culqi body deep-equals a no-snapshot body; schema rejects `quantity: 0` / non-int |
| R2/R5 delta | `webhookOrderStatus.test.ts` | Add `db.transaction` + `update().set().where().returning()` to the mock + `query.paymentOrders.findFirst`. Cases: unknown id ⇒ exact warn + 200, no tx; paid flip ⇒ tx, `fulfillPaidSale` called with `('payment_orders', …)` + row-derived `businessId` + `metadata`; expired ⇒ flip only, helper not called; pre-watermark paid row ⇒ flip but **no** fulfillment; `returning([])` ⇒ `FlipMissedError` ⇒ warn + 200, no fulfillment |
| R2/R3/R7 | `webhookChargeStatus.test.ts` | Mock `stockFulfillment` (`fulfillPaidSale` spy; predicate real). Cases: pending → paid ⇒ helper called after upsert with event `qty`; pre-watermark paid ⇒ helper **not** called, still 200; po resolution hint passed; W-P3.1 upsert assertions untouched |
| R4 | `reconcilePaymentsRoute.test.ts` | Extend exact-equality response; add `db.query.paymentOrders.findMany`, ledger `NOT EXISTS` + watermark params via `compileWhere`, per-row transaction; `fulfillPaidSale` counts; auth: Bearer accepted, wrong Bearer rejected, existing `x-cron-secret` green; settle pass byte-unchanged |
| R1 (client) | `paymentApi.test.ts` | `createOrder` forwards `cartItems` in the body. Hook change covered by `type-check` (no existing `useCheckoutPayment` test) |
| R1 (builder) | `webhookPaymentValues.test.ts` | Upsert values carry `qty` when the event metadata has one; absent ⇒ no key |
| R4 schedule | `vercelCronConfig.test.ts` (new) | Reads `vercel.json`, asserts a `crons` entry targeting `/api/cron/reconcile-payments` |
| D2 migration | `rlsStockMovementsMigration.test.ts` (new, mirrors `rlsPaymentIdempotencyMigration.test.ts`) | 0051 exists, registers in `ledger.json`, contains `ENABLE ROW LEVEL SECURITY` and no `CREATE POLICY` |

## Migration / Rollout

- **Schema**: manual `0051_stock_movements_ledger.sql` (operator applies via psql / Supabase SQL editor,
  precedent 0048–0050), idempotent, RLS zero-policy inline; register with `pnpm check:migrations --update`.
  No backfill of any kind (R7).
- **Watermark**: PR3 sets `FULFILLMENT_WATERMARK` to the planned cutover instant (≤ merge time).
  Direction-safe: a too-early constant only widens the true-victim window; it can never reach
  pre-change history beyond the create/deploy gap.
- **Cron**: `CRON_SECRET` must exist in the deployed env (Vercel sends `Authorization: Bearer`);
  verify at apply. First scheduled run within 24 h of deploy; manual ops trigger remains
  `POST` + `x-cron-secret`.
- **Order**: merge PR1 → PR2 → PR3; each PR independently green (helper inert until wired, `qty`
  persisted before consumed).
- **Rollback = per-PR revert** (PR3 first, then PR2, then PR1): re-opens NEW-8 for the reverted
  triggers; committed decrements and `stock_movements` rows are historical facts and are NOT
  auto-reversed (compensating movements = deferred refund work). Down-migration drops only
  `stock_movements`. Correction C1 (stale R8–R14 note) executes at `sdd-archive`.

**Review workload**: total ≈ 640 changed lines ⇒ `Chained PRs recommended: Yes` ·
`400-line budget risk: High` · `Decision needed before apply: Yes` (delivery strategy `ask-on-risk`).

## Risks

| # | Risk | Severity | Disposition |
|---|---|---|---|
| 1 | If Culqi emits `charge.paid` for Órdenes-backed charges, a chr-typed id could create a third claim key outside the po→payments pair (double decrement) | MED | Mitigated: webhook resolves po via `event.data.order_id \|\| row.culqiChargeId` (D9). Evidence against: an ord-keyed `payments.culqiChargeId` would today already produce duplicate paid rows for one sale (none reported) ⇒ Culqi Órdenes likely emit order events only. Verify during apply (Culqi docs / webhook fixtures); residual accepted if unverifiable |
| 2 | Multi-item **token** sale whose charge call fails: webhook recovers only the bound line (R1 forbids cart arrays in charge metadata); later replay short-circuits ⇒ lines 2..n never decrement | MED | Accepted — spec channel decision (R1); drift is loud (per-line alerts only for what runs). Revisit = A3 pre-charge snapshot, explicitly rejected in proposal |
| 3 | Vercel Hobby: cron can only be daily ⇒ up to 24 h heal latency | LOW | Daily `0 3 * * *` safe on every plan; manual `POST` trigger for ops; tighten to 15 min if Pro (Open Question) |
| 4 | D1 refactor touches the hot, heavily-tested charge transaction | MED | Byte-equivalent extraction, `:685` ordering pinned, full existing suite must stay green; fallback = proposal D2 (inline decrement + marker only) if the diff proves entangled |
| 5 | Cron paid set grows forever ⇒ backstop starves | LOW | `NOT EXISTS` ledger filter + `ORDER BY updatedAt` + limit (D10) — designed out |
| 6 | Legacy cached clients omit `cartItems` ⇒ an order-backed charge has NO persisted `payment_orders.metadata.cartItems` and the charge path fails closed for that sale (no claim, no decrement). It is **not** "no movement" and must never fall back to the request cart | LOW | Mandated by delta R2 ("identical to today"); PR2 client ships in the same release. The sale stays unclaimed so the D10 backstop heals it from the persisted rows; only a sale with no recoverable snapshot at all reaches B1 (qty = 1 + alert) |
| 7 | Pre-watermark row paid long ago, `updatedAt` bumped post-deploy while still `paid` ⇒ cron fulfills a historical sale | LOW | Webhook paths use explicit transition predicates (robust); cron's floor is the best cheap proxy — no transition log exists for `payments` outside `order_events`, whose coverage is unverified. Single-row effect, alert-visible; accepted |

## Open Questions

- [ ] Deployed Vercel plan (Hobby ⇒ daily is final; Pro ⇒ may tighten the schedule) — confirm at apply.
- [ ] Does Culqi emit `charge.paid` for Órdenes-backed charges, and does that payload carry
      `order_id`? (Risk 1 is **closed** by D18 — the duplicate row can no longer be created. The
      answer only decides which escalation D14/A2 takes: `data.order_id` first, then the charge
      object read.)
- [ ] Schedule the other dormant crons (`check-plans`, `order-timeouts`) — out of scope here; follow-up change.
- [ ] Pre-existing: async order with `quantity > 1` and no `cartItems` should 400 in `validateAmount`
      (single-line fallback) — untouched by this change, flagged for a future fix.

---

## Amendment R2 — Canonical sale identity

### Why this amendment exists

Slice-3 adversarial verification (`verify-report-pass3.md`) reproduced a **double stock decrement on
order-flow sales**: one sale produced two `payments` rows, two distinct claim keys, and therefore two
decrements. The D4 mechanism is sound (a CAS on an ordered key set); what is wrong is **what the key
set is derived from**.

### Evidence (verified in code, not inferred)

| # | Evidence | Consequence |
|---|---|---|
| E1 | `app/api/payment/charge/route.ts:546` — `culqiChargeId = culqiOrderId \|\| culqiData?.id \|\| null`. The order flow **never creates a Culqi charge**: it only READS the order and checks `isCulqiOrderPaid` (`:429-457`, `culqiOrders.ts:107`). So the order flow writes an `ord_…` id into `payments.culqi_charge_id` — a column that every other reader treats as a `chr_…` charge id | RC1: a column carries an id of the wrong kind ⇒ one sale has two different names |
| E2 | `app/api/webhooks/culqi/route.ts:466` and `:532-535` — the webhook resolves and upserts `payments` on `culqi_charge_id` with the `chr_…` value | the conflict target **never matches** the order-flow row ⇒ a **second** `payments` row is inserted for the same sale |
| E3 | `payments.culqi_charge_id` is UNIQUE (`payments_culqi_charge_id_unique`) but the two rows carry different values | the unique index does not protect the sale |
| E4 | There is **no FK** between `payments` and `payment_orders`. The only link is the cross-kind equality `payments.culqi_charge_id = payment_orders.culqi_order_id` (webhook `:344`, cron `:223` and `:258`, `reconcileFulfillment.ts:50` and `:63`) | the webhook's row is an **orphan** ⇒ the backstop sees two sales ⇒ second decrement |
| E5 | `app/api/webhooks/culqi/route.ts:404` — the order hint falls back to `row.culqiChargeId`, i.e. it relies on the column holding the *order* id | the hint is only accidentally correct today; it is wrong the moment the column is fixed |

### The two root causes

- **RC1 — identity.** The sale's identity is carried by columns whose meaning depends on which
  writer filled them last. Two writers holding different halves of the identity (`ord_…` vs
  `chr_…`) therefore produce two rows for one sale.
- **RC2 — key derivation.** The claim set is derived from *the anchor the trigger happened to
  resolve* (D4: "resolve every key it can"), so exactly-once is enforced **per anchor**, not
  **per sale**. Two triggers that resolve different anchors of the same sale never collide.

The fix is one sentence: **the sale's identity is resolved once, canonically, and every trigger
derives its claim set from that resolution.** RC1 is fixed by D13 (kind-correct columns, one row per
sale); RC2 by D11 + D12 (canonical resolver, canonical ordered claim set).

---

### D11 — Canonical sale identity (the resolver)

One resolver answers "what sale is this?" for every trigger. It is the **only** place that knows how a
sale is identified; a trigger never decides "I am the payments trigger, therefore my key is payments".

```ts
// src/core/payments/saleIdentity.ts (new) — server-only
export interface SaleIdentity {
  /** The `payment_orders` row uuid — the FIRST claim key when it resolves. */
  paymentOrderId: string | null;
  /** The `payments` row uuid — the second claim key. */
  paymentId: string | null;
  /** Always DB-derived (R5). Never client-supplied. */
  businessId: string;
  /** The sale's Culqi ORDER id (`ord_…`) — persisted, never a claim key. */
  culqiOrderId: string | null;
  /** The sale's Culqi CHARGE id (`chr_…`) — persisted, never a claim key. */
  culqiChargeId: string | null;
}

/** Resolves an anchor into the sale it belongs to. `null` ⇒ unknown sale. */
export function resolveSaleIdentity(input: {
  businessId: string;
  anchor: { culqiOrderId?: string | null; culqiChargeId?: string | null };
  tx?: TxLike;
}): Promise<SaleIdentity | null>;
```

Resolution order — every read is **business-scoped**, every id is **DB-derived** (R5):

1. `culqiOrderId` present ⇒ `payment_orders.findFirst({ culqiOrderId, businessId })` ⇒ `paymentOrderId`.
2. `culqiChargeId` present ⇒ `payments.findFirst({ culqiChargeId, businessId })` ⇒ `paymentId`; if
   that row's `culqi_order_id` is set ⇒ re-run step 1 with it ⇒ `paymentOrderId`.
3. Nothing resolved ⇒ `null`. The caller MUST NOT claim and MUST NOT decrement (fail closed, D12).

**Why:** the resolver reads the **persisted, kind-correct** columns, so the link it returns is the
same link every trigger sees. The cross-kind text join (E4) disappears from the design entirely.

### D12 — Canonical claim set (supersedes D4's *derivation*; D4's *order* survives)

`resolveClaimKeys(identity)` — a pure function of the resolved sale:

| resolved identity | ordered claim set |
|---|---|
| `paymentOrderId` present | `[('payment_orders', paymentOrderId), ('payments', paymentId)]` — the `payments` entry is omitted when `paymentId` is null |
| `paymentOrderId` absent, `paymentId` present | `[('payments', paymentId)]` (token-only sale) |
| neither | `[]` ⇒ **no claim, no decrement** |

Normative consequences:

- A trigger that **can** see the order link MUST NOT derive a payments-only key. This is exactly the
  failure: the webhook's anchor was a `payments` row, so it derived `('payments', …)` while the charge
  transaction derived `('payment_orders', …)` — two winners.
- The order (`payment_orders` first) is preserved verbatim from D4 ⇒ no path locks `payments` before
  `payment_orders` ⇒ no deadlock.
- The claim set is a function of the **sale**, not of the trigger ⇒ every trigger of the same sale
  collides on the same first key ⇒ exactly one winner ⇒ exactly one decrement.
- The claim set may be **empty** only when the sale has no persisted row ⇒ fail closed.

### D13 — `payments` column semantics, one row per sale, and the insert arbiter

**Column model**

| column | holds | `NULL` means | constraint |
|---|---|---|---|
| `payments.culqi_charge_id` | the Culqi **CHARGE** id (`chr_…`) **only** | this sale has no known charge id | UNIQUE (`payments_culqi_charge_id_unique`, existing) |
| `payments.culqi_order_id` (**new**) | the Culqi **ORDER** id (`ord_…`) **only** | this sale has no known order id | UNIQUE (`payments_culqi_order_id_unique`, new) |

**Invariants**

- **I1 — kind-correctness.** No column ever holds an id of the other kind. A `chr_…` is never written
  to `culqi_order_id`; an `ord_…` is never written to `culqi_charge_id`.
- **I2 — one row per sale.** The link between a `payments` row and its `payment_orders` row is the
  **same-kind** equality `payments.culqi_order_id = payment_orders.culqi_order_id` (plus `business_id`).
  The cross-kind equality `payments.culqi_charge_id = payment_orders.culqi_order_id` is **deleted** from
  the codebase (E4).
- **I3 — one arbiter per sale.** A sale's arbiter is decided by its nature: an **order-backed** sale is
  arbitrated by `culqi_order_id`; a **token-backed** sale by `culqi_charge_id`. Every writer of that sale
  uses the same arbiter, so a write by one writer **collides with** the other writer's row instead of
  creating a second one. The arbiter column is always `NOT NULL` for the sale it arbitrates (a `NULL`
  never conflicts in a unique index — that is precisely why the arbiter must be chosen per sale).

**Row lifecycle — both writers resolve BEFORE writing and ADOPT on conflict**

| writer | knows | resolves by | writes / adopts |
|---|---|---|---|
| charge route — order flow | `ord_…` only | `culqi_order_id` | adopt the row if present (update the fields the route owns); else INSERT `culqi_order_id = ord_…`, `culqi_charge_id = NULL` |
| charge route — token flow | `chr_…` | `culqi_charge_id` | adopt, else INSERT `culqi_charge_id = chr_…`, `culqi_order_id = NULL` |
| webhook `charge.paid` | `chr_…` (+ maybe `ord_…`) | `culqi_charge_id` **first**, then `culqi_order_id` | adopt the row it finds (backfilling the missing id); else INSERT with the arbiter of the sale's nature |

**Adopt** = fill the columns this writer owns that the row lacks; never overwrite a non-null id with
null; never change the arbiter of an existing row; never create a second row.

**Why resolve-before-write is mandatory, not an optimisation:** `ON CONFLICT` can arbitrate **one**
column, and the two writers of an order-backed sale hold **different halves** of the identity
(`ord_…` vs `chr_…`, E1/E2). A blind insert therefore duplicates. Resolve-then-insert-then-adopt
produces the same observable outcome as the current conflict target (one row per sale) for **both**
orderings of the two writers, and it is the only shape that works when the second writer arrives first.

### D14 — Webhook attribution and fail-closed rules

The `charge.paid` payload does not always carry the order link, and the webhook is the writer that
creates rows. Its rules:

- **A1 — ours vs not ours.** If the payload carries **our own** charge metadata
  (`metadata.businessId`), the charge was created by our token-flow charge route ⇒ the sale is
  **token-backed** ⇒ the webhook MAY create/adopt the `chr_…`-keyed row.
  *Verified:* every charge our token flow creates sends
  `metadata: { businessId, productId, platform: 'store-lite', qty }` (`charge/route.ts:184`), and the
  order flow creates **no** Culqi charge at all (`charge/route.ts:429-457` only READS the order) ⇒ a
  charge without `metadata.businessId` was not created by us and may be order-backed.
- **A2 — fail closed when unattributable.** If the payload carries **no** `metadata.businessId`, the
  charge was **not** created by our token flow ⇒ it may be order-backed ⇒ the webhook MUST resolve the
  order link (`data.order_id`, else the charge object via `getCulqiCharge`) **before** touching
  `payments`. If the order link still cannot be established ⇒ **fail closed**: **no `payments` row is
  created**, the event is acknowledged (`200`) and a loud warning is emitted. The sale is still healed
  by the `order.status.changed` flip (D8) and the reconcile backstop (D10), both of which resolve by
  **order** id.
- **A3 — backfill, never duplicate.** A webhook that finds the sale's row MUST backfill the id it
  knows and the row lacks (`culqi_charge_id` NULL ⇒ set it; `culqi_order_id` NULL ⇒ set it when known).
  A backfill never creates a second row and never changes the arbiter of an existing row.
- **A4 — the order hint is an ORDER id.** The charge branch's hint is
  `data.order_id ?? row.culqi_order_id` — **never** `row.culqi_charge_id` (a `chr_…` is not an order
  id; today's fallback is only accidentally correct because the column holds the wrong kind of id — E5).

### D15 — Reader/writer re-pointing inventory (every `payments.culqi_charge_id` touchpoint)

| # | Site | Today | Becomes |
|---|---|---|---|
| 1 | `app/api/payment/charge/route.ts:492-499` | replay lookup on `culqiChargeId = culqiOrderId \|\| culqiData?.id` | order flow ⇒ `culqi_order_id = culqiOrderId`; token flow ⇒ `culqi_charge_id = culqiData.id` |
| 2 | `app/api/payment/charge/route.ts:546` | `culqiChargeId = culqiOrderId \|\| culqiData?.id` | order flow ⇒ `culqi_order_id = culqiOrderId`, `culqi_charge_id = NULL`; token flow ⇒ `culqi_charge_id = culqiData?.id ?? null` |
| 3 | `app/api/payment/charge/route.ts:576` | `metadata.culqiId = culqiChargeId` | the kind-correct charge id (`NULL` for order-flow rows until the webhook backfills). The field is **written but never read** anywhere in the repo — no consumer to break |
| 4 | `app/api/payment/charge/route.ts:588-598` | flip (unchanged) + the linked-payment lookup | the sale identity comes from the resolver (D11), not from a text join |
| 5 | `app/api/webhooks/culqi/route.ts:187` (`applyRefundStatus`) | updates `payments` by `culqiChargeId` | a refund carries a `chr_…` ⇒ the lookup becomes **correct** after D13, but it **misses order-flow rows today** (they hold the `ord_…`). Resolve by `culqi_charge_id`, or by `culqi_order_id` when the refund carries an order id |
| 6 | `app/api/webhooks/culqi/route.ts:342-348` | flip branch's linked-payment lookup on `culqiChargeId = culqiOrderId` | same-kind `culqi_order_id = culqiOrderId` (or the resolver) |
| 7 | `app/api/webhooks/culqi/route.ts:404` | hint `data.order_id ?? target.culqiChargeId` | `data.order_id ?? target.culqiOrderId` (D14/A4) |
| 8 | `app/api/webhooks/culqi/route.ts:466, 486, 525` (`applyChargeStatus`) | lookups by `culqiChargeId` | resolve by charge id **then** order id (D13 lifecycle) |
| 9 | `app/api/webhooks/culqi/route.ts:532-535` | `onConflictDoUpdate({ target: payments.culqiChargeId })` | the **arbiter of the sale's nature** (D13/I3) — order-backed ⇒ `culqi_order_id` |
| 10 | `src/core/payments/webhookPaymentValues.ts:31, 126` | builder writes the `chr_…` | keeps `culqiChargeId`; gains an optional `culqiOrderId` |
| 11 | `app/api/cron/reconcile-payments/route.ts:94-101` | settlement pass reads `culqiChargeId IS NOT NULL` | after D13 order-flow rows have a NULL charge id ⇒ the pass must read by `culqi_charge_id` **or** resolve the order state by `culqi_order_id` (`getCulqiOrder`, `isCulqiOrderPaid`) |
| 12 | `app/api/cron/reconcile-payments/route.ts:221-227, 255-262` | the persisted link (`culqiChargeId = culqiOrderId`) | same-kind `culqi_order_id` |
| 13 | `src/core/payments/reconcileFulfillment.ts:50, 63` | the candidate predicate's SQL join | same-kind `culqi_order_id` |
| 14 | `src/lib/complaintScoring.ts:95` | selects `culqiChargeId` | **the value is never used** (the dispute factor reads `order.status === 'disputed'`) ⇒ no behavioural change; the selection is updated for kind-correctness only |
| 15 | `src/core/database/schema/orders.ts` + `src/core/database/database.types.ts` | `payments` model | add `culqiOrderId` (`text`, nullable) + the unique index; regenerate the generated DB types |
| 16 | `migrations/0052_payments_culqi_order_id.sql` (new) | — | additive DDL (D16) + `pnpm check:migrations --update` |

### D16 — Migration and data posture (measured, not assumed)

**DDL only. No data migration, no backfill, no cleanup script.**

Measured on 2026-10-21 against both live databases (read-only, throwaway Node script using the repo's
`postgres` package; no `psql`; secrets never printed; script deleted afterwards):

| database | `payments` | `payment_orders` | `order_events` | `stock_movements` |
|---|---|---|---|---|
| dev (`…likloeyrdzfsrwelpdoz`) | **89 rows, 100 % `chr_…`** (0 `ord_…`) | **0** | 0 | **table ABSENT** |
| prod (`…ggkpckrtyytlzewjjgic`) | **0** | **0** | 0 | **table ABSENT** |

Consequences:

- **Nothing to rewrite.** No row anywhere stores an `ord_…` in `culqi_charge_id` ⇒ the D13 migration has
  no data to migrate ⇒ the 89 dev rows (all token-flow, all `chr_…`) are already kind-correct.
- **The bug is a live code path, not an incident.** `payment_orders` is empty in both databases ⇒ the
  order flow has never completed a sale ⇒ the duplicate-row failure has **never fired in production**.
  It will fire the first time an order-backed sale receives a `charge.paid` webhook.
- **`stock_movements` does not exist in either database** ⇒ migration `0051` has **not** been applied ⇒
  the Slice-3 backstop would throw `relation "stock_movements" does not exist` at runtime ⇒ **0051 is a
  hard deployment prerequisite** and the cron MUST NOT be deployed before it. It also means the ledger
  holds zero rows ⇒ no ledger reconciliation is needed.
- **`order_events` is empty in both** ⇒ dead for this change (the delta never relied on it).

Migration SQL (`0052`, additive, idempotent, re-run safe):

```sql
ALTER TABLE "public"."payments" ADD COLUMN IF NOT EXISTS "culqi_order_id" text;
CREATE UNIQUE INDEX IF NOT EXISTS "payments_culqi_order_id_unique" ON "public"."payments" ("culqi_order_id");
```

### D17 — Regression test contract (RED before the fix, GREEN after)

New file `tests/unit/saleIdentity.test.ts`, plus additions to
`tests/unit/reconcilePaymentsFulfillment.test.ts`:

| # | Test | Setup | Assert |
|---|---|---|---|
| **T1** | one order-backed sale, two writers, **one** `payments` row | a `payment_orders` row (`ord_…`) + the charge route's `payments` row (`culqi_order_id = ord_…`, `culqi_charge_id = NULL`); then the webhook's `charge.paid` with `data.id = chr_…`, `data.order_id = ord_…` | **no second `payments` row**; the existing row's `culqi_charge_id` was **backfilled** to `chr_…`; the sale has exactly 1 row |
| **T2** | the claim set is the **sale's**, not the trigger's | the same sale + a `stock_movements` row for `('payment_orders', po.id)` | the reconcile backstop reports the sale as **already claimed**; the webhook's claim returns **0 rows**; **exactly one** decrement; the ledger holds exactly one row for the sale |
| **T3** | the backstop never sees an order-backed sale as two sales | one `payments` row (`culqi_order_id = ord_…`, `culqi_charge_id = chr_…`) + its `payment_orders` row, no ledger row | the sale is collected **once** (not twice); **one** claim; **one** decrement |
| **T4** | the webhook fails closed when it cannot attribute the charge | no `payments` row; a `charge.paid` event with `chr_…`, **no** `metadata.businessId`, **no** `data.order_id`, and the Culqi charge read returning no order link | **no `payments` row created**; the response is `200`; a warning is emitted |
| **T5** | the token flow is unaffected | a token-backed sale (`chr_…` only) | exactly one `payments` row; exactly one decrement |

**Harness constraint (non-negotiable).** The current
`tests/unit/reconcilePaymentsFulfillment.test.ts:235-236` mock returns `linkedPaymentRow` from
`mockPaymentsFindFirst` **regardless of the `where` clause** — that mock is exactly what hid the
asymmetric-link defect, so the suite passed for the wrong reason. The new tests MUST NOT use a
`findFirst` mock that ignores `where`:

- the fake MUST honour the compiled predicate (compile with the PgDialect and match on the SQL/params),
  and
- the test MUST assert on the **compiled `where`** that the sibling link uses `payments.culqi_order_id`
  (never `payments.culqi_charge_id`), and
- a test that cannot distinguish "linked by charge id" from "linked by order id" is **not evidence**.

### D18 — Supersession map (D1–D10 preserved; amended portions marked with reasons)

| decision | status after R2 | reason |
|---|---|---|
| **D1** (ledger shape) | **UNCHANGED** | the ledger is the right mechanism; the defect was the key **derivation**, not the ledger |
| **D2** (ledger schema) | **UNCHANGED** | — |
| **D3** (CAS idiom) | **UNCHANGED** | — |
| **D4** (canonical two-key claim) | **AMENDED by D12** | the **ordered set survives verbatim**; only its **derivation** changes — from "per anchor" to "per resolved sale identity" (D11). The per-trigger derivation *is* the root cause of the double decrement |
| **D5** (shared helper) | **AMENDED by D11** | the helper's anchor becomes the **resolved identity**; the helper no longer accepts an anchor that asserts "I am the payments trigger" |
| **D6** (snapshot hierarchy) | **UNCHANGED** | — |
| **D7** (watermark) | **UNCHANGED** | — |
| **D8** (flip restructure) | **AMENDED by D13/D15** | the flip's linked-payment lookup stops using the cross-kind text join; it uses the resolver |
| **D9** (webhook charge path) | **AMENDED by D13/D14** | the po-resolution hint `event.data.order_id \|\| row.culqiChargeId` is **wrong** once the column is kind-correct (a `chr_…` is not an order id) ⇒ it becomes `data.order_id ?? row.culqi_order_id` (D14/A4); the upsert's conflict target becomes the sale's arbiter (D13/I3) |
| **D10** (backstop) | **AMENDED by D13/D15** | the candidate predicate's sibling link becomes the same-kind `culqi_order_id` join; the settlement pass must also read order-backed rows |
| **Risk 1** (a `chr_`-typed id could create a third claim key) | **CLOSED** | the key set is now per **sale** (D12), so an extra row cannot create an extra key; the row-per-sale invariant (D13) and the fail-closed rule (D14) remove the duplicate row at the source |
| **Risk 7** (no transition log for `payments`) | **AMENDED, risk unchanged** | the webhook still bumps `updatedAt` only on a real status change, so the watermark proxy holds; but the backstop's candidate set now spans both id columns |
| **File Changes** table | **AMENDED** | add `src/core/payments/saleIdentity.ts`, `migrations/0052_payments_culqi_order_id.sql`, `tests/unit/saleIdentity.test.ts`, and re-point the 12 sites in D15 |
| **Migration / Rollout** | **AMENDED** | 0051 is unapplied in both databases ⇒ it is a hard prerequisite; 0052 is additive with no data migration (D16) |

### Amendment R2 — implementation order

1. **0052 + schema** — add `payments.culqi_order_id` (+ unique index), regenerate the DB types.
2. **`saleIdentity.ts`** — the resolver (D11) and the pure `resolveClaimKeys` (D12).
3. **Re-point the readers** (D15) — the same-kind link everywhere; the cross-kind equality is deleted.
4. **Row lifecycle** (D13) — the charge route and the webhook resolve-before-write and adopt on conflict.
5. **Webhook attribution** (D14) — A1/A2/A3/A4, incl. the fail-closed path.
6. **Claim set** (D12) — `fulfillPaidSale` takes the resolved identity; every trigger resolves first.
7. **Regression tests** (D17) — T1–T5, with the harness constraint honoured.
8. **0051 + deploy** — only after 0051 is applied (D16).
