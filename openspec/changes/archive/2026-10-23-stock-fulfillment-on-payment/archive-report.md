# Archive Report — `stock-fulfillment-on-payment` (NEW-8)

**Archived**: 2026-10-23
**Change**: `stock-fulfillment-on-payment`
**Archived to**: `openspec/changes/archive/2026-10-23-stock-fulfillment-on-payment/`
**Status**: CLOSED — implementation and verification complete; main specs synced.

---

## Executive Summary

Every paid sale now causes exactly one stock movement, no matter which path records the payment:
the charge transaction, the webhook charge upsert, the `order.status.changed` flip, or the reconcile
backstop. Before this change, `products.stock` was written in exactly one place (the charge route),
so sales recorded `paid` by the webhook moved no inventory at all (NEW-8).

The change delivered four merged slices on `develop`: a `stock_movements` claim ledger with a CAS
exactly-once gate, durable pre-payment snapshots in both payment flows, a canonically resolved sale
identity (the amendment that closed a double-decrement found during verification), and a scheduled
reconcile backstop. It also synced the new `stock-fulfillment` capability spec and amended
`payment-orders` R2/R5.

**Deployment warning**: migrations `0051` and `0052` are NOT applied in dev or prod. The scheduled
backstop MUST NOT be enabled until they are (see Operational Prerequisites).

---

## Delivered

| PR | Slice | Commit | Content |
|---|---|---|---|
| #259 | docs | `9e8c5a8` | Oversell finding recorded (predecessor, merged to `develop`) |
| #261 | 1 | `533bf99` | `stock_movements` ledger + migration 0051 + shared `stockFulfillment` helper + charge-route claim/decrement extraction |
| #262 | 2 | `fe6e606` | Durable snapshots in both flows: `create-order` persists `metadata.cartItems`; token flow sends scalar `qty` on charge metadata; amount reconciliation |
| #263 | 3a | `4ac5c24` | Canonical sale identity (D11–D18): kind-correct `culqi_charge_id` / `culqi_order_id`, migration 0052, one `payments` row per sale, ordered key set |
| #264 | 3b | `11929c0` | Reconcile backstop, `vercel.json` daily cron, additive Bearer auth; `origin/develop` tip |

