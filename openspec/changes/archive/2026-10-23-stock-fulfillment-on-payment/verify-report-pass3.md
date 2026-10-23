# Verification Report — Pass 3 (fresh context, adversarial)

**Change:** `stock-fulfillment-on-payment` — Slice 3 / PR3
**Branch / HEAD:** `feat/stock-fulfillment-triggers` @ `fe6e606`
**Baseline:** `origin/develop` @ `fe6e606` (slices 1 and 2 are already merged)
**Verified:** 2026-10-22 (UTC)
**Method:** fresh-context adversarial review — every claim below was reproduced by
running code, not by reading it. Temporary probe harnesses were used and then
removed (the working tree is byte-identical to the pre-verification state).

> **This report does not replace `verify-report.md`.** It is pass 3 and covers
> slice 3 / PR3 only. The slice 1 and slice 2 findings in `verify-report.md`
> remain valid and are not restated or overwritten here.

---

## 1. Status

**FAIL — the PR3 change must not ship as-is.**

The reconcile backstop (the whole point of PR3) **decrements stock twice for
every order-flow sale** that reaches the daily cron. The suite is green
(2939/2939) and the gate is clean (0 errors) because the test harness cannot
express the broken state — see WARNING-3.

One CRITICAL defect, one CRITICAL design defect, three WARNINGs, two
SUGGESTIONs.

---

## 2. Reproduced metrics

| Metric | Claimed | Measured | Verdict |
| --- | --- | --- | --- |
| Unit suite | green | **255 files / 2939 tests passed**, ~50 s | ✅ |
| `pnpm quality` errors | 0 | **0 errors, 924 warnings** | ✅ |
| `origin/develop` lint baseline | 925 warnings | **925 problems (0 errors, 925 warnings)** | ✅ |
| Lint delta (PR3 vs develop) | −1 | **924 − 925 = −1** | ✅ |
| Tracked changed lines | 1 160 + 163 | **1 160 insertions + 163 deletions = 1 323** | ✅ |
| Untracked changed lines | 570 | **493** (`reconcileFulfillment.ts` 89, `reconcilePaymentsFulfillment.test.ts` 369, `vercelCronConfig.test.ts` 35) | ⚠️ overstated by 77 |
| **Honest total changed lines** | 1 893 | **1 816** (1 323 tracked + 493 untracked) | ⚠️ overstated by 77 |
| Files touched | 11 | 8 tracked + 3 untracked | ✅ |

Baseline measurement used a detached worktree of `origin/develop`:
`git worktree add --detach <temp>/sl-develop-baseline origin/develop` →
`pnpm install --prefer-offline --ignore-scripts` (a plain `pnpm install` fails
with `ERR_PNPM_IGNORED_BUILDS`) → `pnpm lint`.

---

## 3. Mutation testing (all required mutations, all reverted)

Each mutation was applied to production code, the **full** unit suite was run,
the failure count was recorded, and the code was restored. Final state
re-verified: `git status --porcelain` identical to the pre-verification state,
no `MUTATION` markers left in the tree, suite green, `pnpm quality` = 0 errors.

| # | Mutation | Real failures (excluding the 2 temporary probe files) | Caught by |
| --- | --- | --- | --- |
| (a) | The claim key set depends on which side resolved (`resolveClaimKeys` drops the sibling key) | **6** | `chargeRoute.test.ts` (×3), `stockFulfillment.test.ts` (×2), `reconcilePaymentsFulfillment.test.ts` (×1) |
| (b) | Any `Authorization: Bearer …` header authenticates | **1** | `reconcilePaymentsRoute.test.ts` → "returns 401 when the Bearer token mismatches" |
| (c) | The missed flip is no longer detected (`FlipMissedError` removed) | **1** | `webhookOrderStatus.test.ts` → "warns and acks without fulfilling when the scoped flip matches no row" |
| (d) | The order money gate is reverted to `status` only | **2** | `webhookOrderStatus.test.ts` → "denies a legacy status-only payload…" and "treats a non-null paid_at as proof of payment" |
| (e) | The snapshot recovery is reverted to the scalar `qty` | **3** | `reconcilePaymentsFulfillment.test.ts` (×3, cart-array recovery) |

