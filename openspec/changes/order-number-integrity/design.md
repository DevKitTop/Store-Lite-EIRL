# Design: Server-generated immutable order numbers (W-P4 root fix + W-P5)

Server generates `payments.order_number` at the single insert site, the DB enforces `NOT NULL`/`UNIQUE`/immutability, and both blind-UPDATE sites become primary-key scoped. PROD is empty, so this is forward-looking prevention, not a data repair.

## Decisions at a glance

| #   | Decision       | Choice                                                                                   |
| --- | -------------- | ---------------------------------------------------------------------------------------- |
| D1  | Generator      | `ORD-` + **12 uppercase hex** chars from `crypto.getRandomBytes(6)` — 48 bits, zero bias |
| D2  | Immutability   | Postgres `BEFORE UPDATE OF order_number` trigger (only primitive that binds)             |
| D3  | Migration      | `0048_*`, one `BEGIN…COMMIT` segment, no `CONCURRENTLY`, fail-closed guards              |
| D4  | `create-order` | Reuse the shared generator for the **Culqi label only**; never touches `payments`        |
| D5  | Tests          | Pure-JS generator + mocked-`db` route tests + one static migration-SQL test              |
| D6  | Rollout        | Code first (no constraints), then manual migration on dev → prod                         |

---

## D1 — Generator

**Choice.** `src/core/payments/orderNumber.ts` exports `generateOrderNumber()`, `ORDER_NUMBER_PATTERN = /^ORD-[A-Za-z0-9_-]{8,20}$/`, and `sanitizeTicketFileName()`.

```
value  = 'ORD-' + Buffer.from(randomBytes(6)).toString('hex').toUpperCase()
length = 16 chars   (12-char suffix)
entropy= 48 bits, perfectly uniform
```

| Property                            | Value                                                              |
| ----------------------------------- | ------------------------------------------------------------------ |
| Character set                       | `0-9 A-F` ⊂ `[A-Za-z0-9]` ⊂ `[A-Za-z0-9_-]` — sanitizer is a no-op |
| Matches `^ORD-[A-Za-z0-9_-]{8,20}$` | Yes, 8 chars of headroom; 16 ≤ 32                                  |
| 5-minute candidate space (P4-2)     | 2^48 = **2.8 × 10^14** ≫ 10^9                                      |
| Space                               | 16^12 = 2.81 × 10^14                                               |
| Birthday 50% / 1%                   | **1.98 × 10^7** / 1.4 × 10^6 orders                                |
| At 10k orders/month                 | 50% at ~1,975 years                                                |

**The "6 chars vs 6 bytes" trap.** `6` base-36 chars = 6 × log2(36) = **31.0 bits** — _below_ the P4-2 floor of 32. `6` hex chars = 3 bytes = **24 bits**, worse. Bytes ≠ characters: 6 bytes are **12 hex nibbles** = 48 bits. Picking hex is what makes the bias question disappear — one byte maps to exactly two nibbles, so there is **no `%` reduction and no rejection loop**.

**Why 12 and not the legacy 8.** Legacy `ORD-` + 8 base-36 = 41.4 nominal bits → 50% collision at **~2.0 × 10^6** orders (~16 years at 10k/month). Worse: an 8-char suffix could _collide with the 83 existing values_. A 12-char suffix makes cross-generation collision **structurally impossible** — the two sets are disjoint under the anchored pattern. Length difference is the decisive argument, not just entropy.

**Reuse, not clone.** Same alphabet/case spirit as `src/core/utils/trackingToken.ts`, but **not** its `b % 30` reduction (biased: 26 residues get 9 hits, 4 get 8).

---

## D2 — Immutability (P4-4)

**Choice.** `BEFORE UPDATE OF order_number` trigger raising `ERRCODE 'restrict_violation'`.

