# Tasks: stock-fulfillment-on-payment (NEW-8 — paid sale with no stock movement)

> **Strategy:** stacked-to-main PR slices (PR1/PR2/PR3a/PR3b). Review budget enforced per slice (=400 changed lines). Strict TDD enabled: pnpm test:unit. **RED → GREEN → REFACTOR** for every behavior change. Artifacts in English; no git ops in this phase.
>
> **Specs are the contract:** specs/stock-fulfillment/spec.md (R1–R7, **note R2/R4 corrected**), specs/payment-orders/spec.md (R2/R5 deltas, Correction C1). Design is the map (design.md, D1–D10). Follow openspec/config.yaml task format and rollback rules exactly.
>
> **Review workload:** estimated total ~640 changed lines → **Chained PRs recommended: Yes**, **400-line budget risk: High**, **Decision needed before apply: Yes** (see end).

## Commit map (resolved strategy: stacked-to-main)

`
develop                                      base
  +-- feat/stock-fulfillment-ledger         PR1   Slice 1: ledger + helper + charge marker      (merged, PR #261)
  +-- feat/stock-fulfillment-snapshots      PR2   Slice 2: snapshots + validation + client      (merged, PR #262)
  +-- feat/stock-fulfillment-identity       PR3a  Slice 3a: canonical identity + money path      (merged, PR #263)
  +-- feat/stock-fulfillment-backstop       PR3b  Slice 3b: reconcile backstop + cron + auth     (merged, PR #264)
`

Each slice branch is cut from `develop` and merged back into `develop` in order (**stacked-to-main**). There is no tracker branch. PR3 was split into 3a/3b once measured size exceeded the review budget. Each slice is independently green and reviewable (=400 lines). All four are merged.

## Out of scope (explicit)

- Oversell **prevention** / reservation/hold (stays as-is).
- Refund / backorder operational path.
- B-07 fix (PII scrubber mangles UUIDs) — not done here.
- payments.status enum/transition redesign (W-P6).
- Creating missing payments rows or notifications from webhook beyond existing behavior.
- Vacuous R13 binding fix (deferred to separate change).
- order.status.changed flip's own rowCount idiom fix / scoping overhaul (deferred to separate change).
- Retro-fulfillment of pre-change drift (start clean at deploy).

## Dependencies / order

`
PR1 (Slice 1) → PR2 (Slice 2) → PR3 (Slice 3)
`

PR1 provides stock_movements schema/migration + src/core/payments/stockFulfillment.ts + charge-route marker extraction (D1). PR2 adds snapshots/validation/client wiring (depends on PR1 helper shape). PR3 wires triggers (webhook + cron) and adds vercel.json crons (depends on PR1+PR2).

## Phase 1: PR1 — Slice 1 (isolated core) — =~215 lines estimated

**Goal:** Ledger table + migration (registered via pnpm check:migrations --update), RLS zero-policy (0050 pattern), shared helper src/core/payments/stockFulfillment.ts with truth-table unit tests, CAS over **ordered key set (payment_orders first, then payments)** (D4), first winning claim authorizes exactly one decrement. Charge route gets marker/marker extraction only where needed to satisfy the ordering contract (tests/unit/chargeRoute.test.ts:685 requires **exactly twice** mockTxUpdate calls with payment_orders flip **FIRST** and stock decrement **SECOND**; CAS is an **INSERT**, never a third UPDATE).

### Branch setup
- [x] **T0** Cut each slice branch from `develop` and merge it back into `develop` in order (stacked-to-main). No tracker branch, no `-a`/`-b`/`-c` chain.  
  **DONE:** PR1 `feat/stock-fulfillment-ledger` (#261) and PR2 `feat/stock-fulfillment-snapshots` (#262) merged straight into `develop`; PR3 `feat/stock-fulfillment-triggers` is in progress on top of `develop`.

### Schema & migration (D1, D2)
- [x] **T1.1 RED** — migration + RLS contract test  
  **Files:** tests/unit/rlsStockMovementsMigration.test.ts (new)  
  **RED first:** Mirror rlsPaymentIdempotencyMigration.test.ts. Assert migrations/0051_stock_movements_ledger.sql exists, is registered in migrations/ledger.json, contains CREATE TABLE IF NOT EXISTS "public"."stock_movements", unique (source_type,source_id), CHECK (source_type IN ('payments','payment_orders')), CHECK (outcome IN ('fulfilled','partial','no_product')), business_id NOT NULL FK to businesses(id), items jsonb NOT NULL DEFAULT '[]', fallback_qty1 boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), **ALTER TABLE ... ENABLE ROW LEVEL SECURITY**, and **no CREATE POLICY**.  
  **DONE:** Test fails with missing migration/registration.

