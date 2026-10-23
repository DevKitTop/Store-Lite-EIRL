# Verification Report — Pass 4 (fresh context, adversarial)

**Change:** `stock-fulfillment-on-payment` — Slice 3 / PR3
**Branch / HEAD:** `feat/stock-fulfillment-triggers` @ `fe6e606` (uncommitted working tree)
**Baseline:** `origin/develop` @ `9e8c5a8` (measured in a throwaway `git worktree`)
**Verified:** 2026-10-22 (UTC)
**Method:** every claim reproduced by executing code. The probe harness and the
baseline worktree were removed afterwards; `git status` is back to the
pre-verification 20 entries.

> Does not replace `verify-report.md` (slices 1–2) or `verify-report-pass3.md`
> (the FAIL that triggered this re-apply). This report covers only the re-apply
> of slice 3.

---

## 1. Status

**PASS for merge into the feature branch** — the pass-3 CRITICAL (double decrement)
is closed **by construction**, and the green suite was **not** bought with weakened
tests. Two WARNINGs must be handled **at deploy time / before archive**, none block
the merge.

Counts: 2 WARNING, 3 SUGGESTION, 0 CRITICAL.

---

## 2. Reproduced metrics

| Metric | Claimed | Measured | Verdict |
| --- | --- | --- | --- |
| Unit suite | 255 files / 2 947 tests green | **255 / 2 947 passed, exit 0** (52 s) | OK |
| `pnpm quality` | 0 errors | **0 errors** (`tsc --noEmit` exit 0) | OK |
| Lint warnings on branch | 928 | **928 problems (0 errors, 928 warnings)** | OK |
| `develop` lint baseline | 925 | **926 problems (0 errors)** | off by 1 |
| Lint delta | +3 | **+2** | off by 1 |
| Tracked churn | 2 017 + 432 | **2 017 insertions + 432 deletions** | OK |
| Untracked lines | 570 (5 files) | **1 094** (42 + 104 + 365 + 541 + 42) | understated by 524 |
| Total changed lines | 3 019 | **3 543** | understated |

The lint delta is real but smaller than claimed. The two removed warnings are
`security/detect-object-injection` (culqi webhook route, refactored away) and
`@typescript-eslint/no-unused-vars` (`tests/unit/createOrderRoute.test.ts`). The
four new ones:

| File:line | Rule |
| --- | --- |
| `app/api/cron/reconcile-payments/route.ts:177` | `complexity` (new function) |
| `app/api/webhooks/culqi/route.ts` (3 sites: 118 / 518 / 673) | `complexity` +1, `complexity` +1, `cognitive-complexity` +1 |
| `src/core/payments/saleIdentity.ts:297` | `complexity` (new file) |

Net +2 is an accurate description; "+3" was not reproducible.

---

## 3. PRIORITY 1 — was the suite weakened?

Per-file audit of every deleted/renamed assertion (`git diff HEAD -- tests/unit/`
shows exactly 11 removed `test(` titles, all accounted for):

| File (±) | Change | Verdict |
| --- | --- | --- |
| `chargeRoute.test.ts` (+24/−3) | renamed test; added `not.toMatch(/culqi_charge_id/)` on the order-flow insert | **strengthened** |
| `webhookPaymentValues.test.ts` (+12/−0) | pure addition (arbiter column) | **strengthened** |
| `stockFulfillment.test.ts` (+86/−18) | `rejects.toThrow(/no claim keys/)` → explicit `unresolved` outcome **plus** no-insert + no-update assertions | **strengthened** (contract change, see below) |
| `reconcilePaymentsRoute.test.ts` (+129/−10) | exact / superset expectations on the compiled query | **strengthened** |
| `webhookChargeStatus.test.ts` (+343/−46) | old "insert complete row" split into token-arbiter + order-arbiter cases; two "update-only fallback" tests replaced by fail-closed tests | **not weakened** |
| `webhookOrderStatus.test.ts` (+302/−81) | old `rowCount`-simulated updates replaced by pre-read-null / `returning([])` → `FlipMissedError`; default event now `state:'paid'`; identity + claim-key assertions added | **strengthened** |

Contract changes that justify the altered expectations (all specified, not
convenient):

- `stockFulfillment` no longer throws when the identity yields no key — **D14**
  ("a trigger whose identity is unresolvable writes nothing and does not error").
  The new test asserts the *outcome*, not the absence of an error, so the
  behavior is pinned more strictly than before.
- `webhookChargeStatus` update-only fallbacks became fail-closed because **D14**
  forbids writing a row without a resolvable business scope. The old tests
  asserted the fallback; the new ones assert the deletion of the row-creation
  path. No scenario lost coverage: the "existing row + no metadata businessId"
  case was untested before and is untested now (see S2).

Two residual weaknesses (reported, not weakening-by-edit):

