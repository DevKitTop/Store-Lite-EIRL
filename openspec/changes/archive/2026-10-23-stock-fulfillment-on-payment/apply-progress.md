# Apply Progress: stock-fulfillment-on-payment — Slice 1 (PR1)

> **Scope:** PR1 only (Slice 1 — isolated core). Slice 2 (PR2) and Slice 3 (PR3) are NOT touched.
> **Strategy:** 3 chained PRs, `stacked-to-main`.
> **Strict TDD:** enabled — every behavior had a failing test first (`pnpm test:unit`).
> **Branch:** `feat/stock-fulfillment-ledger` (created from `develop` @ `9e8c5a8`). No commits/pushes made.
> **Review budget:** the 400-line budget is **exceeded**; a `size:exception` for PR1 was **explicitly
> approved by the user** (see "Budget decision" below).

## Tasks completed

| Task | Status | Notes |
|---|---|---|
| T0 | DONE | Branch `feat/stock-fulfillment-ledger` already created at session start. |
| T1.1 RED | DONE | `tests/unit/rlsStockMovementsMigration.test.ts` written first; failed with `ENOENT 0051_stock_movements_ledger.sql`. |
| T1.2 GREEN | DONE | Migration `0051_stock_movements_ledger.sql` + `stockMovements` model in `schema/orders.ts`; registered via `pnpm check:migrations --update`. |
| T1.3 RED | DONE | `tests/unit/stockFulfillment.test.ts` written first; failed with `Failed to resolve import "@/core/payments/stockFulfillment"`. |
| T1.4 GREEN | DONE | `src/core/payments/stockFulfillment.ts` implemented. |
| T1.5 RED | DONE | `tests/unit/chargeRoute.test.ts` extended; new tests failed while the 60 pre-existing stayed green. |
| T1.6 GREEN | DONE | `app/api/payment/charge/route.ts` extraction. |
| T1.7 VERIFY | **FAIL → FIXED** | Fresh-context adversarial verify returned FAIL with 3 CRITICALs; all three fixed under TDD, then re-verified PASS WITH WARNINGS. See "Verify findings and fix cycle". |

## Files changed

| File | Action | Changed lines (numstat) |
|---|---|---|
| `src/core/payments/stockFulfillment.ts` | Create | +452 |
| `tests/unit/stockFulfillment.test.ts` | Create | +560 |
| `tests/unit/rlsStockMovementsMigration.test.ts` | Create | +77 |
| `migrations/0051_stock_movements_ledger.sql` | Create | +54 |
| `tests/unit/chargeRoute.test.ts` | Modify | +173 / −3 |
| `app/api/payment/charge/route.ts` | Modify | +62 / −49 |
| `src/core/database/schema/orders.ts` | Modify | +38 / −0 |
| `migrations/ledger.json` | Regenerate | +72 / −19 (generated; see note) |

**Total changed lines: 1,488 additions / 71 deletions = 1,559.** Reviewer-visible number is the
numstat total. Excluding the generated `migrations/ledger.json` entry, the authored change is
~1,487.

### Budget decision (resolved)

The forecast estimated ~215 lines; the slice landed at ~1,559. The estimate was **not** the apply
agent's error — it simply **never budgeted for the strict-TDD test surface**, which dominates here
(560 + 77 + 173 = 810 test lines).

A `PR1a` (schema + migration + RLS test) / `PR1b` (helper + route + tests) split was evaluated and
**withdrawn**: it does not achieve the 400-line budget, because `PR1b` would still carry the helper
(452) plus its tests (560), and separating a test file from the code it pins breaks both the
RED/GREEN unit and the repo convention that tests travel with code. The `stacked-to-main` chain is
preserved; only the per-PR budget is knowingly exceeded, once, with the exception recorded in the
PR body.

### `migrations/ledger.json` — corrected finding

An earlier draft of this file claimed "~90 of the 91-line diff is generator pretty-print churn". **That
was wrong and has been corrected.** The apparent churn was an artifact of comparing the *working tree*
under `core.autocrlf=true` (the repo has no `.gitattributes`). Measured on the **staged** diff, the
change is clean: a `generatedAt` bump, counts `sql 78→79` / `unjournaled 54→55`, and the new `0051`
entry — roughly 15 real lines. The file is still `pnpm check:migrations --update` output and must not
be hand-edited.