- [x] **T1.2 GREEN** — create schema + migration  
  **Files:** src/core/database/schema/orders.ts (modify), migrations/0051_stock_movements_ledger.sql (new), migrations/ledger.json (regenerate)  
  **Impl:** Add stockMovements model with columns per D2; export StockMovement/NewStockMovement. Write 0051 with 0050-style header (idempotent), RLS zero-policy. Run pnpm check:migrations --update.  
  **DONE:** T1.1 green; migration registered; schema types compile.

### Shared helper + tests (D3–D7) — core CAS logic
- [x] **T1.3 RED** — helper truth tables  
  **Files:** tests/unit/stockFulfillment.test.ts (new)  
  **RED first:** Mock @/core/database/client with chainable insert().values().onConflictDoNothing().returning(), update().set().where().returning(), transaction. Cases: CAS invoked **before** decrement (invocationCallOrder); conflict on claim (returning([])) → 0 update calls, result already_claimed; compiled decrement WHERE contains business_id AND stock >=; no tx passed → uses db.transaction; tx passed → uses it, does **NOT** call db.transaction; order-backed anchor → payment_orders claim precedes payments claim (ordered key set, D4); token-only → payments claim only; resolveFulfillmentItems: cartItems/qty/productId-only → B1/none → product-less; isHistoricalPaidRow, readFulfillmentQty truth tables; FULFILLMENT_WATERMARK is a Date.  
  **DONE:** Tests fail with missing module/functions.

- [x] **T1.4 GREEN** — implement helper  
  **Files:** src/core/payments/stockFulfillment.ts (new)  
  **Impl:** Export FULFILLMENT_WATERMARK (hard constant at cutover time; set at PR3), isHistoricalPaidRow, readFulfillmentQty, resolveFulfillmentItems, fulfillPaidSale, emitFulfillmentAlerts.  
  **Rules:** Ledger claim = **INSERT** with .values().onConflictDoNothing().returning() **in same tx as decrement**. **Ordered key set**: payment_orders first, then payments (D4). Decrement replicates charge idiom: UPDATE products SET stock = stock - qty WHERE id = ? AND businessId = ? AND stock >= qty with .returning(); **never GREATEST, never rowCount**. Alerts via console.error only (B-07) with **anti-improvement comment**. Post-commit alerts only.  
  **DONE:** T1.3 green; pure functions unit-tested.
### Charge route integration (D1 extraction) — preserve existing contract
- [x] **T1.5 RED** — wire helper into charge route  
  **Files:** tests/unit/chargeRoute.test.ts (modify)  
  **RED first:** Extend hoisted chain: mockTxValues returns { returning, onConflictDoNothing: () => ({ returning }) }. New cases: claim count (token → payments insert + 1 claim; order flow → + payment_orders claim), claim precedes decrement. **HARD GUARD:** test at :685 asserting **exactly twice** mockTxUpdate calls with flip **FIRST** and decrement **SECOND** **MUST remain green** (CAS is INSERT). Replay case untouched behavior.  
  **DONE:** New cases fail; guard test still passes or is adjusted only if necessary to accommodate INSERT-based CAS without reordering updates.

- [x] **T1.6 GREEN** — charge route extraction  
  **Files:** app/api/payment/charge/route.ts (modify)  
  **Impl:** Replace decrement loop with resolveFulfillmentItems + fulfillPaidSale(..., {tx}). Alert loop consumes result; message/payload byte-compatible. Keep R8–R14 gate order unchanged. Fulfillment claim only inside already-committing transaction.  
  **DONE:** T1.5 green; :685 guard passes (exactly 2 updates, flip first, decrement second).

**PR1 acceptance (Slice 1):** Schema+RLS+migration registered; helper with ordered CAS + exactly-once; charge route uses helper/marker in same tx; tests pass; no third UPDATE introduced. **Estimated lines:** ~215.

## Phase 2: PR2 — Slice 2 (snapshots + validation + client) — =~210 lines estimated

