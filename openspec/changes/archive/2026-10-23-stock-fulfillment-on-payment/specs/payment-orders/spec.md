# Delta for payment-orders

**Change**: `stock-fulfillment-on-payment` (NEW-8). This delta MODIFIES **R2** and **R5**, and
carries one non-requirement correction (the stale R8–R14 state note). No requirement is removed and
no new requirement number is consumed. R1, R3, R4, R6–R14 are untouched and remain the published
contract this change respects.

## Numbering continuity

| Capability | Published numbers | REMOVED numbers | First free | This delta |
|---|---|---|---|---|
| `payment-orders` | **R1–R14** (R1–R7 from `culqi-ordenes-pago`; R8–R14 from `order-integrity`, now in `develop`) | none | — | **MODIFIED: R2, R5** (no additions) |

## MODIFIED Requirements

### Requirement: R2: POST /api/payment/create-order

The endpoint MUST accept a Zod-validated body, call `POST https://api.culqi.com/v2/orders`, persist
the response, and return payment instructions.

Input: `{ amount (number, céntimos), currency (default PEN), email (email), phone (optional),
businessId (UUID), productId (optional UUID), customerName (optional), description (optional),
cartItems (optional — array of { id (UUID), quantity (integer ≥ 1) }, the same `{ id, quantity }[]`
shape used by `chargeRequestSchema`'s `metadata.cartItems` and consumed by `validateAmount`) }`.

The Culqi order body MUST include: `amount`, `currency_code`, `description`, `order_number`
(generated), `client_details`, `expiration_date` (now + 3 days), `confirm: false`. When
`customerName` is present, `client_details` SHALL include `first_name` and `last_name` derived via
`splitFullName(customerName)`; when absent, `client_details` SHALL NOT include name keys. The Culqi
order body MUST be byte-equivalent whether or not `cartItems` is present — the snapshot is a
server-side persistence concern and MUST NOT leak into the Culqi request.

(Previously: the input schema (`createOrderRequestSchema`) had no `cartItems`; the amount
reconciliation ran `validateAmount` without cart context (single `productId` line only); and
`payment_orders.metadata` was persisted as `{ culqiRaw }` alone — no fulfillment snapshot existed.)

Snapshot persistence:

- When `cartItems` is present, `create-order` MUST persist it in `payment_orders.metadata` under
  the dedicated `cartItems` key, alongside the existing `culqiRaw`, at the row insert — i.e.
  before any writer can observe a `pending → paid` transition (`stock-fulfillment` R1).