Mutation (a) is the important one: it is exactly the divergence that CRITICAL-1
exploits, and the suite catches it — **but only for the charge route.** No
webhook test catches it (WARNING-1).

---

## 4. Findings

### CRITICAL-1 — The backstop double-decrements stock for every order-flow sale

**Severity:** CRITICAL · **Introduced by:** PR3 (the develop baseline has no
cron fulfillment pass — `git diff app/api/cron/reconcile-payments/route.ts`
shows the entire backstop is new in this diff)

**The chain (five independent facts, each verified in code):**

1. `app/api/payment/charge/route.ts:546` — the charge route stores the **ORDER**
   text id in `payments.culqi_charge_id`:
   `const culqiChargeId = culqiOrderId || culqiData?.id || null;`
   In the order flow `culqiOrderId` is the Culqi order id (`ord_…`).
2. `app/api/webhooks/culqi/route.ts:466` and `:532-536` — the `charge.paid`
   webhook upserts on `payments.culqi_charge_id = <CHARGE id>` (`chr_…`).
   The stored value is the ORDER id, so the conflict target **never matches**
   and the webhook **INSERTs a duplicate `payments` row** for the same order.
3. `src/core/database/schema/orders.ts:59` — `culqiChargeId:
   text('culqi_charge_id').unique()`. `ord_…` ≠ `chr_…`, so **both rows
   coexist**.
4. `app/api/cron/reconcile-payments/route.ts:255-267` and
   `src/core/payments/reconcileFulfillment.ts:46-55` — the backstop resolves
   the payment→order link through `payments.culqi_charge_id =
   payment_orders.culqi_order_id`. The duplicate row carries the CHARGE id, so
   the link is **broken** and the duplicate is collected as a **separate sale**
   whose claim key set is `[('payments', <duplicate uuid>)]` only.
5. The charge route already claimed `('payment_orders', po)` **and**
   `('payments', charge-route-uuid)`. The duplicate's key is **not** claimed →
   the CAS succeeds → **a second decrement**.
   Its snapshot has no cart array (`create-order` sends no `qty` —
   `app/api/payment/create-order/route.ts:189`), so the B1 fallback applies:
   **one extra unit of the bound product**.

**Reproduction** (real cron route + real `fulfillPaidSale` + an in-memory
model of `payments` / `payment_orders` / `stock_movements` / `products`, seeded
with the exact post-order-flow state):

```
[PROBE E2E] body = {"reconciled":0,"skipped":0,"scanned":0,"fulfilled":1,
                    "fulfillmentSkipped":0,"fulfillmentScanned":1}
[PROBE E2E] new decrements = [{"productId":"…001","requested":1}]
[PROBE E2E] stock before = {PROD_A: 98, PROD_B: 95}
[PROBE E2E] stock after  = {PROD_A: 97, PROD_B: 95}
[PROBE E2E] ledger = ['payment_orders:…004', 'payments:…003', 'payments:…009']
```

`…009` is the webhook-created duplicate row: a **new** ledger claim and a
**new** decrement for a sale that was already fulfilled.

**Blast radius:** every order-flow sale with a product-bound cart — the store's
primary purchase path. One extra unit of the bound product per sale, silently.
Stock drifts down, stockouts appear without sales to explain them, and the
drift is invisible in the ledger (both claims look legitimate).

**Related (not yet a live bug, but the same trap):** the webhook's own
`fulfillChargeSale` is safe *only* because `data.order_id` resolves the order
and the shared `('payment_orders', …)` key is already claimed. If Culqi's
`charge.paid` payload ever omits `order_id`, the webhook's key set becomes
payments-only and the webhook itself double-decrements.