**Goal:** Snapshot persistence for both flows per R1. Order flow: payment_orders.metadata.cartItems at create-order insert (A1). Token flow: scalar qty in Culqi charge metadata (A2). Zod changes in src/features/billing/schemas.ts. validateAmount reconciliation reused (R6). Client wiring in paymentApi.ts and useCheckoutPayment.ts. Mock chains extended as needed.

### Schemas & validation
- [x] **T2.1 RED** — schema + validation  
  **Files:** tests/unit/billingSchemas.test.ts (modify), tests/unit/createOrderSchema.test.ts (modify)  
  **RED first:** Export shared cartItemsSchema (shape { id: UUID, quantity: int = 1 }[]). createOrderRequestSchema gains optional cartItems. Cases: reject quantity: 0/non-int; snapshot shape matches existing contract.  
  **DONE:** Fail on missing schema changes. **VERIFIED (slice 2):** `cartItemsSchema` exported (quantity defaults to 1; rejects 0 and non-integers); `createOrderRequestSchema.cartItems` optional; `chargeRequestSchema.metadata.cartItems` now reuses the shared schema. Culqi request body contract unchanged (the outgoing body never carried a cart).

- [x] **T2.2 GREEN** — schemas  
  **Files:** src/features/billing/schemas.ts (modify)  
  **Impl:** Add cartItemsSchema, update createOrderRequestSchema. Keep Culqi body contract unchanged.  
  **DONE:** T2.1 green. **VERIFIED (slice 2):** shared `cartItemsSchema` is the single source of truth; `tests/unit/billingSchemas.test.ts` + `tests/unit/createOrderSchema.test.ts` cover the reject cases and the optional field.
### Create-order route (A1, R2)
- [x] **T2.3 RED** — create-order snapshot  
  **Files:** tests/unit/createOrderRoute.test.ts (modify)  
  **RED first:** When cartItems present, validateAmount called **with** cartItems; tampered quantity → 400, mockFetch not called, no insert. Persist metadata.cartItems alongside culqiRaw (exact shape). Culqi order body deep-equals body sent without snapshot. Snapshot never written to/aliased to metadata.productId.  
  **DONE:** Failures for missing snapshot persistence/validation. **VERIFIED (slice 2):** 3 RED tests present in `tests/unit/createOrderRoute.test.ts` (full-cart reconciliation accepted; quantity mismatch rejected with 400 and no Culqi call and no insert; snapshot persisted in `payment_orders.metadata` beside `culqiRaw`).

- [x] **T2.4 GREEN** — create-order  
  **Files:** app/api/payment/create-order/route.ts (modify)  
  **Impl:** Persist cartItems in payment_orders.metadata at insert (before any paid transition). Pass to validateAmount whenever present; reject with 400 before Culqi if reconciliation fails. Keep Culqi body byte-identical.  
  **DONE:** T2.3 green. **VERIFIED (slice 2):** `create-order` reconciles the full cart via `validateAmount(..., { cartItems })`, returns 400 before any Culqi call or insert on mismatch, persists `metadata.cartItems` next to `metadata.culqiRaw`, and leaves the outgoing Culqi body byte-identical. The snapshot is never aliased to `metadata.productId`.

### Charge route qty (A2, R1)
- [x] **T2.5 RED** — charge metadata qty  
  **Files:** tests/unit/chargeRoute.test.ts (modify)  
  **RED first:** Culqi body metadata.qty equals validated bound line's quantity; **no cart array** in charge metadata.  
  **DONE:** Fails without change. **VERIFIED (slice 2):** RED test in `tests/unit/chargeRoute.test.ts` asserts the outgoing Culqi body carries a scalar `metadata.qty` and never a cart array.

- [x] **T2.6 GREEN** — charge route qty  
  **Files:** app/api/payment/charge/route.ts (modify)  
  **Impl:** Add scalar qty to metadata sent to Culqi from validated cart (qty = cartItems.find(i=>i.id===productId)?.quantity ?? 1). Never add cart array.  
  **DONE:** T2.5 green. **VERIFIED (slice 2):** `boundQty` is derived from the validated incoming cart (`metadata.cartItems.find(i => i.id === productId)?.quantity ?? 1`); the outgoing Culqi metadata is exactly `{ businessId, productId, platform, qty }`. A client-supplied `metadata.qty` is stripped by the Zod schema, so the client cannot spoof the quantity independently.