```sql
IF NEW.order_number IS DISTINCT FROM OLD.order_number THEN
  RAISE EXCEPTION 'payments.order_number is immutable (row %)', OLD.id
    USING ERRCODE = 'restrict_violation';
END IF;
RETURN NEW;
```

| Alternative                   | Why rejected                                                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REVOKE UPDATE` on the column | The app connects as a privileged/owner role. A column-level grant is only honored when the grantee has **no** table-level `UPDATE` — not our case, so it does not bind. |
| RLS policy                    | RLS is row-level; `WITH CHECK` sees the new row but never `OLD`, so "this column must not change" is inexpressible.                                                     |
| App-layer guard only          | Not a constraint. The trigger still fires for the app, so the guard is redundant for enforcement — keep it only as a code-level invariant a unit test can assert.       |

`UPDATE OF order_number` fires only when the column is in the `SET` list; an idempotent replay re-setting the same value passes `IS DISTINCT FROM` and is unaffected.

---

## D3 — Migration `0048_payments_order_number_integrity.sql`

**One segment, `BEGIN;` … `COMMIT;`.** Precedent: `0046_*` already sends 4 statements in a single segment, so `postgres.js` simple-query multi-statement works in this runner.

Order is load-bearing — the trigger must come **last** or it would reject its own backfill:

| Phase | Action                                                                                                                                            | Guard                                                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | `pg_advisory_xact_lock(4800048)`                                                                                                                  | prevents two operators racing                                                                                                             |
| 1     | Backfill: `UPDATE … SET order_number = 'ORD-'‖upper(substring(replace(gen_random_uuid()::text,'-','') FROM 1 FOR 12)) WHERE order_number IS NULL` | `gen_random_uuid()` is PG13 core and already the repo's PK default — no `pgcrypto`                                                        |
| 2     | Format scan `!~ '^ORD-[A-Za-z0-9_-]{8,20}$'`                                                                                                      | `RAISE EXCEPTION` → aborts                                                                                                                |
| 3     | Duplicate scan `GROUP BY 1 HAVING count(*)>1`                                                                                                     | `RAISE EXCEPTION` **listing the values**; operator resolves by hand, re-runs. Never auto-resolve — renumbering breaks printed tickets/QRs |
| 4     | `ALTER COLUMN order_number SET NOT NULL`                                                                                                          | only `IF attnotnull` is false                                                                                                             |
| 5     | `CREATE UNIQUE INDEX IF NOT EXISTS payments_order_number_unique`                                                                                  |                                                                                                                                           |
| 6     | Trigger function + `CREATE TRIGGER`                                                                                                               | **after** the backfill                                                                                                                    |
| 7     | Post-conditions: re-assert index, notnull, trigger exist                                                                                          | self-verifies atomically                                                                                                                  |

**Fail-closed under `apply-migration.mjs`.** The runner logs `❌` and _continues_, then prints `✅ Migration completed successfully` regardless. The explicit transaction is the fix: any error leaves nothing committed, so "continue" has nothing to continue. Because that success line is untrustworthy, phase 7 self-verifies and a read-only `scripts/verify-order-number-integrity.sql` gives the operator an independent check.

**No `CONCURRENTLY`.** It cannot run inside a transaction and the PROD `DATABASE_URL` pooler (6543, transaction mode) has no stable session. 89 dev rows / 0 prod rows build in under a millisecond; a blocking `CREATE INDEX` holds `SHARE` only. _Operational note:_ if `payments` ever grows past ~10^6 rows, drop the index and rebuild with `CREATE UNIQUE INDEX CONCURRENTLY` run manually over `DIRECT_URL` (5432), outside this migration. `DIRECT_URL` does not exist in the repo today — verified zero references — so that would be a separate prerequisite.

**Idempotency (MIG-2).** Every DDL step is `IF NOT EXISTS` / existence-checked; the backfill's `WHERE … IS NULL` matches 0 rows on re-run. PROD: 0 rows, backfills 0, constraints installed.

**Never renumbers.** The 83 and the 2 `ticket_url` rows are excluded structurally — `order_number IS NULL` is false for all 85.

---

## D4 — `create-order/route.ts:159`

**Choice.** Replace `ORD-${crypto.randomUUID().slice(0,8)}` with `generateOrderNumber()`, rename the local to `culqiOrderLabel`, and document it as a Culqi-side display label only.

- The `payment-orders` spec R2 mandates Culqi's `order_number` field, so the field stays — it is now **not** an independent generator.
- `create-order` already never writes `payments`; this change makes that structural rather than incidental. Add a test that asserts zero `payments` inserts.
- Its value lands in `payment_orders.metadata.culqiRaw.orderNumber` — namespaced, so no `payments.order_number` conflict (P4-8).
- 16 chars vs Culqi's previous 12: no length regression.

---

## D5 — Test strategy (strict TDD, `pnpm test:unit`)

**How the repo tests the DB today: it does not.** `vitest.config.ts` is jsdom + no DB; `chargeRoute.test.ts` mocks `@/core/database/client` wholesale and even builds a `PgDialect` to inspect SQL. So `NOT NULL`/`UNIQUE` cannot be proven by `pnpm test:unit` — the established pattern is followed, plus one static migration test and one operator SQL script.

| File                                      | Action | Covers                                                                                                                                                                                                                              |
| ----------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/orderNumber.test.ts`          | new    | Format, length ≤32, charset, 48-bit entropy, 10k distinct, sanitizer round-trip **injectivity**, 83-legacy values pass the same pattern, structural disjointness from the 8-char shape                                              |
| `tests/unit/orderNumberMigration.test.ts` | new    | Replicates the runner's split/strip: exactly 1 segment, exactly one `BEGIN`/`COMMIT`, **no `--` line inside the dollar-quoted body** (the runner would strip it), and index-position ordering backfill < NOT NULL < index < trigger |
| `tests/unit/chargeRoute.test.ts`          | modify | P4-1 client value ignored + `metadata` key absent; P4-3 `23505` retried, still 200; P4-7 generator throws → no row, 500, key completed; P4-4 replay returns the stored value with no re-insert                                      |
| `tests/unit/createOrderRoute.test.ts`     | modify | Culqi label matches the pattern; zero `payments` inserts                                                                                                                                                                            |
| `tests/unit/updateTicketRoute.test.ts`    | new    | P5-1: `eq()` spy proves the UPDATE is keyed on `payments.id`, not `orderNumber`; 0 rows → 404 and UPDATE never called                                                                                                               |
| `tests/unit/ticketGenerateRoute.test.ts`  | modify | Same PK assertion at the second site; filename is exactly `${orderNumber}.png`; QR URL unchanged; existing-`ticketUrl` short-circuit still returns without upload (P5-2)                                                            |
| `tests/unit/useCulqiCallback.test.ts`     | modify | No `metadata.orderNumber` sent; `onOrderPaid` and `order_created.orderId` use `paymentResult.payment.orderNumber`                                                                                                                   |