## TDD Cycle Evidence (Strict TDD — MANDATORY)

Every behavior change followed RED → GREEN → REFACTOR. `refactor` = the post-GREEN `pnpm quality`
cleanup (type aliases → interfaces, `Array<T>` → `T[]`, `let` → `const`, removing the
`as unknown as TxLike` cast once `TxLike` was aliased to the real Drizzle type).

| Task | RED (test written first, observed failing) | GREEN (impl, observed passing) | REFACTOR |
|---|---|---|---|
| T1.1 | `rlsStockMovementsMigration.test.ts` failed: migration file missing / not registered. | `0051_stock_movements_ledger.sql` + schema. | Generated file regenerated via `--update`; no code refactor. |
| T1.3 | `stockFulfillment.test.ts` failed: `Failed to resolve import "@/core/payments/stockFulfillment"`. | Helper implemented. | `interface` over `type` alias, `T[]` over `Array<T>`, `const` invariants, `TxLike` real-type alias. |
| T1.5 | New charge-route cases failed while 60 pre-existing stayed green. | Route extraction. | Removed unused `gte` import; narrowed the payments-insert assertion to the `amount` payload. |
| **T1.7a** | Pinned-key tests failed against the broken anchor (claim key was the Culqi TEXT order id; the `payments` key duplicated the order id). | `resolveClaimKeys` derives keys from DB row uuids only, ordered `payment_orders` → `payments`, and **throws** when no row id resolves (fail closed). Route threads `paymentOrderId = flipped[0].id`. | Extracted module-level helpers to lower cognitive complexity. |
| **T1.7b** | Oversell-outcome test failed (ledger recorded `fulfilled` for an oversold sale; `partial` unreachable). | `correctClaimOutcome` upserts the just-written claim row to the truthful `partial` outcome. | Nested ternary in `readFulfillmentQty` → `if/else` (removed 2 sonarjs warnings). |

## Test and quality evidence

- Full suite `pnpm test:unit` → **253 files, 2,873 tests passed** (0 failed).
  Baseline before this change: 253 files / 2,866 tests. **Net +7 tests** (all pinning the fixed contract).
- `tests/unit/chargeRoute.test.ts` → the guard asserting exactly two `mockTxUpdate` calls
  (`payment_orders` flip FIRST, decrement SECOND) **stays green** — the CAS is an INSERT.
- `pnpm quality` → **0 errors, 926 warnings**. The develop baseline is **926** warnings (measured
  independently via `git stash -u` + lint), so this change adds **net 0** new warnings.
- Coverage: `stockFulfillment.ts` 100% lines / 93.2% branch; `charge/route.ts` 87.1% / 84.2%
  (uncovered lines are pre-existing notify/rate-limit branches; the fulfillment block is fully covered).

## Verify findings and fix cycle

A fresh-context adversarial verify (not the implementing agent) rejected the first green state. The
decrement logic was proven sound by mutation (dropping `gte(products.stock, requested)` broke 3 tests;
neutralising the CAS short-circuit broke 2). The **claim key identity** was the defect:

| # | Severity | Finding | Status |
|---|---|---|---|
| CRITICAL-1 | money loss | The order-flow anchor used Culqi's TEXT order id (`ord_…`) as the claim `sourceId`, which is a `uuid NOT NULL` column. Postgres rejects the cast inside `db.transaction`, so the charge transaction rolled back **after Culqi captured the payment** — a paid sale with zero stock movement. Tests were blind: no `sourceId` assertion existed. | FIXED |
| CRITICAL-2 | oversell | Exactly-once was structurally broken. The helper pushed both keys with the same `anchor.id` (so the `payments` key held the order id, not the payments row id), and the charge path claimed the Culqi text id while PR3's flip will claim the `payment_orders` **row uuid** — different ledger rows, both claims win, **double decrement**. | FIXED |
| CRITICAL-3 | false confidence | The claim key value was asserted nowhere; corrupting it to a bogus string left the suite green. A test that cannot fail proves nothing. | FIXED |
| W | signal | Ledger persisted `outcome:'fulfilled'` with `applied:false` for an oversold sale; `'partial'` was unreachable. | FIXED |
| W | signal | Change added 2 sonarjs warnings over baseline. | FIXED |

### Claim-key contract (implemented here; PR3 MUST reuse it)