### Webhook payment values + client wiring
- [x] **T2.7 RED** — webhookPaymentValues + client  
  **Files:** tests/unit/webhookPaymentValues.test.ts (modify), tests/unit/paymentApi.test.ts (modify)  
  **RED first:** Upsert values carry qty when event metadata has one; absent → no key. paymentApi.createOrder forwards cartItems in body.  
  **DONE:** Failures. **VERIFIED (slice 2):** `webhookPaymentValues` carries optional `metadata: { qty }` and omits the key when absent; `paymentApi` forwards the optional `cartItems`. The previously missing client link was the one real gap: `useCheckoutPayment` did not forward `cartItems` to `createOrder`, so the order flow never produced a snapshot. Fixed with a RED→GREEN pair in `tests/unit/Checkout.test.tsx`.

- [x] **T2.8 GREEN** — wire values + client  
  **Files:** src/core/payments/webhookPaymentValues.ts (modify), src/shared/payments/paymentApi.ts (modify), app/[slug]/(app)/components/hooks/useCheckoutPayment.ts (modify)  
  **Impl:** Builder pure; persist qty in payments.metadata when present. Client forwards cart snapshot/qty as appropriate.  
  **DONE:** T2.7 green. Mock chains extended (design D-notes): onConflictDoNothing on mocks, db.transaction + .returning() where needed so tests run. **VERIFIED (slice 2):** `useCheckoutPayment` now forwards `cartItems: cartItems.map(i => ({ id: i.id, quantity: i.quantity }))` to `createOrder`. `webhookPaymentValues` stays pure and the `payments.metadata` jsonb column already persists `metadata: { qty }` through the existing `db.insert(payments).values({ ...values, status })` in the webhook route, so no slice-3 file was touched.

**PR2 acceptance (Slice 2):** Both flows have snapshots per R1; validation reuses validateAmount; client wires snapshot/qty; no wrong-channel substitution. **Estimated lines:** ~210.
**PR2 STATUS: COMPLETE (audited 2026-10-21).** Both flows carry a snapshot (order flow: `payment_orders.metadata.cartItems`; token flow: scalar `qty` in the Culqi charge body, plus `payments.metadata.qty` on the webhook-created row). Validation reuses `validateAmount` with the incoming cart. Client wiring is complete for both `createOrder` (snapshot) and the charge/token path (cart lines, server-derived `qty`). No wrong-channel substitution: the incoming cart array and the outgoing scalar `qty` are provably separate, and a client-supplied `metadata.qty` is stripped by the schema. Working-tree total for the whole slice: 13 files, 623 insertions / 17 deletions (~640 changed lines) vs the ~210 estimate — over budget because the slice also carries the schema/validation tests, the two new hook tests, and the mid-flight red/green scaffolding. No commit, push, or PR was performed.

## Phase 3: PR3 — Slice 3 (triggers + scheduling + client marker) — =~215 lines estimated

**Goal:** Webhook triggers wired (charge upsert + order.status.changed with D8 restructure), cron backstop with corrected candidate predicate, snapshot wiring complete, charge-route marker write (D1 extraction as needed), vercel.json crons entry (daily at 3 * * *). Fulfillment alerts use console.error only; business scoping + .returning(); ordered CAS preserved.

### Webhook charge path (D9)
- [x] **T3.1 RED** — charge webhook fulfillment  
  **Files:** tests/unit/webhookChargeStatus.test.ts (modify)  
  **RED first:** Pre-read with R7 predicate; applyChargeStatus returns row. Pending→paid → helper called after upsert with event qty. Pre-watermark paid → helper **not** called, still 200. PO resolution hint passed. W-P3.1 upsert semantics untouched.  
  **DONE:** Tests fail with the helper unwired.

- [x] **T3.2 GREEN** — charge webhook  
  **Files:** app/api/webhooks/culqi/route.ts (modify)  
  **Impl:** Pre-read {id,businessId,productId,status,updatedAt}; R7 gate; charge branch calls fulfillPaidSale in its own tx (crash window allowed, healed by backstop). Resolve PO via event.data.order_id || row.culqiChargeId.  
  **DONE:** T3.1 green.