**Fix direction.** The claim must be keyed by the **sale**, not by whichever row
a trigger happened to resolve. The durable fix is one canonical link: store the
**charge id** in `payments.culqi_charge_id` (the column is named for it) and
the **order id** in a separate column, then make both the charge route and the
webhook write that pair. A cheaper stopgap — resolving the link through
`payments.metadata.culqiId` (the charge route stores the order id there,
`charge/route.ts:576`) — closes the *charge-route* row's link but leaves the
webhook's duplicate row unlinked, so it is a mitigation, not a fix.

---

### CRITICAL-2 — The exactly-once guarantee is per-anchor, not per-sale

**Severity:** CRITICAL (design)

`stock_movements` is unique on `(source_type, source_id)`
(`src/core/database/schema/orders.ts:401`), and the claim key set is derived
from whichever anchors the trigger happened to resolve
(`src/core/payments/stockFulfillment.ts:124-140`, `resolveClaimKeys`). Two
triggers that resolve **different key sets for the same sale** therefore both
win the CAS and both decrement. This is the general form of CRITICAL-1.

**Reproduction** (real `fulfillPaidSale`, in-memory ledger):

```
[PROBE N1 control] decrements = 1 ledger = 2      # same key set → exactly once
[PROBE N1 hazard]  decrements = 2 ledger = 2      # different key set → twice
[PROBE N1 hazard]  outcomes = fulfilled fulfilled
[PROBE N1 hazard]  stock left = 96                # 100 − 2 − 2
```

The design and the spec both promise "exactly once per sale"; the mechanism
only delivers "at most once per `(source_type, source_id)`". The gap is
invisible until two triggers disagree about the sale's identity — which is
exactly what happens whenever the payment↔order link is asymmetric.

---

### WARNING-1 — The `charge.paid` fulfillment trigger has no test at all

`tests/unit/webhookChargeStatus.test.ts:55` mocks `fulfillPaidSale: vi.fn()`,
never captures it, never asserts it. It is the **only** occurrence of the
symbol in the file. So nothing pins:

- that `charge.paid` fulfils the sale,
- which anchor / claim keys it uses,
- which snapshot it recovers,
- that it skips an already-claimed sale.

The PR3 charge trigger is therefore untested, and mutation (a) was invisible to
every webhook test. The `charge.paid` path is the one that creates the
duplicate row of CRITICAL-1.

---

### WARNING-2 — The snapshot reader is more permissive than the snapshot writer

The writer (`src/features/billing/schemas.ts:20-25`) is strict:
`id: z.string().uuid()`, `quantity: z.number().int().min(1).default(1)`.

The reader (`src/core/payments/stockFulfillment.ts:177-195`) coerces:
`Math.max(1, Number.isFinite(parsed) ? parsed : 1)`.

| Persisted `quantity` | Reader result | Effect |
| --- | --- | --- |
| `0` | `1` | **over-orders**: decrements 1 unit for a line the writer would have rejected |
| `-5` | `1` | **over-orders** |
| `true` / `null` | `1` | **over-orders** |
| `'3'` | `3` | accepted although the writer rejects strings |
| **`2.5`** | **`2.5`** | **passes through** → `products.stock - 2.5` on an `integer` column → Postgres error → the transaction (claim included) rolls back → the paid sale is never fulfilled and the cron retries it on every run |

`products.stock` is `integer` (`src/core/database/schema/products.ts:71`;
`migrations/0002_add_product_fields.sql:17`).

**Reachability today: none.** Every write site is Zod-validated and
`buildWebhookPaymentValues` only ever persists `{ qty }` (an integer ≥ 1) or
nothing at all. So this is a latent hazard, not a live bug — but the reader is
the trust boundary for a money-moving quantity, and it is the only place that
decides how many units leave stock.

---

### WARNING-3 — The cron test harness cannot express the broken state