1. `('payment_orders', <paymentOrders row uuid>)` — from `.returning({ id: paymentOrders.id })`, already
   fail-closed-validated so it is guaranteed present.
2. `('payments', <payments row uuid>)` — from the `payments` insert `.returning()`.

For the token-only flow the single key is `('payments', <payments row uuid>)`. **Culqi text ids
(`ord_…`, `chr_…`) must never be used as a `sourceId`.**

## Mutation proof

Independently reproduced by the verifier (not the implementing agent):

| # | Mutation | Result |
|---|---|---|
| M-A | Remove the `gte(products.stock, requested)` predicate from the decrement `WHERE`. | **3 failures** — the decrement predicate is load-bearing. |
| M-B | Neutralise the CAS short-circuit so an existing claim still decrements. | **3 failures** — the short-circuit is load-bearing. |
| M-C1 | Corrupt the `payment_orders` claim key to a bogus value. | **3 failures** (previously **0** — the CRITICAL-3 blind spot is closed). |
| M-C2 | Corrupt the `payments` claim key to a bogus value. | **5 failures.** |

All mutations were restored and the tree re-confirmed green (253 files / 2,873 tests).

## Hard-constraint verification

- Exactly two `mockTxUpdate` calls in the order flow (`payment_orders` flip FIRST, stock decrement
  SECOND). **PASS** — the CAS is an INSERT, not a third UPDATE. **PASS**
- Decrement stays conditional (`WHERE id AND businessId AND stock >= requested`) with `.returning()`.
  No `GREATEST`; no `rowCount`-based decision (postgres-js exposes `count`/`command`; `rowCount` is
  `undefined` and would fail open). **PASS**
- The CAS claim executes in the SAME transaction as the decrement and the paid-state write. **PASS**
- Every fulfillment read/write is business-scoped and asserts affected rows. **PASS**
- Alerts use `console.error` only — never `logger`/Sentry — because `src/lib/piiScrubber.ts` rewrites
  UUIDs to `…[REDACTED_PHONE]` (B-07). Anti-improvement comment present. **PASS**
- Ordered key set `payment_orders` first, then `payments`. **PASS**
- Migration RLS zero-policy matches the `0050` pattern; prefix `0051` is free; `pnpm check:migrations`
  OK. **PASS**

## Out-of-scope files (untouched — confirmed)

`app/api/payment/create-order/route.ts`, `src/features/billing/schemas.ts`,
`src/features/billing/validateAmount.ts`, `src/core/payments/webhookPaymentValues.ts`,
`app/api/webhooks/culqi/route.ts`, `app/api/cron/reconcile-payments/route.ts`, `vercel.json`,
storefront client — all untouched. Oversell prevention, refund/backorder, the vacuous R13 writer and
B-07 remain out of scope.

## Residuals and follow-ups for PR3

1. **N1 (WARNING — latent, probe-verified, MUST be carried into PR3).** The exactly-once guarantee
   holds only when **every** trigger resolves the **same** key set. The short-circuit inspects only the
   *first* key of the set it attempts, so a `payments`-only claim that wins first, followed by a
   full-set trigger, **double-decrements** (probe printed `decrements=2`). Unreachable in slice 1 (no
   order-backed caller uses a payments-only set), but PR3's `order.status.changed` flip and the cron
   backstop **must resolve the `payment_orders` row** for every order-backed sale, and the reverse-order
   scenario needs a committed test. The robust alternative — making the claim order-independent by
   inspecting all keys of the set — is a design change (D1/D3) and is deliberately deferred to a PR3
   design decision rather than settled here.
2. The ledger row's `items[].applied: false` on the happy path is unchanged; correcting it would need a
   third write, which would break the pinned two-`mockTxUpdate` count.
3. Watermark `2026-10-01` in the backstop predicate is a placeholder that will be stale by PR3.
4. Real-Postgres behaviour (uuid cast, `ON CONFLICT` concurrency, drizzle conflict-target inference) is
   not covered by the unit-only layer.

## Rollback boundary of this slice

Revert PR1 (drop `stock_movements` usage, the helper, the charge-route extraction, the migration and its
RLS test). Committed decrements and `stock_movements` rows are historical facts and are not
auto-reversed. The helper is inert until PR2/PR3 wire additional triggers.

## Non-obvious discoveries