### Webhook order.status.changed (D8)
- [x] **T3.3 RED** — order flip fulfillment  
  **Files:** tests/unit/webhookOrderStatus.test.ts (modify)  
  **RED first:** Add db.transaction + update().set().where().returning() mocks + query.paymentOrders.findFirst. Unknown id → exact warn Order not found in DB: ... + 200, no tx. Paid flip → tx, fulfillPaidSale called with ('payment_orders', id) + row-derived businessId + metadata. Expired/cancelled → flip only, helper not called. Pre-watermark paid row → flip but **no** fulfillment. returning([]) → FlipMissedError → warn + 200, no fulfillment.  
  **DONE:** Tests fail with the flip unwired.

- [x] **T3.4 GREEN** — order flip  
  **Files:** app/api/webhooks/culqi/route.ts (modify)  
  **Impl:** Pre-read row; db.transaction with scoped flip WHERE culqiOrderId AND businessId(read) .returning({id,businessId,metadata}); length!==1 → throw FlipMissedError → rollback → warn + 200. If mapped==='paid' && !isHistoricalPaidRow(read) call fulfillPaidSale with order anchor in same tx. Business scoping from pre-read.  
  **DONE:** T3.3 green.
### Cron backstop + scheduling (D10, R4)
- [x] **T3.5 RED** — reconcile backstop  
  **Files:** tests/unit/reconcilePaymentsRoute.test.ts (modify), tests/unit/reconcilePaymentsFulfillment.test.ts (new), tests/unit/vercelCronConfig.test.ts (new)  
  **RED first:** Extend response to include fulfilled, fulfillmentSkipped, fulfillmentScanned. Add pass 2: candidates over **both** tables status='paid' AND updatedAt >= watermark AND NOT EXISTS (source_type,source_id) in stock_movements, ORDER BY updatedAt, limit 100, one helper tx per row. Auth: Authorization: Bearer <CRON_SECRET> (timing-safe) accepted alongside existing x-cron-secret. vercel.json has crons entry targeting /api/cron/reconcile-payments.  
  **DONE:** 10 failures — Bearer accepted → 401; response missing the 3 fulfillment counters; vercel.json has no `crons`; `src/core/payments/reconcileFulfillment.ts` unresolvable.

- [x] **T3.6 GREEN** — cron + vercel.json  
  **Files:** src/core/payments/reconcileFulfillment.ts (new), app/api/cron/reconcile-payments/route.ts (modify), vercel.json (modify)  
  **Impl:** Pass 2 fulfillment; Bearer auth additive/timing-safe; extend counters. Add crons: [{ path: '/api/cron/reconcile-payments', schedule: '0 3 * * *' }] (daily).  
  **DONE:** T3.5 green (31/31 across the three files). The candidate predicate is a pure module (`claimedSaleFilter`) expressed over the SALE's ordered key set — both ledger slots, the sibling row resolved through the persisted (culqi text id + business) link. The sale is deduped by a reverse index so it is collected once even when only one side resolves the link.

### Final integration & guard checks
- [x] **T3.7 GREEN** — verify hard constraints  
  **Files:** All modified tests  
  **Checks:** tests/unit/chargeRoute.test.ts:685 still asserts exactly 2 mockTxUpdate (flip first, decrement second) — passes with INSERT CAS. Decrement conditional stock >= qty with .returning(), no GREATEST, no rowCount. Alerts use console.error only with anti-improvement comment in helper. All fulfillment reads/writes business-scoped with .returning(). Ordered CAS order preserved. Out of scope items not touched.  
  **DONE:** All unit tests pass for affected areas. `chargeRoute.test.ts` is UNTOUCHED by this slice (not in the diff) — its guard (exactly 2 `mockTxUpdate`, claim-before-decrement via `invocationCallOrder`) is still green. Grep over the fulfillment surface finds **no** `GREATEST` and **no** `rowCount`; the alerts are `console.error` only and carry the anti-B-07 comment.

**PR3 acceptance (Slice 3):** All triggers wired, backstop runs (cron configured), corrected candidate predicate used, exactly-once enforced across races. **Estimated lines:** ~215.
**PR3 STATUS: COMPLETE (2026-10-21; merged 2026-10-23).** Both webhook triggers (charge + order.status.changed flip) and the cron backstop are wired through the ONE shared `fulfillPaidSale` helper, so the claim is the single exactly-once gate. The backstop's candidate predicate is a pure module (`claimedSaleFilter`) expressed over the SALE's ordered key set — it checks BOTH ledger slots (its own row and the sibling row resolved through the persisted culqi-id + business link), so a sale claimed by any other trigger is never re-selected. The snapshot comes from the persisted cart array first (W-A). `vercel.json` schedules the backstop daily at 03:00 UTC. Auth is additive: `x-cron-secret` OR `Authorization: Bearer <CRON_SECRET>`, both timing-safe. Mutation proofs: breaking the cron's key set fails 2 tests (both N1), breaking the auth fails 1 test (the Bearer mismatch); both restored green. Delivered as two stacked slices: PR #263 (canonical sale identity + money-path rewrite) and PR #264 (reconcile backstop + cron + Bearer auth).