**RED → GREEN order:** `orderNumber` → `orderNumberMigration` → `chargeRoute` → `createOrderRoute` → `updateTicketRoute` → `ticketGenerateRoute` → `useCulqiCallback`. The generator contract must be green before any route consumes it.

**Retry must wrap the transaction, not the insert.** A unique violation aborts the transaction, so an inner retry is impossible: wrap `db.transaction(...)` in a bounded 3-attempt helper that re-runs the callback (which regenerates). `notifyNewOrder`, SMS, stock checks and analytics all sit _outside_ the transaction and run only on success, so they cannot double-fire.

**`lookupOrderSchema` is deliberately unchanged** (`min(1)`), so N1-1 holds for all 89 values without widening scope.

---

## D6 — Rollout and rollback

`.github/workflows/ci.yml` contains no migration step (verified) — **merging never applies the migration**.

1. Merge PR1 (generator). No route behaviour changes. No DB.
2. Merge PR2 (write sites + client). App now writes 12-char values into a still-permissive table — the same risk profile as today.
3. Run the read-only pre-flight on dev (duplicate + format scan); require 0 findings.
4. Merge PR3 (W-P5) — removes the confused-deputy independent of the DB.
5. Merge PR4 (migration + verification). Then **operator**: apply `0048_*` to dev → run `verify-order-number-integrity.sql` → confirm 6 backfilled / 83 unchanged / index + trigger present → apply to prod (0 rows).