`tests/unit/reconcilePaymentsFulfillment.test.ts:235-236`:

```ts
mockPaymentsFindFirst.mockImplementation(async () => linkedPaymentRow);
mockPaymentOrdersFindFirst.mockImplementation(async () => linkedOrderRow);
```

Both link lookups **ignore the `where` clause** and return a constant. The
asymmetric-link case — the exact state that breaks CRITICAL-1 — is therefore
inexpressible in the suite, which is why 2939 green tests coexist with a live
double decrement. (The candidate `findMany` mocks do compile the `where`, but
they only check `params.includes('paid')`; the `not exists` ledger predicate is
never evaluated either.)

---

### WARNING-4 — The `mockResolvedValueOnce` queue leaks between tests

`vitest.config.ts:26-27` sets `restoreMocks: true` and `clearMocks: true`,
which does **not** clear the `once` queue in Vitest 4.1.9. Measured:

```
[PROBE mock queue] observed = "POISONED"
```

A once-value queued in one test and never consumed is consumed by the **next**
test. The PR3 tests are currently safe because each `beforeEach`
re-declares the defaults (`reconcilePaymentsRoute.test.ts:104-119`) and every
test consumes what it queues — but `stockFulfillment.test.ts:325,362,518` and
`reconcilePaymentsFulfillment.test.ts:408` rely on once-queues, so any future
early return will poison the next test silently.

---

### SUGGESTION-1 — The backstop is N+1

`collectFulfillmentSales` runs 1 + 1 base queries plus one `findFirst` per
order row and per payment row — up to 202 queries per run at
`MAX_PER_RUN = 100`. Acceptable for a daily cron; a single join over the
persisted link would be cheaper and would make the asymmetric-link case
visible in one place.

### SUGGESTION-2 — The watermark is a hardcoded date

`FULFILLMENT_WATERMARK = 2026-10-21T00:00:00.000Z` is a constant in the
source. It is fixed (no moving-window retroactive risk), but every deployment
after that date widens the backstop's window, so the first cron run after a
late deployment retroactively fulfils a batch of sales. A deployment-time
constant (or a migration-recorded value) would make the boundary explicit.

---

## 5. Scope items — PASS / FAIL

| # | Scope item | Verdict | Evidence |
| --- | --- | --- | --- |
| A | Cron settlement pass unchanged | ✅ | `git diff` — the settlement pass is untouched; 9 settlement tests green |
| B | Cron fulfillment backstop added | ⚠️ **FAIL** | CRITICAL-1: the backstop double-decrements |
| C | Snapshot recovery (cart array first, scalar fallback) | ✅ | `resolveSaleSnapshot` + mutation (e) caught by 3 tests |
| D | Order money gate uses the canonical proof (`state` / `paid_at`) | ✅ | `webhook/route.ts:253`; mutation (d) caught by 2 tests |
| E | Watermark / no retro-fulfilment (R7) | ✅ | `isHistoricalPaidRow` + the `gte(updatedAt, watermark)` window; 4 tests pin it |
| F | Cron auth (secret header, additive Bearer) | ✅ | mutation (b) caught by 1 test; both headers timing-safe |
| G | Cron schedule configured | ✅ | `vercel.json` — `{ "path": "/api/cron/reconcile-payments", "schedule": "0 3 * * *" }`, `framework: nextjs`; `vercelCronConfig.test.ts` |
| H | Exactly-once per sale | ❌ **FAIL** | CRITICAL-2 |
| I | Charge trigger fulfils the sale | ❌ **FAIL** | WARNING-1 — implemented but untested |
| J | No claim key carries a Culqi text id | ✅ | `stock_movements.source_id` is `uuid`; all four anchor shapes carry DB uuids; `chargeRoute.test.ts` pins it |

---

## 6. Safety verdict

**NOT SAFE TO MERGE.**