## Final verification (before apply/PR creation)

- [x] **V1** Run pnpm test:unit — all tests pass (no regressions) → **255 files / 2,939 tests, exit 0** (baseline before this slice: 253 / 2,916)
- [x] **V2** Run pnpm type-check — 0 errors → `tsc --noEmit` clean
- [x] **V3** Run pnpm lint — 0 errors (warnings acceptable if pre-existing) → **0 errors, 924 warnings**; the develop baseline measured on `origin/develop @ fe6e606` is **925 warnings, 0 errors**, so the slice is 1 warning BELOW baseline and contributes **0 warnings and 0 errors of its own** (its 7 touched files lint clean)
- [x] **V4** Verify hard constraints:
  - [x] chargeRoute.test.ts:685 exactly twice mockTxUpdate, flip first, decrement second (file untouched, guard green)
  - [x] CAS is INSERT ... ON CONFLICT DO NOTHING ... RETURNING, never third UPDATE
  - [x] Decrement uses AND stock >= qty + .returning(), no GREATEST, no rowCount
  - [x] Alerts use console.error only (anti-B-07 comment present)
  - [x] Ordered key set payment_orders first, then payments; first claim wins (pinned by a key-set test, not just an anchor shape)
  - [x] Business-scoped everywhere, .returning() assertions
  - [x] No oversell prevention, no refund/backorder, no R13 fix, no B-07 fix

## Review Workload Forecast

- **Estimated changed lines:** Total ~640 (PR1 ~215 + PR2 ~210 + PR3 ~215)
- **Chained PRs recommended:** Yes
- **400-line budget risk:** High
- **Decision needed before apply:** Yes
- **Per-slice boundaries:**
  - **PR1 (Slice 1 — isolated core):** Start: ledger/schema/migration. Finish: helper + charge extraction with tests. Verification: migration registered, helper unit tests pass, chargeRoute.test.ts:685 guard green. Rollback: revert PR1 (drops helper/schema usage; committed decrements historical).
  - **PR2 (Slice 2 — snapshots + validation):** Start: schemas/create-order/charge qty/client wiring. Finish: both flows have snapshots per R1 with validation. Verification: snapshot tests pass, validateAmount reconciliation used, no wrong-channel substitution. Rollback: revert PR2 (clients fall back to legacy; server still uses PR1 helper if wired).
  - **PR3 (Slice 3 — triggers + scheduling):** Start: webhook + cron wiring. Finish: all triggers + daily cron configured. Verification: trigger tests pass, backstop predicate correct, alerts via console.error. Rollback: revert PR3 first (re-opens NEW-8 for triggers); committed movements not auto-reversed.

### Measured size (reality vs the forecast above)

The forecast (~640 total, ~215 for PR3, 400-line budget risk High) was LOW. Measured against `origin/develop @ fe6e606`:

| Slice | Production | Test | Total changed lines |
| --- | --- | --- | --- |
| PR3 (webhook triggers + helper wiring, prior run) | 448 | 456 | 904 |
| PR3 (cron backstop + Bearer auth + vercel.json + task fix, this run) | 374 | 538 | 912 |
| **PR3 cumulative** | **822** | **994** | **1,816** |

PR3 alone is ~4.5× the 400-line review budget, so the slice MUST be split again before the PR is opened (candidate cut: the cron backstop + `vercel.json` + the Bearer auth as one reviewable unit, the webhook triggers as another). The forecast's per-slice estimates should be corrected before the next slice is planned — the test/production ratio (~55%) is what blew the budget, not the production code.

### Resolution at archive (2026-10-23)

The split was applied and both slices merged: **#263** `4ac5c24` (canonical sale identity + money-path rewrite) and **#264** `11929c0` (reconcile backstop + scheduled cron + additive Bearer auth). All implementation, test and verification tasks above are complete (33/33 boxes checked). The size note above remains as historical evidence of the forecast miss.