- The snapshot MUST NOT be written into, aliased to, or read from `metadata.productId`.
  `readOrderProductBinding` and R13's three-state binding semantics (`'absent' | { id } |
  'invalid'`) MUST behave exactly as published: the new key is additional metadata under its own
  name and is invisible to the R13 gate. A snapshot MUST NOT be able to satisfy, bypass, invalidate
  or reshape the product binding check.
- When `cartItems` is absent, behavior is identical to today (the order is created; a later paid
  transition falls back to the `stock-fulfillment` R3 B1 rule if the row is product-bound, or has
  no stock effect if it is product-less).
- The amount check MUST consume the snapshot: when `cartItems` is present it MUST be passed to
  `validateAmount` so the DB-derived `price × quantity` reconciliation covers every line, not just
  `productId`. A snapshot the reconciliation does not cover MUST be rejected with the existing 400
  validation contract before the Culqi call (`stock-fulfillment` R6).

#### Scenario: Successful order — PagoEfectivo returns CIP

- GIVEN valid input including `amount: 5000`, `email: buyer@test.com`
- WHEN `POST /api/payment/create-order` is called
- THEN it MUST return `{ success: true, culqiOrderId, paymentCode, qrUrl, expirationDate }`
- AND `payment_orders` MUST have a row with `status: pending`, `paymentMethod` matching the Culqi response

#### Scenario: Successful order includes buyer name

- GIVEN valid input including `customerName: "Juan Perez"`
- WHEN `POST /api/payment/create-order` is called
- THEN `client_details` MUST include `first_name: "Juan"` and `last_name: "Perez"`

#### Scenario: Order without buyer name omits name keys

- GIVEN valid input without `customerName`
- WHEN `POST /api/payment/create-order` is called
- THEN `client_details` MUST NOT include `first_name` or `last_name`

#### Scenario: Invalid input rejected

- GIVEN a request with missing `businessId` or invalid `email`
- WHEN `POST /api/payment/create-order` is called
- THEN it MUST return HTTP 400 with a Zod validation error

#### Scenario: Culqi API failure

- GIVEN a valid request but Culqi returns a non-2xx response
- WHEN `POST /api/payment/create-order` is called
- THEN it MUST return the Culqi error details
- AND MUST NOT persist any `payment_orders` row

#### Scenario: The cart snapshot is persisted alongside culqiRaw

- GIVEN valid input including `cartItems: [{ id: <uuid>, quantity: 2 }]`
- WHEN the order is persisted
- THEN `payment_orders.metadata.cartItems` MUST equal the validated snapshot in the
  `{ id, quantity }[]` shape
- AND `payment_orders.metadata.culqiRaw` MUST be unchanged
- AND the Culqi order body MUST be identical to one sent without `cartItems`

#### Scenario: A snapshot whose quantities do not reconcile with the amount is rejected

- GIVEN valid input whose `cartItems`, priced from the DB via `validateAmount`, produce a total
  that differs from `amount`
- WHEN `POST /api/payment/create-order` validates the request
- THEN it MUST return HTTP 400
- AND no Culqi order call MUST be made and no `payment_orders` row MUST be persisted

#### Scenario: The snapshot never disturbs the R13 product binding

- GIVEN a request with `productId: A` and a `cartItems` snapshot
- WHEN the R13 gate later evaluates the persisted row via `readOrderProductBinding`
- THEN the binding read MUST consider only `metadata.productId`
- AND the presence or shape of `metadata.cartItems` MUST NOT change the binding's three-state
  outcome (`'absent'`, `{ id }`, or `'invalid'`)

### Requirement: R5: Webhook — order.status.changed

The Culqi webhook MUST handle `order.status.changed` events and update
`payment_orders.status`. When the transition records `paid`, the flip MUST be performed together
with stock fulfillment, atomically:

- On an event mapped to `paid`, the webhook MUST flip the order and fulfill stock via the single
  shared fulfillment helper (`stock-fulfillment` R2) **in the same database transaction**: the
  business-scoped, `.returning()`-asserted flip (R10 discipline) yields the order row's `id` and
  `businessId`, which key the helper's CAS claim (`sourceType: 'payment_orders'`) and
  business-scoped decrement. A flip that affects 0 rows MUST abort before any fulfillment write.
- The helper's exactly-once CAS governs duplicates: a replayed `paid` event finds the claim taken
  and performs no second decrement; the payment/order outcome is unaffected either way.
- Events mapped to `expired` or `cancelled` MUST NOT touch stock.
- Fulfillment MUST NOT create `payments` rows and MUST NOT emit notifications: this path flips the
  order and moves stock only. The W-P3.1 webhook upsert remains the only webhook writer of
  `payments`.
- The unknown-id scenario is unchanged (see below).

(Previously: the handler updated `payment_orders.status` only — a `pending → paid` flip recorded
money truth with no inventory movement, which is one of the NEW-8 drift paths.)

#### Scenario: Order paid via webhook

- GIVEN a `payment_orders` row with status `pending`
- WHEN a webhook event `order.status.changed` arrives with status `paid`
- THEN the row MUST update to status `paid` and `updatedAt` refreshed
- AND, in the same transaction, exactly one `stock_movements` claim
  (`sourceType: 'payment_orders'`) and one decrement MUST be committed for that order — from the
  cart snapshot when recoverable, under the B1 `qty = 1` rule when product-bound without a
  snapshot, and with no stock effect when the order is product-less
  (`stock-fulfillment` R1/R3)

#### Scenario: A replayed paid event does not double-decrement

- GIVEN an order already flipped to `paid` with its fulfillment claim recorded
- WHEN the same `paid` event arrives again
- THEN the flip is a no-op re-write at most and the fulfillment CAS observes 0 claim rows
- AND no second stock decrement occurs and the webhook still acknowledges the event

#### Scenario: Order expired via webhook

- GIVEN a `payment_orders` row with status `pending`
- WHEN a webhook event `order.status.changed` arrives with status `expired`
- THEN the row MUST update to status `expired`
- AND no stock movement MUST be claimed or applied

#### Scenario: Unknown Culqi order ID in webhook

- GIVEN a webhook event references a `culqiOrderId` not in `payment_orders`
- WHEN the webhook processes it
- THEN it MUST log a warning and return `{ received: true }` without error

#### Scenario: The flip never outlives fulfillment

- GIVEN a `paid` event whose flip affects 0 rows (unknown or foreign order)
- WHEN the transaction evaluates the flip assertion
- THEN the transaction MUST abort with no `stock_movements` row and no stock change
- AND the webhook MUST NOT fulfill against any other tenant's order or product

## Non-requirement corrections (spec prose, no behavioral change)

### Correction C1 — the R8–R14 state note is stale and MUST be fixed at archive

The header state note (`openspec/specs/payment-orders/spec.md:3-23`) and the R8–R14 section
preamble (`:184-189`) still claim that R8–R14 are pending merge of draft PR **#203** on a
`feature-branch-chain`, that "nothing has reached `main` or `develop`", that readers must "treat
R8–R14 as the **intended** contract until #203 merges", and (at `:189`) that they must re-read the
state note "before relying on them in production". **All of that is stale: R8–R14 ARE in
`develop`.** PR #203 merged into the `feat/order-integrity` **tracker** branch — not into
`develop`; the content reached `develop` via PRs **#211 / #215 / #224 / #253**. The requirements
are verified shipped code, not an intended contract.

At archive, the published spec MUST be rewritten so that:

- the header note states that R8–R14 are present in `develop` and independently verified, with the
  tracker-vs-develop path recorded (#203 → tracker; #211/#215/#224/#253 → `develop`);
- the claims "pending merge", "Treat R8–R14 as the intended contract until #203 merges", "Nothing
  has reached `main` or `develop`", the draft-PR/single-revert rollback warning, and the `:189`
  "read the state note before relying on them in production" pointer are **removed**;
- the still-accurate numbering material (no renumbering; R13/R14 discovered post-verification by
  engram #1162) is retained — it documents provenance, not merge status.

The corrected note MUST also record the verification gotcha, so no future agent "re-checks" this
the wrong way: `git merge-base --is-ancestor feat/order-integrity origin/develop` returns **1**
(the tracker branch object is not an ancestor of `develop`) even though its content shipped — the
`feat/order-integrity*` branches are stale locals and the remote branch was deleted after merge.
**Branch ancestry is NOT a valid check here**; presence MUST be verified by code artifacts
(`readOrderProductBinding`, `getCulqiOrder`, `isCulqiOrderPaid` in `charge/route.ts`,
`reserveIdempotencyKey`/`releaseIdempotencyKey`, the `ORDER_AMOUNT_MISMATCH` /
`ORDER_PRODUCT_MISMATCH` / `ORDER_CURRENCY_MISMATCH` codes and the W-P1 reservation comment,
`migrations/0048_payments_order_number_integrity.sql`, `src/core/payments/orderNumber.ts`,
`src/lib/orderAccessCookie.ts`, `orderAccessGate.ts`).

#### Scenario: The published spec no longer claims a pending merge

- GIVEN a reader of `openspec/specs/payment-orders/spec.md` after this change is archived
- WHEN they read the header note and the R8–R14 preamble
- THEN no "pending merge", "until #203 merges", "nothing reached develop", or "read the state note
  before trusting them" instruction remains
- AND the note states R8–R14 are in `develop`, verified via code artifacts

#### Scenario: The ancestry trap is documented

- GIVEN the corrected note
- WHEN a future change attempts to verify R8–R14's presence with branch ancestry
- THEN the note warns that `git merge-base --is-ancestor feat/order-integrity origin/develop`
  returns 1 despite shipped content, and directs verification to the code artifacts list

## Out of Scope (this delta)

- Everything the `stock-fulfillment` delta already scopes: oversell prevention (reservations/holds),
  the refund/backorder path, B-07 (PII scrubber mangles UUIDs), `payments.status` redesign,
  retro-fulfillment of pre-deployment drift.
- Adding a `productId` column to `payment_orders` or changing the R13 binding mechanism itself —
  this delta only guarantees the new `cartItems` key does not interfere with it.
- R1, R3, R4, R6–R14 text: respected verbatim; any change to them belongs to a different change.
