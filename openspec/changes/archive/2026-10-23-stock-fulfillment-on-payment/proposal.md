# Proposal: stock-fulfillment-on-payment (NEW-8 — paid sale with no stock movement)

> Follow-up to the silent-oversell clamp fix merged at `9e8c5a8`. That change made the charge
> transaction's decrement conditional + loud; THIS change closes the paths that never reach that
> transaction at all (webhook-recorded payments, reconciled payments, async orders paid via webhook).

## Intent

**Every paid sale causes exactly one stock movement, regardless of which path recorded the
payment.** Today `products.stock` is written in exactly one place (the charge route's transaction);
the Culqi webhook's `applyChargeStatus` upsert (W-P3.1), `order.status.changed`, and the reconcile
cron can all record a `paid` state without any inventory movement. Culqi captures a charge, the
client's `/api/payment/charge` call fails/times out, the webhook records `paid` — oversell by drift.

## Scope

### In Scope

- A recoverable fulfillment snapshot (product + quantity) persisted **before money moves**: order
  flow via `payment_orders.metadata` in `create-order`; token flow via qty added to the Culqi
  charge `metadata` the charge route already sends.
- Exactly-once stock fulfillment triggered when a payment becomes `paid` by **any** path: charge
  transaction (already correct — gains only a completion marker), webhook charge upsert,
  `order.status.changed`, with the reconcile cron as backstop.
- A single shared fulfillment helper (conditional decrement idiom, business-scoped) and a
  completion marker so no two triggers decrement the same sale.
- Server-side validation of the snapshot quantity (it is client-influenced; it MUST NOT become a
  free `qty` knob — same trust class as `validateAmount`).
- A **scheduled** reconcile backstop: `vercel.json` gains a `crons` entry for
  `app/api/cron/reconcile-payments/route.ts`, so the backstop actually runs (today nothing
  schedules it — see Resolved Input).
- Correcting the stale R8–R14 state note in `openspec/specs/payment-orders/spec.md` (this change
  already amends that spec).

### Out of Scope

- Oversell **prevention** under concurrency (reservation/hold designs) — prevention stays as-is.
- Refund / backorder operational path (the ledger below is chosen so it can host this later).
- B-07 (PII scrubber mangles UUIDs). `payments.status` enum/transition redesign (W-P6).
- Creating missing `payments` rows or notifications from the webhook beyond what already exists.
- **Deferred to a SEPARATE change (decided)**: the vacuous R13 product binding. Nothing writes
  `payment_orders.metadata.productId`, so `readOrderProductBinding` always resolves `'absent'` and
  R13's product-mismatch denial cannot fire on the order flow. Verified during the spec phase:
  every `metadata: { businessId, productId, platform }` occurrence (`charge/route.ts:176`,
  `create-order/route.ts:176`, `penalties/pay/route.ts:130`, `purchase-plan/route.ts:177`) is a
  **Culqi API request body**, not a `payment_orders` row write. Split out because it has a
  different blast radius, its own test matrix, and the fulfillment contract below does not depend
  on it (fulfillment reads `cartItems`/`qty`, not the R13 binding).
- **Deferred**: the `order.status.changed` flip's own `rowCount` usage and missing business scoping
  (webhook `route.ts:359-368`). This change routes fulfillment through `.returning()` with a
  row-derived `businessId` and leaves the flip's published idiom untouched.

## Existing contracts this change must respect / amend

| Contract | Relation |
|---|---|
| `payment-orders` R1 (`metadata` jsonb) | **Respect** — snapshot lives in existing jsonb under a namespaced key; R13's `metadata.productId` three-state binding MUST keep working (`readOrderProductBinding` must ignore the new key). |
| `payment-orders` R2 (`create-order` schema/persist) | **Amend** — accept and persist the cart snapshot; input schema grows, Culqi order body unchanged. |
| `payment-orders` R5 (`order.status.changed`) | **Amend** — a `pending → paid` flip now also fulfills stock (today it is status-only). Unknown-id scenario unchanged. |
| `payment-orders` R8–R14 (order-flow money gate) | **Respect** — charge-route semantics unchanged; the fulfillment marker write joins the existing transaction. **Sequencing caveat CLEARED: R8–R14 are IN `develop` (verified by code artifacts; see Resolved Input Q6). No blocker.** |
| `payment-orders` R10 (business scoping) | **Respect** — every fulfillment read/update MUST be business-scoped and row-count asserted (`.returning()` idiom, never `rowCount`). |
| W-P3.1 webhook upsert (`webhookPaymentValues.ts:1-19`) | **Respect** — the deliberate upsert is preserved; fulfillment hangs off the (possibly webhook-created) `payments` row, after it exists. |
| `order-flow` spec (V2 state machine) | **No amendment** — fulfillment completes before the order enters the state machine. |
| `seller-fraud-guards` (product lock) | **No amendment** — guards govern `updateProduct`; the server-side decrement is not that path (stock stays seller-editable per spec either way). |

## Capabilities

### New Capabilities

- `stock-fulfillment`: exactly-once stock movement for every paid sale — snapshot contract,
  fulfillment trigger points, completion marker/ledger, missing-snapshot handling.

### Modified Capabilities

- `payment-orders`: R2 (snapshot persisted at order creation), R5 (paid flip fulfills stock).

## Approach — options and recommendation

### A. Where the snapshot lives

| Option | Description | Tradeoff |
|---|---|---|
| **A1** | Persist `cartItems: [{productId, qty}]` in `payment_orders.metadata` at `create-order` (order flow has the pre-charge hop). | Zero new tables; webhook already reads the row. Client + Zod change; qty needs server-side trust validation; must not break R13 binding. |
| **A2** | Add `qty` (token flow is single-product) to the Culqi charge `metadata` the charge route already sends (`metadata: { businessId, productId, platform }`). The webhook already recovers `data.metadata`, and Culqi signs the payload. | No new pre-charge hop for the card flow; nothing new in our DB pre-charge. Culqi metadata size is bounded; qty is client-supplied at charge creation — validated server-side before the Culqi call. |
| **A3** | New pre-charge snapshot endpoint for the token flow. | Extra round-trip + client change + new surface for no gain over A2. **Reject.** |

**Recommendation: A1 (order flow) + A2 (token flow).** Together they cover both flows with the
minimum new machinery; A2 reuses the one channel the webhook can already read at failure time.

### B. What to fulfill when quantity is unrecoverable

| Option | Behavior for a paid row with no snapshot | Tradeoff |
|---|---|---|
| **B1** | Decrement `qty = 1` + structured log/alert. | Honest minimum movement (single-product is the norm); drift reduced, not eliminated. |
| **B2** | No write; alert only. | Leaves today's drift for legacy rows; simplest. |

**Recommendation: B1** for product-bound payments; **no stock effect** for product-less orders
(R13 explicitly permits them), with a log line only.

### C. Which trigger, and how exactly-once is guaranteed

| Option | Trigger | Tradeoff |
|---|---|---|
| **C1** | Webhook fulfills inline (charge upsert + order flip); reconcile cron is the backstop; both call one helper. Exactly-once via a CAS marker: a fulfillment row (see below) with a unique source key, claimed by `INSERT … ON CONFLICT DO NOTHING … RETURNING` (or conditional `UPDATE … WHERE not-fulfilled RETURNING`) **in the same transaction as the decrement**. Two racing triggers → exactly one wins; loser sees 0 rows and skips. | Small latency tolerance via cron; webhook downtime self-heals. Slightly more code than one trigger. |
| **C2** | Cron only. | Payment-to-stock latency = cron interval; cron reliability becomes load-bearing. |
| **C3** | Webhook only. | Webhook downtime permanently re-opens NEW-8. |

**Recommendation: C1.** Completion key: a new `stock_movements` ledger table with unique
`(sourceType, sourceId)` where source is `payments` (charge/token path — every such sale has
exactly one `payments` row thanks to the preserved W-P3.1 upsert) **or** `payment_orders`
(`order.status.changed` path — which flips the order row without creating a `payments` row, so
`payments.id` cannot be the universal key). A ledger (vs a boolean column) is chosen because one
table covers both source types, gives an audit trail for the refund path deferred out of scope,
and keeps the CAS mechanics in one place. Alternative (lighter): `stock_fulfilled_at` column on
each of `payments` and `payment_orders` — two CAS sites, no audit trail.

### D. Charge route inline decrement

| Option | Approach | Tradeoff |
|---|---|---|
| **D1** | Extract the conditional decrement into the shared helper; the charge route uses it and also writes the fulfillment marker in the same transaction. | One implementation; touches the hot, heavily-tested path. The #203 conflict risk is gone (R8–R14 are in `develop`), so the only question is regression appetite. |
| **D2** | Leave the inline decrement; only add the marker write to the transaction. Webhook/cron use the helper (duplicated ~10-line SQL). | Zero regression risk on the charge path; two copies of the decrement idiom. |

**Recommendation: D1** — the sequencing blocker is void (R8–R14 are in `develop`). D2 remains the
zero-risk fallback if the charge-route diff proves more entangled than the design allows.

## Resolved Input for Design

Every previously blocking question was settled against the codebase before design entry.

| # | Resolution | Evidence |
|---|---|---|
| Q1 | Multi-item carts are real on the token path, and the client ALREADY sends `cartItems` to `/api/payment/charge`. The snapshot shape MUST match the existing contract: `{ id, quantity }` (not `{ productId, qty }`). | `CartContext.tsx`, `CartDrawer.tsx`, `Checkout.tsx`, `useCheckoutPayment.ts:24,55,93,209`, `validateAmount.ts:18` |
| Q2 | Partially settled: `businessId`/`productId` already round-trip through the Culqi charge `metadata`, so a scalar `qty` on that same map is expected to arrive too. Residual check for design: Culqi's `metadata` size limit — the token path therefore carries a scalar `qty` only, never a whole cart array. | `webhookPaymentValues.ts:77-89`, `charge/route.ts:176` |
| Q3 | ALREADY SOLVED in existing code. `validateAmount` derives the authoritative amount from DB prices (`price`/`secondPrice`, business-scoped via `eq(businessId)` + `inArray`) and already consumes `cartItems: { id, quantity }[]`, summing `price × 100 × quantity`. The server-side quantity bound reuses that same source — no new mechanism. | `validateAmount.ts:35-71` |
| Q4 | **Ledger, not columns** (accepted). `order.status.changed` flips `payment_orders` WITHOUT creating a `payments` row, so no `payments`-keyed column can cover that path. Use `stock_movements` with unique `(sourceType, sourceId)`. | `payment-orders` R5; webhook `:338-369` |
| Q5 | **B1 accepted**: a paid row with no snapshot decrements `qty = 1` and alerts. No stock effect for product-less orders (R13 permits them). | Product decision |
| Q6 | **VOID — not a blocker.** R8–R14 ARE in `develop`. PR #203 merged into the `feat/order-integrity` TRACKER (not `develop`); the content reached `develop` via #211/#215/#224/#253. | Evidence list below |
| Q7 | **Start clean at deploy** (accepted): no retro-fulfillment of pre-change drift. Historical rows lack snapshots, and a mass retro-decrement could zero stock for products that sold correctly. | Product decision |

**Q6 evidence (R8–R14 present in `develop`)**: `readOrderProductBinding`, `getCulqiOrder`,
`isCulqiOrderPaid` in `app/api/payment/charge/route.ts`; `releaseIdempotencyKey` /
`reserveIdempotencyKey` plus `ORDER_AMOUNT_MISMATCH` / `ORDER_PRODUCT_MISMATCH` /
`ORDER_CURRENCY_MISMATCH` and the "RESERVE THE IDEMPOTENCY KEY BEFORE ANY EXTERNAL CALL (W-P1)"
comment (R13/R14); `migrations/0048_payments_order_number_integrity.sql`;
`src/core/payments/orderNumber.ts`; `src/lib/orderAccessCookie.ts` and `orderAccessGate.ts` (C4).

**Do NOT re-check this with branch ancestry**: `git merge-base --is-ancestor feat/order-integrity
origin/develop` returns 1 (the tracker branch object is not an ancestor) even though its content
shipped. The `feat/order-integrity*` branches are stale locals; the remote branch was deleted
after merge. Check code artifacts, not ancestry.

**New gap found while resolving Q1 (in scope)**: the order flow sends only the FIRST product —
`useCheckoutPayment.ts:161` sets `productId: cartItems[0]?.id`. Since `metadata.productId` is the
only product the webhook can recover, a multi-item order is unrecoverable at webhook time unless
the cart snapshot is persisted in `create-order`. This makes the A1 snapshot load-bearing, not
optional. Mitigating detail: when `create-order` fails the client logs "falling back to charge-only
flow", and that path DOES carry `cartItems` — it stays recoverable.

**The backstop must actually run (in scope)**: `vercel.json` has NO `crons` block and the only
workflow is `ci.yml`, so `app/api/cron/reconcile-payments/route.ts` is a dormant endpoint behind
`CRON_SECRET` that nothing calls. A `crons` entry is added so the C1 backstop exists in reality.
The exact schedule is decided in design, within the deployed Vercel plan's cadence limits.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/core/database/schema.ts` + migration | Modified/New | `stock_movements` ledger (or marker columns) |
| `src/core/payments/` (new helper, e.g. `stockFulfillment.ts`) | New | Snapshot validation + exactly-once fulfill |
| `app/api/webhooks/culqi/route.ts` | Modified | Fulfill on charge upsert + order paid flip |
| `src/core/payments/webhookPaymentValues.ts` | Modified | Recover `qty` from charge metadata |
| `app/api/payment/create-order/route.ts` + `src/features/billing/schemas.ts` | Modified | A1 snapshot persist + validation |
| `app/api/cron/reconcile-payments/route.ts` | Modified | Backstop fulfillment |
| `vercel.json` | Modified | Add a `crons` entry so the reconcile backstop actually runs |
| `openspec/specs/payment-orders/spec.md` | Modified | R2/R5 deltas + correct the stale R8–R14 state note |
| `app/api/payment/charge/route.ts` | Modified | Marker write (D2) or helper refactor (D1) |
| Storefront `Checkout.tsx` | Modified | Send cart snapshot / qty metadata |
| `tests/unit/` | Modified/New | Strict TDD (`pnpm test:unit`) |

## Size Forecast

| Slice | Content | Est. lines |
|---|---|---|
| 1 | Schema + fulfillment helper + ledger + unit tests | ~200 |
| 2 | Webhook + cron triggers + webhookPaymentValues + tests | ~160 |
| 3 | create-order snapshot + client metadata + charge marker + tests | ~280 |

**Total ≈ 640 — OVER the 400-line budget.** `Decision needed before apply: Yes` ·
`Chained PRs recommended: Yes` · `400-line budget risk: High`. Delivery strategy `ask-on-risk`.

## Rollback Plan

Additive only: no destructive schema delta, no data rewrite. Per-slice revert restores
"records payment, never fulfills" (re-opens NEW-8); already-decremented stock and existing
`stock_movements` rows are historical facts and are NOT auto-reversed (a compensating refund
movement is future work, out of scope). Down-migration drops only the new table/columns. Spec
deltas are additive requirements — reverting needs no spec rewrite.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Double decrement charge-route vs webhook race | Med | Same-transaction marker claim (CAS); loser skips on 0 rows |
| Snapshot qty is client-influenced → stock sabotage | Med | Server-side bound before any Culqi call (Q3) |
| Regression on the hot, heavily-tested charge path (D1 refactor) | Med | D1 only if design accepts it; D2 (inline decrement kept) is the zero-risk fallback |
| Webhook payload lacks metadata/qty in some event shape | Low | Fail to B1 (qty=1 + alert), never to silent skip |

## Dependencies

- **No merge dependency**: R8–R14 are already in `develop` (Q6 void). This change bases on
  `develop` directly.
- Strict TDD: `pnpm test:unit` (RED cases defined in tasks/design phases).
- A Vercel cron cadence available on the deployed plan — the schedule chosen in design MUST fit it.

## Success Criteria

- [ ] A paid charge whose client call to `/api/payment/charge` failed still produces exactly one
      stock decrement (webhook path).
- [ ] A paid async order (`order.status.changed`) produces exactly one stock decrement.
- [ ] Replay/racing triggers (webhook + cron + retry) never decrement twice for one source payment.
- [ ] Charge-route happy path behavior is unchanged apart from the marker write.
- [ ] `pnpm test:unit`, `pnpm type-check`, `pnpm lint`, `pnpm build` green.
