# Verification Report

**Change**: stock-fulfillment-on-payment (NEW-8)
**Scope**: Slice 1 / PR1 only (`feat/stock-fulfillment-ledger`, working tree over `develop` @ `9e8c5a8`)
**Version**: N/A (delta specs under `specs/`, no published version yet)
**Mode**: Strict TDD
**Verifier**: fresh-context adversarial verify (independent execution; apply agent's claims treated as claims to falsify)
**Date**: 2026-10-20

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total (Phase 1 / this scope) | 7 (T0, T1.1–T1.6) |
| Tasks complete | 7 (all checked in `tasks.md`; apply-progress marks T0–T1.6 DONE) |
| Tasks incomplete | 0 |
| Change-level view | 26 tasks total; remaining 19 (T2.1–T2.8, T3.1–T3.7, V1–V4) belong to slices 2–3 by plan |
| V1–V4 evidence for current tree | V1 ✅ (2866/2866), V2 ✅ (tsc 0 errors), V3 ✅ (eslint 0 errors), V4 ✅ (all hard constraints, see Correctness) — checkboxes left unchecked in `tasks.md` for the final change-level pass |
| Scope discipline | ✅ Forbidden slice-2/3 files untouched: `create-order/route.ts`, `billing/schemas.ts`, `webhookPaymentValues.ts`, webhook `route.ts`, reconcile `route.ts`, `vercel.json`, `paymentApi.ts`, `useCheckoutPayment.ts` — `git status` shows only the 8 slice-1 files |

### Build & Tests Execution

**Build / quality gate**: ✅ Passed (gate = 0 errors)

```text
pnpm quality  →  eslint + tsc --noEmit → 0 errors, 928 warnings, exit 0
tsc --noEmit  →  0 errors

Baseline check (claim falsified): apply-progress claims "928-warning baseline is pre-existing".
Measured via `git stash -u` + `pnpm lint` on develop: 926 warnings (0 errors).
Current: 928 → this change ADDS exactly 2 warnings, both in the new helper:
  src/core/payments/stockFulfillment.ts:106  sonarjs/no-nested-conditional
  src/core/payments/stockFulfillment.ts:186  sonarjs/cognitive-complexity (22 > 15)
(0 errors regardless → gate green; the "pre-existing baseline" claim itself is inaccurate.)
Targeted lint of changed files: 0 errors / 4 findings = 2 helper sonarjs + 1 pre-existing
unused var (tests/unit/chargeRoute.test.ts:25, unchanged by this diff) + ledger.json config-ignore.
```

**Tests**: ✅ 2866 passed / 0 failed / 0 skipped

```text
pnpm test:unit
  Test Files  253 passed (253)
  Tests       2866 passed (2866)
  Duration    ~50s
```

**Mutation testing (run by the verifier, not the implementer)** — each mutation applied, full suite run, then restored; final tree re-verified green (253/2866, plus 96/96 on the 3 change test files after the last restore):

```text
M-A  Remove `gte(products.stock, requested)` from the decrement WHERE
     (src/core/payments/stockFulfillment.ts:254)
     → 3 FAILED (matches apply-progress claim):
        tests/unit/chargeRoute.test.ts > stock decrement (oversell) > decrements stock with an
          atomic availability predicate scoped to the business
        tests/unit/chargeRoute.test.ts > stock decrement (oversell) > uses the real quantity in
          the availability predicate, not a hard-coded 1
        tests/unit/stockFulfillment.test.ts > fulfillPaidSale > decrement is conditional and
          business-scoped: WHERE business_id AND stock >= qty
     Result: RESTORED, suite green.

M-B  Neutralize CAS short-circuit: `} else if (!wonFirstClaim) {` → `} else if (false && !wonFirstClaim) {`
     (stockFulfillment.ts:224)
     → 2 FAILED (matches apply-progress claim):
        tests/unit/chargeRoute.test.ts > fulfillment marker (stock_movements ledger) > a losing CAS
          claim (already fulfilled) skips the decrement but keeps the sale
        tests/unit/stockFulfillment.test.ts > fulfillPaidSale > a claim conflict (returning [])
          skips the decrement and reports already_claimed
     Result: RESTORED, suite green.

M-C  Corrupt the route's order-flow claim key:
     charge/route.ts:611 `id: culqiOrderId ? (culqiOrderId as string) : payment.id`
     → `id: culqiOrderId ? 'probe_wrong_key_not_a_row_id' : payment.id`
     → 0 FAILED — 253 files / 2866 tests ALL GREEN with a garbage claim key.
     Result: RESTORED, suite green.
     ⇒ CRITICAL per verify contract: a mutation that produces no failures proves nothing.
       No test anywhere pins the claim's `sourceId` (`grep sourceId tests/unit/chargeRoute.test.ts`
       = 0 hits; the helper test hard-codes a valid UUID at stockFulfillment.test.ts:334, which
       masks the route-side misuse found in CRITICAL-1).
```

**Coverage**: threshold 0 (`openspec/config.yaml`) → ✅ Above. Tool available (`test:coverage`, `@vitest/coverage-v8`); measured with the change's 3 test files:

```text
pnpm exec vitest run --coverage tests/unit/{chargeRoute,stockFulfillment,rlsStockMovementsMigration}.test.ts
  Test Files 3 passed, Tests 96 passed
```

### Spec Compliance Matrix

Statuses per report contract: ✅ COMPLIANT (covering test passed) / ❌ FAILING (test failed) /
❌ UNTESTED (no covering test) / ⚠️ PARTIAL (passes but covers only part) / ➦ out of slice scope.

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| SF-R2 | Two racing triggers produce exactly one decrement | `stockFulfillment.test.ts > a claim conflict (returning []) skips the decrement…` + `chargeRoute.test.ts > a losing CAS claim…` | ⚠️ PARTIAL — CAS mechanism pinned at unit level (mocked insert); true concurrent race never executed (no integration/real-PG layer) |
| SF-R2 | An order-backed sale claimed under two different key types still decrements once | (none — grep `sourceId` in chargeRoute.test.ts = 0; mutation C = 0 failures) | ❌ UNTESTED — and statically falsified: charge keys `('payment_orders', culqiOrderId-text)` (charge/route.ts:610-611) while spec requires the `payment_orders` **row id** (spec R2, payment-orders R5 delta: "flip … yields the order row's `id` … which key the helper's CAS claim"). The two paths can never collide ⇒ CRITICAL-2/3 |
| SF-R2 | The charge-route happy path is unchanged apart from the marker | `chargeRoute.test.ts` full suite (64/64) incl. hard guard :695 exactly-2-`mockTxUpdate` with flip first (`invocationCallOrder`), gate tests, claim-count tests | ✅ COMPLIANT |
| SF-R2 | A webhook-recorded payment fulfills without the charge route | — | ➦ slice 3 (webhook untouched; helper ready) |
| SF-R2 | A status-only order flip fulfils under the order key | `stockFulfillment.test.ts > order-backed anchor claims po FIRST…`, `> a product-less paid order claims but never decrements` | ⚠️ PARTIAL — helper supports a po-only anchor; webhook wiring is slice 3 |
| SF-R2 | A replayed paid event does not double-decrement | `stockFulfillment.test.ts > a claim conflict (returning [])…`, `chargeRoute.test.ts > a losing CAS claim…` | ⚠️ PARTIAL — mechanism tested; replay wiring is slice 3 |
| SF-R2 | Insufficient stock is loud, non-fatal, and terminal | `chargeRoute.test.ts > stock decrement (oversell)…` (3 tests), alert assertions (`stringContaining('oversold')`), `stockFulfillment.test.ts > decrement is conditional…` | ⚠️ PARTIAL — loud ✅ non-fatal ✅ terminal ✅ (claim row written before decrement blocks R4 retry), BUT the persisted ledger row records `outcome: 'fulfilled'` and `items[].applied: false` for an oversold sale (helper :213 vs result :264) — "outcome MUST be recorded" letter violated → WARNING-2; alert message not byte-compatible → WARNING-1 |
| SF-R1 | (3 scenarios) snapshot channels | — | ➦ slice 2 (schemas/create-order/client untouched) |
| SF-R3 | A paid product-bound row without a snapshot decrements one and alerts | `stockFulfillment.test.ts > resolveFulfillmentItems…` B1 cases + `emitFulfillmentAlerts` B1 branch | ⚠️ PARTIAL — B1 mechanism + alert implemented and unit-tested; trigger context (webhook/backstop) is slice 3 |
| SF-R3 | A missing snapshot never fails the payment | helper tests: 0-row decrement never throws; `chargeRoute.test.ts` oversell tests keep 200 | ⚠️ PARTIAL — mechanism proven; webhook `{received:true}` ack path is slice 3 |
| SF-R3 | A product-less paid order has no stock effect | `stockFulfillment.test.ts > a product-less paid order claims but never decrements` (+ outcome `no_product` persisted) | ✅ COMPLIANT (helper level) |
| SF-R4 | (4 scenarios, incl. `vercel.json` crons) | — | ➦ slice 3 — verified NOT touched (scope discipline) |
| SF-R5 | A cross-tenant source cannot decrement another tenant's stock | `stockFulfillment.test.ts > decrement is conditional and business-scoped…`; order pre-read `eq(paymentOrders.businessId, businessId)` (charge/route.ts:345) | ✅ COMPLIANT |
| SF-R5 | Affected rows are asserted through returned rows, never rowCount | grep: no `rowCount` in helper or new route code (only forbidden-in-comment references); CAS `.returning()` :217; decrement `.returning()` :257 | ✅ COMPLIANT |
| SF-R6 | A tampered snapshot quantity is rejected before money moves | — | ➦ slice 2 (create-order) |
| SF-R6 | Fulfillment consumes only amounts that reconciled | `charge/route.ts:248-253` `validateAmount({… cartItems: metadata?.cartItems})` pre-branching, before any Culqi call; suite green | ✅ COMPLIANT (charge path) |
| SF-R6 | No parallel quantity bound is introduced | grep of new code: no second price source / qty cap (`Math.max(1, item.quantity)` at :246 is a floor for B1, not a cap) | ✅ COMPLIANT |
| SF-R7 | A pre-deployment paid row is never fulfilled | `stockFulfillment.test.ts > isHistoricalPaidRow…`, `> FULFILLMENT_WATERMARK is a Date` | ⚠️ PARTIAL — predicate + constant exist and are tested, but no consumer exists in slice 1 (by design, slice 3) and the value is an unpinned placeholder → WARNING-3 |
| SF-R7 | The post-deploy boundary does not weaken B1 | — | ➦ slice 3 |
| PO-R2 (legacy) | Successful order — PagoEfectivo returns CIP | `createOrderRoute.test.ts > returns success with culqiOrderId, paymentCode, qrUrl for PagoEfectivo` (:253) | ✅ COMPLIANT |
| PO-R2 (legacy) | Successful order includes buyer name | `createOrderRoute.test.ts > sends client_details with first_name/last_name when customerName is provided` (:328) | ✅ COMPLIANT |
| PO-R2 (legacy) | Order without buyer name omits name keys | (no test asserts absence of `first_name`; only :328/:362 positive hits) | ❌ UNTESTED — **pre-existing gap**, untouched published text, no task in this change covers it → WARNING-7 |
| PO-R2 (legacy) | Invalid input rejected | `createOrderRoute.test.ts > returns 400 for missing businessId` (:171), `> returns 400 for invalid email` (:185) | ✅ COMPLIANT |
| PO-R2 (legacy) | Culqi API failure | `createOrderRoute.test.ts > returns Culqi error and does NOT insert when Culqi API fails` (:371) | ✅ COMPLIANT |
| PO-R2 (delta) | The cart snapshot is persisted alongside culqiRaw | — | ➦ slice 2 |
| PO-R2 (delta) | A snapshot whose quantities do not reconcile is rejected | — | ➦ slice 2 |
| PO-R2 (delta) | The snapshot never disturbs the R13 product binding | — | ➦ slice 2 |
| PO-R5 (delta) | Order paid via webhook (flip + fulfillment, same tx) | `webhookOrderStatus.test.ts > updates payment_orders to paid when paid status received` (:72) covers flip only | ➦ slice 3 (fulfillment assertion is PR3 work; webhook untouched per plan) |
| PO-R5 (delta) | A replayed paid event does not double-decrement | — | ➦ slice 3 (helper mechanism counted under SF-R2) |
| PO-R5 (legacy) | Order expired via webhook — no stock movement | `webhookOrderStatus.test.ts > updates payment_orders to expired…` (:88) + static: no fulfillment code in webhook | ✅ COMPLIANT |
| PO-R5 (legacy) | Unknown Culqi order ID in webhook | `webhookOrderStatus.test.ts > logs warning and returns received when culqiOrderId not found in DB` (:128) | ✅ COMPLIANT |
| PO-R5 (delta) | The flip never outlives fulfillment | — | ➦ slice 3 |
| PO-R2 correction C1 | (2 archive-time scenarios) | — | ➦ archive phase |

**Compliance summary (in-scope rows only)**: 12/19 ✅ COMPLIANT, 6/19 ⚠️ PARTIAL, 1/19 ❌ UNTESTED (SF-R2 two-key scenario — the change's central requirement). Out of scope: 17 (slice 2: 7, slice 3: 10), 2 archive, 1 pre-existing gap.

---

### TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | "TDD Cycle Evidence" table found in `apply-progress.md` (RED rows for T1.1/T1.3/T1.5 paired with GREEN T1.2/T1.4/T1.6) |
| All tasks have tests | ✅ | 6/6 implementation tasks map to test files (T0 is branch setup — N/A) |
| RED confirmed (tests exist) | ✅ | 3/3 files exist: `rlsStockMovementsMigration.test.ts`, `stockFulfillment.test.ts`, `chargeRoute.test.ts` |
| GREEN confirmed (tests pass) | ✅ | 96/96 tests across the 3 files pass on execution; full suite 2866/2866 |
| Triangulation adequate | ⚠️ | TRIANGULATE column absent from the evidence table; verified manually: helper = 24 cases across behaviors, charge route = 64 — BUT SF-R2's cross-path key identity has **0** cases (CRITICAL-3) |
| Safety Net for modified files | ⚠️ | SAFETY NET column absent from the evidence table; verified manually: modified `chargeRoute.test.ts` guard intact (:695 exactly-2 `mockTxUpdate`, flip-first via `invocationCallOrder`); `vitest.config.ts:26-27` `restoreMocks`/`clearMocks` prevent cross-test leakage; no early-return Once-queue poisoning found (new tests use persistent mocks re-established in `beforeEach`; pre-existing Once queues at :1032/:1051/:1108/:1143 fully consumed post-change) |

**TDD Compliance**: 4/6 ✅, 2 ⚠️ (evidence-table format gaps — both columns manually verified above)

---

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 96 (change-related; 2866 suite-wide) | 3 | vitest (`pnpm test:unit`) |
| Integration | 0 | 0 | not installed |
| E2E | 0 (tooling present: `test:e2e` script) | 0 | playwright — not exercised by this gate |
| **Total** | **96** | **3** | |

SUGGESTION: ledger/CAS logic is unit-only; a single integration test against real Postgres would have caught CRITICAL-1 (uuid cast) immediately (also see Mutation C).

---

### Changed File Coverage

| File | Line % | Branch % | Uncovered Lines | Rating |
|------|--------|----------|-----------------|--------|
| `src/core/payments/stockFulfillment.ts` (new) | 100% (61/61) | 93.2% (69/74) | — | ✅ Excellent |
| `app/api/payment/charge/route.ts` | 87.1% (142/163) | 84.2% (165/196) | 21 lines: 190,224,260,292,300,312,327,430-431,460-461,477-478,522,524,533,652,657,671,676,764 — all pre-existing (rate-limit/idempotency/notify catch branches); the fulfillment block 575–642 is fully covered | ⚠️ Acceptable |
| `src/core/database/schema/orders.ts` | 33.3% (10/30) | n/a | declarative model-definition statements | ⚠️ Low (mechanical flag; no behavioral logic — informational) |

**Average changed-file coverage**: 73.5% (weighted by file: excellent on behavioral code, low only on declarative schema)

---

### Assertion Quality

| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| `tests/unit/chargeRoute.test.ts` | (absent) | no assertion on claim `sourceId` anywhere in the file (grep = 0) | Missing spec-critical assertion — Mutation C corrupted the claim key and the suite stayed green; masks CRITICAL-1/2 | CRITICAL |
| `tests/unit/chargeRoute.test.ts` | 25 | `mockProductsSelectFrom` assigned, never used | Unused var (pre-existing — line unchanged by this diff) | WARNING (pre-existing) |
| `tests/unit/chargeRoute.test.ts` | 695 | `expect(mockTxUpdate).toHaveBeenCalledTimes(2)` | Mock call-count coupling — **intentional**, mandated by tasks.md T1.5/V4 hard guard; not counted as a violation | — (by design) |

Tautology/ghost-loop/smoke-test scan across all 3 files: none found.

**Assertion quality**: 1 CRITICAL (missing), 1 WARNING (pre-existing)

---

### Quality Metrics

**Linter**: ⚠️ 0 errors / 928 warnings repo-wide (develop baseline **926** measured via stash → +2 from the new helper; changed-file target run: 0 errors / 4 findings incl. config-ignore)
**Type Checker**: ✅ 0 errors (`tsc --noEmit`, no changed-file hits)

---

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|---|---|---|
| SF-R1 snapshot persistence | ➦ Not implemented (slice 2, by plan) | Forbidden files untouched ✅ |
| SF-R2 exactly-once CAS | ❌ **Mis-implemented** | Ordered key set correct (`payment_orders` first — helper :189-195) and CAS correct (INSERT `onConflictDoNothing().returning()` :206-217, same tx :276), **but key identity wrong**: charge route anchors with Culqi's TEXT id (charge/route.ts:610-611), and the payments key uses `anchor.id` too (:193 via :611) instead of `payment.id`. See CRITICAL-1/2/3 |
| SF-R3 B1 fallback | ✅ Mechanism implemented | `Math.max(1, …)` floor :246, `b1` flag, alert :315-320; anti-improvement comment :289-293 |
| SF-R4 backstop + cron | ➦ Not implemented (slice 3, by plan) | cron/`vercel.json` untouched ✅ |
| SF-R5 scoping + `.returning()` | ✅ Implemented | decrement `eq(products.businessId, anchor.businessId)` :253; claim sets `businessId` :209; order pre-read scoped (charge/route.ts:345); zero `rowCount` reads in new code |
| SF-R6 validateAmount | ✅ (charge path) / ➦ slice 2 (create-order) | `validateAmount({…, cartItems})` at charge/route.ts:248-253, before any Culqi call |
| SF-R7 watermark | ⚠️ Placeholder | `FULFILLMENT_WATERMARK = 2026-10-01` — predates today by 19 days; must be re-set at PR3 cutover per D7 → WARNING-3 |
| PO-R5 atomic flip | ➦ slice 3 | webhook untouched ✅ |
| PO-R2 cartItems schema | ➦ slice 2 | schemas/create-order untouched ✅ |

**Hard-constraint checks (V4)**:

| Constraint | Evidence | Result |
|---|---|---|
| Guard: exactly 2 `mockTxUpdate`, flip first, decrement second | `chargeRoute.test.ts:695` `toHaveBeenCalledTimes(2)`; calls[0] asserted as paid-flip; flip-first via `invocationCallOrder` (:1214); CAS is an INSERT (`onConflictDoNothing`) — never a third UPDATE | ✅ |
| Decrement = `WHERE business_id AND stock >= qty` + `.returning()`, no GREATEST/rowCount | helper :250-257; mutation A proved the predicate is load-bearing (3 failures); grep: no GREATEST/rowCount outside forbidden-in-comment prose | ✅ |
| CAS `INSERT … ON CONFLICT DO NOTHING … RETURNING` before decrement, same tx | helper :206-217 before :247; `if (opts?.tx) return run(opts.tx)` :276; route passes `{tx}` :615-623; mutation B proved the short-circuit is load-bearing (2 failures) | ✅ |
| Ordered key set `payment_orders` → `payments`, first claim wins | helper :189-195; dedicated test asserts sourceType order; partial-claim conflict path continues (:224-235) | ✅ (order) / ❌ (identity — CRITICAL-2) |
| Alerts `console.error` only + anti-improvement comments (B-07) | helper :289-293; route :634-639; no `logger` import in helper | ✅ |
| Business scoping everywhere, `.returning()` assertions | see SF-R5 row | ✅ |
| Migration RLS zero-policy (0050 pattern), prefix free, registered | `0051_stock_movements_ledger.sql` mirrors 0050 (ENABLE RLS, no CREATE POLICY — pinned by `rlsStockMovementsMigration.test.ts` 8/8); `pnpm check:migrations` OK (0051 once; 0048 double-prefix is pre-existing/grandfathered — not touched) | ✅ |
| No out-of-scope files touched | `git status` = only 8 slice-1 files | ✅ |
| Snapshot not aliased to `metadata.productId` (R13) | charge route reads no `cartItems` from `metadata.productId`; no schema changes to binding | ✅ |

**CAS-on-postgres-js soundness** (analyzed): `INSERT … ON CONFLICT DO NOTHING … RETURNING` yields 0 rows on conflict; concurrent duplicates block on speculative insertion until the winner commits, then return 0 rows — exactly-once holds under true concurrency at the DB level. The defect is *what gets inserted*, not the CAS primitive.

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D1 charge-route extraction into shared helper, same tx | ✅ Yes | `{tx}` threaded; gate order untouched |
| D2 `stock_movements` schema shape | ✅ Yes | uuid `source_id` NOT NULL :391, unique pair :401, CHECKs, jsonb `items`, `fallbackQty1` — mirrors migration |
| D3 module placement `src/core/payments/` | ✅ Yes | peer of idempotency/culqiOrders; no new dependency (`package.json` untouched) |
| D4 ordered key set (po → payments; charge claims `('payments', payment.id)` + `('payment_orders', po.id)`) | ⚠️ Partial | Order implemented; **identity deviates** for the charge path (culqiOrderId instead of row ids) → CRITICAL-2. The po row id was available one line away (`.returning({ id: paymentOrders.id })` at charge/route.ts:585) but unused for the anchor |
| D5 alerts post-commit, `console.error` | ⚠️ Partial | Post-commit ✅, console.error ✅ — but message/payload NOT byte-compatible with task T1.6 → WARNING-1 |
| D6 mock-chain extensions | ✅ Yes | see TDD Safety Net row |
| D7 watermark set at PR3 cutover | ⚠️ Deferred | Placeholder stands per plan; value must be re-set at PR3 → WARNING-3 |
| D8/D9/D10 (PR3 triggers/backstop) | ➦ n/a | slice 3 — webhook/cron/vercel untouched ✅ |
| Review budget ≤400 lines/slice, ~215 estimated | ❌ Exceeded | actual **1,132 insertions + 71 deletions = 1,203 changed lines** (tests 594, helper 321, route 102, schema 38, migration+ledger 126) ≈ 3× budget, 5.6× estimate → WARNING-4, decision deferred by apply-progress |

### Issues Found

**CRITICAL**:

1. **CRITICAL-1 — Real-Postgres crash: Culqi TEXT id inserted into `uuid NOT NULL` `source_id`.**
   `charge/route.ts:610-611` anchors the order flow with `id: culqiOrderId` (Culqi's text id — fixtures/`paymentApi` use `ord_…`, e.g. `ord_culqi_abc123`), but `stock_movements.source_id` is `uuid('source_id').notNull()` (schema :391, migration 0051). Drizzle sends the value as-is; PostgreSQL raises `invalid input syntax for type uuid` → **the whole charge transaction rolls back on every order-flow charge**: money already captured by Culqi, payment not recorded, order stays `pending`, no decrement — the exact drift NEW-8 exists to close. Unit tests are structurally blind (no `sourceId` assertion in `chargeRoute.test.ts`; the helper test hard-codes a valid UUID at `stockFulfillment.test.ts:334`). Fail-closed (no stock corruption), fail-loud (500), but broken in production.

2. **CRITICAL-2 — The change's central exactly-once claim (SF-R2) is falsified as wired.**
   Spec R2 requires keys `('payment_orders', po-row-id)` and `('payments', payment-row-id)` so the charge transaction and the later PR3 flip (`payment-orders` R5 delta: "the flip … yields the order row's `id` … which key the helper's CAS claim") **collide on the same `(source_type, source_id)` pair**. As implemented, charge claims `('payment_orders', culqiOrderId-text)` and `('payments', culqiOrderId-text)` (both via `anchor.id` at helper :192-193), while D8's flip will claim `('payment_orders', po-uuid)` → **different ledger rows → both first-claims win → two decrements for one sale**. Even ignoring the crash (CRITICAL-1), fixing only the type (casting/uuid-ing the culqi id) would leave this second, fail-open defect intact. Additionally, charge never claims `('payments', payment.id)` for the order flow — deviating from design D4 and from R2's "keyed by the payments row id".

3. **CRITICAL-3 — Test that cannot fail (Mutation C).**
   Replacing the route's claim key with the constant `'probe_wrong_key_not_a_row_id'` left the entire suite green (253/2866). Zero tests pin the claim's `sourceId`; the ordered-key test only asserts `sourceType`. Per the verify contract, a mutation producing no failures is itself CRITICAL: the suite gives false confidence on the exact dimension where findings 1 and 2 live. (`grep sourceId tests/unit/chargeRoute.test.ts` = 0 hits.)

**WARNING**:

1. **W1 — Alert message/payload not byte-compatible (task T1.6).** Prefix changed `'[charge] oversold…'` → `'[stockFulfillment] oversold…'` (helper :308, :316) and payload gained `channel/sourceType/sourceId`. Tests only assert `stringContaining('oversold')`. `docs/PREPRODUCTION_READINESS_2026-10_VERIFICATION.md` still references the old `[charge] oversold` string — stale if any dashboard/grep keys on it. (Spec R3 *wants* source in the alert; the task text demanded byte-compatibility — spec and task conflict; deviation not documented in apply-progress.)
2. **W2 — Ledger misrecords the fulfillment outcome.** The claim row is written before the decrement with `outcome: productBound ? 'fulfilled' : 'no_product'` (helper :213) and pre-decrement `items` (all `applied: false`); the correct post-decrement result (`'partial'`, applied flags — :243-273) is returned to the caller but never persisted. Consequences: oversold sales are recorded as `'fulfilled'` in the ledger, the CHECK value `'partial'` is unreachable from any path, and `items[].applied` is dead data. The backstop anti-retry goal of R2 ("so the backstop does not re-attempt") still holds via claim-row presence — the requirement's letter ("the fulfillment outcome MUST be recorded") does not.
3. **W3 — Watermark placeholder.** `FULFILLMENT_WATERMARK = 2026-10-01` predates today (2026-10-20) by 19 days; test only pins `instanceof Date` + not-NaN. D7 defers the real value to PR3 — if forgotten, the backstop's `updatedAt >= watermark` predicate will retro-fulfill sales paid between 10-01 and cutover (they have no ledger rows), violating R7 ("rows already `paid` when the change deployed … no movement is created for them, ever"). Design's "direction-safe / only widens the true-victim window" reasoning holds only against pre-2025 history, not against R7's deployment line.
4. **W4 — Size/Review Workload Guard.** 1,203 changed lines vs the 400-line budget and the ~215 estimate (3× / 5.6×). Apply-progress flags it and defers the decision. Orchestrator must resolve via the cached `delivery_strategy` (split PR1, `size:exception`, or accept) before any PR.
5. **W5 — TDD evidence table incomplete.** `apply-progress` TDD Cycle Evidence table lacks the TRIANGULATE and SAFETY NET columns required by strict-tdd-verify (both manually verified by this phase — see TDD Compliance).
6. **W6 — Changed-file coverage.** `src/core/database/schema/orders.ts` at 33.3% lines (< 80% mechanical flag; declarative model file, informational).
7. **W7 — Falsified claim in apply-progress.** "928-warning baseline pre-existing" is wrong: develop baseline is **926** (measured); the change adds 2 sonarjs warnings in the new helper. Gate (0 errors) still green.
8. **W8 — Pre-existing spec-test gap (tracked, not introduced):** `payment-orders` R2 legacy scenario "Order without buyer name omits name keys" has no covering test (only positive `first_name` assertions exist). No task in this change covers it; listed so archive/spec maintenance can pick it up.

**SUGGESTION**:

1. **S1** — Add a route test asserting the claim payload's `sourceId` equals the DB-derived row id (`payment.id` / `payment_orders.id`) — this single assertion would have caught CRITICAL-1/2/3 and protects the D8 collision contract.
2. **S2** — `result.claimed` only ever contains the first key (`wonFirstClaim` guard, helper :220-223); the second committed claim exists in the ledger but is invisible to callers. Surface both for observability.
3. **S3** — No test pins the claim payload's `outcome`, `items`, `fallbackQty1` fields (relevant to W2).
4. **S4** — One integration test against real Postgres (uuid column + ON CONFLICT under concurrency) would close the unit-layer blind spot demonstrated by Mutation C.
5. **S5** — Refactor helper hotspots flagged by sonarjs: nested ternary :106, cognitive complexity 22 (:186), when next touching the file.

### Verdict

**FAIL**

The mechanism (CAS ordering, same-transaction claim, conditional business-scoped decrement, migration/RLS, scoping, alert safety) is correctly built and mutation-verified — but the change's central requirement, exactly-once fulfillment keyed to DB row ids (SF-R2), is mis-keyed: it crashes real Postgres on the order flow (CRITICAL-1), would double-decrement once the crash is naively fixed (CRITICAL-2), and no test can detect either (CRITICAL-3, mutation-verified). Fix in slice 1 before PR: re-key the charge anchor to row ids (po id is already returned at charge/route.ts:585; payments key must use `payment.id`), pin `sourceId` assertions, then re-run verify.

---
---

# Re-verification Pass 2 (post-fix, adversarial)

**Date**: 2026-10-20 · **Verifier**: fresh-context adversarial re-verify · **Tree**: same branch, UNCOMMITTED fix on top of the pass-1 tree
**Mode**: Strict TDD · **Prior pass**: kept above, unmodified — this section supersedes its verdict

The fix agent's claims were treated as unverified input and independently reproduced.

### Reproduced numbers (every claim re-run, not copied)

```text
pnpm test:unit   → 253 files / 2873 tests passed / 0 failed  (fix claim 253/2873 — REPRODUCED)
pnpm quality     → 0 errors, 926 warnings, exit 0            (fix claim 926/0 — REPRODUCED)
develop baseline → measured independently via git stash -u + pnpm lint: 926 warnings / 0 errors
                   ⇒ NET 0 new warnings (pass 1 measured +2; the 2 sonarjs warnings in the old
                   helper are gone — targeted lint of all 6 changed/new TS files = 1 warning,
                   the pre-existing unused var tests/unit/chargeRoute.test.ts:25)
pnpm check:migrations → OK (79 sql, 55 manual-only, 21 grandfathered collisions)
Final restore re-run → 253/2873 green (after all mutations reverted; tree byte-clean:
  no probe strings, gte predicate restored, CAS short-circuit restored)
```

### Mutation campaign (all re-run by this verifier; restored; final tree green)

```text
M-C1 (NEW)  resolveClaimKeys: payment_orders slot id → 'probe_wrong_key_not_a_row_id'
            → 3 FAILED  (pass 1 equivalent mutation: 0 FAILED — the blind spot is CLOSED)
              chargeRoute > keys both order-flow claims to DB row ids, never Culqi text ids (R2)
              chargeRoute > no claim key ever carries a Culqi text id (uuid-column regression guard)
              stockFulfillment > order-backed anchor claims payment_orders FIRST … keyed to DB row ids
M-C2 (NEW)  resolveClaimKeys: payments slot id → probe value
            → 5 FAILED  (token-only key + both-flow keys are now pinned too)
M-A         drop gte(products.stock, requested) from decrement WHERE → 3 FAILED (same 3 as pass 1)
M-B         neutralize CAS short-circuit (`false &&`) → 3 FAILED (pass 1: 2; the new in-memory
            ledger R2 test also catches it now)
```

### Probe: reverse-order two-trigger scenario (temporary scratch test, run then deleted)

A payments-only claim landing FIRST for a sale that LATER gets the full ordered key set
produces **2 decrements** (probe printed `decrements=2`, assertion failed). The short-circuit
only treats a FIRST-key conflict as "already claimed"; a first-key WIN followed by a second-key
conflict proceeds to decrement. See N1 below — not reachable in slice 1, but the helper's stated
"any two triggers collide" guarantee is conditional on identical key sets.

### CRITICAL re-verification

| Finding | Status | Evidence |
|---|---|---|
| CRITICAL-1 (Culqi text id into uuid `source_id`) | ✅ **FIXED** | Route anchors only from DB returnings: po key = `flipped[0].id` from `.returning({ id: paymentOrders.id })` (route :589-596); payments key = `payment.id` from the payments insert `.returning()` (:572, :620). `resolveClaimKeys` throws when no row id resolves (helper :136-140; test `rejects.toThrow(/no claim keys/)` + no insert). `culqiOrderId` is carried on the anchor but NEVER read by key resolution (grep). No caller other than the charge route exists yet (grep `fulfillPaidSale`). Mutations M-C1/M-C2 kill the suite — no path can silently write a bad key |
| CRITICAL-2 (two winning keys for one sale) | ✅ **FIXED for the charge↔flip contract** (with N1 caveat) | Ordered key set = `('payment_orders', po-row-uuid)` then `('payments', payments-row-uuid)` — route test pins BOTH sourceIds to distinct DB uuids (`claims[0].sourceId === PO_ROW_UUID`, `claims[1].sourceId === PAY_ROW_UUID`, `.not.toBe` each other). A future PR3 flip resolving the po row by `culqiOrderId` collides on key 1 → returns `already_claimed`. Short-circuit + full-set-first-then-payments-only pinned by the in-memory-ledger test (stockFulfillment.test.ts:418, asserts `decrementCalls === 1`). Ordering uniform po-first across all helpers paths → deadlock-free (static) |
| CRITICAL-3 (test that cannot fail) | ✅ **FIXED** | M-C1: 3 failures (was 0). M-C2: 5 failures. Both flows pin `sourceId`; a dedicated no-Culqi-text-id regression guard exists (route test) |

### The `onConflictDoUpdate` question (pass-1 suspicion; scrutinized from first principles)

| Attack | Verdict | Reasoning |
|---|---|---|
| Does the race-LOSER reach the upsert and overwrite the winner? | **NO** | `claimKeys` returns `null` on a first-key conflict → `fulfillPaidSale` returns `already_claimed` (helper :387-388) BEFORE the decrement (:396) and the correction (:398). `claimed` only ever contains keys THIS transaction inserted (:261-265), so `correctClaimOutcome` can only mutate rows it wrote itself. Loser path cannot touch the ledger. NOT a new CRITICAL |
| `where: businessId` mismatch — silent no-op → `length !== 1` → throw aborts a valid payment? | **Theoretically yes, practically unreachable** | Postgres `ON CONFLICT DO UPDATE … WHERE` false ⇒ silent no-op ⇒ `RETURNING` empty ⇒ `length !== 1` throws ⇒ payment tx aborts. But the upsert only runs for keys this tx itself inserted, so the conflicting row carries the same `anchor.businessId` — the WHERE always passes. Cross-business conflict on the same key is impossible (keys are the caller's own row uuids, and a foreign conflict would have taken the loser path earlier). Fail-closed if it ever fired |
| Is `(sourceType, sourceId)` the real DB unique constraint? | **YES** | Schema `unique('stock_movements_source_unique').on(sourceType, sourceId)` (orders.ts) and migration 0051 `CONSTRAINT "stock_movements_source_unique" UNIQUE ("source_type", "source_id")` — target matches, same column order. No runtime "no unique constraint matching" error (static match; unit mocks cannot prove drizzle's runtime inference — see limitations) |
| Is plain `INSERT … ON CONFLICT DO NOTHING … RETURNING` sufficient? Is the upsert necessary? | **The claim already IS DO NOTHING; the upsert is NOT required for R2** — it exists only to fix W2 (truthful `partial` outcome after oversell) | Alternatives: (a) plain `tx.update` by the claim's returned row id — more directly scoped, but a 3rd `tx.update`, breaking the V4 exactly-2 guard; (b) no correction — reopens W2. **Bottom line: keep the upsert — it is safe under current wiring (self-row only, loser never reaches it); do NOT revert.** BUT the helper comment "the ledger stays insert-only" (:324) is factually WRONG — `onConflictDoUpdate` mutates the existing row on conflict → N2 |

### Warning status after the fix

| Pass-1 warning | Now |
|---|---|
| W1 alert byte-compat | ❌ **OPEN** — prefix is still `'[stockFulfillment] oversold…'` (helper :437); `docs/PREPRODUCTION_READINESS_2026-10_VERIFICATION.md:392` still references `[charge] oversold` |
| W2 ledger misrecords outcome | ✅ **FIXED** — oversold sales persist `outcome: 'partial'` with truthful `applied` flags (correction upsert); tests pin `set.outcome === 'partial'`, business-scoped WHERE, and the corrected values payload (stockFulfillment.test.ts:476-504); route-level oversell path exercises it |
| W3 watermark placeholder | ❌ OPEN (2026-10-01; deferred to PR3 by D7) |
| W4 size overrun | ❌ OPEN, **GROWN** — see size below |
| W5 TDD evidence table gaps | ❌ OPEN, worse — apply-progress was NOT updated for the fix cycle: no fix TDD evidence, and its numbers are now stale (says 2866 tests / "928 pre-existing baseline"; reality 2873 / baseline 926) |
| W6 schema-file coverage | ❌ OPEN (informational) |
| W7 "928 baseline pre-existing" falsified | Effectively moot (net 0 new warnings now) but the apply-progress sentence remains inaccurate |
| W8 pre-existing spec gap (buyer-name absence) | ❌ OPEN (pre-existing, out of scope) |

### New findings (pass 2)

**WARNING**:

- **N1 — Exactly-once holds only for IDENTICAL key sets; the reverse order double-decrements (probe-verified, latent for PR3).** `claimKeys` returns `null` only on a FIRST-key conflict. If an order-backed sale is first claimed under a payments-only key set (`paymentOrderId: null`), a later full-set trigger wins the fresh `payment_orders` key, skips the conflicting `payments` key ("a later key that conflicts is fine"), and **decrements again** (probe: `decrements=2`). Not reachable in slice 1 (single caller; the charge route always resolves the po row first for order-backed sales, and token-only sales have no po row). It becomes reachable if any PR3 trigger (webhook charge upsert per design :53, reconcile backstop) fulfils an order-backed sale WITHOUT resolving its po row — the same window as design risk 1's residual. **Guard for PR3: every trigger MUST resolve the po row (by `culqiOrderId`) for any sale that has one, before calling `fulfillPaidSale`; add the reverse-order scenario as a committed test in PR3.** The helper doc ("any two triggers of one sale collide and exactly one wins", :112-114) overstates the guarantee — true only when both triggers resolve the same key set.
- **N4 — apply-progress not updated post-fix** (stale counts 2866/928 vs actual 2873/926; no fix-cycle TDD evidence appended). Process-level; archive should reconcile.

**SUGGESTION**:

- **N2** — Fix the inaccurate comment "the ledger stays insert-only" (helper :324): `onConflictDoUpdate` is a mutating upsert (safe here — self-row only — but the wording misleads the next maintainer).
- **N3** — Document the key-set-identity precondition on `resolveClaimKeys` (N1) in the helper's contract comment.
- **N5** — `resolveClaimKeys` does not validate uuid format; a non-uuid caller value fails only at the DB cast (fail-closed via 500, not a typed throw). Optional format guard.
- **N6** — `correctClaimOutcome` marks every line sharing an oversold `productId` as not-applied even if a duplicate line for the same product applied — cosmetic, pathological carts only.

### Hard constraints (V4) re-checked

| Constraint | Result | Evidence |
|---|---|---|
| Exactly 2 `mockTxUpdate` in order flow, flip FIRST, decrement SECOND; CAS stays an INSERT | ✅ | chargeRoute.test.ts:711 (`toHaveBeenCalledTimes(2)`, `calls[0]` asserted as the paid flip); positional order = invocation order; CAS claim is `.onConflictDoNothing().returning()`; correction is an insert-upsert, never `tx.update` (grep: helper has exactly one `.update(` — the decrement on `products`) |
| Decrement conditional + business-scoped + `.returning()`, no GREATEST/rowCount | ✅ | helper :289-299; M-A kills 3 tests; grep: GREATEST/rowCount appear only in forbidden-in-comment prose |
| Alerts `console.error` only (B-07) | ✅ | helper :437/:445; no `logger` import; anti-improvement comments intact in helper and route |
| No slice-2/3 file touched | ✅ | `git status` = the same 8 slice-1 files; `create-order/route.ts`, `billing/schemas.ts`, `validateAmount.ts`, `webhookPaymentValues.ts`, webhook route, reconcile route, `vercel.json`, storefront client all untouched |
| Migration RLS zero-policy + registered | ✅ | rls test 8/8 green; `check:migrations` OK |

### Queue-poisoning audit (Once queues)

All `mockResolvedValueOnce` queues are fully consumed by their own test (chargeRoute :1048/:1067/:1124/:1159 — flip + one decrement per line, all consumed on the asserted 200/500 paths; stockFulfillment :280/:325/:478 — claim/decrement consumed on the exercised paths). New tests use persistent `mockResolvedValue` re-established in `beforeEach`. No early-return leak found; full suite green in file order.

### Size (for the pre-approved `size:exception` — honest number)

```text
Tracked (git diff --numstat):   route.ts 62+/49-, ledger.json 72+/19-, orders.ts 38+/0,
                                chargeRoute.test.ts 173+/3        → 345 insertions, 71 deletions
Untracked new files:            stockFulfillment.ts 450, stockFulfillment.test.ts 560,
                                rlsStockMovementsMigration.test.ts 77, 0051 sql 54  → 1,141
TOTAL:                          1,486 insertions + 71 deletions = 1,557 changed lines
Net of ledger.json generator formatting churn (~5 real lines): ≈ 1,500 lines
(prior pass measured 1,203; the fix added ~354 net lines — correction logic + 7 new tests)
```

### Limitations (could not verify)

- Real-Postgres behavior: uuid cast, `ON CONFLICT` under true concurrency, and drizzle's runtime unique-index inference for the upsert target are reasoned statically + pinned structurally (migration test) — no integration layer exists (pass-1 S4 still stands).
- The fix cycle's RED phase: no TDD evidence recorded anywhere (apply-progress stale, N4).
- Design risk 1 residual (does Culqi emit `charge.paid` for Órdenes sales?) — remains an open PR3 verification item.

### Verdict (pass 2)

**PASS WITH WARNINGS**

All three pass-1 CRITICALs are genuinely fixed and now mutation-killed (M-C1 3 failures, M-C2 5, M-A 3, M-B 3; previously the equivalent key mutation produced 0). The gate is green with **0 net new lint warnings** (926/926 vs develop baseline, independently measured). The suspected upsert hazard does NOT exist on the loser path — the loser never reaches the correction, and the correction can only mutate rows the winning transaction itself wrote; the upsert is safe and should be KEPT (but its "insert-only" comment is false — N2). The slice is **safe to commit** for slice 1, with the honest size number **1,557 changed lines** under the pre-approved `size:exception`, and N1 must be carried into PR3 as a hard wiring constraint (resolve the po row for every order-backed sale; add the reverse-order test). W1 (alert prefix) and W3 (watermark) remain open by the prior pass's terms.

---
---

# Slice 2 / PR2 Verification — adversarial verify (fresh context)

**Change**: stock-fulfillment-on-payment (NEW-8)
**Scope**: Slice 2 / PR2 only — snapshots + validation + client wiring
**Tree**: branch `feat/stock-fulfillment-snapshots`, HEAD == `origin/develop` == `533bf99c97f34df1e48c3fa27290c91076908e30` (slice 1 merged); **13 modified files, UNCOMMITTED** (623 insertions / 17 deletions = 640 changed lines)
**Mode**: Strict TDD · **Verifier**: fresh-context adversarial verify — every apply-agent claim treated as a claim to falsify, every number reproduced independently
**Date**: 2026-10-21
**Prior passes**: slice 1 (Pass 1 + Pass 2) kept above, unmodified. This section is a NEW scope and does not reopen them.

**Working-tree fingerprint (SHA256 of `git diff`)** — `B38C4A0DD65DF7077B063CB187F0206F1AA7B276266773BBA0D3467BF6B5D5FC` — identical before and after the entire verification, proving every mutation was reverted and the tree was never left modified.

**Deviation (mandatory disclosure)**: `judgment-day` prescribes a **dual blind review by two independent sub-agents**. This phase executed under the SDD executor contract, which explicitly forbids delegating or launching sub-agents. Its severity rubric was therefore applied **manually and adversarially by a single fresh context**, with mutation testing + executable probes substituted for the second reviewer. This is a deliberate, disclosed deviation — not an oversight.

---

## 1. Completeness

| Metric | Value |
|--------|-------|
| Tasks in scope (Phase 2) | 8 (T2.1–T2.8) |
| Tasks complete | 8 (all `[x]` in `tasks.md`; `apply-progress.md` marks each DONE) |
| Tasks incomplete | 0 |
| Scope discipline | ✅ 13 files, all slice-2. **Zero** slice-3 files touched: `app/api/webhooks/culqi/route.ts`, `app/api/cron/reconcile-payments/route.ts`, `vercel.json`, `migrations/*`, `src/core/database/schema/*`, `src/core/payments/stockFulfillment.ts` — verified by `git status --porcelain -uall` (no untracked files either) |
| Production / test split | 6 prod files (82+/16−) · 7 test files (541+/1−) |
| Size vs review budget | ❌ **640 changed lines vs the 400-line budget** → W-E (carried forward per the review-workload guard) |

## 2. Build & Tests Execution

```text
pnpm test:unit        → 253 files / 2903 tests passed / 0 failed / 0 skipped   exit 0
pnpm quality          → eslint + tsc --noEmit → 0 errors, 925 warnings        exit 0
tsc --noEmit          → 0 errors
pnpm check:migrations → OK — 79 sql files, 55 manual-only, 21 grandfathered prefix collisions   exit 0

develop baseline (measured independently, git stash -u + pnpm lint): 926 warnings / 0 errors
⇒ NET −1 warning (this slice REMOVES one warning; the apply-progress "928 baseline" claim from
  slice 1 is stale — the true baseline is 926, as pass 2 already established)
```

**Mutation campaign** — every mutation applied to the real tree, **full suite** run, then restored and SHA256-verified. All seven are load-bearing (a mutation that produces no failure proves nothing):

| # | Mutation | Failures | Killed test(s) |
|---|----------|----------|----------------|
| A | `useCheckoutPayment` stops forwarding `cartItems` | **2** | `Checkout.test.tsx > sends every cart line…`, `> sends the single line with its own quantity…` |
| B | `create-order` drops `cartItems` from `validateAmount` | **3** | `createOrderRoute.test.ts > reconciles the full cart total against every line…`, `> rejects a line quantity that does not match the amount paid…`, `> persists the cart snapshot…` |
| C | `create-order` stops persisting `metadata.cartItems` | **1** | `createOrderRoute.test.ts > persists the cart snapshot in payment_orders.metadata alongside culqiRaw` |
| D | Culqi charge body forced to carry a cart array | **1** | `chargeRoute.test.ts > sends the bound line quantity as scalar metadata.qty and never a cart array` |
| E | `boundQty` hardcoded to `1` | **1** | same test as D |
| F | webhook builder stops carrying `metadata.qty` | **2** | `webhookPaymentValues.test.ts > copies a positive integer qty into values.metadata`, `> coerces a numeric-string qty to an integer` |
| G | `paymentApi.createOrder` stops forwarding `cartItems` | **1** | `paymentApi.test.ts > forwards cartItems to the create-order endpoint` |

## 3. Adversarial probes (temporary, run then deleted — tree byte-identical afterwards)

43 assertions across two throwaway probe files, all green. This is where the two headline claims were settled.

**Probe 1 — pure (35 assertions).** Schema boundaries; Zod stripping; reader-agreement matrix; the boundQty-vs-fulfilment divergence matrix; proof the webhook builder never emits an array.

```text
quantity 0 / -1 / 1.5 / '2' / NaN        → REJECTED
quantity 1_000_000_000 / MAX_SAFE_INTEGER → ACCEPTED   ← no upper bound (S-C)
missing quantity                          → defaults to 1
[] (empty array)                          → ACCEPTED     ← no .min(1)
non-uuid id                               → REJECTED
extra keys (name/price/stock)             → STRIPPED to {id, quantity}
client metadata.qty                       → STRIPPED at the edge (cannot spoof)
readQty (webhook) vs readFulfillmentQty   → AGREE on all 12 inputs: 3,'3',1,0,-1,2.5,'abc',null,true,undefined,'0',' 3 '
webhook builder output                    → keys are exactly ['qty']; NEVER a cartItems key
```

**Probe 2 — route (8 assertions).** The decisive test of the reported under-charging hypothesis:

```text
B1  cart-only, amount = FIRST (cheap) line only      → 400 REJECTED (no Culqi call, no insert)
B2  cart-only, amount = WHOLE cart                   → 200
B3  cart-only, amount = only the EXPENSIVE line      → 400 REJECTED
B8  productId=CHEAP but cart=[EXPENSIVE]             → 200 with the EXPENSIVE price ⇒ the anchor id is DEAD when the cart is non-empty
B4  cartItems: [] and NO productId                   → 200 — NO price check at all (see W-D)
B5  cartItems: [] WITH a productId                   → 400 — the check still runs
B6  no cartItems, no productId (legacy generic)      → 200 — no price check (pre-existing)
B7  first cart line absent from the DB               → 400 'Producto no encontrado'
```

## 4. Spec Compliance Matrix (R1 / R6 — the slice-2 requirements)

| Requirement / scenario | Test | Result |
|---|---|---|
| **R1** order flow persists the cart snapshot at create-order | `createOrderRoute.test.ts > persists the cart snapshot in payment_orders.metadata alongside culqiRaw`; `> sends a byte-identical Culqi order body with or without the snapshot` | ✅ COMPLIANT (mutation C kills it) |
| **R1** the token flow carries a scalar `qty` on the charge metadata | `chargeRoute.test.ts > sends the bound line quantity as scalar metadata.qty and never a cart array` | ✅ COMPLIANT (mutations D+E kill it) |
| **R1** a snapshot in the wrong channel is a violation | charge metadata asserted to be exactly `{businessId, productId, platform, qty}` + `not.toHaveProperty('cartItems')` + `JSON.stringify(...)` contains no `[`; create-order persists an array and never `metadata.productId` | ✅ COMPLIANT |
| **R1** snapshot key dedicated — never aliased to `metadata.productId`; `readOrderProductBinding` reads exactly one key, three-state semantics unchanged | `charge/route.ts:90-99` + `:396-409` **byte-unchanged by this diff** (the charge-route diff is 10+/1−, all in the qty path) | ✅ COMPLIANT |
| **R1** token-flow `qty` derived server-side from the validated cart, never a raw client field | `charge/route.ts:468-470` derives from `metadata.cartItems` (the array `validateAmount` already reconciled at `:254`); outgoing metadata is a **literal** so no client field can reach it; Zod strips `metadata.qty` at the edge (probe-verified) | ✅ COMPLIANT — but see W-C (the invariant is unpinned) |
| **R6** create-order must pass the incoming `cartItems` to `validateAmount` | `create-order/route.ts:87-93`; probe B1/B2/B3 prove the reconciliation covers **every** line, not the anchor | ✅ COMPLIANT (mutation B kills it) |
| **R6** a snapshot whose amount does not reconcile is rejected before money moves | `createOrderRoute.test.ts > rejects a line quantity that does not match the amount paid (400, no Culqi, no insert)` | ✅ COMPLIANT (mutation B kills it) |
| **R6** no parallel quantity bound / second price source introduced | grep: no second price lookup, no cap logic anywhere in the diff | ✅ COMPLIANT |
| **R6** the client wires the snapshot end-to-end | `useCheckoutPayment.ts:165-168` → `paymentApi.ts:134` → `create-order/route.ts:78` | ✅ COMPLIANT (mutations A + G kill it) |
| **R1** the webhook builder carries an optional scalar `qty` and omits the key when absent | `webhookPaymentValues.test.ts` × 3 | ✅ COMPLIANT (mutation F kills it) |

**R1/R6 compliance: 10/10 ✅.** The slice-2 requirements are met as written.

## 5. Correctness (static evidence)

| Claim under test | Verdict | Evidence |
|---|---|---|
| "A tampered cart quantity is rejected before any external call" | ✅ TRUE | `create-order/route.ts:88-99` — the check precedes the Culqi call (`:207`) and the insert (`:256`); probe B1: 400 with `mockFetch`/`mockInsert` never called |
| "The reconciliation covers the whole cart, not just the first line" | ✅ TRUE | `validateAmount` prefers the cart array; probe B1 (cheap-first line only → 400) and B3 (expensive-only → 400) prove it |
| "The order flow persists an array and the token flow a scalar — no channel substitution" | ✅ TRUE | create-order writes `metadata.cartItems` (`create-order/route.ts:259-263`); the charge body carries `qty` only (`charge/route.ts:184`); the Culqi **order** body still carries `{businessId, productId, platform}` with **no** `qty` and **no** array (`create-order/route.ts:189`) |
| "The client cannot spoof the quantity" | ✅ TRUE (twice over) | Zod strips `metadata.qty` (probe 1) **and** the outgoing metadata is a literal that never spreads request metadata (`charge/route.ts:184`) |
| "The scalar reaches the durable channel" | ✅ TRUE | charge body → Culqi echoes `data.metadata` → `webhookPaymentValues.ts:115` `readQty` → `:131` `metadata: {qty}` → webhook route `.values({...values, status})` (`app/api/webhooks/culqi/route.ts:237`) → `payments.metadata` jsonb. The upsert's `set: {status, updatedAt}` does **not** overwrite `metadata` (`:239-241`), so a cart array written by the charge path survives |
| "The two flows' snapshot channels do not interfere" | ✅ TRUE | the order flow's recovery source is the persisted `payment_orders.metadata.cartItems` (an array); the token flow's is the charge metadata scalar. The webhook upsert cannot downgrade the array to `{qty}` |
| "The V4 hard guard survives" | ✅ TRUE | `chargeRoute.test.ts:797` `expect(mockTxUpdate).toHaveBeenCalledTimes(2)` — the line moved from pass-2's `:711` by exactly the 86 lines this slice added to that file; the assertion is unchanged. `mockTxSet.mock.calls[0][0].status === 'paid'` proves flip-first, decrement-second |
| "No slice-3 file was touched" | ✅ TRUE | `git status --porcelain -uall` → 13 modified files, 0 untracked, none in the slice-3 set |

## 6. Coherence (design)

| Decision | Followed? | Notes |
|---|---|---|
| D-notes: shared `cartItemsSchema` as the single source of truth | ✅ | `schemas.ts:16-24`; both the charge request and the create-order request reuse it; the pre-existing inline duplicate was removed (`schemas.ts:56-59`) |
| R1: order snapshot = the EXISTING `{id, quantity}` shape | ✅ | the persisted shape is byte-identical to the shape `validateAmount` already reconciles — no new shape invented |
| R1: snapshot never aliased to `metadata.productId` | ✅ | create-order writes only `culqiRaw` + `cartItems`; `readOrderProductBinding` untouched |
| D-notes: `webhookPaymentValues` stays pure, no DB-schema imports | ✅ | `readQty` is a local mirror of `readFulfillmentQty`; probe proves the two accept/reject identically on 12 inputs |
| R1: the token flow's scalar is "the quantity of the bound `productId` within the validated cart" | ✅ | `charge/route.ts:468-470` — the exact spec sentence, and the spec-mandated fallback to 1 is explicitly tested (`chargeRoute.test.ts:613-633`) |
| D-notes: client wiring forwards `{id, quantity}` only | ✅ | `useCheckoutPayment.ts:168` maps to exactly `{id, quantity}` — no client price/name reaches the server |

## 7. Issues Found

### CRITICAL

**None.** No incomplete task, no failing test command, no untested spec scenario, and no spec-breaking deviation. Every R1/R6 scenario has a passing covering test that is mutation-killed.

### WARNING

- **W-A (highest value in this report) — The token flow's durable channel can represent only ONE line of a multi-line cart, while the charge route sells the whole cart.** R1 mandates a scalar for the bound `productId` and R6 mandates it be "the quantity of the bound `productId` within the validated cart" — the implementation matches both *exactly*, and the multi-line behaviour is deliberate and tested (`chargeRoute.test.ts:561-598` asserts `qty: 3` for a 2-line A×3+B×2 cart). The consequence lands in PR3: the charge route fulfils `resolveFulfillmentItems({cartItems})` = **the whole cart** (`charge/route.ts:636-638`), but the token flow's webhook recovery can reconstruct **only the bound line**. Probe-verified matrix:
  - D1 — cart `{A×3, B×2}`: the sale moves **5** units, the recoverable snapshot rebuilds **3**. The other 2 units are never decremented, and because the snapshot *looks* valid, B1 (decrement 1 + alert) never fires → a **silent under-fulfilment**.
  - D2 — cart `{B×5}` with bound `productId = A` (not in the cart): the scalar falls back to **1**, naming a product that was **never sold**. Recovery would decrement A's stock by 1 while B×5 is lost → the wrong product is decremented. This fallback is explicitly tested (`chargeRoute.test.ts:613-633`), so it is a designed behaviour, not a bug — but the designed consequence deserves to be a conscious decision.
  - D3 — duplicate ids `{A×3, A×2}`: scalar 3 vs 5 units moved.
  - D4/D5/D6 (no cart / empty cart / single-line cart) — the two channels agree.
  **This is a limitation of the spec's channel choice, not a slice-2 implementation defect** (the slice complies with R1/R6's letter). **PR3 guard:** before wiring the webhook recovery, decide explicitly how a multi-line token sale is restored — e.g. restore the bound line and alert on the remainder, or derive the scalar as the cart total and re-derive the product set server-side. Do not let PR3 ship the recovery path without resolving D1/D2, or multi-line token sales will silently under-fulfil and can decrement unsold products.
- **W-B — The order flow fulfils from the transient request cart, not from the persisted snapshot R1 designates.** `charge/route.ts:636` reads `metadata?.cartItems` (the client's charge request), while the durable channel R1 defines is `payment_orders.metadata.cartItems` (persisted by create-order). Two sources of truth for one sale. Today they agree (the same client sends the same cart to both hops) and the divergence self-heals in the common case (a changed cart total fails `validateAmount` → 400 → the webhook path takes over with the persisted array). But a cart swapped for a *different* cart of the *same total* passes validation and decrements the transient cart while the durable snapshot names the other one. **PR3 guard:** the order flow's charge path should consume `orderRow.metadata.cartItems` so both triggers derive the decrement from the same source.
- **W-C — The R6 anti-spoofing invariant is asserted but not pinned by any test.** `tasks.md` T2.6 and `apply-progress.md` both claim "a client-supplied `metadata.qty` is stripped by the Zod schema, so the client cannot spoof the quantity independently". That is **true** (probe-verified: Zod's `strip` mode removes it, and the outgoing metadata is a literal that never spreads request metadata) — but **no test asserts it** (`grep qty tests/unit/` finds no case that sends a client `metadata.qty`). The property currently holds for two independent reasons; neither is guarded. One assertion would close it.
- **W-D — `cartItems: []` with no top-level `productId` skips the price revalidation entirely.** `create-order/route.ts:87` — `revalidationProductId = productId ?? cartItems?.[0]?.id` → `undefined` for an empty array → the whole check is skipped → an order for an arbitrary amount ≥ 100 cents is accepted, a Culqi order is created, and an **empty** `metadata.cartItems: []` snapshot is persisted (probe B4). This is the **pre-existing** generic-order behaviour (probe B6: no `cartItems` and no `productId` behaves identically — `git stash` baseline confirms `if (productId)` gated the check before this slice), so it is **not a new money hole introduced by slice 2**; but slice 2 makes it reachable with an explicit empty array and now persists an empty snapshot alongside it. Recommend `cartItems: []` be treated as "no cart" (drop the key) or the empty array rejected.
- **W-E — Review-workload guard: 640 changed lines vs the 400-line budget.** (582 of them are tests; production is 82+/16− across 6 files.) Under the pre-approved `size:exception` per the slice-1 precedent, but the orchestrator must confirm before the PR.

### SUGGESTION

- **S-A** — `createOrderRoute.test.ts > reconciles a cart-only order that has no top-level productId` **still passed under mutation B** (the cart removed from `validateAmount`), so it does not pin the full-cart reconciliation it is named for. Its assertion needs to distinguish "whole cart reconciled" from "first line reconciled" (e.g. a cart whose first line is cheap and whose later line is expensive, asserting 400 when only the first line is priced).
- **S-B** — No upper bound on `quantity` (1e9 and `Number.MAX_SAFE_INTEGER` are accepted). The quantity is bounded downstream by the DB-derived price reconciliation, so this is not exploitable today; a max would be a separate bound and R6 forbids a parallel one — flagging it only so it is a conscious decision.
- **S-C** — Consider a comment at `charge/route.ts:466-470` naming the recovery consequence of the `?? 1` fallback (W-A/D2), so the next maintainer sees it without reading this report.
- **S-D** — `webhookPaymentValues.readQty` duplicates `readFulfillmentQty` by design (purity, no DB-schema import) — acceptable, but the duplication is now load-bearing for cross-file agreement (probe-verified equivalent today, unpinned by tests).

### Falsified claim (reported hypothesis, tested and rejected)

The hypothesis under review — *"a cart-only create-order request reconciles only against the first cart line, so a multi-line order can be under-charged"* — is **FALSE**, and is falsified by the spec's own words and by execution:

- R6 states the create-order check "MUST pass the incoming `cartItems` to `validateAmount` (today it calls it without `cartItems`, so the reconciliation covers only the single `productId` line)". The slice implements exactly that, and `validateAmount` prefers the cart array whenever it is non-empty.
- Probe B1: a cart-only request whose amount matches only the cheap first line is **rejected 400**, with no Culqi call and no insert. Probe B3: matching only the expensive line is also rejected. Probe B8: the anchor `productId` is **ignored** whenever the cart is non-empty — it only decides *whether* the check runs.
- The residual, real edge is W-D (an **empty** cart), not the hypothesised first-line anchor.

## 8. Queue-poisoning audit (Once queues)

`tests/unit/paymentApi.test.ts:10` — `mockFetch.mockReset()` in `beforeEach` clears both the call log **and** the `mockResolvedValueOnce` queue, so the two new tests at `:198`/`:222` cannot inherit a stale queued response. `tests/unit/Checkout.test.tsx` uses persistent `vi.fn().mockResolvedValue(...)` re-established per test, never `Once`. `chargeRoute.test.ts` / `createOrderRoute.test.ts` / `webhookPaymentValues.test.ts` add no new `Once` queues. `vitest.config.ts:26-27` (`restoreMocks`/`clearMocks`) prevents cross-file leakage. **No early-return leak found.** The new `chargeRoute.test.ts` block is 86 lines of pure additions (0 deletions) — no existing assertion was weakened.

## 9. Limitations (could not verify)

- **No integration/Postgres layer** — every DB interaction is mocked. The uuid/unique-constraint reasoning from slice 1 still rests on static analysis; nothing in slice 2 touches the DB layer, so the slice-1 limitation is unchanged rather than worsened.
- **The Culqi-side contract** — that Culqi echoes `charge.metadata` back verbatim to the webhook (the link the whole token-flow channel depends on) is asserted by the repo's own mocks and the spec, not by a live API. Design risk 1 (does Culqi emit `charge.paid` for Órdenes sales?) remains open from slice 1.
- **The dual blind review** prescribed by `judgment-day` was not performed (executor contract forbids sub-agents) — see the disclosure at the top.
- **PR3 behaviour** — the webhook recovery path, the CAS and the backstop are slice 3 and were not exercised here; W-A, W-B and W-D are therefore stated as risks to be discharged there, not as defects observed in slice 2.

## 10. Verdict (slice 2)

**PASS WITH WARNINGS**

Slice 2 does exactly what R1 and R6 require, and I could not falsify it. The tree is green independently: **253 files / 2903 tests passed**, **0 lint errors**, **0 type errors**, migrations check OK, and **7/7 mutations are load-bearing** — including the two that matter most (dropping the cart from `validateAmount` → 3 failures; dropping the snapshot persistence → 1 failure). The reported under-charging hypothesis is **false**: the reconciliation covers the whole cart, and the anchor id is dead whenever the cart is non-empty. The working tree was restored **byte-identically** to its starting fingerprint, and nothing was committed or pushed.

Four warnings travel forward. **W-A is the one that must not be lost**: the token flow's durable channel can carry only the bound product's quantity, while the charge route sells the whole cart — PR3 must decide how a multi-line token sale is restored before wiring the recovery path, or multi-line token sales will silently under-fulfil and can decrement a product that was never sold. **W-B** says the order flow should fulfil from the persisted snapshot rather than the transient request cart. **W-C** says the anti-spoofing invariant that T2.6 *claims* must be pinned by an actual test. **W-D** is a pre-existing (not slice-2-introduced) empty-cart hole that now also persists an empty snapshot. **W-E** is the size budget.

**Slice 2 is safe to commit.** W-A and W-B are PR3 constraints, not PR2 blockers.
