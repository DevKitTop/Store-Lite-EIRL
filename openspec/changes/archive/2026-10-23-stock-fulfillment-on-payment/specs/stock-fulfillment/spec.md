# Delta for stock-fulfillment

**Capability**: new — no `openspec/specs/stock-fulfillment/spec.md` exists, so every requirement below is ADDED.
**Change**: `stock-fulfillment-on-payment` (NEW-8). This delta is spec-phase output only: no code, no tasks.

**One-line contract**: every paid sale causes exactly one stock movement, regardless of which path
recorded the payment — charge transaction, webhook charge upsert, `order.status.changed` flip, or the
reconcile backstop. Today `products.stock` is written in exactly one place (the charge route's
transaction); every other path that can record `paid` moves no inventory at all.

## Numbering continuity

| Capability | Published numbers | REMOVED numbers | First free | This delta |
|---|---|---|---|---|
| `stock-fulfillment` | none (capability does not exist yet) | — | **R1** | **R1–R7** |

## Contract map — what this delta respects or amends

| Existing contract | Relation | Evidence |
|---|---|---|
| `payment-orders` R1 (`payment_orders.metadata` jsonb) | **Respect** — the snapshot lives in the existing jsonb under its own dedicated key | `create-order/route.ts:240` (insert writes `metadata.culqiRaw`) |
| `payment-orders` R2 (`create-order`) | **Amend** — see the `payment-orders` delta in this change | `schemas.ts` `createOrderRequestSchema` (no `cartItems` today) |
| `payment-orders` R5 (`order.status.changed`) | **Amend** — a `pending → paid` flip now also fulfills stock | webhook `route.ts:338-369` (status-only update today) |
| `payment-orders` R8–R14 (order-flow money gate) | **Respect** — gate semantics stay intact; the fulfillment marker write merely joins the existing transaction. R8–R14 ARE in `develop` (proposal Q6 — code artifacts, not branch ancestry) | `charge/route.ts:362-448`, `culqiOrders.ts`, `migrations/0048_payments_order_number_integrity.sql` |
| `payment-orders` R10 (business scoping, `.returning()` idiom) | **Respect** — every fulfillment read/update inherits this discipline | `charge/route.ts:570-578` (`.returning({ id })`, never `rowCount`) |
| `payment-orders` R13 (`readOrderProductBinding` three-state) | **Respect** — the new snapshot key MUST NOT be read as, written to, or mistaken for `metadata.productId` | `charge/route.ts:84-90` |
| W-P3.1 webhook upsert | **Amend** — the webhook may still out-race the charge route and create the sale's `payments` row, but it MUST first resolve the sale's existing row through the kind-correct id columns and MUST NOT create a row for a charge it cannot attribute to a sale; fulfillment hangs off the resulting `payments` row, after it exists | `webhookPaymentValues.ts:1-19`, webhook `route.ts:162-246`, `charge/route.ts:546` (the order id written into the charge column — the root cause of the duplicate row) |
| Charge-route conditional decrement (silent-oversell clamp fix, `9e8c5a8`) | **Respect** — the `stock >= qty` + `.returning()` idiom is the behavior the shared helper extracts; a losing write still skips without failing the payment | `charge/route.ts:588-638` |
| `order-flow` spec (V2 state machine) | **No amendment** — fulfillment completes before the order enters the state machine | — |
| `seller-fraud-guards` (product lock) | **No amendment** — guards govern `updateProduct`; the server-side decrement is not that path | — |

## ADDED Requirements

### Requirement: R1 — The fulfillment snapshot MUST be persisted before money moves, in the channel each flow already has

Before any path can record a `paid` state, the system MUST have persisted a recoverable
fulfillment snapshot (product identity + quantity). The two payment flows have different
pre-payment hops, so each uses the one channel it already has — the shapes are deliberately
NOT interchangeable:

| Flow | Where the snapshot lives | Shape | Why this shape |
|---|---|---|---|
| **Order flow** (async Culqi Órdenes) | `payment_orders.metadata` under a dedicated `cartItems` key, written by `create-order` at the row insert | `cartItems: { id: UUID, quantity: int ≥ 1 }[]` — the **existing** shape used by `validateAmount` (`validateAmount.ts:18`) and the storefront charge metadata (`schemas.ts` `chargeRequestSchema`), NOT `{ productId, qty }` | The order flow has a pre-charge server hop: `create-order` runs server-side before any payment exists, so a full cart array fits in the one DB row the webhook already reads. Today `create-order` persists only `metadata.culqiRaw`, and `metadata.productId` (the only product the webhook can recover) is the FIRST cart product only — a multi-item order is otherwise unrecoverable at webhook time. |
| **Token/card flow** (Culqi Checkout charge) | a scalar `qty` added to the Culqi **charge** `metadata` map the charge route already sends (`metadata: { businessId, productId, platform: 'store-lite' }`, `charge/route.ts:176`) | `qty: int ≥ 1` — a scalar for the single bound `productId`, NEVER a whole cart array | The card flow has no pre-charge server hop: when the charge route's call fails or times out, the only channel the webhook can read is the charge `metadata` Culqi echoes back (`data.metadata`, `webhookPaymentValues.ts:64-81`), and Culqi's metadata size is bounded — a cart array belongs there per Q2's residual check, a scalar does not. |

- The order-flow snapshot MUST be persisted with the `payment_orders` insert in `create-order` —
  i.e. before any `pending → paid` transition can be observed by any writer.
- The token-flow `qty` MUST be derived server-side from the same client cart input that
  `validateAmount` already reconciles (see R6) and MUST be attached to the charge request Culqi
  receives; the client MUST NOT be able to set charge-metadata `qty` independently of that
  validation.
- The charge `metadata` map MUST NOT gain a cart array; the `payment_orders.metadata` snapshot
  MUST NOT be reduced to a scalar. A snapshot written in the wrong flow's channel is a contract
  violation even if the values happen to be correct.
- The snapshot key MUST be dedicated: fulfillment data MUST NOT be written into, aliased to, or
  read from `metadata.productId` (the `payment-orders` R13 binding key). `readOrderProductBinding`
  continues to read exactly one key, and its three-state semantics (`'absent' | { id } | 'invalid'`)
  are unchanged.

#### Scenario: The order flow persists the cart snapshot at create-order

- GIVEN a valid `create-order` request carrying `cartItems: [{ id: <uuid>, quantity: 2 }]`
- WHEN `POST /api/payment/create-order` succeeds
- THEN the persisted `payment_orders.metadata` MUST contain `cartItems` with exactly that
  `{ id, quantity }[]` shape
- AND the existing `metadata.culqiRaw` content MUST be unchanged
- AND the Culqi order request body MUST be identical to the body sent without a snapshot (R2 delta)

#### Scenario: The token flow carries a scalar qty on the charge metadata

- GIVEN the charge route is about to call Culqi for a validated cart whose bound `productId` has
  quantity 3
- WHEN the charge request body is built
- THEN the `metadata` sent to Culqi MUST include `qty: 3` alongside `businessId`, `productId` and
  `platform`
- AND MUST NOT include any cart array

#### Scenario: A snapshot in the wrong channel is a violation

- GIVEN either flow's snapshot handling
- WHEN the charge `metadata` would receive a cart array, or the order snapshot would be a scalar
- THEN the contract is violated — neither shape substitution is permitted, even with correct values

### Requirement: R2 — Exactly-once fulfillment: a compare-and-swap on the `stock_movements` ledger claims every paid sale

> **AMENDED (R2).** The claim set is now derived from a **canonically resolved sale identity** instead
> of from whichever row each trigger happened to resolve, and the persisted link between a sale's two
> rows is kind-correct (order id ↔ order id). The ledger, the CAS idiom, the fixed claim order and the
> exactly-once rules are unchanged; what changed is *what the key set is derived from*.

Fulfillment completion MUST be claimed by a compare-and-swap (CAS) on a new `stock_movements`
ledger table with a **unique `(sourceType, sourceId)`** pair, where `sourceType` is either
`payments` (keyed by the `payments` row id) or `payment_orders` (keyed by the `payment_orders` row
id):