- **W1 (test rigor):** `tests/unit/webhookOrderStatus.test.ts` resolver mocks
  (`mockTxPaymentOrdersFindFirst`, `mockPaymentsFindFirst`) ignore the compiled
  WHERE clause, so D17's "MUST assert compiled where" is satisfied for the *flip*
  but **not** for the sibling-link read. Compare
  `tests/unit/reconcilePaymentsFulfillment.test.ts:179/190`, which does assert
  SQL text and column kinds. A regression that swapped the link columns inside
  the resolver's `findFirst` would not fail this suite.
- **W2 (coverage gap):** `tests/unit/saleIdentity.test.ts` **does not exist**,
  although design D17 mandates it. `resolveSaleIdentity` is only covered
  transitively through route suites. Mutation M4 shows the indirect coverage is
  strong (8 failures), but the mandated file is missing from the delivery.

**Verdict: no assertion was weakened to obtain green.** No test asserts a
double decrement, no expectation was loosened from exact to substring, and no
`expectedCalls` count was removed.

---

## 4. PRIORITY 2 — is the double decrement closed by construction?

Probe harness (`tests/unit/zz_verify_probe.test.ts`, then deleted): an in-memory,
WHERE-aware fake DB that compiles drizzle predicates with
`new PgDialect().sqlToQuery(...)` and matches `"table"."column" op $n`, running the
**real** `cronPOST`, the **real** `resolveSaleIdentity` and the **real**
`fulfillPaidSale`. 4/4 passed.

| Probe | Scenario | Result |
| --- | --- | --- |
| P1 | backstop → `charge.paid` webhook → order flip | **1 decrement**, stock 10→8, claim keys exactly `payment_orders:<PO>` + `payments:<PAY>`, later triggers report `already_claimed` |
| P2 | token flow (no order) | 1 decrement, key `payments:<PAY_TOKEN>` only |
| P3 | identity that resolves nothing | `identity=null`, `resolveClaimKeys=[]`, outcome `unresolved`, 0 movements, 0 decrements, no throw |
| P4 | legacy row with `culqi_charge_id='ord_1'`, `culqi_order_id IS NULL` | **2 decrements**, fulfilled 2, stock 6 |

**Conclusion:** for the post-migration data shape the double decrement is
**structurally impossible** — every trigger derives the claim set from the same
resolved identity, and the claim is one `INSERT ... ON CONFLICT DO NOTHING
RETURNING` on `(source_type, source_id)`. P1 is the exact sequence that produced
the pass-3 CRITICAL and now yields one movement.

**P4 is the boundary:** the fix does **not** heal already-duplicated legacy rows;
it relies on no new duplicate being created. That is exactly what D16 decided
(no backfill in 0052, measure first). It is a delivery precondition, not a code
defect — see W3.

---

## 5. PRIORITY 3 — checklist

| # | Item | Method | Result |
| --- | --- | --- | --- |
| 1 | No Culqi text id can reach `stock_movements.source_id` | `migrations/0051` declares `source_id uuid NOT NULL` + `UNIQUE (source_type, source_id)` + CHECK on the kind; `grep source_id` shows only uuid row ids written; tests assert `not.toMatch(/ord_|chr_/)` | PASS (DB-level guard, not convention) |
| 2 | `rowCount` never read | `grep -n "rowCount" src app` → comments only | PASS |
| 3 | Migration 0052 idempotent & DDL-only | 42 lines, `ADD COLUMN IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS`, no DML; `pnpm check:migrations` OK (80 files, 56 manual-only, 21 grandfathered collisions) | PASS (structural) |
| 4 | `isCulqiOrderPaid` uses `state`, not `status` | `src/core/payments/culqiOrders.ts:107-111`; `status:'paid'` alone → `{mapped:null, reason:'unproven'}` + warn, no flip (test-covered) | PASS |
| 5 | Backstop candidate query covers both id kinds | `app/api/cron/reconcile-payments/route.ts:93+` reads `culqi_charge_id` and `culqi_order_id` kind-correctly, `.returning()` | PASS |
| 6 | Watermark bounded, no retro-fulfillment | `src/core/payments/stockFulfillment.ts:50` = `2026-10-21T00:00:00Z` | **WARNING W3** |
| 7 | Snapshot channel per flow | order-backed triggers read `payment_orders.metadata.cartItems`; token flow `metadata.qty` | PASS with W4 |
| 8 | No rely on hint for claim keys | `resolveClaimKeys` only emits DB row uuids | PASS |

---

## 6. Mutation proofs (all reverted; backups in `%TEMP%\verify-bak`)

| # | Mutation | Failures |
| --- | --- | --- |
| M1 | blind insert: `if (saleRow && false)` in `app/api/webhooks/culqi/route.ts:601` | `webhookChargeStatus` **4 failed / 7 passed** |
| M2 | order flip calls `fulfillPaidSale({ ...identity, paymentOrderId: null })` (`route.ts:388`) | `webhookOrderStatus` **3 failed / 15 passed** |
| M3 | unresolvable claims anyway (synthetic key, `stockFulfillment.ts:383`) | `stockFulfillment` **1 failed / 30 passed** |
| M4 | per-anchor resolver (one key by anchor kind) | **8 failed / 4 suites** (`chargeRoute` 3, `reconcilePaymentsFulfillment` 2, `stockFulfillment` 2, `webhookOrderStatus` 1) |

