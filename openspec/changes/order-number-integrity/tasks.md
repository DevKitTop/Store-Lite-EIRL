# Tasks: Server-generated unique order numbers to eliminate enumeration and fix W-P5 multi-row updates

## Review Workload Forecast

| Field                   | Value                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Estimated changed lines | ~825 (180 + 307 + 207 + 235)                                                                 |
| 400-line budget risk    | High                                                                                         |
| Chained PRs recommended | Yes                                                                                          |
| Suggested split         | PR 1 → PR 2 → PR 3 → PR 4 (4 slices)                                                         |
| Delivery strategy       | ask-on-risk (user chose 4-slice split)                                                       |
| Chain strategy          | flat (each targets `feat/order-integrity-b2`, stacked-to-main pattern as siblings #207–#210) |

**Decision needed before apply: Yes**  
**Chained PRs recommended: Yes**  
**Chain strategy: stacked-to-main**  
**400-line budget risk: High**

### Suggested Work Units

| Unit | Goal                                                                                                             | Likely PR | Notes                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Pure generator contract (`orderNumber.ts` + tests). Zero behaviour change.                                       | PR 1      | Base: `feat/order-integrity-b2`. Independent. Must precede 2 and 3.                                                                               |
| 2    | Write sites + client: `charge`, `create-order`, `useCulqiCallback` + tests. Strip client `metadata.orderNumber`. | PR 2      | Depends on PR 1 (generator). After merge, app writes 12-char values to still-permissive schema. Independent from PR 3 after PR 1.                 |
| 3    | W-P5: `update-ticket`, `ticket/generate` + tests (primary-key scoped updates).                                   | PR 3      | Depends on PR 1. Independent from PR 2. Can run parallel after PR 1.                                                                              |
| 4    | Migration + verification: `0048_*`, `verify-order-number-integrity.sql`, migration test.                         | PR 4      | **MUST be LAST**. Requires PR 2's code to be live before applying migration (ordering hazard). Drops NOT NULL only before revert if rolling back. |

## Phase 1: Slice 1 — Pure generator contract (Est. ~180 LOC)

**Goal**: Add `src/core/payments/orderNumber.ts` and `tests/unit/orderNumber.test.ts`. Zero behaviour change to any running code. This contract must be GREEN before any other slice consumes it.

### Files touched

- [NEW] `src/core/payments/orderNumber.ts`
- [NEW] `tests/unit/orderNumber.test.ts`

### RED → GREEN tasks

- [x] 1.1 **RED** — Write failing tests for `generateOrderNumber()`: returns value matching `^ORD-[A-Za-z0-9_-]{8,20}$`; length ≤ 32; starts with `ORD-`; suffix is 12 hex chars (uppercase); produces distinct values across multiple calls (≥10k distinct in 10k generation test); 48-bit entropy property (frozen `Date.now()` produces ≥2 distinct values in 100 calls); collision resistance across 2 calls in same millisecond produces different values.
- [x] 1.2 **RED** — Write failing tests for `ORDER_NUMBER_PATTERN` constant export and `sanitizeTicketFileName(orderNumber)`: returns filename-safe form; round-trip injective (value → sanitized → value unchanged); does not collapse distinct values.
- [x] 1.3 **RED** — Write failing tests asserting legacy compatibility: 83 existing-style values (from spec reality) satisfy the pattern; structural disjointness constraint holds (format allows 8–20 suffix chars).
- [x] 1.4 **GREEN** — Implement `src/core/payments/orderNumber.ts` exporting `generateOrderNumber()`, `ORDER_NUMBER_PATTERN = /^ORD-[A-Za-z0-9_-]{8,20}$/`, and `sanitizeTicketFileName()`. Use `crypto.getRandomBytes(6)` to produce 12 uppercase hex chars. No `%` reduction. No wall-clock derivation.
- [x] 1.5 **GREEN** — Make all Slice 1 tests pass. Verify no other files modified. Confirm zero behaviour change to app code paths.

### Verification gate (Slice 1)

```bash
pnpm test:unit tests/unit/orderNumber.test.ts
```

All tests must pass. No other test files affected.

### Rollback

Revert the two new files (`orderNumber.ts`, `orderNumber.test.ts`).

### Commit message (Conventional)

```
feat(payments): add server order number generator contract (slice 1)

- Introduce generateOrderNumber() with 12-char uppercase hex suffix (48-bit entropy)
- Export ORDER_NUMBER_PATTERN (^ORD-[A-Za-z0-9_-]{8,20}$) and sanitizeTicketFileName()
- Add unit tests for format, entropy, distinctness, and sanitizer round-trip
- Pure contract addition; zero behaviour change
```

---

## Phase 2: Slice 2 — Write sites + client (Est. ~307 LOC)

**Goal**: Wire generator into `charge/route.ts`, `create-order/route.ts`, `useCulqiCallback.ts`. Strip client-supplied `metadata.orderNumber` so server is authoritative. Depends on Slice 1. Independent from Slice 3 after PR 1.

### Files touched

- [MOD] `app/api/payment/charge/route.ts`
- [MOD] `app/api/payment/create-order/route.ts`
- [MOD] `src/features/payment/hooks/useCulqiCallback.ts`
- [MOD] `tests/unit/chargeRoute.test.ts`
- [MOD] `tests/unit/createOrderRoute.test.ts`
- [MOD] `tests/unit/useCulqiCallback.test.ts`

### RED → GREEN tasks

- [ ] 2.1 **RED** — `chargeRoute.test.ts`: add test `P4-1 client value ignored + metadata key absent` — request has `metadata.orderNumber: "ORD-ATTACKER0000"`, assert stored `order_number` differs and `metadata` has no `orderNumber` key.
- [ ] 2.2 **RED** — `chargeRoute.test.ts`: add test `P4-3 unique constraint retried` — simulate `23505` on insert; assert transaction retried (bounded) and response still 200 with server-generated `order_number`.
- [ ] 2.3 **RED** — `chargeRoute.test.ts`: add test `P4-7 generation failure never persists null` — generator throws; assert no row inserted, response 500, idempotency key completed with failure.
- [ ] 2.4 **RED** — `chargeRoute.test.ts`: add test `P4-4 replay returns stored value` — idempotent replay returns existing `order_number` with no re-insert.
- [ ] 2.5 **RED** — `createOrderRoute.test.ts`: assert Culqi label matches pattern, zero `payments` inserts (P4-8).
- [ ] 2.6 **RED** — `useCulqiCallback.test.ts`: assert no `metadata.orderNumber` sent; `onOrderPaid` receives `paymentResult.payment.orderNumber`; analytics/navigation use server value.
- [ ] 2.7 **GREEN** — `charge/route.ts`: import `generateOrderNumber()` from `@/core/payments/orderNumber`. Strip `metadata.orderNumber` from request (ignore client value). Generate `orderNumber` inside charge write path before insert. Wrap transaction in bounded retry (max 3 attempts) that re-runs callback (regenerating new value) on unique violation (23505); do not retry non-unique errors. Ensure generator failure rolls back and returns 500 without persisting row.
- [ ] 2.8 **GREEN** — `create-order/route.ts`: replace local generator with `generateOrderNumber()`; rename to `culqiOrderLabel`; do not write to `payments`. Keep Culqi `order_number` field as label only.
- [ ] 2.9 **GREEN** — `useCulqiCallback.ts`: remove any client-side order number generation; do not include `orderNumber` in metadata sent to charge; read `paymentResult.payment.orderNumber` from server response and pass to `onOrderPaid`, analytics, and navigation. No API shape change.
- [ ] 2.10 **GREEN** — Make all Slice 2 tests pass. Verify existing tests not broken by the new contract.

### Verification gate (Slice 2)

```bash
pnpm test:unit tests/unit/chargeRoute.test.ts tests/unit/createOrderRoute.test.ts tests/unit/useCulqiCallback.test.ts
```

### Rollback

Revert changes to the 3 source files and 3 test files. Client reverts to previous generation (if any) — but migration (Slice 4) not yet applied, so `NOT NULL` constraint absent; rollback is safe.

### Commit message (Conventional)

```
feat(payments): wire server-generated order numbers to write sites (slice 2)

- charge: generate orderNumber at insert, strip client metadata.orderNumber, retry on unique conflict
- create-order: use shared generator as Culqi label only (no payments writes)
- useCulqiCallback: drop client generation, consume server payment.orderNumber
- Add unit tests covering ignored client value, retry, and generator failure handling
```

---

## Phase 3: Slice 3 — W-P5 primary-key scoped updates (Est. ~207 LOC)

**Goal**: Fix blind multi-row UPDATE keyed by `orderNumber`. Both `update-ticket` and `ticket/generate` must resolve `orderNumber` → single row (with ownership check), then UPDATE by `payments.id`. Independent from Slice 2 after PR 1.

### Files touched

- [MOD] `app/api/payment/update-ticket/route.ts`
- [MOD] `app/api/ticket/generate/route.ts`
- [MOD] `tests/unit/updateTicketRoute.test.ts` (NEW)
- [MOD] `tests/unit/ticketGenerateRoute.test.ts`

### RED → GREEN tasks

- [ ] 3.1 **RED** — `tests/unit/updateTicketRoute.test.ts`: test `P5-1 UPDATE keyed by id not orderNumber` — mock DB; assert the UPDATE call uses `eq('id', <paymentId>)` (not `eq('orderNumber', ...)`). Given 0 matching owned row, returns 404 and UPDATE never called.
- [ ] 3.2 **RED** — `tests/unit/updateTicketRoute.test.ts`: test ownership enforced on resolved row (cross-tenant scenario) — resolves to business A's row but request from business B → 404; only 1 row affected semantics.
- [ ] 3.3 **RED** — `tests/unit/ticketGenerateRoute.test.ts`: assert same PK assertion; filename is exactly `${orderNumber}.png` using shared sanitizer (no substitution/collision). QR URL remains `/[slug]/order/verify/[orderNumber]`.
- [ ] 3.4 **RED** — `tests/unit/ticketGenerateRoute.test.ts`: test `P5-2 existing ticket_url short-circuit` — with `ticket_url` present and no `forceRegenerate`, returns existing `publicUrl` without upload/update of `order_number`; with `forceRegenerate`, still updates by `id` and QR unchanged.
- [ ] 3.5 **GREEN** — `app/api/payment/update-ticket/route.ts`: select payment by `orderNumber` (exact match), enforce ownership/businessId check on that resolved row. If not found/owned → 404. Perform UPDATE by `payments.id` only (primary key). Never UPDATE `order_number`. Affect-exactly-1 semantics (DB unique guarantees).
- [ ] 3.6 **GREEN** — `app/api/ticket/generate/route.ts`: same pattern — resolve to single row by `orderNumber` with ownership/trackingToken validation as appropriate; all writes (ticket_url, metadata, etc.) use `eq('id', payment.id)`. Use shared `sanitizeTicketFileName()` for storage filename; ensure `order_number` is never modified. Preserve existing behavior for reprint flow.
- [ ] 3.7 **GREEN** — Make all Slice 3 tests pass. No regression in verify route assumptions (path segment unchanged).

### Verification gate (Slice 3)

```bash
pnpm test:unit tests/unit/updateTicketRoute.test.ts tests/unit/ticketGenerateRoute.test.ts
```

### Rollback

Revert changes to the 2 source files and 2 test files. Previous multi-row-by-orderNumber behavior restored (still permissive DB).

### Commit message (Conventional)

```
fix(payments): scope ticket updates to primary key (W-P5) (slice 3)

- update-ticket: resolve by orderNumber with ownership check, UPDATE by payments.id only
- ticket/generate: resolve by orderNumber, UPDATE by payments.id; use shared filename sanitizer
- Prevent multi-row updates keyed by non-unique client-controlled value
- Add unit tests asserting PK-scoped updates and reprint short-circuit
```

---

## Phase 4: Slice 4 — Migration + verification (Est. ~235 LOC)

**Goal**: Add `0048_payments_order_number_integrity.sql`, `scripts/verify-order-number-integrity.sql`, and migration test. **MUST be LAST**. Encoding critical ordering hazard: do not apply migration before Slice 2 code is live; and before reverting code while `NOT NULL` stands, drop `NOT NULL` first.

### Files touched

- [NEW] `migrations/0048_payments_order_number_integrity.sql`
- [NEW] `scripts/verify-order-number-integrity.sql`
- [NEW] `tests/unit/orderNumberMigration.test.ts`

### RED → GREEN tasks

- [ ] 4.1 **RED** — `tests/unit/orderNumberMigration.test.ts`: assert migration is exactly one segment with `BEGIN` and `COMMIT`; no `--` line inside dollar-quoted body; ordering is backfill < format scan < duplicate scan < SET NOT NULL < CREATE UNIQUE INDEX < trigger function+CREATE TRIGGER < post-conditions; uses `pg_advisory_xact_lock(4800048)`.
- [ ] 4.2 **GREEN** — `migrations/0048_payments_order_number_integrity.sql`: implement with phases 0–7 as specified. Backfill only `WHERE order_number IS NULL` using `gen_random_uuid()` (no pgcrypto). Format scan `!~ '^ORD-[A-Za-z0-9_-]{8,20}$'` fails closed. Duplicate scan lists offending values and fails closed. Trigger `BEFORE UPDATE OF order_number` raises `restrict_violation`. Post-conditions verify notnull, unique index exists, trigger exists. All DDL uses `IF NOT EXISTS` where appropriate. Transaction wrapped in single `BEGIN; ... COMMIT;`. Idempotent (re-run affects 0 rows).
- [ ] 4.3 **GREEN** — `scripts/verify-order-number-integrity.sql`: read-only checks (post-apply proof). Count NULL = 0; all match pattern; duplicate count 0; NOT NULL true; unique index present; trigger present. Returns pass/fail markers. Designed for operator to run independently (success message of apply script is untrustworthy per design).
- [ ] 4.4 **GREEN** — Make migration test pass.

### CRITICAL ordering hazard (must be encoded/documented)

**If migration (0048) is applied BEFORE Slice 2's code is live in production:** every insert arriving without a server-generated `orderNumber` violates the new `NOT NULL` constraint and breaks checkout. The migration merging does NOT apply it (`migrations/README.md`: merging a PR does not apply migrations; an operator runs `scripts/apply-migration.mjs` or Supabase SQL editor manually). This task list enforces PR 4 is LAST.

**Reverse coupling (rollback):** reverting Slice 2 code while `NOT NULL` still stands breaks every insert (code would attempt to write null). Therefore, during rollback: **DROP NOT NULL must precede any code revert** of write sites. The rollback instructions above reflect this dependency.

**Untrustworthy success message:** `scripts/apply-migration.mjs` prints `✅ Migration completed successfully` even after errors. The migration is atomic (single transaction) so failed statements abort commit; however, operators MUST run `scripts/verify-order-number-integrity.sql` as independent read-only verification after apply. This is captured in verification gate below.

### Verification gate (Slice 4)

```bash
pnpm test:unit tests/unit/orderNumberMigration.test.ts
```

Read-only verification (operator post-apply):

```bash
node scripts/apply-migration.mjs --dry-run 2>/dev/null || true
psql "$DATABASE_URL" -f scripts/verify-order-number-integrity.sql
```

All checks must return PASS (0 NULL, 0 duplicates, pattern OK, constraints/triggers present).

### Rollback

```sql
DROP TRIGGER IF EXISTS payments_order_number_immutable ON public.payments;
DROP INDEX IF EXISTS public.payments_order_number_unique;
ALTER TABLE public.payments ALTER COLUMN order_number DROP NOT NULL;
```

**Note:** Drop `NOT NULL` BEFORE reverting Slice 2 code. The 6 backfilled values remain (NULL not restored) — this is correct (NULL was the defect).

### Commit message (Conventional)

```
feat(payments): enforce order_number NOT NULL + UNIQUE with immutable trigger (slice 4)

- Add migration 0048 to backfill only NULL rows, enforce constraints, add immutable UPDATE trigger
- Add read-only verification script (independent of apply-migration success message)
- Add migration structure test ensuring atomic single-segment transaction
- Backfill scope: exactly NULL rows only; 83 existing and 2 ticket_url rows untouched
- Idempotent and safe for empty prod (0 rows)
```

---

## Global constraints & non-goals

- Do NOT modify `.gitignore`, do NOT stage, do NOT run DB writes, do NOT implement anything (this is planning only).
- Explicit non-goals: verify-page gate (#209), `payments.status` (W-P6), WhatsApp/YCloud (W-W1..W-W4), Redis/Upstash (W-I1), migration journal repair (idx 24), renumbering existing values, renumbering the 2 printed-ticket rows.
- Verified facts preserved: DEV 89 (6 NULL, 83 valid, 2 with ticket_url), PROD 0. No renumbering of printed-ticket rows.
- Both W-P5 sites must use primary-key UPDATE (update-ticket and ticket/generate).
- Ticket filename sanitizer must preserve injectivity; QR path unchanged.
- Client ignores supplied `orderNumber`; server authoritative. Strip key from metadata jsonb.

## Risks

| Risk                                                | Mitigation                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Migration applied before Slice 2 code               | Enforce PR 4 LAST; document in ordering hazard.                                           |
| Revert with `NOT NULL` still set                    | Drop `NOT NULL` before code revert (documented).                                          |
| `apply-migration.mjs` success message untrustworthy | Require independent verification via `scripts/verify-order-number-integrity.sql`.         |
| UNIQUE conflict under concurrency                   | Bounded retry in charge route re-runs callback (regenerates).                             |
| Printed tickets (2 rows) mutated                    | Backfill filters `WHERE order_number IS NULL` only; no touch of non-NULL/ticket_url rows. |
| 83 legacy values could conflict with new format     | 12-char suffix ensures structural disjointness; migration format scan validates.          |

## Next recommended

Run `pnpm test:unit` for Slice 1 first (RED→GREEN), merge PR 1; then PR 2, PR 3 in either order after PR 1 (independent); then PR 4 LAST with operator verification.