- `payment_orders` exists because the `order.status.changed` path can flip an order WITHOUT
  creating a `payments` row, so a `payments`-keyed column (e.g. `stock_fulfilled_at` on `payments`)
  **cannot** be the universal completion key; one ledger with two source types is. (A ledger also
  gives the refund/backorder path — deferred out of scope — a place to live later.)
- `payments` exists because the charge/token path records the sale as a `payments` row, and every
  such sale has exactly one because the row is resolved before it is written (see below).

**A single sale can be resolvable under BOTH keys.** An order-backed sale is exactly that case: the
charge route creates the `payments` row *and* flips the `payment_orders` row for the same purchase,
so `('payments', payment.id)` and `('payment_orders', po.id)` both identify one sale. Keying each
trigger to its own type in isolation would therefore let the charge transaction and a later
`order.status.changed` each win their **own** key — two successful claims, two decrements, one sale.
That outcome is forbidden.

**The sale's identity MUST be resolvable independently of the trigger.** A sale's identity is carried
by the persisted, kind-correct columns of its rows:

- `payments.culqi_charge_id` holds the Culqi **CHARGE** id (`chr_…`) and nothing else; `NULL` means
  the sale has no known charge id.
- `payments.culqi_order_id` holds the Culqi **ORDER** id (`ord_…`) and nothing else; `NULL` means the
  sale has no known order id.
- No column may hold an id of the other kind. A row that stores an order id in the charge column is a
  violation, and so is a row that stores a charge id in the order column.
- The link between a sale's `payments` row and its `payment_orders` row is the **same-kind** equality
  `payments.culqi_order_id = payment_orders.culqi_order_id` (within one business). A link that
  compares a charge id with an order id is not a link.

**One sale MUST have at most one `payments` row.** Every writer of a sale's row MUST resolve the
existing row **before** writing (business-scoped) and MUST adopt that row instead of inserting a
second one; a write that would create a second row for a sale it has already resolved is a violation.
Adopting a row means filling the columns that writer owns and that the row lacks — it never creates a
second row and never replaces a known id with `NULL`.

The claim MUST therefore cover the sale's **entire resolvable key set, in a fixed order:
`payment_orders` first, then `payments`**:

- The key set MUST be derived from the **resolved sale identity**, not from the row a given trigger
  happened to resolve. A trigger that can resolve the order link MUST NOT derive a payments-only key
  set for a sale that has one.
- Every path MUST resolve the sale identity first (business-scoped; every id DB-derived, never
  client-supplied) and then claim that sale's keys in the fixed order.
- The **first** successful claim authorizes exactly one decrement for the sale. Any further key
  claimed in the same call is recorded as part of that same fulfillment and MUST NOT cause a second
  decrement.
- The fixed order is normative: no path may lock `payments` before `payment_orders`, so concurrent
  triggers cannot deadlock.
- A sale with only one resolvable key claims only that key: a token-only sale has no
  `payment_orders` row, and a status-only flip with no `payments` row has no `payments` key.
- For an order-backed charge, the winning first key is `payment_orders`; a `('payments', …)` claim
  row for the same fulfillment is also committed in that transaction.
- A sale whose identity resolves to **no** persisted row has an **empty** key set. Such a path MUST
  claim nothing and MUST NOT decrement.

The claim (an `INSERT … ON CONFLICT DO NOTHING … RETURNING`, or a conditional equivalent that
observes the same uniqueness) MUST execute in the **same database transaction** as:

- the `products` stock decrement(s), and
- the write that records the `paid` state, wherever that write is already transactional (the
  charge-route transaction; the R5 order flip, which MUST become transactional with its
  fulfillment per the `payment-orders` R5 delta).

For the webhook charge upsert (W-P3.1), which is not one transaction today, the claim MUST be
attempted only **after** the paid `payments` row exists; a crash between the upsert and the claim
is healed by the backstop (R4), never lost.