1. **`TxLike` must alias the real Drizzle type** — `PgTransaction<PostgresJsQueryResultHKT, typeof
   schema, ExtractTablesWithRelations<typeof schema>>`. A hand-rolled structural `TxLike` failed `tsc`
   because Drizzle's `insert(table: PgTable)` is not assignable to a `(table: unknown)` signature
   (contravariance).
2. **`FulfillmentResult['outcome']` must include `'partial'`** — the decrement can partially apply
   (some lines oversold), distinct from the terminal `no_product`/`already_claimed`. The design's type
   sketch omitted `'partial'` but the ledger CHECK constraint includes it.
3. **One pre-existing test was adjusted** — `chargeRoute.test.ts` "accepts the exact decimal-string
   amount…" asserted `mockTxInsert` called exactly once. The fulfillment CAS adds `stock_movements`
   INSERTs, so the assertion counts only the `payments` insert (by its `amount` payload). The
   two-`mockTxUpdate` guard was NOT modified.
4. **Measuring a generated file's diff on Windows** — with `core.autocrlf=true` and no `.gitattributes`,
   a working-tree diff of a generated file is churn-heavy; measure `git diff --cached` instead.

---

# Apply Progress: stock-fulfillment-on-payment — Slice 2 (PR2)

> **Scope:** PR2 only (Slice 2 — snapshots + validation + client). Slice 3 (PR3) files are NOT touched.
> **Strategy:** 3 chained PRs, `stacked-to-main`. No commits/pushes/PRs performed.
> **Strict TDD:** enabled (`pnpm test:unit`).
> **Branch:** `feat/stock-fulfillment-snapshots` (from `develop` @ `533bf99`).
> **Starting point:** a cancelled mid-flight run had already left 11 files / 536 insertions / 17 deletions
> on the working tree. This session audited that work, found and fixed the one real gap, and verified it.
> **Review budget:** the 400-line budget is **exceeded** (640 changed lines vs the ~210 estimate) — see
> "Budget decision" below.

## Tasks completed

| Task | Status | Notes |
|---|---|---|
| T2.1 RED | DONE (inherited + audited) | Shared `cartItemsSchema` RED cases: reject `quantity: 0` / non-int. |
| T2.2 GREEN | DONE (inherited + audited) | `cartItemsSchema` exported; `createOrderRequestSchema.cartItems` optional; `chargeRequestSchema.metadata.cartItems` reuses it. |
| T2.3 RED | DONE (inherited + audited) | 3 RED cases in `tests/unit/createOrderRoute.test.ts`. |
| T2.4 GREEN | DONE (inherited + audited) | `create-order` reconciles the full cart, 400s before Culqi/insert, persists `metadata.cartItems`. |
| T2.5 RED | DONE (inherited + audited) | Charge route RED: outgoing Culqi body carries scalar `metadata.qty`, never a cart array. |
| T2.6 GREEN | DONE (inherited + audited) | `boundQty` derived from the validated incoming cart. |
| T2.7 RED | DONE (inherited + audited) | `webhookPaymentValues` qty present/absent; `paymentApi` forwards `cartItems`. |
| T2.8 GREEN | **FIXED (the real gap)** | `useCheckoutPayment` did **not** forward `cartItems` to `createOrder` — the order flow could never produce a snapshot. Fixed with a RED→GREEN pair. |

## Files changed (working tree, uncommitted)

| File | Action | numstat |
|---|---|---|
| `app/[slug]/(app)/components/hooks/useCheckoutPayment.ts` | Modify | +6 / −0 |
| `app/api/payment/charge/route.ts` | Modify | +10 / −1 |
| `app/api/payment/create-order/route.ts` | Modify | +25 / −7 |
| `src/core/payments/webhookPaymentValues.ts` | Modify | +21 / −0 |
| `src/features/billing/schemas.ts` | Modify | +17 / −8 |
| `src/shared/payments/paymentApi.ts` | Modify | +3 / −0 |
| `tests/unit/Checkout.test.tsx` | Modify | +81 / −0 |
| `tests/unit/billingSchemas.test.ts` | Modify | +46 / −1 |
| `tests/unit/chargeRoute.test.ts` | Modify | +86 / −0 |
| `tests/unit/createOrderRoute.test.ts` | Modify | +157 / −0 |
| `tests/unit/createOrderSchema.test.ts` | Modify | +80 / −0 |
| `tests/unit/paymentApi.test.ts` | Modify | +46 / −0 |
| `tests/unit/webhookPaymentValues.test.ts` | Modify | +45 / −0 |