- The change ships a daily cron that **silently removes stock** that was
  already removed. The failure mode is not a crash and not an error log — it
  is a plausible-looking ledger with two claims for one sale.
- The 0-error lint gate and the 2939-green suite are **not** evidence of
  correctness here: the harness mocks the exact query that resolves the link
  (WARNING-3), so the broken state cannot be expressed.
- The recommended gate before merging: a regression test that seeds a
  `payments` row whose `culqi_charge_id` is the **charge** id next to a
  `payment_orders` row whose `culqi_order_id` is the **order** id, and asserts
  **one** decrement.

---

## 7. What could NOT be verified

- **No real Postgres.** Every DB interaction was modelled in memory
  (transcribed from the Drizzle schema, the migrations, and
  `claimedSaleFilter`). The two Postgres-level claims — the
  `integer - 2.5` type error and the `onConflictDoNothing` behaviour under
  real concurrency — are derived from the schema/migrations, not executed.
- **No real Culqi.** The `charge.paid` payload shape (notably whether
  `data.order_id` is present) is taken from the code and the Culqi docs, not
  from a captured production event.
- **Concurrency.** The exactly-once claim was exercised sequentially. Two
  truly concurrent transactions were not run against Postgres; the CAS
  semantics are inferred from `ON CONFLICT DO NOTHING … RETURNING`.
- **The deployed watermark.** `2026-10-21T00:00:00.000Z` is compared against
  "now" (`2026-10-22T00:30Z`), so the backstop window is already open.
- **Migrations.** No migration is part of this diff; the `stock_movements`
  table and its RLS setup come from the already-merged slices 1/2 and were not
  re-verified here.

---

## 8. Non-obvious discoveries

1. **The column name lies.** `payments.culqi_charge_id` stores the **order**
   id in the order flow (`charge/route.ts:546`), while the webhook writes the
   **charge** id into the same column. The two ids live in one unique column
   with two different meanings — that is the root of CRITICAL-1.
2. **`stock_movements` is keyed by row, not by sale.** The ledger's uniqueness
   is `(source_type, source_id)`, so "exactly once" is only true while every
   trigger agrees on the sale's identity.
3. **The webhook is a silent row duplicator in the order flow.** The upsert's
   conflict target can never match the charge route's row, so *every* order
   payment produces two `payments` rows. Before PR3 this was harmless; PR3
   gave the duplicate a decrement.
4. **`restoreMocks` does not clear once-queues** in Vitest 4.1.9 (measured).
5. **`create-order` sends no `qty`** to Culqi (`create-order/route.ts:189`),
   so the webhook-created row carries no metadata at all → the backstop's
   fallback is always B1 (`qty = 1`), never the real cart.
6. **The `not exists` candidate predicate shares the broken link.** It resolves
   the sibling row through the same
   `payment_orders.culqi_order_id = payments.culqi_charge_id` join, so it is
   blind to the same asymmetry that breaks the collection — the SQL filter
   cannot exclude the duplicate row either.

---

## 9. Reproduction commands

```bash
# Baseline (develop)
git worktree add --detach "%TEMP%/sl-develop-baseline" origin/develop
cd "%TEMP%/sl-develop-baseline"; pnpm install --prefer-offline --ignore-scripts; pnpm lint

# Working tree
pnpm test:unit          # 255 files / 2939 tests
pnpm quality            # 924 problems (0 errors, 924 warnings)

# Line counts
git diff --numstat                                   # 1160 + 163
(Get-Content src/core/payments/reconcileFulfillment.ts).Count
(Get-Content tests/unit/reconcilePaymentsFulfillment.test.ts).Count
(Get-Content tests/unit/vercelCronConfig.test.ts).Count   # 89 + 369 + 35 = 493
```

The probe harnesses used for §4 (CRITICAL-1, CRITICAL-2, WARNING-4) were
temporary files under `tests/unit/` and have been removed; copies are kept
outside the repository.