The stock decrement itself MUST reuse the charge route's conditional idiom — `UPDATE products SET
stock = stock - qty WHERE id = ? AND businessId = ? AND stock >= qty` with `.returning()` — now
extracted into a single shared fulfillment helper used by ALL triggers. There MUST be exactly one
implementation of "decrement for a paid sale"; no trigger may carry its own copy.

Exactly-once rules:

- A trigger that observes **0 rows** from the CAS claim MUST skip the decrement and proceed
  normally: the payment (or order flip) outcome is unchanged, no error is raised, and the HTTP
  response / webhook acknowledgement is unaffected. The loser of a race is not a failure.
- Two racing triggers for the same sale MUST result in **exactly one** decrement.
- A trigger MUST NOT decrement without claiming; an unclaimed decrement is forbidden even as a
  fast path.
- A path that cannot resolve the sale identity MUST NOT claim and MUST NOT decrement. Failing closed
  is the only allowed outcome: no claim row, no stock movement, no error, and the sale remains
  eligible for the backstop (R4).
- A webhook event that cannot be attributed to a sale MUST NOT create a `payments` row for it. The
  event is still acknowledged, and the sale is healed by the path that can resolve it (the order
  flip, or the backstop) — never by inventing a second row.
- The charge route's happy path MUST be observably unchanged apart from the marker write: the
  R8–R14 gate order, rejections and zero-side-effect rules apply exactly as published, and the
  fulfillment claim only ever runs inside the already-committing transaction of an allowed charge.

Insufficient stock preserves the merged clamp semantics (`9e8c5a8`): when the conditional
decrement matches 0 rows, the sale still stands, no stock goes negative, an observable alert is
emitted, and the fulfillment outcome MUST be recorded so the backstop (R4) does not retry the same
sale forever.

#### Scenario: Two racing triggers produce exactly one decrement

- GIVEN a paid sale for which the charge transaction and the webhook (or the backstop) both attempt
  fulfillment concurrently
- WHEN both run the shared helper against that sale's ordered key set
- THEN the first successful claim authorizes exactly one decrement
- AND the other trigger observes 0 further claim rows, skips its decrement, and its payment/webhook
  processing completes without error

#### Scenario: An order-backed sale claimed under two different key types still decrements once

- GIVEN an order-backed sale, so both a `payments` row and a `payment_orders` row identify it
- WHEN the charge transaction fulfils it and a later `order.status.changed` flip attempts
  fulfillment for that same sale
- THEN the charge transaction wins `('payment_orders', …)` first, per the fixed claim order
- AND the later flip observes the sale already claimed, skips its decrement, and completes its flip
  without error
- AND exactly one decrement exists for the sale

#### Scenario: The charge-route happy path is unchanged apart from the marker

- GIVEN a token or order-flow charge that passes the R8–R14 gate and commits
- WHEN the transaction runs
- THEN `payments` insert, stock decrement, notifications and response behave exactly as published
- AND a `stock_movements` row with `sourceType: 'payments'` is committed in the same transaction

#### Scenario: A webhook-recorded payment fulfills without the charge route

- GIVEN Culqi captured a charge but the client's `/api/payment/charge` call failed, and the
  webhook's W-P3.1 upsert creates the `paid` `payments` row
- WHEN the webhook runs fulfillment after the row exists
- THEN exactly one decrement is recorded and that sale's claimable keys are marked fulfilled
  (including a `('payments', …)` claim row, which the charge transaction commits)
- AND a later charge-route replay of the same charge MUST NOT decrement again (its CAS claim
  returns 0 rows)

#### Scenario: A status-only order flip fulfils under the order key

- GIVEN an async order flipped `pending → paid` by the webhook without any `payments` row
- WHEN fulfillment runs
- THEN the sale's only resolvable key is `('payment_orders', order.id)`, and the CAS claim uses it
- AND no `payments` row is created by fulfillment or by the webhook (W-P3.1 boundary preserved)

#### Scenario: A replayed paid event does not double-decrement

- GIVEN a `paid` webhook event delivered twice for the same payment or order
- WHEN both deliveries run fulfillment
- THEN the second claim observes 0 rows and no second decrement occurs

#### Scenario: Insufficient stock is loud, non-fatal, and terminal

- GIVEN a fulfilled sale whose product has less stock than the snapshot quantity
- WHEN the conditional decrement matches 0 rows
- THEN the payment stays recorded as paid, stock never goes negative, and an alert identifies the
  business, product and source
- AND the backstop MUST NOT re-attempt this sale on every run

#### Scenario: One sale has one `payments` row, whichever writer arrives first

- GIVEN an order-backed sale whose `payment_orders` row exists and whose `payments` row was written
  by the charge route with the order id in `culqi_order_id` and no charge id
- WHEN the webhook's `charge.paid` handler runs for that sale's charge id
- THEN it MUST resolve the sale's existing `payments` row instead of inserting a second one
- AND the row's missing charge id MUST be backfilled, never duplicated
- AND the sale MUST still have exactly one `payments` row

#### Scenario: A charge id is never used as an order id

- GIVEN any persisted sale id
- WHEN it is written to or read from `payments`
- THEN the order id lives only in `culqi_order_id` and the charge id lives only in `culqi_charge_id`
- AND a lookup that needs an order id MUST NOT fall back to the charge id

#### Scenario: The claim set is the sale's, not the trigger's

- GIVEN an order-backed sale whose `payment_orders` key was already claimed
- WHEN the backstop and the webhook's charge branch both attempt fulfillment for that sale
- THEN both MUST derive the same ordered key set — `('payment_orders', …)` first, then
  `('payments', …)` — from the resolved sale identity
- AND neither may derive a payments-only key set for that sale
- AND exactly one decrement exists for the sale

#### Scenario: The backstop never sees an order-backed sale as two sales

- GIVEN one `payments` row linked to one `payment_orders` row by the same-kind order id
- WHEN the backstop evaluates its candidate set
- THEN the sale MUST be collected once, not once per side
- AND one claim and one decrement MUST result

#### Scenario: A webhook that cannot attribute the charge creates no row

- GIVEN a `charge.paid` event that carries no business metadata and no order link
- WHEN the webhook handles it
- THEN no `payments` row may be created for it
- AND the event is still acknowledged, and the sale remains eligible for the order flip or the
  backstop

### Requirement: R3 — Missing snapshot (B1): decrement qty = 1 and alert; product-less paid orders have no stock effect

When a post-deployment paid row (candidate set bounded per R7) is product-bound but no snapshot is
recoverable — legacy metadata, a webhook payload without usable `metadata`, a corrupted snapshot —
the system MUST:

1. decrement the bound product by **`qty = 1`** (the honest minimum: single-product sales are the
   norm), via the same conditional, business-scoped idiom; AND
2. emit a structured alert identifying the business, product and payment/order source.

It MUST NOT fail the payment (Culqi already captured the money; throwing cannot undo that), and it
MUST NOT silently skip — a silent skip is exactly the NEW-8 drift this change exists to close.

"Product-bound" means the row carries a product reference the system can act on: `payments.productId`
(charge path — always present on webhook-created rows, since `buildWebhookPaymentValues` returns
`null` without it), or an order snapshot / `metadata.productId` binding (order path).

A **product-less** paid order — permitted by R13, which explicitly accepts an order with no usable
`metadata.productId` — has **NO stock effect**: no product is decremented, no quantity is guessed.
Only a log line is emitted, and the attempt MUST be recorded as terminal so the backstop does not
re-process it every run.

The alert MUST be observable with its identifiers intact: the structured logger's `scrubPII` mangles
UUIDs (B-07, out of scope), so alerts MAY reuse the existing non-scrubbed `console.error` idiom the
charge route already uses for oversold alerts (`charge/route.ts:624-638`); upgrading them to the
structured logger is blocked on B-07 and MUST NOT be attempted here.

#### Scenario: A paid product-bound row without a snapshot decrements one and alerts

- GIVEN a post-deployment `payments` row with `status: 'paid'` and a `productId`, whose charge
  metadata carried no usable `qty`
- WHEN fulfillment runs (trigger or backstop)
- THEN `products.stock` for that business-scoped product decreases by exactly 1
- AND a structured alert identifies the business, product and source
- AND no error is thrown and the payment row stays `paid`

#### Scenario: A missing snapshot never fails the payment

- GIVEN the same row, processed by the webhook path
- WHEN fulfillment completes under B1
- THEN the webhook still acknowledges with `{ received: true }` / 200
- AND the payment's `paid` state is unaffected

#### Scenario: A product-less paid order has no stock effect

- GIVEN a paid `payment_orders` row with neither a snapshot nor a usable `metadata.productId` —
  the legitimate product-less order R13 permits
- WHEN fulfillment runs
- THEN no `products` row is updated and no quantity is guessed
- AND a log line records the no-product outcome, recorded as terminal for the backstop

### Requirement: R4 — The reconcile backstop MUST re-attempt fulfillment AND actually be scheduled

The reconcile cron (`app/api/cron/reconcile-payments/route.ts`, `CRON_SECRET`-guarded) MUST
re-attempt fulfillment for every candidate paid row (post-deployment set per R7) whose **entire
resolvable key set is unclaimed**: `payments` rows with `status: 'paid'`, and `payment_orders` rows
with `status: 'paid'` — each via the same shared helper and CAS as every other trigger. This covers
webhook downtime, a crash between upsert and claim, and any transient fulfillment failure.

The candidate predicate MUST be expressed over the sale's keys, not over one row in isolation. A
row MUST be selected as a candidate only when NO `stock_movements` entry exists for ANY key that
sale resolves to (R2's ordered set) — otherwise a sale whose `payment_orders` key was already
claimed could be re-selected merely because no `('payments', …)` row exists for it. The backstop
MUST NOT pre-filter on one source type and MUST NOT decrement directly: it delegates every claim to
the shared helper, so an already-claimed key still blocks it. (The `NOT EXISTS` form is
load-bearing for a second reason: the paid set grows forever, so attempting CAS on
already-fulfilled history would starve the bounded candidate window.)

The sale's key set MUST be resolved through the **kind-correct persisted link** (R2): a `payments`
row and a `payment_orders` row describe the same sale only when they share the same order id within
the same business. The backstop MUST resolve that link the same way every other trigger resolves it,
so all of them judge the same sale identically. A candidate set MUST NOT contain the same sale twice
— once through its `payments` side and once through its `payment_orders` side — because the second
occurrence would attempt a second claim for a sale the first occurrence already claimed.

The settlement pass (pending → paid) MUST cover both id kinds: a pending sale is settled by reading
its charge when it has a known charge id, and by reading its order state when it does not. A pending
order-backed sale MUST NOT be left pending forever merely because it has no charge id yet.

A backstop that no scheduler invokes is not a backstop. Therefore the deployment configuration
(`vercel.json`) MUST contain a `crons` entry invoking the reconcile route. Today `vercel.json`
carries no `crons` block at all (evidence: `vercel.json` is `{ framework, installCommand,
buildCommand }` only), so the endpoint is dormant; scheduling it is in scope for this change, at a
cadence the deployed Vercel plan supports (exact schedule decided in design).

The cron's existing auth (`x-cron-secret` vs `CRON_SECRET`, timing-safe compare) and its age guard
for `pending` rows are unchanged; fulfillment candidates are a separate, additional pass — the
cron MUST NOT settle `pending` payments into `paid` (that remains Culqi's truth via the existing
read).

#### Scenario: The backstop fulfills a paid row the webhook never reached

- GIVEN a post-deployment `payments` row at `status: 'paid'` with no `stock_movements` entry and a
  recoverable snapshot
- WHEN the reconcile cron runs
- THEN the shared helper claims and applies exactly one decrement for that source
- AND a subsequent cron run finds the entry and skips it

#### Scenario: The backstop is scheduled

- GIVEN the repository's deployment configuration
- WHEN `vercel.json` is inspected
- THEN a `crons` entry exists that targets the reconcile route
- AND an unscheduled endpoint does not satisfy this requirement

#### Scenario: The backstop never double-fulfills

- GIVEN a paid row whose sale already has its `stock_movements` claim recorded
- WHEN the cron runs
- THEN the row is not selected as a candidate, or its CAS claim returns 0 rows
- AND no decrement is applied

#### Scenario: A sale claimed under one key is not re-selected because its other key is unclaimed

- GIVEN an order-backed sale whose `payment_orders` key was already claimed and decremented
- AND the same sale's `payments` row has no `('payments', …)` claim row
- WHEN the cron evaluates candidates
- THEN that sale is NOT selected, because a claim exists for one of its resolvable keys
- AND no second decrement occurs

#### Scenario: An order-backed sale is one candidate, not two

- GIVEN a `payments` row and a `payment_orders` row that describe the same sale through the
  same-kind order id, and no claim exists yet for that sale
- WHEN the backstop evaluates candidates
- THEN the sale is collected once, not once per side
- AND one claim and one decrement result

### Requirement: R5 — Every fulfillment read/update MUST be business-scoped and MUST assert affected rows via `.returning()`

Every database read or write performed on behalf of fulfillment — the snapshot read, the CAS claim,
the `products` decrement — MUST be scoped by `businessId`. Fulfillment for a tenant MUST NEVER
address another tenant's products, even given a valid foreign `sourceId`; a cross-tenant id simply
matches 0 rows and nothing moves.

Affected-row observation MUST use the `.returning()` idiom and assert on the returned rows (the
R10 discipline, `charge/route.ts:570-578`). Reading `rowCount` is forbidden for fulfillment
decisions: the `drizzle-orm/postgres-js` DML result exposes `count`/`command` and never `rowCount`,
so a `rowCount` check is `undefined`-based and fails open. The claim CAS uses
`INSERT … ON CONFLICT DO NOTHING … RETURNING` for the same reason — the returned row IS the
affected-row assertion.

For the order path, where the Culqi event carries only the `culqiOrderId`, the trigger MUST obtain
the `businessId` from the order row it just identified (via `.returning()` on the flip) and pass it
to the helper; fulfillment MUST NOT trust any business id that did not come from the database row.

The sale identity a trigger resolves MUST be business-scoped end to end (R2): the resolver's reads,
the sibling link it follows, and the decrement it authorizes all use the same business id, taken from
a database row. A sale id that resolves only under another business's scope resolves to nothing, and
the trigger MUST fail closed — no key set, no claim, no decrement — rather than fall back to an
unscoped read.

#### Scenario: A cross-tenant source cannot decrement another tenant's stock

- GIVEN a fulfillment call whose product id belongs to business B while the resolved
  `businessId` is business A
- WHEN the shared helper runs
- THEN the decrement matches 0 rows, no stock changes for either tenant, and the outcome is
  treated as "no movement applied" — never as a silent success against B's row

#### Scenario: Affected rows are asserted through returned rows, never rowCount

- GIVEN any fulfillment write
- WHEN its outcome is evaluated
- THEN the decision is based on rows returned by `.returning()` / the CAS insert
- AND `rowCount` is never read anywhere in the fulfillment path

#### Scenario: A sale id from another tenant resolves to nothing

- GIVEN a fulfillment call whose order id belongs to business B while the resolved `businessId` is
  business A
- WHEN the sale identity is resolved
- THEN no row is resolved, no key set is produced, and no claim and no decrement occur

### Requirement: R6 — Snapshot quantity is trusted only through `validateAmount`'s server-side reconciliation

Quantity is client-influenced by construction (the storefront collects it), so it MUST NOT become a
free knob. The snapshot quantity is trusted in exactly one way — the way `validateAmount` already
trusts it: the server derives the authoritative amount from DB prices (`secondPrice ?? price`,
business-scoped via `eq(businessId)` + `inArray`) over the `{ id, quantity }[]` cart and requires
`DB-derived price × quantity (in céntimos) == client amount`
(`validateAmount.ts:35-71`). This change reuses that source; it MUST NOT invent a parallel bound
(max-quantity table, separate cap logic, a second price lookup).

Concretely:

- The charge path already satisfies this: `charge/route.ts` calls `validateAmount` with
  `metadata.cartItems` before any Culqi call, so a tampered quantity cannot survive without a
  matching (i.e., correctly-priced) amount.
- `create-order` MUST gain the same treatment when a snapshot is present: its amount check MUST
  pass the incoming `cartItems` to `validateAmount` (today it calls it without `cartItems`, so the
  reconciliation covers only the single `productId` line). A snapshot the amount check does not
  cover MUST be rejected before the Culqi order is created.
- The token-flow `qty` sent to Culqi MUST be derived from that same validated cart — the quantity
  of the bound `productId` within it — so the webhook-recoverable `qty` is the quantity that was
  reconciled, never a raw client field.

An amount/quantity mismatch MUST be rejected with the existing 400 validation contract before any
external call, exactly as `validateAmount` failures are today.

#### Scenario: A tampered snapshot quantity is rejected before money moves

- GIVEN a `create-order` request whose `cartItems` quantity would make the DB-derived total
  differ from the requested `amount`
- WHEN the endpoint validates the request
- THEN it MUST return HTTP 400
- AND no Culqi order call occurs and no `payment_orders` row is persisted

#### Scenario: Fulfillment consumes only amounts that reconciled

- GIVEN any snapshot quantity that reaches fulfillment
- WHEN it is applied
- THEN that quantity is one for which `validateAmount` (or its identical derivation) previously
  reconciled DB price × quantity against the charged amount for the same business

#### Scenario: No parallel quantity bound is introduced

- GIVEN this change's validation surface
- WHEN it is reviewed
- THEN every quantity check routes through `validateAmount`'s DB-derived reconciliation
- AND no second price source or independent quantity cap exists

### Requirement: R7 — No retro-fulfillment: drift that predates this change MUST NOT be backfilled (Q7)

This change starts clean at deployment. Historical paid rows lack snapshots, and a mass
retro-decrement would zero stock for products that already sold correctly — so the system MUST NOT
backfill drift that predates the change:

- There MUST be NO one-shot backfill job, migration, or script that creates `stock_movements` or
  decrements stock for already-paid rows.
- All fulfillment triggers — including the R4 backstop — MUST bound their candidate set to paid
  transitions recorded **after** this change's deployment watermark (the watermark mechanism —
  e.g. the ledger migration timestamp — is decided in design, but it MUST be explicit and
  testable). Rows that were already `paid` when the change deployed are historical facts: no
  movement is created for them, ever, by any path in this change.
- B1 (R3) applies only **inside** the post-deployment candidate set: it rescues post-deploy sales
  whose snapshot proved unrecoverable; it is not a licence to decrement pre-deploy rows by 1.

#### Scenario: A pre-deployment paid row is never fulfilled

- GIVEN a `payments` (or `payment_orders`) row that was `paid` before the deployment watermark
- WHEN the reconcile cron or any trigger runs after deployment
- THEN no `stock_movements` row is created for it and no `products` stock changes
- AND it is skipped as history, not as a failure to retry

#### Scenario: The post-deploy boundary does not weaken B1

- GIVEN a post-deployment paid row with a product reference and no recoverable snapshot
- WHEN fulfillment runs
- THEN B1 applies: `qty = 1` + alert
- AND the watermark excludes only rows paid before deployment, not rows lacking snapshots after it

## Non-requirement obligations (no behavioral change)

- **New module, no new dependency.** The shared helper MUST live in `src/core/payments/` (proposal
  names `stockFulfillment.ts`), a new peer of `idempotency.ts` / `culqiOrders.ts`, so the charge
  route, the webhook and the cron all import the one implementation.
- **No new webhook side effects.** The webhook MUST NOT create missing `payments` rows and MUST NOT
  emit new notifications on fulfillment; if no row exists to hang fulfillment on, that remains the
  existing lost-confirmation behavior — not this change's problem to paper over.
- **`payments.status` is untouched.** The enum and its transitions (W-P6) are out of scope; the
  completion marker is the ledger, not a status value.
- **The `order-flow` V2 state machine and `seller-fraud-guards` are unchanged** (see contract map).

## Out of Scope

- Oversell **prevention** under concurrency — reservation/hold designs. This change guarantees
  exactly-once movement for a sale that was already recorded `paid`; it does not make concurrent
  checkouts safe against selling the last unit twice.
- The refund / backorder operational path. The ledger is shaped so it can host compensating
  movements later; no such movement or logic is specified here.
- **B-07**: the PII scrubber mangles UUIDs (`scrubPII` phone regex vs identifiers). Alerts reuse the
  existing `console.error` idiom instead; fixing the scrubber is not in this change.
- `payments.status` enum/transition redesign (W-P6).
- Creating missing `payments` rows from the webhook, or any new notification triggered by
  fulfillment.
- Any retro-fulfillment or stock correction for pre-deployment drift (forbidden by R7, not merely
  unspecified).