Rollback is slice-wise in reverse order (#264 → #263 → #262 → #261). Committed `stock_movements` rows
are historical facts and are not auto-reversed by a code revert.

---

## Specs Synced

| Domain | Action | Details |
|---|---|---|
| `stock-fulfillment` | **Created** | 7 requirements added (R1–R7), 0 modified, 0 removed. New authoritative spec at `openspec/specs/stock-fulfillment/spec.md`; delta converted from change header to published contract with provenance and contract map. |
| `payment-orders` | **Updated** | 0 added, 2 modified (R2 `POST /api/payment/create-order`; R5 `order.status.changed`), 0 removed. R1, R3, R4, R6, R7 and R8–R14 preserved untouched. |

### `payment-orders` changes in detail

- **R2 (modified)**: accepts optional validated `cartItems` (`{ id, quantity }[]`, ≤100, no
  duplicates), persists it as `metadata.cartItems` at insert, validates the amount against the
  DB-derived total through `validateAmount`, keeps the Culqi order request body unchanged, and
  preserves single-product behavior when `cartItems` is empty. New scenarios cover snapshot
  persistence, wrong/tampered amount rejection, empty cart, and invalid shape.
- **R5 (modified)**: `pending → paid` now fulfills stock atomically with the status flip, only from
  `pending`, using the persisted order snapshot; product-less paid orders update status with no
  stock effect and are recorded terminal. New scenarios cover snapshot fulfillment, duplicate flip,
  and product-less paid orders.
- **Correction C1 (state note only)**: the stale `order-integrity` header claiming R8–R14 were
  "PENDING MERGE / not in production" was corrected. R8–R14 are in `develop`; the note now records
  the merge PRs and warns that branch ancestry (`feat/order-integrity`) is misleading because the
  branches are stale locals and the remote was deleted. No requirement text was altered.

Destructive-delta check: none. No requirement was removed, and no large section was replaced.

---

## Verification Evidence

| Report | Scope | Outcome |
|---|---|---|
| `verify-report.md` | Slice 1 | PASS WITH WARNINGS after 3 CRITICAL fixes |
| `verify-report-pass3.md` | Slice 3 (first pass) | FAIL — one sale could be claimed under two key types and double-decrement |
| `verify-report-pass4.md` | Slice 3 after D11–D18 amendment | PASS |

Final gates on the merged tree:

- `pnpm test:unit` — **256 files / 2,957 tests, exit 0**
- `pnpm quality` — **0 errors, 928 warnings**; `develop` baseline 926 warnings (no new errors)
- Hard constraints re-checked: CAS is `INSERT … ON CONFLICT DO NOTHING … RETURNING`; decrement uses
  `AND stock >= qty` + `.returning()`, never `GREATEST` or `rowCount`; business-scoped throughout;
  alerts use `console.error` only (B-07 constraint); no oversell prevention, refund path, R13 fix,
  or B-07 fix was smuggled in.

The FAIL from pass 3 is retained as part of the audit trail. It is superseded by the pass-4 PASS and
the final gates above.

---

## Task Completion

`tasks.md`: **33 / 33 boxes checked**, 0 unchecked. The stale "PR3 in progress / must be split before
opening" notes were updated at archive to reflect the actual 3a/3b split and merges (#263, #264).

---

## Operational Prerequisites

1. **Apply migrations before enabling the backstop.** `0051_stock_movements_ledger.sql` and
   `0052_payments_culqi_order_id.sql` are not applied in dev or prod; `stock_movements` does not
   exist in either database. Enabling the cron first makes it throw
   `relation "stock_movements" does not exist`.
2. **Enable the scheduled backstop only after both migrations are applied.** `vercel.json` contains
   the daily `0 3 * * *` cron entry; Vercel will invoke it regardless of database readiness.
3. **No retro-fulfillment.** Do not backfill pre-deployment paid rows (forbidden by R7 and
   implemented by the `FULFILLMENT_WATERMARK` candidate bound).

---

## Carried-Forward Risks

- **Oversell is observable, not prevented.** Concurrent checkouts can still sell the last unit
  twice; the clamp keeps stock non-negative and alerts. Reservation/hold designs remain out of scope.
- **`oversold` marker durability / refund path deferred.** The ledger is shaped to host compensating
  movements later; nothing implements them yet.
- **B-07**: `src/lib/piiScrubber.ts:13` mangles UUIDs. Fulfillment alerts deliberately use
  `console.error` (never the structured logger or Sentry) so identifiers survive. Do not "upgrade"
  these alerts until B-07 is fixed.
- **R13 product binding is vacuous.** Nothing writes `payment_orders.metadata.productId`, so
  `ORDER_PRODUCT_MISMATCH` cannot fire today; the order path relies on the snapshot instead. Fixing
  the binding was deferred.
- **Legacy duplicate caveat (measured non-existent).** An existing `payments` row with a Culqi order
  id in `culqi_charge_id` could, in principle, double-decrement; dev had 89 rows, all `chr_…`, and
  prod had 0. Monitoring only.
- **`tasks.md` measured-size note** remains ~4.5× over the 400-line review budget for PR3, retained
  as historical evidence that the forecast was low.

---

## Artifact Index

| Artifact | Path |
|---|---|
| Proposal | `proposal.md` |
| Design (amended D11–D18) | `design.md` |
| Tasks | `tasks.md` (33/33 complete) |
| Delta spec — new capability | `specs/stock-fulfillment/spec.md` |
| Delta spec — payment orders | `specs/payment-orders/spec.md` |
| Apply progress | `apply-progress.md` |
| Verification (slice 1) | `verify-report.md` |
| Verification (slice 3 FAIL) | `verify-report-pass3.md` |
| Verification (slice 3 PASS) | `verify-report-pass4.md` |
| Event-shape investigation | `pr3-event-shape.md` |
| Archive report | `archive-report.md` |

**Synced source of truth**:
- `openspec/specs/stock-fulfillment/spec.md`
- `openspec/specs/payment-orders/spec.md`

---

## SDD Cycle Complete

Planned → specified → designed → implemented → verified → archived. The change is closed and the
main specs reflect the shipped behavior.