**Total: 13 files, 623 insertions / 17 deletions = 640 changed lines.**
Inherited from the cancelled run: 11 files, 536 / 17. This session's own change: 2 files, 87 / 0
(`useCheckoutPayment.ts` +6, `tests/unit/Checkout.test.tsx` +81).

## Budget decision

The forecast was ~210 lines; the slice landed at 640. Same root cause as PR1: the estimate never
budgeted for the strict-TDD test surface, which dominates (46 + 86 + 157 + 80 + 46 + 45 + 81 = 541 test
lines out of 623). The `size:exception` for PR1 was already approved by the user; PR2 needs the same
explicit sign-off, or the slice must be re-cut.

## TDD Cycle Evidence (Strict TDD)

| Task | RED (written first, observed failing) | GREEN |
|---|---|---|
| T2.8 client link | `tests/unit/Checkout.test.tsx` — 2 failed / 13 passed. `AssertionError: expected undefined to deeply equal [ { …(2) }, { …(2) } ]` at `tests/unit/Checkout.test.tsx:554:50`, and the same at `:571`. | `useCheckoutPayment` forwards `cartItems: cartItems.map(i => ({ id: i.id, quantity: i.quantity }))` → 1 file passed, 15 tests passed. |

Safety-net baseline before any change: the 7 slice-2 test files → **7 files, 153 tests passed**.

## Test and quality evidence

- Full suite `pnpm test:unit` → **253 files, 2,903 tests passed** (0 failed).
  Baseline before this slice: 253 files / 2,901 tests. **Net +2 tests** (the two new hook tests).
- `pnpm quality` → **0 errors, 925 warnings**, `tsc --noEmit` exit 0.
  The clean-tree baseline was measured independently (`git stash -u` then `pnpm lint` = **926 warnings**),
  so this slice is **net −1 warning**. No new warnings introduced.
- The `mockTxUpdate` guard in `tests/unit/chargeRoute.test.ts` (exactly **two** calls, flip FIRST /
  decrement SECOND) was **not touched** and stays green.

## Mutation proof (6 mutations, all restored)

| # | Mutation | Result |
|---|---|---|
| M-1 | `useCheckoutPayment` stops forwarding `cartItems` to `createOrder`. | **2 failures** — the new client tests are load-bearing. |
| M-2 | `create-order` stops passing `cartItems` to `validateAmount`. | **3 failures** — cart reconciliation is load-bearing. |
| M-3 | `create-order` stops persisting `metadata.cartItems`. | **1 failure** — snapshot persistence is load-bearing. |
| M-4 | Charge route hardcodes `boundQty = 1` (ignores the validated cart). | **1 failure** — `qty` derivation is load-bearing. |
| M-5 | A cart array is added to the outgoing Culqi charge body. | **1 failure** — the "never a cart array" assertion is load-bearing. |
| M-6 | `webhookPaymentValues` stops carrying `metadata.qty`. | **2 failures** — the webhook qty passthrough is load-bearing. |

All mutations were reverted; `git diff` was re-checked for stray `MUTATION` markers (none), and the
tree was re-confirmed green: **253 files / 2,903 tests**, **0 errors / 925 warnings**.

## The two metadata channels (the core R1/R6 conclusion)

They are provably separate — no wrong-channel substitution:

1. **Incoming request channel** — `metadata.cartItems` on the create-order / charge request body.
   The array lives here. The server validates it and derives quantities from it. On the charge path
   the *parsed* metadata is spread into the `payments` row, so the DB snapshot keeps the cart array.
2. **Outgoing Culqi channel** — the charge body metadata is exactly
   `{ businessId, productId, platform, qty }`. **Scalar only, never a cart array.**
   The webhook-created `payments` row gets `metadata: { qty }` (scalar) via the existing
   `db.insert(payments).values({ ...values, status })` in the webhook route.

**Spoofing check:** `chargeRequestSchema.metadata` has no `qty` key, and Zod strips unknown keys, so a
client-supplied `metadata.qty` is dropped at the edge. The client therefore **cannot** set the
charge-metadata `qty` independently of the server-side validation. R6 holds.

## Persisted shapes

