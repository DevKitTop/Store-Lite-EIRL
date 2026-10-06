# Payment Orders Specification

> **⚠️ Extended 2026-10-02 by `order-integrity` (C2) — IMPLEMENTED AND VERIFIED, PENDING MERGE.**
> **R8–R14 below were synced at SDD archive from `openspec/changes/order-integrity/`. They describe
> code that exists and has been independently verified, but it is NOT yet in production.** The change
> lives entirely in **three unmerged draft PRs** on a `feature-branch-chain`:
> **#203** `feat/order-integrity` → `feat/order-integrity-a` (slice A, R8–R14) · **#204** and **#205**
> are the later C4 slices (see `api-access-control` R13–R18) and do not touch `payment_orders`.
> Nothing has reached `main` or `develop`. Slice A commits: `e9ab802`, `ccfbb55`, `f4239a6`, `51c8a06`,
> `c0eb346`, `0bd40a9`, `62761ab` (tip `62761ab` on `feat/order-integrity-a`).
>
> Treat R8–R14 as the **intended** contract until #203 merges. **Rollback is a single revert of
> `feat/order-integrity-a`**, which re-opens C2 (a fabricated or unpaid `culqiOrderId` can again
> produce a `paid` row, a stock decrement, a seller notification and an SMS).
>
> **No renumbering.** `payment-orders` had no REMOVED section and no numbering cross-reference table,
> so R8 was the first free number. **No requirement was modified or removed** — R8–R14 are additive.
>
> **Numbering note:** R13 and R14 were **not** in the original proposal. They were discovered by the
> slice-A verify report (engram **#1162**, findings W1/W2) as a spec gap, and are published here
> because they are now shipped code. R8–R12 are written against paid-ness only and never asked for a
> binding or for idempotency-key cleanup, so R13/R14 are **not** violations of R8–R12 — they close
> two holes those requirements left open.

## Purpose

Enable asynchronous payment methods (PagoEfectivo, Billetera Móvil, Cuotéalo) via Culqi Órdenes de Pago (`POST /v2/orders`). Orders generate CIP codes or QR URLs instead of charging a card token synchronously. The webhook tracks status transitions (pending → paid/expired/cancelled).

## Requirements

### R1: Payment Orders Database Table

The system MUST store a `payment_orders` table with: `id` (UUID PK), `businessId` (FK → businesses), `culqiOrderId` (text, unique), `amount` (decimal), `currency` (text, default `PEN`), `status` (enum: `pending`, `paid`, `expired`, `cancelled`), `paymentMethod` (text enum: `pago_efectivo`, `billetera_movil`, `cuotealo`), `paymentCode` (text, nullable — CIP), `qrUrl` (text, nullable), `buyerEmail` (text), `buyerPhone` (text, nullable), `expirationDate` (timestamp), `metadata` (jsonb, default `{}`), `createdAt`, `updatedAt`.

#### Scenario: Create order record

- GIVEN a valid Culqi order API response has been received
- WHEN the system persists it
- THEN a row MUST exist in `payment_orders` with status `pending`

#### Scenario: Duplicate culqiOrderId rejected

- GIVEN a `payment_orders` row with a given `culqiOrderId`
- WHEN another insert uses the same value
- THEN the database MUST reject with a unique constraint violation

### R2: POST /api/payment/create-order

The endpoint MUST accept a Zod-validated body, call `POST https://api.culqi.com/v2/orders`, persist the response, and return payment instructions.

Input: `{ amount (number, céntimos), currency (default PEN), email (email), phone (optional), businessId (UUID), productId (optional UUID), customerName (optional), description (optional) }`.

The Culqi order body MUST include: `amount`, `currency_code`, `description`, `order_number` (generated), `client_details`, `expiration_date` (now + 3 days), `confirm: false`. When `customerName` is present, `client_details` SHALL include `first_name` and `last_name` derived via `splitFullName(customerName)`; when absent, `client_details` SHALL NOT include name keys.

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

### R3: Checkout Order Integration

Before `Culqi.open()`, the Checkout MUST call `POST /api/payment/create-order` when the selected payment flow is async, and pass the resulting `culqiOrderId` to `Culqi.settings({ order })`.

#### Scenario: Sync methods skip order creation

- GIVEN the buyer pays with card, yape, or plin
- WHEN `handlePayment` executes
- THEN it MUST NOT call `create-order`
- AND the existing charge flow MUST proceed unchanged

#### Scenario: Async methods trigger order creation

- GIVEN the checkout is ready to open Culqi
- WHEN the selected payment flow requires async methods
- THEN `POST /api/payment/create-order` MUST be called before `Culqi.open()`
- AND `Culqi.settings({ order: culqiOrderId })` MUST be set

### R4: Culqi.order Callback Handling

The `window.culqi` callback MUST distinguish `Culqi.order` (async result) from `Culqi.token` (sync charge).

#### Scenario: Show payment instructions after async order

- GIVEN the buyer completed an async payment in the Culqi modal
- WHEN `window.culqi` fires with `Culqi.order` present and no `Culqi.token`
- THEN the system MUST display payment instructions (CIP code / QR / expiration) instead of the charge receipt

#### Scenario: Error from Culqi order

- GIVEN the Culqi modal returns an error for an async method
- WHEN `window.culqi` fires with `Culqi.error`
- THEN the system MUST display the error message to the buyer

### R5: Webhook — order.status.changed

The Culqi webhook MUST handle `order.status.changed` events and update `payment_orders.status`.

#### Scenario: Order paid via webhook

- GIVEN a `payment_orders` row with status `pending`
- WHEN a webhook event `order.status.changed` arrives with status `paid`
- THEN the row MUST update to status `paid` and `updatedAt` refreshed

#### Scenario: Order expired via webhook

- GIVEN a `payment_orders` row with status `pending`
- WHEN a webhook event `order.status.changed` arrives with status `expired`
- THEN the row MUST update to status `expired`

#### Scenario: Unknown Culqi order ID in webhook

- GIVEN a webhook event references a `culqiOrderId` not in `payment_orders`
- WHEN the webhook processes it
- THEN it MUST log a warning and return `{ received: true }` without error

### R6: Payment Method Enum Expansion

The `payment_method` pgEnum and the inline `text('payment_method', { enum: [...] })` in the `payments` table MUST include `pago_efectivo`, `billetera_movil`, and `cuotealo`.

#### Scenario: Enum values updated

- GIVEN the database schema definition
- WHEN `paymentMethodEnum` is inspected
- THEN it MUST include `card`, `yape`, `plin`, `pago_efectivo`, `billetera_movil`, `cuotealo`

#### Scenario: Payments table column updated

- GIVEN the `payments` table `payment_method` column
- WHEN its enum values are inspected
- THEN they MUST match the expanded enum

### R7: Payment Instructions UI

The checkout MUST display a payment instructions view after order creation for async methods, showing the CIP code (PagoEfectivo) or QR URL (Billetera Móvil) with expiration countdown.

#### Scenario: PagoEfectivo shows CIP code

- GIVEN an order was created with `paymentMethod: pago_efectivo`
- WHEN the payment instructions UI renders
- THEN it MUST display the CIP code prominently, bank names, and expiration countdown

#### Scenario: Billetera Móvil shows QR

- GIVEN an order was created with `paymentMethod: billetera_movil`
- WHEN the payment instructions UI renders
- THEN it MUST display the QR code image and expiration date

#### Scenario: Instructions modal is closable

- GIVEN the payment instructions UI is visible
- WHEN the buyer clicks close
- THEN the modal MUST dismiss
- AND the buyer can return to the storefront

---

# Added 2026-10-02 — `order-integrity` (C2): the money-truth gate for the order flow

> Synced at SDD archive from `openspec/changes/order-integrity/specs/payment-orders/spec.md`
> (change artifacts: proposal, design D1–D13, tasks WU-A1/A2, apply-progress, verify-report).
> **All eight requirements below are implemented and independently verified — pending merge of
> draft PR #203.** Read the state note at the top of this file before relying on them in production.

`POST /api/payment/charge` is specified by R2 for order creation and by R4/R5 for the Culqi callback
and webhook, but **its order-flow branch — the branch taken when a client supplies a `culqiOrderId`
and no `token` — was specified nowhere.** It trusted the client's `culqiOrderId` outright. These
requirements specify it: it is a **second writer** for R5's `pending → paid` transition, and it is
the only reader of the Culqi order that R5's webhook is not the source for.

## R8: The order-flow branch MUST verify the Culqi order before trusting a client-supplied `culqiOrderId`

The order-flow branch of `POST /api/payment/charge` — the branch taken when the client supplies
`culqiOrderId` and no `token` (`isOrderFlow`) — MUST NOT treat the presence of a client-supplied
`culqiOrderId` as evidence that Culqi collected money. Before any write, the server MUST perform two
**ordered reads**, both against the **business** in the request:

1. `payment_orders` MUST be read by the pair (`culqiOrderId`, `businessId`). A row absent under that
   pair ⇒ the request MUST be rejected with **404**. A row present ⇒ that read yields the exact row
   the later flip in R10 must address.
2. The Culqi order MUST then be read by id with the business's **secret key**
   (`resolveCulqiSecretKey(businessId)`), using an abort deadline of 15 s and
   `Authorization: Bearer`, exactly mirroring `POST /api/payment/create-order`.

Both reads MUST be evaluated **before** the idempotency-key reservation, so a rejected request MUST
NOT burn an idempotency key. The existing rate limiter already runs ahead of the branch and is
unchanged; the order read is inside the already-budgeted window.

A Culqi transport failure MUST be reported distinctly from a not-paid state: an abort/timeout ⇒
**504**; any other transport throw ⇒ **502** (`create-order`'s existing split).

#### Scenario: Invented order id is refused before any write

- GIVEN no `payment_orders` row exists for (`culqiOrderId`, `businessId`)
- WHEN `POST /api/payment/charge` is called with that `culqiOrderId` and no token
- THEN the response is **404**
- AND `db.transaction` is never called, no `payments` row is inserted, no `products` row is updated,
  no seller notification is emitted, and no idempotency key is reserved

#### Scenario: Gate runs ahead of the idempotency reservation

- GIVEN a `culqiOrderId` that fails the R9 paid check
- WHEN the request is rejected
- THEN no idempotency key was reserved for it, so the buyer's retry is not answered as a replay

#### Scenario: Culqi transport failures are distinguishable

- GIVEN the order row exists but the Culqi read aborts at the 15 s deadline
- WHEN the request is processed
- THEN **504**
- GIVEN the order row exists and the Culqi read throws for any other reason
- THEN **502**
- AND in both cases `db.transaction` is never called

Archived-state note (2026-10-02) — shipped as `charge/route.ts:362-448` +
`src/core/payments/culqiOrders.ts`:

| Requirement clause                        | Shipped evidence                                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| business-scoped ordered read ⇒ 404        | `route.ts:362-382` — `db.query.paymentOrders.findFirst({ where: and(eq(culqiOrderId), eq(businessId)), columns: { amount, currency, metadata } })`; absent ⇒ `404`                   |
| the read is **projected**                 | the `columns` object selects only the three fields the binding (R13) needs — never `buyerEmail`/`buyerPhone`, which are in memory for a check that never serialises them             |
| secret key, 15 s abort, `Bearer`          | `culqiOrders.ts:10` (`CULQI_TIMEOUT_MS = 15000`), `:36-39` `AbortController`, `:47` `Authorization: Bearer`, `:48` `Accept: application/json`                                        |
| both reads before `reserveIdempotencyKey` | reservation at `route.ts:470`; the gate closes at `:448`                                                                                                                             |
| abort ⇒ 504, other throw ⇒ 502            | `culqiOrders.ts:78-85` maps `AbortError` → `CulqiReadError('timeout')` and everything else → `('transport')`; `route.ts:94` + `culqiReadErrorResponse` map the kinds to the statuses |
| module is transport-agnostic              | `culqiOrders.ts` imports **no** `next/server`; `class CulqiReadError extends Error` carries the kind                                                                                 |

**Two hardening details the shipped code adds beyond the requirement text**, both recorded so the
next reader does not "simplify" them away:

- **The client-supplied id is `encodeURIComponent`-escaped** (`culqiOrders.ts:45`). Interpolated raw
  it escapes its own path segment and can retarget the read at a different Culqi endpoint (e.g.
  `../../v2/charges/chr_x?limit=100`).
- **A body the gateway labels JSON MUST parse.** A parse failure on a `content-type: …json` response
  is a transport fault (`culqiOrders.ts:57-69`); a genuinely non-JSON body (HTML error page, empty
  proxy response) is tolerated down to `{}` so the caller fails closed on "not paid". Without the
  distinction, an HTML error page would be read as an unpaid order and rejected with a buyer-facing
  402 instead of surfacing a 502.

## R9: Only an acknowledged `paid` order may commit; every other state is rejected with zero side effects

The order-flow branch MUST commit (insert `payments` with `status: 'paid'`, flip `payment_orders`,
decrement stock, notify the seller) **only** when the paid check in R11 resolves to allow. Any other
outcome — `pending`, `expired`, `cancelled`, or an unparseable/absent marker — MUST be rejected with
**402** and MUST produce **zero** side effects: no `payments` insert, no `payment_orders` update, no
`products` stock update, no `notifyNewOrder`, no SMS. The token flow (`isTokenFlow`) is unchanged.

#### Scenario: Pending order is refused with no side effect

- GIVEN a `payment_orders` row exists for (`culqiOrderId`, `businessId`) and Culqi reports a
  non-`paid` state
- WHEN `POST /api/payment/charge` is called
- THEN the response is **402**
- AND no `payments` row is inserted, no `products` stock is decremented, and `notifyNewOrder` is
  never called

#### Scenario: Expired and cancelled orders are refused

- GIVEN Culqi reports `expired`, and separately `cancelled`
- WHEN the order-flow branch is entered
- THEN each request is rejected with **402** and no write occurs

#### Scenario: Token flow is untouched

- GIVEN a request carrying `token` and no `culqiOrderId`
- WHEN the Culqi charge succeeds
- THEN the insert, stock decrement and notification proceed exactly as before

Archived-state note (2026-10-02) — shipped as `route.ts:439-448`: `!culqiOrderPaid` ⇒ `402`
`{ error: ORDER_NOT_PAID_MESSAGE, code: 'ORDER_NOT_PAID' }`, reached **before** the reservation at
`:470`, so the transaction at `:562+` never opens. The token flow's branch (`route.ts:449-468`) is
byte-unchanged; all pre-existing token-flow tests stay green unmodified, which is the regression
proof for "the token flow is untouched".

## R10: The `payment_orders` flip and the `payments` dedup lookup MUST be business-scoped

The `payment_orders` UPDATE that sets `status: 'paid'` MUST be scoped by **both** `culqiOrderId` and
`businessId`, and the route MUST assert that exactly one row was affected. An affected-row count of
**0** MUST abort the transaction (no committed flip, no response carrying a `paid` state).

Separately, the idempotency **dedup lookup** on `payments.culqiChargeId` (the replay path that
returns `payment: <full row>` with HTTP 200) MUST be scoped by `businessId` as well. A `culqiChargeId`
belonging to another tenant MUST never return that tenant's payment row — and therefore MUST never
return buyer PII (`buyerEmail`, `buyerDni`, shipping columns) — to the caller.

#### Scenario: Cross-tenant order id cannot flip another tenant's row

- GIVEN a `payment_orders` row whose `businessId` differs from the request's `businessId`
- WHEN the order-flow branch attempts the flip
- THEN the UPDATE affects **0** rows
- AND the transaction aborts; the response is not a success and the other tenant's row is unchanged

#### Scenario: Cross-tenant dedup replay misses

- GIVEN a `payments` row exists with `culqiChargeId` owned by business B
- WHEN business A posts a charge carrying that same id
- THEN the dedup lookup finds no row, no replay response is returned, and business B's payment data
  is never included in business A's response

Archived-state note (2026-10-02) — the two scoping sites and the replay payload:

| Site           | Shipped                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dedup lookup   | `route.ts:484` — `where: and(eq(payments.culqiChargeId, …), eq(payments.businessId, businessId))`                                                                                                                                                 |
| replay payload | `route.ts:498-500` — the replayed `payment` object carries exactly `{ id, trackingToken, orderNumber, amount, currency, status }`, a **PII-free subset** of the only fields the client callback reads. No `buyer*`, no `shipping*`, no `metadata` |
| the flip       | `route.ts:562-575` — `update(paymentOrders).set({ status: 'paid' }).where(and(eq(culqiOrderId), eq(businessId))).returning({ id })`                                                                                                               |

**Fail-closed shape correction (recorded, because the requirement text says `rowCount === 1` and the
code does not read `rowCount`).** The DB driver is `drizzle-orm/postgres-js`, and its DML results
expose `count` / `command` — **never `rowCount`**. Reading `.rowCount` would yield `undefined`, so a
literal `rowCount !== 1` assertion would throw on _every_ order flow. The shipped equivalent is
`.returning({ id })` plus a **length** assertion (`returning` is what materialises the affected-row
identity), which fails closed on both 0 and >1. `drizzle-kit push` is forbidden in this repo, so
this idiom is the only way to observe the count.

## R11: The paid marker is read from Culqi's real `state` / `paid_at` fields

> **Amended before the C2 money gate shipped.** The original R11 read a `status` field on the Culqi
> order. **The Culqi order object has no `status` field** — that name (and `paid`) belongs to the
> **CHARGE** object. Under an "every marker present must equal `'paid'`" rule a fictional field is
> filtered out as `undefined` and is **silently harmless**: no test ever fails, while the written
> contract is poisoned and the next reader misled. The regression is pinned by an explicit row —
> `{ status: 'paid' }` MUST deny.
>
> Evidence: Culqi's documented order anatomy carries `state` and `paid_at` and **no** `status`;
> `state === 'paid'` is real (Culqi's own Prestashop module compares `$state == 'paid'` /
> `$state == 'expired'` on the order webhook payload, and `GET /v2/orders` accepts a `state` filter
> with documented values including `created` and `paid`); `paid_at` is a unix timestamp, `null` while
> unpaid; responses are **flat** (no `data` envelope), proven by this repo's own
> `create-order/route.ts` reading `culqiData.id`, `payment_method`, `cip_code` and
> `action?.qr?.image_url` at the top level. The community OpenAPI mirrors
> (github.com/api-evangelist/culqi) carry **neither** a `state` enum nor `paid_at`, could not settle
> this, and were not treated as authoritative.

The paid check MUST inspect the order's `state` and `paid_at` fields and MUST resolve to **paid**
when **either** is authoritative money evidence:

1. `state` is exactly the string `'paid'` — an exact, case-sensitive comparison. No case folding, no
   trimming, no substring matching. A non-string `state` is not `paid`.
2. `paid_at` is money evidence — a finite number greater than zero, or a non-empty string that parses
   to one.

The two markers are combined with **OR**, not AND. Everything else denies (**402**), including:
`paid_at` `null`, `0` (epoch zero is not a real capture time), `''`, a non-numeric string, any
`state` other than exactly `'paid'`, an empty response, and any response whose only paid-looking key
is `status`. This is fail-closed by construction: any field the gate cannot positively recognise as
paid denies.

Pinned truth table — `A` = allow (proceed to commit), `D` = deny (**402**):

| `state`                             | `paid_at`                                | Outcome                                                         |
| ----------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| absent                              | absent                                   | **D** — unparseable response                                    |
| `'paid'`                            | absent                                   | **A**                                                           |
| absent                              | `1538540700000` (number)                 | **A**                                                           |
| absent                              | `'1538540700000'` (numeric string)       | **A**                                                           |
| `'paid'`                            | `1538540700000`                          | **A**                                                           |
| `'pending'`                         | absent                                   | **D**                                                           |
| `'created'`                         | absent                                   | **D**                                                           |
| `'expired'`                         | absent                                   | **D**                                                           |
| `'cancelled'`                       | absent                                   | **D**                                                           |
| `'refunded'`                        | absent                                   | **D**                                                           |
| `'unpaid'`                          | absent                                   | **D**                                                           |
| `'PAID'`, `' paid'`                 | —                                        | **D** — exact match only, no case/trim/substring normalization  |
| non-string (number, object, `null`) | —                                        | **D**                                                           |
| absent                              | `null` / `0` / `''` / non-numeric string | **D** — not money evidence                                      |
| absent                              | —                                        | **D** — `status: 'paid'` is a CHARGE field, not an order marker |
| `'pending'`                         | `1538540700000`                          | **A** — see the documented asymmetry below                      |

**Documented asymmetry (deliberate, pinned).** `state` can still read `pending` for a few seconds
after Culqi captured the money on an async method. A non-null `paid_at` is therefore authoritative
and wins over a stale `state`. Denying there would reject a buyer who genuinely paid — reintroducing
exactly the free-order outcome this gate exists to prevent. The reverse asymmetry is not taken:
`state: 'paid'` with a `null` `paid_at` still allows, because `state` is the documented terminal
paid value.

#### Scenario: `state` is exactly `paid`

- GIVEN a Culqi response carrying `state: 'paid'`
- WHEN the paid check runs
- THEN it allows

#### Scenario: `paid_at` is money evidence on its own

- GIVEN a Culqi response carrying `paid_at: 1538540700000` (number), or the same value as a string
- WHEN the paid check runs
- THEN it allows

#### Scenario: A non-`paid` state denies

- GIVEN a Culqi response carrying `state: 'pending'`, `'created'`, `'expired'`, `'cancelled'`,
  `'refunded'`, `'PAID'` or `' paid'`
- WHEN the paid check runs
- THEN it denies with **402** and no write occurs

#### Scenario: A stale `pending` state with a real `paid_at` still allows

- GIVEN a Culqi response carrying `state: 'pending'` together with `paid_at: 1538540700000`
- WHEN the paid check runs
- THEN it allows, because the capture timestamp is authoritative money evidence

#### Scenario: A charge-only `status` field does not grant paid

- GIVEN a Culqi response carrying `status: 'paid'` and neither `state` nor `paid_at`
- WHEN the paid check runs
- THEN it denies with **402** — `status` is a field of the CHARGE object, not the order

#### Scenario: An unparseable response denies

- GIVEN a Culqi response with no marker at all, a non-string `state`, or a `paid_at` that is
  `null` / `0` / `''` / non-numeric
- WHEN the paid check runs
- THEN it denies with **402** and no write occurs

Archived-state note (2026-10-02) — shipped as `culqiOrders.ts:107-129`:

```ts
export function isCulqiOrderPaid(order: CulqiOrderState): boolean {
  if (order.state === 'paid') return true;
  return isMoneyTimestamp(order.paid_at);
}
```

`===` against the literal `'paid'` is what makes case/trim/substring normalization impossible, and
both markers are typed `unknown` so the non-string rows are **representable and therefore testable**
rather than suppressed by the type system. `isMoneyTimestamp` accepts only a finite `> 0` number or
a non-empty string parsing to one.

## R12: A not-paid rejection MUST be buyer-distinguishable, never an opaque 5xx

The **402** not-paid rejection MUST carry a signal the existing client already reads, so a buyer on an
async payment method is told the payment is still being confirmed rather than shown a generic failure.
The route MUST return the buyer-facing processing/re-poll text in the response's `error` field — the
field `chargePayment` reads before throwing, and whose value `useCulqiCallback` forwards verbatim to
`onError(message)`. An additional machine-readable `code` MAY accompany it, but MUST NOT be the only
distinguishing signal, because the existing client collapses the body into a single `Error` message.

A not-paid outcome MUST NOT be reported as **500** or any other 5xx. The wording MUST tell the buyer
the payment is still processing and that they can retry / the status will refresh.

This requirement exists because of proposal risk **R3**: buyers who legitimately paid an async method
whose Culqi order still reads `pending` are now rejected. That is the correct outcome — today they get
a free order — but it MUST be surfaced as "processing", not as a crash.

#### Scenario: Not-paid carries a buyer-facing message

- GIVEN the Culqi order reports `pending`
- WHEN the route rejects the request
- THEN the response status is **402** and its `error` field states that the payment is still being
  confirmed and invites a retry / status refresh

#### Scenario: A transport failure is not presented as not-paid

- GIVEN the Culqi read aborted
- WHEN the route rejects the request
- THEN the status is **504**, which is distinct from the 402 not-paid contract

Archived-state note (2026-10-02) — every rejection in the order-flow branch follows one shape:
`{ success: false, error: <buyer-safe text>, code: <machine-readable> }` at `route.ts:40-52`
(`ORDER_NOT_PAID_MESSAGE`, `ORDER_AMOUNT_MISMATCH_MESSAGE`, `ORDER_CURRENCY_MISMATCH_MESSAGE`,
`ORDER_PRODUCT_MISMATCH_MESSAGE`) and the 402 sites at `:392-448`. **No rejection body carries a
`details` key** — `chargePayment` throws `data.details || data.error` (`paymentApi.ts:104`), so a
`details` key would shadow the buyer-facing text with a raw internal error.

**Buyer-visible behaviour change (product note, PR #203 body).** A buyer who legitimately paid an
async Culqi method whose order still reads `pending` now receives **402 + "still processing"** and the
instructions screen MUST re-poll, where previously they silently received a free order. Copy is
Spanish voseo, matching the rest of the buyer's path.

## R13: The recorded amount and product MUST be the ones the verified Culqi order authorises

> **Added after verification** (slice-A verify report, engram **#1162**, finding **W1**). Not in the
> original proposal; discovered because R8–R12 are written against paid-ness only and never asked for
> a binding. Recorded here because it is shipped code.
>
> The gap: the gate proved a Culqi order was `paid` but never checked that the amount/product the
> transaction would record was the amount/product that order was created for. **Underpayment
> scenario:** a buyer creates a Culqi order for a **S/ 1.00** product of business B and pays it, then
> POSTs `/api/payment/charge` with that `culqiOrderId` but `productId` = another of B's products
> priced **S/ 1000.00** and `amount: 100000`. `validateAmount` passes (100000 is that product's real
> price), the gate passes (the order is paid), the dedup lookup misses — and the transaction inserts
> `payments { amount: '1000.00', status: 'paid', productId: <S/1000 product> }` and decrements the
> S/ 1000 product's stock. Result: **S/ 1.00 collected, S/ 1000.00 recorded**. Blast radius is confined
> to the attacker's own tenant (both `orderRow` and `productId` must belong to `businessId`), so it is
> **not** cross-tenant theft and does **not** reopen C2 — it is underpayment, self-inflicted stock
> depletion, and a fabricated financial record (inflated `payments` rows, `PAYMENT_COMPLETED`
> analytics, `notifyNewOrder`).

Verifying paid-ness is necessary but NOT sufficient: the gate MUST also bind the verified payment to
what the transaction records. The recorded amount, currency and product MUST equal the verified Culqi
order's own amount, currency and product binding.

- The amount comparison MUST account for the unit mismatch: `payment_orders.amount` is `decimal(10,2)`
  written in **soles** (`create-order` writes `String(amount / 100)`) while the request `amount` is
  **minor units**, so the comparison MUST scale before testing equality and MUST round, or a legitimate
  order is rejected on a float artifact.
- The comparison MUST **fail closed**: an unreadable stored amount (null, empty, non-numeric) MUST be
  denied. A silent `NaN` must never be treated as a match or a mismatch-that-slips-through.
- `payment_orders` has **no `productId` column**; the binding lives in `metadata.productId` and is
  **absent for a product-less order** (`create-order` permits one). When a binding is present it MUST
  match; when it is absent there is nothing to bind and the request MUST be allowed.
- A binding that is present but unusable (not a string) MUST be denied, so an attacker cannot bypass the
  check by supplying a non-string value.
- The binding MUST be evaluated **inside the existing gate**, before the Culqi read (so a mismatch costs
  no upstream round-trip) and always before `reserveIdempotencyKey` (so no key is burned).
- The gate read MUST use an explicit `columns` projection of the money and binding fields only; it MUST
  NOT pull `buyerEmail` / `buyerPhone` into memory for a check that never serialises them.
- A rejection MUST follow the R12 discipline: buyer-safe text in `error`, a distinct machine-readable
  `code`, and **never** a `details` key (`chargePayment` throws `data.details || data.error`).

#### Scenario: A request amount that is not the order amount is refused

- GIVEN a Culqi order of `S/ 1.00` that Culqi reports as `paid`
- WHEN the client requests the charge with `amount: 100000` for another product of the same business
- THEN the route denies with **402**, `code: 'ORDER_AMOUNT_MISMATCH'`, and no `details` key
- AND no Culqi read, no transaction and no idempotency reservation occur

#### Scenario: A decimal-string order amount is accepted on its true value

- GIVEN a Culqi order whose stored amount is the decimal string `'10.99'`
- WHEN the client requests `amount: 1099`
- THEN the route accepts the charge, because `Math.round(10.99 * 100)` is `1099`

#### Scenario: An unreadable stored amount fails closed

- GIVEN a `payment_orders` row whose amount is null, empty or non-numeric
- WHEN the client requests any charge against that order
- THEN the route denies with **402** and `code: 'ORDER_AMOUNT_MISMATCH'`
- AND the stored value is never coerced into an accidental match

#### Scenario: A request currency that is not the order currency is refused

- GIVEN a Culqi order stored with currency `USD`
- WHEN the client requests the charge with `currency: 'PEN'`
- THEN the route denies with **402** and `code: 'ORDER_CURRENCY_MISMATCH'`, with no `details` key

#### Scenario: A request product that is not the ordered product is refused

- GIVEN a Culqi order bound to product A via `metadata.productId`
- WHEN the client requests the charge for product B of the same business
- THEN the route denies with **402** and `code: 'ORDER_PRODUCT_MISMATCH'`, with no `details` key

#### Scenario: A product-less order is still accepted

- GIVEN a Culqi order whose `metadata` carries no usable `productId` (empty object, null, absent key, or
  a non-object value) — the legitimate shape of a product-less order
- WHEN the client requests the charge
- THEN the route accepts it, because there is no product binding to violate

Archived-state note (2026-10-02) — shipped as `route.ts:384-427`, **between** the 404 and the Culqi
read, i.e. after the projected read and before `resolveCulqiSecretKey` (`:429`):

| Check                                 | Shipped                                                                                                                                                                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| amount, scaled + rounded, fail-closed | `orderAmountToMinorUnits(orderRow.amount)` ⇒ `null` on an unreadable value, and `null` short-circuits the equality so a `NaN` can never match (`route.ts:391-392`)                                                                                         |
| currency                              | strict `currency !== orderRow.currency` ⇒ `ORDER_CURRENCY_MISMATCH` (`:403-412`)                                                                                                                                                                           |
| product binding, three-state          | `readOrderProductBinding` returns `'absent'` \| `{ id }` \| `'invalid'`; `'invalid'` and a non-matching `id` both deny, `'absent'` allows (`route.ts:414-427`) — the three-state shape is what makes "present but unusable" deniable instead of bypassable |

## R14: A failed charge transaction MUST NOT leave the idempotency key in `processing`

> **Added after verification** (slice-A verify report, engram **#1162**, finding **W2**). Same
> caveat as R13: not in the original proposal, discovered while verifying slice A.
>
> The mechanism: the client derives the `Idempotency-Key` as `charge-${token || culqiOrderId}`
> (`paymentApi.ts:68`), so it is **deterministic per Culqi order**, not per attempt. Any path that
> reserves a key and then throws — including the new `payment_orders` flip assertion — left the row at
> `status: 'processing'`, `responseBody: null`. `reserveIdempotencyKey` answers `{type:'processing'}`
> for such a row (`idempotency.ts:39-47`) and **no reaper for `payment_idempotency_keys` exists
> anywhere in the repo**, so every subsequent retry of that order was answered **409 forever**. The
> impact is fail-closed (no money lost, no free order) but it is a permanent buyer lockout caused by a
> transient fault.

If a charge throws after its idempotency key was reserved, the route MUST complete that key with the
failure before returning, so the recorded failure is replayable rather than a permanent `processing`
lockout. This MUST NOT mask the original failure: if the completion itself throws, the original error
MUST still surface. It MUST NOT complete a key the success path already completed, and it MUST NOT
complete a key that was never reserved.

#### Scenario: A failed transaction leaves the key completed with the failure

- GIVEN the `payment_orders` flip affects 0 rows, so the transaction throws
- WHEN the route returns **500**
- THEN the reserved key MUST be recorded as `failed` with status **500** and the same buyer-safe error
  text the response carries — never left at `processing`

#### Scenario: A retry after a failed transaction is not answered 409

- GIVEN a first charge for a Culqi order failed inside the transaction
- WHEN the client retries the identical request with the same deterministic key
- THEN the response MUST NOT be a **409** `processing` answer

Archived-state note (2026-10-02) — shipped in the route's terminal `catch` (`route.ts:669-691`). The
`!successPathCompletedKey` guard is what keeps the cleanup from double-completing a key the success
path already completed at `:666`, and the inner `try/catch` around `completeIdempotencyKey` is what
keeps a cleanup failure from masking the original 500.

## Non-requirement obligations (no behavioral change)

- **New module, no new dependency.** The Culqi order read lives in `src/core/payments/culqiOrders.ts`,
  a new peer of `idempotency.ts` and `rateLimiter.ts`, so the future W-P3 webhook upsert and
  reconciliation cron reuse it. It imports **no** `next/server` — the read is transport-agnostic and
  the typed `CulqiReadError` is what lets the route map statuses without the module binding to a
  `NextResponse`. `executeCulqiCharge` stays route-private.
- **`resolveCulqiSecretKey` is reused as-is** (`charge/route.ts:51-96`); no new secret key path.
- **`chargeRequestSchema` is unchanged.** It already permits `culqiOrderId` without `token`; the fix is
  the gate, not the schema.
- **`and` was added to the `drizzle-orm` import.** `charge/route.ts` previously imported only
  `eq, sql`; all three new scoped predicates (R8 read, R10 dedup, R10 flip) need it.

## Out of scope (recorded 2026-10-02)

- C1 RLS (needs live Supabase). W-P3 webhook upsert and the reconciliation cron. W-P6 `payments.status`
  enum/transition design. W-P2/W-I1 rate-limiter redesign and reordering the limiter.
- `metadata.cartItems` trust (W-P4/W-P5). Live Culqi keys (operator).
- Any change to `payment_orders`' unique constraint on `culqiOrderId`; R10 scopes the **query**, not
  the schema.
- Buyer-facing UI for the R3 processing state beyond the response contract in R12.