Notes worth carrying forward:
- M2 is caught by **identity assertions**, never by a decrement outcome — no
  test constructs two triggers with divergent claim sets.
- M3's single failure is the fail-closed test; a second trigger would have caught
  it too, so the fail-closed contract is load-bearing on its own.

---

## 7. Findings

### WARNING

**W3 — `FULFILLMENT_WATERMARK` is already in the past.**
`src/core/payments/stockFulfillment.ts:50` is `2026-10-21T00:00:00.000Z`; the
verification date (and therefore the earliest realistic merge/deploy) is
2026-10-22. Every `payments` row that became `paid` between those instants is
inside the candidate window, which R7 forbids ("no retro-fulfillment"). Today the
exposure is small (token-flow rows only, `payment_orders` is empty), but the
constant must be bumped to the actual cutover instant before deploy — it is a
one-line, deploy-blocking edit, not a code defect.

**W4 — order-flow snapshot falls back to a request-supplied cart.**
`app/api/payment/charge/route.ts:689` fulfils an **order-backed** sale from
`metadata.cartItems` of the **request** (`useCulqiCallback.ts:168/240` →
`paymentApi.ts:99`), while the webhook, the order flip and the backstop read
`payment_orders.metadata.cartItems`. Consequences:
- A legacy / non-storefront client that omits `cartItems` (e.g. the Culqi panel
  or a cached bundle) yields B1 (`qty` fallback = 1) with a **terminal claim** for
  a multi-unit order — the persisted quantity is then never applied.
- The request cart is buyer-controlled. `validateAmount` bounds the *total*, but
  a buyer paying an equal total can split the quantity across lines
  (`[{A,1},{B,1}]` for one unit) and shrink the decrement for A and B. No price
  manipulation (prices are read from the DB), only stock accounting.

Design Risk 6 describes this as "no movement"; the actual behavior is
"movement with the request's quantities". Fix direction: for `isOrderFlow`, use
the order row's `metadata.cartItems` (already loaded at `route.ts:359`) and
ignore the request cart.

### SUGGESTION

- **S1** — `app/api/webhooks/culqi/route.ts:194-203`: `applyRefundStatus` matches
  with `or(eq(culqiChargeId, chargeId), eq(culqiOrderId, chargeId))` — a value-kind
  OR, not a column-kind-correct predicate, and not business-scoped. Safe today only
  because `chr_`/`ord_` prefixes cannot collide; a malformed id would cross-read
  the wrong column.
- **S2** — the "existing row + payload without `metadata.businessId`" branch of
  `applyChargeStatus` (the adopt path) has no test. It is the one place where a
  row written by the charge route is enriched by the webhook.
- **S3** — `findOrderRow` (`route.ts:468`) and the `applyOrderStatusChanged`
  pre-read select by Culqi id only. Tenant safety holds because `businessId` is
  taken from the fetched row (R5), but a business-scoped predicate would make the
  guarantee local instead of inferential.

---

## 8. Could not verify

- Real Postgres behavior of `ON CONFLICT (culqi_order_id)` against the index created
  by 0052 (`CREATE UNIQUE INDEX IF NOT EXISTS`): verified by inspection only —
  no test DB is provisioned in this repo. Column-level uniqueness in the Drizzle
  schema (`orders.ts:70`) matches the migration name.
- D16's measurement itself (how many duplicate sale rows exist in production).
  P4 establishes only that the code depends on that number being 0.
- The `charge.paid` fail-closed path when the order row stays `pending`: the
  backstop reads only `status='paid'` rows, so nothing heals it. Accepted residual
  risk (design Risk 1), unchanged by this re-apply.

---

## 9. Non-obvious discoveries

1. The claim set is a **pure function of the identity**, so the double decrement
   is closed by *two* independent mechanisms: one resolved row per sale, and a
   single `(source_type, source_id)` CAS. P1 exercises both at once.
2. `payments.culqi_order_id` being `unique` *and* the conflict target means the
   webhook can safely race the charge route's insert; the loser enriches, it does
   not create a second row.
3. `source_id uuid` turns the "hint never becomes a key" rule from a code
   convention into a DB constraint — a text Culqi id would raise, not silently
   decrement twice.
4. The pass-3 lint baseline (925) could not be reproduced: a clean worktree of
   `origin/develop` at `9e8c5a8` reports 926. Under-reporting the delta hid one
   new complexity warning.
5. Probe-only, not a defect: `webhookChargeStatus` still requires
   `metadata.businessId`/`productId` even when the order link already supplies a
   business — a webhook-only order sale (charge created outside the route) fails
   closed and is healed by the backstop rather than written immediately.

---

## 10. Verdict

Ship slice 3 into the feature branch. Before deploy/archive:

1. Bump `FULFILLMENT_WATERMARK` to the real cutover instant (W3).
2. Decide W4 (order-flow snapshot source) — either accept the request cart
   knowingly or switch to the persisted order cart.
3. Add `tests/unit/saleIdentity.test.ts` per D17 (W2) and close S2.