**Rollback** (manual SQL, in reverse):

```sql
DROP TRIGGER IF EXISTS payments_order_number_immutable ON public.payments;
DROP INDEX IF EXISTS public.payments_order_number_unique;
ALTER TABLE public.payments ALTER COLUMN order_number DROP NOT NULL;
```

The 6 backfilled values are **not** restored — their pre-migration state was `NULL`, which is exactly the W-N1 defect.

**One real coupling:** reverting the code while `NOT NULL` stands breaks inserts (code would write `null`). Drop `NOT NULL` _before_ any code revert.

---

## File changes

| File                                                  | Action | Description                                                     |
| ----------------------------------------------------- | ------ | --------------------------------------------------------------- |
| `src/core/payments/orderNumber.ts`                    | Create | Generator, `ORDER_NUMBER_PATTERN`, `sanitizeTicketFileName`     |
| `migrations/0048_payments_order_number_integrity.sql` | Create | Backfill → guards → NOT NULL → index → trigger                  |
| `scripts/verify-order-number-integrity.sql`           | Create | Read-only post-apply proof                                      |
| `app/api/payment/charge/route.ts`                     | Modify | Generate at insert, strip `metadata.orderNumber`, retry wrapper |
| `app/api/payment/create-order/route.ts`               | Modify | Reuse generator as Culqi label                                  |
| `app/api/payment/update-ticket/route.ts`              | Modify | UPDATE by `payments.id`                                         |
| `app/api/ticket/generate/route.ts`                    | Modify | UPDATE by `payments.id`; shared sanitizer                       |
| `src/features/payment/hooks/useCulqiCallback.ts`      | Modify | Drop local generators; read server value                        |

**Data flow — after**

```
client ──metadata (no orderNumber)──▶ charge
                                     ├─ generateOrderNumber() ──▶ INSERT payments (server value)
                                     └─ response.payment.orderNumber ──▶ client ──▶ onOrderPaid
                                                                        ├─ verify link / QR
                                                                        └─ POST /api/ticket/generate
                                                                              ├─ SELECT … WHERE order_number=?  → id
                                                                              ├─ ownership on THAT row
                                                                              └─ UPDATE … WHERE id = ?
```

---

## Review budget — split required

Realistic total ≈ **825 changed lines** vs a 400-line budget. **Do not ship as one PR.** Four autonomous slices, each green on its own:

| PR  | Scope                                                                           | Est. |
| --- | ------------------------------------------------------------------------------- | ---- |
| 1   | `orderNumber.ts` + `orderNumber.test.ts` — pure contract, zero behaviour change | ~180 |
| 2   | `charge`, `create-order`, `useCulqiCallback` + their tests                      | ~307 |
| 3   | `update-ticket`, `ticket/generate` + their tests (W-P5)                         | ~207 |
| 4   | `0048_*`, verify SQL, migration test                                            | ~235 |

Each slice has a clear start/finish, its own verification, and its own rollback. PR1 must precede PR2 (the generator contract is consumed); PR4 must follow all others.

---

## Open questions

- [ ] Should `.env.example` gain a `DIRECT_URL` entry? Recommended, but it is docs-only and deferred — nothing in this change needs it.
- [ ] `order_number` stays `text` with no length cap; the format is enforced by validator + trigger, not by the column. Adding a `varchar(32)` is out of scope.