- Order flow: `payment_orders.metadata = { culqiRaw, cartItems: [{ id, quantity }] }`.
- Token flow, charge-created row: `payments.metadata` = incoming `cartItems` + `shippingInfo` +
  `culqiId` (+ optional `customerAuth`).
- Webhook-created row: `payments.metadata = { qty }`.
- Culqi charge body: `metadata = { businessId, productId, platform: 'store-lite', qty }`.

## Out-of-scope files (untouched — confirmed)

`src/core/payments/stockFulfillment.ts`, `migrations/*`, `src/core/database/schema/*`,
`app/api/webhooks/culqi/route.ts`, `app/api/cron/reconcile-payments/route.ts`, `vercel.json`,
`src/features/payment/hooks/useCulqiCallback.ts` — all untouched.

## Non-obvious discoveries

1. **`useCheckoutPayment` was the single missing link.** The whole slice was server-complete and
   client-incomplete: the order flow built a Culqi order from a *single* `productId` and never sent the
   cart, so `payment_orders.metadata.cartItems` could only ever be populated by a caller that does not
   exist yet. The fix is 1 line of real code; the risk was entirely in the absence of a test, which is
   why the RED pair in `tests/unit/Checkout.test.tsx` matters.
2. **The create-order route never writes `metadata.productId`** — it only appears in the outgoing
   Culqi order body. The snapshot therefore has to live in its own `metadata.cartItems` key; it cannot
   be derived from anything already persisted.
3. **`chargeRequestSchema.metadata.cartItems` quantity is now optional (default 1)** because it reuses
   the shared schema. This is a deliberate loosening: an inbound line without a quantity is read as one
   unit. It cannot weaken reconciliation, because the amount is reconciled against the same cart.
4. **`openspec/**/*.md` is gitignored** (`.gitignore` line 98: `*.md`). The SDD artifacts are real
   files on disk but never appear in `git status` — an audit looking only at git will not see them.
5. **`tasks.md` contains 33 stray control characters** (0x0B vertical tab and similar) baked in by a
   lossy earlier write — e.g. a vertical tab followed by `alidateAmount` instead of `validateAmount`.
   The file is valid UTF-8, so it round-trips safely, but grep for `alidateAmount` /
   `esolveFulfillmentItems` will confuse a reviewer.
6. **Windows PowerShell 5.1 `Add-Content` writes ANSI, not UTF-8.** Appending to these artifacts with
   `Add-Content` corrupted the em-dashes and arrows. Use `[System.IO.File]::AppendAllText` with an
   explicit `UTF8Encoding($false)` instead.

## Ambiguities and follow-ups for PR3

1. **The `qty` derivation is duplicated.** The charge route derives `qty` from
   `metadata.cartItems.find(i => i.id === productId)?.quantity ?? 1`; `readFulfillmentQty` in
   `stockFulfillment.ts` reads `metadata.qty` from the persisted row. The semantics match, but the
   mapping from cart line to scalar is expressed in two places. PR3 should reuse one derivation.
2. **A charge request whose cart contains the bound product more than once** would use the first
   match. The schema allows duplicate ids. Low impact, but PR3 should decide whether to reject it.
3. **The `revalidationProductId = productId ?? cartItems?.[0]?.id` fallback** in `create-order` means a
   cart-only request is reconciled against its first line's product. If the first line is not the
   dominant one, the amount check is against the wrong product's price. PR3 should confirm the
   intended semantics.
4. **PR2 exceeded the 400-line review budget (640 lines).** Needs an explicit `size:exception` like
   PR1, or a re-cut.
5. **Real-Postgres behaviour is still unverified** (jsonb round-trip of `metadata.cartItems`,
   `ON CONFLICT` inference) — the unit layer only proves the shape.

---

# Slice 2 hardening — W-C: pin the client-`qty` anti-spoofing invariant

**Status**: complete. Follow-up to the slice-2 verify report, finding **W-C** ("the server-side `qty`
derivation is real, but no test asserts a client cannot spoof it").

## The invariant now under test

`POST /api/payment/charge` derives the Culqi `metadata.qty` **server-side** from the validated cart
(`boundQty`, `app/api/payment/charge/route.ts:466-470`). A client cannot spoof it, and that holds for
**two independent reasons**:

1. `chargeRequestSchema.metadata` has no `qty`/`quantity` key, and Zod runs in `strip` mode, so a
   client-supplied `metadata.qty` is removed at the edge;
2. the outgoing Culqi metadata is a **literal** — `{ businessId, productId, platform, qty }` — and never
   spreads the request metadata.

Before this hardening **neither** defense was asserted anywhere: `grep qty tests/unit/` found no case
that sends a client `metadata.qty`. An untested security invariant is exactly the "test that cannot
fail" class that produced a CRITICAL in slice 1.

## File changed

| File | Action | Lines |
|------|--------|-------|
| `tests/unit/chargeRoute.test.ts` | Modified | +73 (1 new test) |

No production file changed. The `mockTxUpdate` "exactly two calls, flip FIRST / decrement SECOND"
guard was left untouched and stays green.

## Test added

`POST /api/payment/charge > charge metadata qty snapshot (A2) > ignores a client-supplied metadata.qty:
the Culqi qty is derived server-side from the cart`

It sends a token-flow charge whose `metadata` carries **both** a legitimate `cartItems` array
(A × 3, B × 2) **and** hostile `qty: 999` + `quantity: 888`, then asserts three things:

1. the Culqi body carries the server-derived `qty` (`3`), not `999`;
2. the outgoing metadata is **exactly** `{ businessId, productId, platform, qty }` — no `quantity`
   alias, no stray client key (`shippingInfo`, `cartItems`), never the cart array;
3. the persisted `payments.metadata` row carries no client `qty`/`quantity`.

Assertion (3) is what pins the **Zod-strip** half of the invariant. The strip is invisible in the
Culqi body (the literal protects it there), and the durable row is the only other channel the
validated metadata reaches — and that channel matters, because
`readFulfillmentQty` (`src/core/payments/stockFulfillment.ts:146`) later reads `metadata.qty` back
**from the stored row** to size the oversell-recovery decrement.

## TDD cycle evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| W-C | `tests/unit/chargeRoute.test.ts` | Unit (route) | ✅ 70/70 | ✅ Written | ✅ 71/71 | ➖ Single (one invariant, one route) | ➖ None needed |

## Mutation proof (all restored)

The test is load-bearing against **both** defenses, proven by three mutations:

| # | Mutation | Tests failed | Observed failure |
|---|----------|--------------|------------------|
| M-A | `chargeRequestSchema.metadata` gains `qty`/`quantity` (breaks the Zod strip) | **1** | `expected { …(5) } to not have property "qty"` — `999` survived into `payments.metadata` |
| M-B | outgoing Culqi metadata spreads the request metadata instead of being a literal | **2** | `expected { …(5) } to deeply equal { …(4) }` — `cartItems` + `shippingInfo` leaked into the gateway payload (mine + the pre-existing A2 test) |
| M-C | M-A **and** M-B together, with the spread placed *after* the literal | **2** | `expected 999 to be 3` — the client value actually reached Culqi |

M-C is the real attack: it needs **both** defenses broken before a client `qty` reaches the gateway,
which is why neither may be assumed.

## Non-obvious discovery

**The two defenses protect different downstream consumers, so one assertion per channel is required.**
The outbound Culqi metadata is read back by `buildWebhookPaymentValues`
(`src/core/payments/webhookPaymentValues.ts:117`), which persists `metadata.qty` into the webhook-created
payment row; the persisted `payments.metadata` is read back by `readFulfillmentQty`
(`src/core/payments/stockFulfillment.ts:148`). A Culqi-body-only assertion pins the first channel and
is **blind** to a regression in the Zod strip (M-A passes such a test); a DB-row-only assertion pins
the second and is blind to a regression in the literal (M-B passes such a test). The invariant is the
conjunction, so the test asserts both.

## Verification

- `pnpm test:unit` → **253 files / 2,904 tests, all passing** (baseline 253 / 2,903; net +1).
- `pnpm quality` → **0 errors, 925 warnings**, `tsc --noEmit` exit 0. The 925 matches the slice-2
  post-change value exactly; this hardening adds **zero** warnings (verified by linting the file with
  and without the new test: 1 warning before, 1 warning after — the one warning at line 25 is the
  pre-existing unused `mockProductsSelectFrom`).
- Pre-existing note: `tests/unit/repoTextEncoding.test.ts` can time out at 10 s under full parallel
  suite load on this machine (it passes in isolation in ~1.2 s). Unrelated to this change.
