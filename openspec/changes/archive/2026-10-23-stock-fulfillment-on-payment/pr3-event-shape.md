# PR3 Event Shape — Culqi Order Webhook → Row Recovery

**Change**: `stock-fulfillment-on-payment` (NEW-8), PR3 scope.
**Branch**: `feat/stock-fulfillment-triggers` @ `fe6e606` (= `origin/develop`).
**Status**: investigation only — no production code changed.
**Method**: static read of the webhook/charge/order code paths + read-only queries against the DEV and PROD databases + a rolled-back Drizzle probe + third-party Culqi documentation. Every claim below is labelled **code-derived**, **data-confirmed** or **assumption**.

---

## The question

Before PR3 can wire `order.status.changed` into the shared fulfillment helper, five facts must be pinned down:

1. What payload shape does the Culqi order event actually carry (order id, charge id), and how is it mapped to a `payment_orders` / `payments` row?
2. Which row does a Culqi **text** id resolve to, and is that lookup business-scoped?
3. Does the persisted metadata carry the **full cart array** (`metadata.cartItems`) or a **scalar `qty`**?
4. In the `order.status.changed` flip (`app/api/webhooks/culqi/route.ts:338-370`): what is updated, under which predicate, keyed by what, and does the `rowCount` check work?
5. Does the order flow create a `payment_orders` row **and** a `payments` row, or only one — and how are they linked?

---

## Answer 1 — The payload shape the webhook expects

**There is no `parsePaymentEvent` and no `resolvePaymentId` anywhere in the repository.** The parsing is inline in the webhook route, and there is exactly **one** identifier-resolution line for **every** event type.

| Concern | Answer | Evidence |
|---|---|---|
| Event envelope | `{ object: "event", id: "evt_...", type: "<event.type>", creation_date, data: { ...the affected resource... } }` | Cast inline at `app/api/webhooks/culqi/route.ts:280-294`; envelope shape from the Culqi webhook catalog (`api-evangelist/culqi`, `asyncapi/culqi-events-webhooks.yml:18-20`) |
| Order id | `data.id` → `ord_...` | `route.ts:340` (`const culqiOrderId = event.data?.id;`); `ord_test_xxxxxxxxxxxx` in the Culqi Order schema |
| Charge id | `data.charge_id ?? data.id` → `chr_...` | `route.ts:299` (`const chargeId = event.data?.charge_id ?? event.data?.id;`); `route.ts:129` (same idiom for refunds) |
| Single resolution for all events | `route.ts:299` | For `order.status.changed`, `data.charge_id` is absent, so the variable named `chargeId` actually holds the **ORDER** text id |
| Guard before the switch | `route.ts:301-303` | `if (!eventType || !chargeId) return NextResponse.json({ received: true });` — an order event with **no `data.id`** is silently dropped with HTTP 200, no log |
| Deduplication key | `route.ts:305` | `event.id ?? \`${eventType}:${chargeId}\`` → for order events without an `evt_` id the key is `order.status.changed:ord_...` |
| Row mapping — order events | `payment_orders` via `payment_orders.culqi_order_id` | `route.ts:362` |
| Row mapping — charge events | `payments` via `payments.culqi_charge_id` | `route.ts:190`, `:198`, `:231`, `:239` |
| `payments` row for order events | **Never** — the order branch does not touch `payments` | `route.ts:338-370` (the whole branch) |
| `payment_orders` row for charge events | **Never** — the charge branch does not touch `payment_orders` | `route.ts:173-242` (the whole function) |

**Row mapping, concretely:**

- `order.status.changed` → `UPDATE payment_orders WHERE culqi_order_id = <ord_… text id>` (`route.ts:359-362`). This path **never creates or updates a `payments` row** — the reason design D1 (`design.md:22`) chose a two-source-type ledger instead of a `payments.stock_fulfilled_at` marker column, and the reason spec R2 keeps a "status-only order flip" scenario (`specs/stock-fulfillment/spec.md:190-195`).
- `charge.paid` / `charge.failed` → `INSERT … ON CONFLICT (payments.culqi_charge_id) DO UPDATE` (`route.ts:235-241`) or `UPDATE payments WHERE culqi_charge_id = <chr_…>` (`route.ts:194-198`). This path **never touches `payment_orders`**.

### 1a. The `data.status` assumption (highest-impact finding)

The handler reads the order's payment state from **`data.status`** (`route.ts:339`). Three independent sources say the Culqi **order** resource has no `status` field:

1. **This repo's own contract** — `src/core/payments/culqiOrders.ts:24-26` and `:88-101`:
   > *"Mirrors Culqi's real ORDER object: an order has NO `status` field. `status` / `paid` belong to the CHARGE object."* … *"There is deliberately NO `status` here. An earlier revision of this contract read `status` because this repo's POST create-order handler and its webhook touch that name — but on the CHARGE object, where `status`/`paid` really live. On an order, a `status` key is fiction: it filters out as `undefined` and silently proves nothing."*

   `isCulqiOrderPaid` (`culqiOrders.ts:107-111`) therefore reads **`order.state === 'paid'` OR a non-null `paid_at`**.

2. **The Culqi Orders resource schema** (derived from Culqi's docs, `api-evangelist/culqi` → `openapi/culqi-orders-api-openapi.yml:156-176`): the `Order` object has `id` (`ord_test_xxxxxxxxxxxx`), `state` (example `created`), `order_number`, `cip_code`, `expiration_date`, `metadata`, `amount`, `currency_code` — and **no `status` property at all**.

3. **The envelope contract** — `data` is *"…the affected resource…"* (`asyncapi/culqi-events-webhooks.yml:18-20`). For `order.status.changed` the affected resource is the Order, so `data.state` is the state field.

**Where the wrong assumption came from.** The handler was added in a single commit with **no captured payload fixture**: `df4ba6a feat(culqi): add order.status.changed handler to webhook route` (2026-06-05), which introduced `data.status?: string` into the event cast and the `statusMap` in one edit. The `status` name plausibly leaked from the **client-side** Culqi Checkout object — `src/types/culqi.d.ts:52-61` (`CulqiOrderResult { id; status; … }`) and `src/features/payment/hooks/useCulqiCallback.ts:150` (`if (order.status === 'paid')`) — which is a *different object* from the API order resource.

**Consequence if `data.status` is absent (the likely case):** `route.ts:339` → `undefined` → the guard at `route.ts:342-345` fires → `console.warn('[culqi-webhook] Missing order ID or status in order.status.changed')` → `break` → HTTP 200, **no flip**. The order-flow sale then depends entirely on the charge route's own flip (`charge/route.ts:588-606`).

> **Label: strong evidence, not proof.** The repo contains **zero** real captured Culqi webhook payloads (see Answer 5's "empirical limits"), and Culqi does not publish an enumerated webhook payload schema — the catalog states *"Culqi does not publish an AsyncAPI document"* and *"the exhaustive enumerated list lives in the CulqiPanel event-type picker"*. PR3 must accept **both** `data.state` and `data.status`, and fail closed (deny unless the state is provably `paid`).

---

## Answer 2 — Which row a Culqi text id resolves to, and business scoping

### The `order.status.changed` path resolves **no `payments` row at all**

It resolves a **`payment_orders`** row, by the Culqi **text** id:

```ts
// app/api/webhooks/culqi/route.ts:359-362
.where(eq(paymentOrders.culqiOrderId, culqiOrderId))
```

- **Business scoping: NONE.** The predicate contains only `culqi_order_id`. No `businessId` term is present, and the handler never reads `businessId` from the row.
- The handler never resolves `payment_orders.id` (the DB uuid), so it cannot hand a uuid to the ledger. The only key it owns is a Culqi text id.
- Today this is not an exploitable cross-tenant write, because `culqi_order_id` is `UNIQUE` globally (`src/core/database/schema/orders.ts:321`) — at most one row can match. But it **violates** `stock-fulfillment` R5 (*"Every fulfillment read/update MUST be business-scoped"*, `specs/stock-fulfillment/spec.md:320-336`) and it **fails R5's other half**: *"the trigger MUST obtain the `businessId` from the order row it just identified (via `.returning()` on the flip) and pass it to the helper; fulfillment MUST NOT trust any business id that did not come from the database row."* The current handler has no way to do that.
- Design D8 (`design.md:29`) already prescribes the rewrite: pre-read → business-scoped flip with `.returning({id, businessId, metadata})` → `FlipMissedError`.

### The charge path resolves the `payments` row by text id — also unscoped

```ts
// app/api/webhooks/culqi/route.ts:189-192
const existing = await db.query.payments.findFirst({
  where: eq(payments.culqiChargeId, chargeId),
  columns: { id: true },
});
```

- **Business scoping: NONE.** Same shape as the order path: the predicate is the text id alone, and it is unique (`orders.ts:59`, `culqi_charge_id` `.unique()`), so at most one row matches globally.
- In the INSERT branch the business is **derived from the webhook payload**, not from a DB row: `route.ts:202-207` reads `data.metadata.businessId` and `route.ts:209-214` resolves the owner from it. That is the payload, not the database — the opposite of what R5 demands for fulfillment.

### What the text id actually holds — the decisive detail

`payments.culqi_charge_id` stores **whatever text id the charge route was handed**. For the **order flow** that is the Culqi **ORDER** id:

```ts
// app/api/payment/charge/route.ts:546
const culqiChargeId = culqiOrderId || culqiData?.id || null;
…
culqiChargeId,            // app/api/payment/charge/route.ts:558
```

So an order-flow sale stores:

```
payment_orders.culqi_order_id  = 'ord_…'      ← text, unique
payments.culqi_charge_id       = 'ord_…'      ← the SAME text, NOT 'chr_…', NOT a uuid
```

There is **no foreign key** between the two tables (`payments` has no `payment_orders` reference, `orders.ts:41-130`). The only link is **string equality of the same Culqi text id**.

Consequences:

- A `charge.paid` webhook carrying `data.id = 'chr_…'` will **not** find an order-flow `payments` row (its key is `ord_…`).
- A `charge.paid` carrying `data.id = 'ord_…'` **would** match it — the charge path's `findFirst` has no way to tell an order id from a charge id.
- The DB uuid of `payment_orders.id` and the DB uuid of `payments.id` are **unrelated to each other** and unrelated to either Culqi text id.

---

## Answer 3 — Full cart array or scalar `qty`?

**Both exist, in two deliberately non-interchangeable channels.** This is the R1 contract (`specs/stock-fulfillment/spec.md:34-58`).

| Flow | Channel | Shape | Written by |
|---|---|---|---|
| Order flow | `payment_orders.metadata.cartItems` | **full array** `{ id: uuid, quantity: int ≥ 1 }[]` | `app/api/payment/create-order/route.ts:253-264` |
| Order flow (side effect) | `payments.metadata.cartItems` | **full array** `{ id, quantity }[]` | `app/api/payment/charge/route.ts:574-578` |
| Token/card flow | Culqi **charge** `metadata.qty` | **scalar** `int ≥ 1` | `app/api/payment/charge/route.ts:184` |
| Webhook-created `payments` row | `payments.metadata.qty` | **scalar** `int ≥ 1` (or absent) | `src/core/payments/webhookPaymentValues.ts:131` |

**Order flow — full array, in `payment_orders.metadata`:**

```ts
// app/api/payment/create-order/route.ts:253-264
metadata: {
  culqiRaw: { orderId: culqiData.id, orderNumber: culqiData.order_number, createdAt: … },
  …(cartItems !== undefined ? { cartItems } : {}),
},
```

`cartItems` is the Zod-validated request body (`create-order/route.ts:60-79`), typed by `createOrderRequestSchema.cartItems` (`src/features/billing/schemas.ts:87`) → `cartItemsSchema` (`schemas.ts:20-25`):

```ts
export const cartItemsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    quantity: z.number().int().min(1).default(1),
  }),
);
```

Zod **strips unknown keys** (`schemas.ts:17-18`), so only `{ id, quantity }` is persisted — `name`/`price`/`stock` never reach the DB. `create-order` also revalidates the amount against that cart (`create-order/route.ts:87-98` → `validateAmount({ productId, businessId, clientAmount: amount, cartItems })`).

**Order flow — the same full array also lands on the `payments` row.** The charge route stores the whole validated request metadata:

```ts
// app/api/payment/charge/route.ts:574-578
metadata: {
  ...metadata,                    // ← validated charge metadata, cartItems included
  culqiId: culqiChargeId,
  …(customerAuth ? { customerAuth } : {}),
},
```

and `chargeRequestSchema.metadata.cartItems` is the same `cartItemsSchema` (`schemas.ts:59`).

**Token flow — scalar only, and it travels to Culqi, not to our row:**

```ts
// app/api/payment/charge/route.ts:466-470
const boundQty =
  metadata?.cartItems?.find((i: { id: string; quantity: number }) => i.id === productId)
    ?.quantity ?? 1;

// app/api/payment/charge/route.ts:184  (body of POST https://api.culqi.com/v2/charges)
metadata: { businessId, productId, platform: 'store-lite', qty },
```

A webhook-created `payments` row can therefore only ever carry the scalar — the builder's return type has no other metadata shape:

```ts
// src/core/payments/webhookPaymentValues.ts:54-55
/** Scalar quantity echoed by the charge route (`metadata.qty`, A2). */
metadata?: { qty: number };

// src/core/payments/webhookPaymentValues.ts:131
…(qty !== null ? { metadata: { qty } } : {}),
```

**`payment_orders.metadata` never carries a scalar `qty`** — the order channel is array-only by contract.

### Empirical confirmation (DEV)

| Metric | Value |
|---|---|
| `payments` rows | 89 |
| `payments` with `metadata ? 'cartItems'` | **89 / 89** |
| `payments` with `metadata ? 'qty'` | **0 / 89** |
| `payments` with `culqi_charge_id LIKE 'chr%'` | 89 / 89 |
| `payments` with `culqi_charge_id LIKE 'ord%'` | **0 / 89** |
| `payment_orders` rows | **0** |

⚠️ The 89 stored `cartItems[]` entries have keys `id, name, price, quantity` — the **pre-slice-2** shape, because those rows predate the Zod strip (commit `b877a51 feat(payments): persist durable cart quantity snapshots for both payment flows`). The **current** contract persists `{ id, quantity }` only. The DB proves the historical shape; `schemas.ts:20-25` proves the current one.

---

## Answer 4 — The `order.status.changed` flip, line by line

The block is `app/api/webhooks/culqi/route.ts:338-370`.

```ts
338:      case 'order.status.changed': {
339:        const orderStatus = event.data?.status;
340:        const culqiOrderId = event.data?.id;
341:
342:        if (!culqiOrderId || !orderStatus) {
343:          console.warn('[culqi-webhook] Missing order ID or status in order.status.changed');
344:          break;
345:        }
346:
347:        const statusMap: Record<string, OrderStatus> = {
348:          paid: 'paid',
349:          expired: 'expired',
350:          cancelled: 'cancelled',
351:        };
352:
353:        const mapped = statusMap[orderStatus];
354:        if (!mapped) {
355:          console.warn(`[culqi-webhook] Unknown order status: ${orderStatus}`);
356:          break;
357:        }
358:
359:        const result = (await db
360:          .update(paymentOrders)
361:          .set({ status: mapped, updatedAt: new Date() })
362:          .where(eq(paymentOrders.culqiOrderId, culqiOrderId))) as unknown as {
363:          rowCount: number;
364:        };
365:
366:        if (!result?.rowCount || result.rowCount === 0) {
367:          console.warn(`[culqi-webhook] Order not found in DB: ${culqiOrderId}`);
368:        }
369:        break;
370:      }
```

| Question | Answer |
|---|---|
| **What is updated** | `payment_orders.status` + `payment_orders.updated_at` **only**. `payments` is never written, and no `payments` row is created. |
| **Predicate** | `eq(paymentOrders.culqiOrderId, culqiOrderId)` — **no `businessId` term**. Not business-scoped. |
| **Key** | The Culqi **text** id `ord_…`. The DB uuid `payment_orders.id` is never resolved. |
| **Transaction** | **None.** A bare `db.update()`, outside any `db.transaction`, not combined with any fulfillment write. |
| **`.returning()`** | **Not used.** |
| **Status mapping** | `{paid, expired, cancelled}` → `OrderStatus` = `orderStatusEnum` = `['pending','paid','expired','cancelled']` (`src/core/database/schema/enums.ts:149`, `types.ts:17`). `pending` is never a target. |
| **`rowCount`** | **Never exists on this result.** See below. |

### The `rowCount` check is dead code — it always warns

`src/core/database/client.ts` uses Drizzle's **postgres-js** driver. The DML result of `db.update(...).where(...)` is a postgres-js `Result`, which exposes **`count`**, not `rowCount`.

**Rolled-back probe against DEV** (throwaway script, transaction deliberately aborted with `ROLLBACK_PROBE`):

```
=== zero-row update (payment_orders WHERE status='pending') ===
typeof result            : object
Object.keys(result)      : []
own "rowCount" in result : false
result.rowCount          : undefined
result.count             : 0
result.command           : UPDATE
result.constructor.name  : Result
.returning() rows length : 0

=== MATCHING update (payments SET status='paid' WHERE status='paid') ===
own "rowCount" in result : false
result.rowCount          : undefined
result.count             : 27 <- real affected-row count
result.command           : UPDATE
.returning() rows length : 27 <- real affected-row count
```

Therefore `route.ts:366`:

- `result.rowCount` is `undefined` → `!result?.rowCount` is **`true`** → the `console.warn('[culqi-webhook] Order not found in DB: …')` fires on **every** order event, including successful 27-row-style updates.
- A genuine miss (0 matched rows) is **indistinguishable** from a success — the signal is 100% noise.

The unit test cannot catch this: `tests/unit/webhookOrderStatus.test.ts:62` mocks `mockWhere.mockResolvedValue({ rowCount: 1 })`, a shape postgres-js never produces.

`stock-fulfillment` R5 already forbids this exact pattern (*"Reading `rowCount` is forbidden for fulfillment decisions … a `rowCount` check is `undefined`-based and fails open"*, `specs/stock-fulfillment/spec.md:327-332`), and design D3 records it (*"`rowCount` is `undefined` on postgres-js"*, `design.md:24`).

### What else the flip is missing for PR3

No pre-read (so no `businessId`, no `metadata`, no `updatedAt` for the R7 watermark predicate), no `db.transaction`, no `.returning()`, no `FlipMissedError`, no `fulfillPaidSale` call, and no `payments` resolution.

---

## Answer 5 — Does the order flow create one row or two?

**Two rows. Linked only by string equality of the same Culqi text id.**

### The order flow (async Culqi Órdenes)

1. **`POST /api/payment/create-order` → INSERT `payment_orders`** (one row).
   `app/api/payment/create-order/route.ts:239-266`
   - `id` = DB uuid (`orders.ts:317`)
   - `culqiOrderId = culqiData.id` = `ord_…` (`create-order/route.ts:243`)
   - `status: 'pending'` (`:246`)
   - `metadata.cartItems` = full array (`:263`)

2. **Buyer pays in Culqi Checkout → client calls `POST /api/payment/charge` with `culqiOrderId`.**
   `src/features/payment/hooks/useCulqiCallback.ts:147-175` (`handleCulqiOrder` → `chargePayment({ culqiOrderId: order.id, … })`)

3. **`POST /api/payment/charge` (order branch).**
   - Business-scoped pre-read of the order row: `charge/route.ts:344-357` (`culqi_order_id` **AND** `business_id`).
   - Amount/currency/product binding gates: `charge/route.ts:373-409`.
   - Verifies Culqi really captured the money: `charge/route.ts:436-438` → `isCulqiOrderPaid(await getCulqiOrder(culqiOrderId, secretKey))`.
   - **INSERT `payments`** (one row): `charge/route.ts:549-581` — `culqiChargeId = culqiOrderId` (`:546`, `:558`), `status: 'paid'` (`:563`), `metadata` = full charge metadata incl. `cartItems` (`:574-578`).
   - **UPDATE `payment_orders` → `'paid'`**, business-scoped, with `.returning()`:
     ```ts
     // app/api/payment/charge/route.ts:589-604
     .where(and(eq(paymentOrders.culqiOrderId, culqiOrderId), eq(paymentOrders.businessId, businessId)))
     .returning({ id: paymentOrders.id });
     if (flipped?.length !== 1) throw new Error('payment_orders flip affected no row');  // fail closed
     ```
     → `paymentOrderId = flipped[0].id` (`:605`) — **the DB uuid**.
   - Builds the fulfillment anchor with **both** uuids: `charge/route.ts:623-629` → `{ paymentOrderId, paymentId: payment.id, businessId, culqiOrderId }`.

4. **`resolveClaimKeys` claims the ordered key set** — `payment_orders` first, then `payments`:
   `src/core/payments/stockFulfillment.ts:123-139`.

```
payment_orders.id   (uuid A)  ─┐
                                ├─ linked ONLY by  payment_orders.culqi_order_id
payments.id         (uuid B)  ─┘   =  payments.culqi_charge_id  =  'ord_…'
```

`uuid A ≠ uuid B`, and neither equals `'ord_…'`.

### The other two flows, for contrast

| Flow | Rows created |
|---|---|
| **Order flow** | `payment_orders` (pending → paid) **and** `payments` (paid) — **two** |
| **Token/card flow** | `payments` only — the `payment_orders` flip is guarded by `if (culqiOrderId)` (`charge/route.ts:588`) |
| **Status-only webhook flip** | `payment_orders` only — **no** `payments` row is created or updated (`route.ts:338-370`; design D1 `design.md:22`; spec R2 `specs/stock-fulfillment/spec.md:190-195`) |

### Empirical limits (important)

| Check | DEV | PROD |
|---|---|---|
| `payment_orders` rows | **0** | **0** |
| `payments` rows | 89 | **0** |
| `payments` ⨝ `payment_orders` on `culqi_charge_id = culqi_order_id` | **0** | 0 |
| `order_events` rows | **0** | **0** |

- **Neither database contains a single order-flow sale.** Every order-flow fact above is **code-derived**.
- `order_events` is **not** a webhook archive — it is a status-change audit trail (`orders.ts:133-151`: `payment_id`, `from_status`, `to_status`, `triggered_by`, `reason`) and **nothing in `src/` ever inserts into it** (grep: no `insert(orderEvents)` anywhere). It is a dead table and cannot be mined for payloads.
- All `ord_…` identifiers in the repo are **fabricated test fixtures** (`tests/unit/*`); there is no captured production payload to compare against.

---

## Recovery design implication

**Row/id recovery must key on the sale's ordered key set — `payment_orders` uuid first, then `payments` uuid — because every trigger must resolve the SAME set for the CAS to have exactly one winner.**

This is the N1 contract already written into the change:

- `specs/stock-fulfillment/spec.md:105-118` — *"The claim MUST therefore cover the sale's **entire resolvable key set, in a fixed order: `payment_orders` first, then `payments`**"* … *"The fixed order is normative: no path may lock `payments` before `payment_orders`, so concurrent triggers cannot deadlock."*
- `design.md:25` (D4) — *"**Canonical two-key claim** … For every sale, claim **all resolvable keys in fixed order: `payment_orders` first, then `payments`**"* … *"Claiming po-first makes every order-backed path collide on the same first key ⇒ exactly one winner (R2)."*
- `src/core/payments/stockFulfillment.ts:123-139` (`resolveClaimKeys`) — the implemented order.
- `design.md:82-87` — the cross-key race D4 kills: without a canonical order, the charge tx claims `payments` ✓ and a later flip claims `payment_orders` ✓ ⇒ **two** decrements for one sale.

### What the current flip must change to satisfy N1

| # | Requirement | Current state | Required change (design D8) |
|---|---|---|---|
| 1 | Resolve the sale's **DB uuids**, not a text id | `route.ts:362` keys the UPDATE on `culqi_order_id`; `payment_orders.id` is never resolved | Pre-read `paymentOrders.findFirst({ where: eq(culqiOrderId) })` → `{ id, businessId, metadata, status, updatedAt }` |
| 2 | Claim **`payment_orders` first** | No claim at all | `fulfillPaidSale({ paymentOrderId: flipped.id, paymentId: <resolved>, businessId: row.businessId, culqiOrderId })` → `resolveClaimKeys` pushes `('payment_orders', …)` first |
| 3 | Resolve the **matching `payments` row** | Never attempted | `payments.findFirst({ where: and(eq(payments.culqiChargeId, <same ord_… text id>), eq(payments.businessId, row.businessId)) })` — the text id is the **only** link (Answer 2) |
| 4 | **Business scope** on every read/write | None (`route.ts:362`) | Scope the flip and the `payments` lookup by the **DB-derived** `businessId` (R5) |
| 5 | **Atomic** claim + decrement + flip | Not transactional | `db.transaction` around flip + `fulfillPaidSale(anchor, snapshot, tx)` |
| 6 | **`.returning()`-asserted** affected rows | `rowCount` cast (always `undefined`) | `.returning({ id, businessId, metadata })`; `length !== 1` ⇒ `FlipMissedError` ⇒ rollback + warn + 200 |
| 7 | **Fail closed** on a miss | Warns on every event (noise) | Warn only when the row is genuinely absent (exact string `'Order not found in DB: …'` preserved) |

### Rules the recovery must obey

1. **A Culqi text id is a resolution hint, never a claim key.** `stock_movements.source_id` is a `uuid` column (`design.md:151-159`); a text id would crash the insert. `stockFulfillment.ts:117-121` and `tests/unit/chargeRoute.test.ts:1444` (`expect(sourceId.startsWith('ord_')).toBe(false)`) pin this.
2. **The `payments` row for an order-backed sale must be found by the ORDER text id** (`payments.culqi_charge_id = 'ord_…'`, `charge/route.ts:546` + `:558`) — **not** by a `chr_…` id. A `payments` row keyed by `chr_…` belongs to a *different* (token) sale and must never be paired with this order.
3. **If no `payments` row resolves, the sale's only key is `('payment_orders', po.id)`** — still a valid N1 claim (`specs/stock-fulfillment/spec.md:115-116`: *"a status-only flip with no `payments` row has no `payments` key"*). The claim must not be abandoned for lack of a second key.
4. **Both slots are claimed in one call.** The first successful claim authorizes exactly one decrement; further keys are recorded in the same fulfillment and MUST NOT decrement again (`specs/stock-fulfillment/spec.md:110-112`).
5. **The charge route already claims `payment_orders` first** (`charge/route.ts:623-629` → `resolveClaimKeys`). PR3 must not introduce a second, differently-ordered path — that is precisely the cross-key race D4 exists to kill.
6. **The snapshot comes from `payment_orders.metadata.cartItems`** (full array, `create-order/route.ts:263`) — the flip's own row. The scalar `qty` channel belongs to the token flow and must not be read from an order row (`specs/stock-fulfillment/spec.md:52-54`).
7. **Both the flip and the backstop must select candidates by the sale's key set, not by one row in isolation** (`specs/stock-fulfillment/spec.md:270-277`) — a sale already claimed under `payment_orders` must not be re-selected because its `payments` slot is unclaimed.

### Two open items that block PR3 from being *correct* (not merely *green*)

| # | Item | Why it blocks | Where it is tracked |
|---|---|---|---|
| A | The order event's state field is `state` (or `status`?) | If it is `state`, the current handler never flips anything and PR3 would wire a dead branch. PR3 must read **both** and fail closed | `design.md:207` Risk 1; `design.md:218` Open Question 2 |
| B | Does Culqi emit `charge.paid` for Órdenes-backed charges, and does the payload carry `order_id`? | If yes, a `chr_`-keyed `payments` upsert could create a **third** claim key outside the `payment_orders → payments` pair ⇒ double decrement | `design.md:207` Risk 1 (mitigation: resolve the order via `event.data.order_id \|\| row.culqiChargeId`, D9 `design.md:30`) |

Neither is resolvable from the repository or the databases (no real payload exists anywhere). They must be settled from a real CulqiPanel delivery log — or PR3 must be written to be safe **without** settling them (read `state` **or** `status`; resolve the order by `data.order_id ?? data.id`; scope every read by a DB-derived `businessId`).

---

## Appendix A — Raw evidence

### A.1 Branch / commit provenance

```
$ git rev-parse --abbrev-ref HEAD
feat/stock-fulfillment-triggers
$ git rev-parse --short HEAD
fe6e606
$ git status --porcelain=v1          # (empty — clean tree)
$ git log --oneline -3
fe6e606 Merge pull request #262 from DevKitTop/feat/stock-fulfillment-snapshots
b877a51 feat(payments): persist durable cart quantity snapshots for both payment flows
8327bf6 feat(payments): fulfil stock on payment through a claim ledger
```

### A.2 The commit that introduced the `data.status` assumption (no fixture)

```
$ git show df4ba6a --stat
feat(culqi): add order.status.changed handler to webhook route
 app/api/webhooks/culqi/route.ts              | 37 ++++++++++++++++-
 openspec/changes/culqi-ordenes-pago/tasks.md | 60 ++++++++++++++++++++++++++++
 src/core/database/schema.ts                  |  1 +

$ git show df4ba6a -- app/api/webhooks/culqi/route.ts
+      data?: {
+        id?: string;
+        reference_code?: string;
+        status?: string;          ← the assumed field
+        outcome?: { type?: string };
+      };
+      case 'order.status.changed': {
+        const orderStatus = event.data?.status;
+        const culqiOrderId = event.data?.id;
+        …
+        const result = (await db
+          .update(paymentOrders)
+          .set({ status: mapped, updatedAt: new Date() })
+          .where(eq(paymentOrders.culqiOrderId, culqiOrderId))) as unknown as {
+          rowCount: number;
+        };
+        if (!result?.rowCount || result.rowCount === 0) { … }
```

### A.3 The unit test that masks the `rowCount` bug

```ts
// tests/unit/webhookOrderStatus.test.ts:28-41  (the fixture — fabricated, not captured)
function createOrderStatusEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: `test-event-${eventCounter}`,
    type: 'order.status.changed',
    data: { id: 'ord_culqi_abc123', status: 'paid', … },
    …topLevelOverrides,
  };
}

// tests/unit/webhookOrderStatus.test.ts:57-62  (the impossible mock)
mockUpdate.mockReturnValue({ set: mockSet });
mockSet.mockReturnValue({ where: mockWhere });
mockWhere.mockResolvedValue({ rowCount: 1 });   ← postgres-js never returns this
```

### A.4 Rolled-back Drizzle probe — `rowCount` does not exist

```
=== zero-row update (payment_orders WHERE status='pending') ===
typeof result            : object
Object.keys(result)      : []
own "rowCount" in result : false
result.rowCount          : undefined
result.count             : 0
result.command           : UPDATE
result.constructor.name  : Result
.returning() rows length : 0

=== MATCHING update (payments SET status='paid' WHERE status='paid') ===
own "rowCount" in result : false
result.rowCount          : undefined
result.count             : 27 <- real affected-row count
result.command           : UPDATE
.returning() rows length : 27 <- real affected-row count

tx rolled back as designed: ROLLBACK_PROBE
```

### A.5 Read-only DB summaries (no PII values printed)

```
[DEV] order_events rows: 0
[DEV] payment_orders summary: {"n":0,"paid":0,"pending":0,"ord_prefix":0,"has_cartitems":0,"has_qty":0}
[DEV] payments summary: {"n":89,"chr_prefix":89,"ord_prefix":0,"null_charge":0,"has_cartitems":89,"has_qty":0,"has_ordernumber":89}
[DEV] payment_orders.metadata keys: (none)
[DEV] payments.metadata.cartItems[] entry keys: id, name, price, quantity
[DEV] payments.metadata.cartItems[] entry types: [{"id_type":"string","qty_type":"number","n":89}]
[DEV] payments JOIN payment_orders on culqi ids: 0

[PROD] order_events rows: 0
[PROD] payment_orders summary: {"n":0,"paid":0,"pending":0,"ord_prefix":0,"has_cartitems":0,"has_qty":0}
[PROD] payments summary: {"n":0,"chr_prefix":0,"ord_prefix":0,"null_charge":0,"has_cartitems":0,"has_qty":0,"has_ordernumber":0}
[PROD] payments JOIN payment_orders on culqi ids: 0
```

DEV `payments.metadata` distinct top-level key names (keys only — values withheld because `dni` / `riskData` / `shippingInfo` carry buyer PII):
`cartItems, culqiId, culqiResponse, customerAuth, dni, orderNumber, paymentGateway, platform, riskData, shippingInfo`.

DEV host: `db.likloeyrdzfsrwelpdoz.supabase.co:5432`. Tables present: `businesses, order_events, payment_orders, payments, products`. **`stock_movements` does not exist** (migration 0051 is not applied in this database).

### A.6 Culqi Order resource schema (third-party, derived from Culqi's docs)

`api-evangelist/culqi` → `openapi/culqi-orders-api-openapi.yml:155-181`:

```yaml
Order:
  type: object
  properties:
    object:      { type: string, example: order }
    id:          { type: string, example: ord_test_xxxxxxxxxxxx }
    amount:      { type: integer }
    currency_code: { $ref: '#/components/schemas/CurrencyCode' }
    state:       { type: string, example: created }        ← the state field
    order_number: { type: string }
    cip_code:    { type: string }
    expiration_date: { type: integer }
    creation_date:  { type: integer }
    metadata:    { $ref: '#/components/schemas/Metadata' }
```

**No `status` property exists on the Order object.**

Webhook envelope (`asyncapi/culqi-events-webhooks.yml:18-20`):

```yaml
payload: >-
  JSON event object { object: "event", id: "evt_...", type: "<event.type>",
  creation_date, data: { ...the affected resource... } }
```

and (`:34-38`):

```yaml
notes: >-
  Signature/verification specifics are not published as a documented HMAC
  scheme in the public docs; merchants validate by refetching the referenced
  resource (e.g. getCharge with the event's charge id). Because Culqi ships no
  AsyncAPI document, no AsyncAPI-spec pointer is emitted — only Webhooks.
```

### A.7 This repo's own order-state contract

`src/core/payments/culqiOrders.ts:88-111`:

```ts
// Culqi's real ORDER object carries its payment state in TWO fields, not one:
//   - `state`   — lifecycle string. 'paid' is confirmed real (Culqi's own
//                 Prestashop module compares `$state == 'paid'` on the order
//                 webhook payload; GET /v2/orders filters on `state`).
//   - `paid_at` — unix timestamp of the capture, `null` while unpaid.
//
// There is deliberately NO `status` here. … On an order, a `status` key is
// fiction: it filters out as `undefined` and silently proves nothing …
export function isCulqiOrderPaid(order: CulqiOrderState): boolean {
  if (order.state === 'paid') return true;
  return isMoneyTimestamp(order.paid_at);
}
```

### A.8 The client-side `status` — a different object

```ts
// src/types/culqi.d.ts:52-61
export interface CulqiOrderResult {
  id: string;
  status: string;          ← the Culqi Checkout JS order object, NOT the API resource
  amount?: number;
  cip_code?: string;
  expiration_date?: number;
  payment_method?: string;
  action?: CulqiOrderAction;
  [key: string]: unknown;
}

// src/features/payment/hooks/useCulqiCallback.ts:150
if (order.status === 'paid') {
```

The client-side object sent to Culqi also carries a **fuller** cart than the server persists:

```ts
// src/features/payment/hooks/useCulqiCallback.ts:85-90
cartItems: cartItems.map((item) => ({
  id: item.id,
  name: item.name,
  quantity: item.quantity,
  price: (item as unknown as Record<string, unknown>).secondPrice || item.price,
})),
```

→ Zod strips `name`/`price` at the API boundary (`schemas.ts:20-25`), which is why the DB shows the legacy 4-key shape for pre-slice-2 rows and the contract is `{ id, quantity }` today.

---

## Appendix B — Adjacent findings (out of the five questions, material to PR3)

| # | Finding | Evidence | Impact |
|---|---|---|---|
| B.1 | The webhook catalog's confirmed event types list `charge.creation.succeeded` and `charge.failed` — **not** `charge.paid`, which is what the route switches on. | `asyncapi/culqi-events-webhooks.yml:30-33` vs `route.ts:315` | The charge branch may never fire if Culqi emits only the canonical name. The repo already treats `refund.creation.succeeded` as canonical with `refund.created` as a legacy alias (`route.ts:323-324`) — the same alias treatment should be considered for `charge.paid`. Verify against a real delivery. |
| B.2 | The reconcile cron is **not scheduled** — `vercel.json` has no `crons` block. | `vercel.json:1-5` (3 keys only) | Confirms design D10's premise; the backstop is dormant today. |
| B.3 | The reconcile cron's auth accepts **only** `x-cron-secret`; Vercel sends `Authorization: Bearer <CRON_SECRET>`. | `app/api/cron/reconcile-payments/route.ts:28-48` | Design D10 requires an additive Bearer branch; until then a scheduled run would 401. |
| B.4 | The cron reconciles only `payments` rows, and re-reads Culqi via `getCulqiCharge(payment.culqiChargeId)` — which for an order-flow row is an `ord_…` id, not a charge id. | `reconcile-payments/route.ts:53-61`, `:67-81` | Order-flow rows are invisible to the settle pass; the backstop's pass 2 must cover `payment_orders` explicitly (R4). |
| B.5 | `order_events` is never written by any code in `src/`. | grep for `insert(orderEvents)` → no match | The table is a dead audit trail; it cannot serve as a payload archive. |
| B.6 | `FULFILLMENT_WATERMARK` is still the PR1 authoring date, not the PR3 cutover instant. | `src/core/payments/stockFulfillment.ts:40` (`2026-10-01T00:00:00.000Z`) | PR3 must set it to the cutover instant (design D7 / `design.md:187`). |

---

## Appendix C — Explicit unknowns

| # | Unknown | Why it could not be settled here | How to settle it |
|---|---|---|---|
| C.1 | Whether the real `order.status.changed` payload carries `state`, `status`, or both | No captured payload exists in the repo, the DBs, or any fixture; Culqi publishes no enumerated webhook payload schema | Read a real delivery from the CulqiPanel event viewer / REST `listEvents`; until then read **both** fields and fail closed |
| C.2 | Whether Culqi emits `charge.paid` for Órdenes-backed charges, and whether the payload carries `order_id` | Same reason | `design.md:207` Risk 1 / `design.md:218` Open Question — verify during apply |
| C.3 | The live order-flow row shape | Both databases have **0** `payment_orders` rows | Execute one real async order in a staging environment and re-run the inspector |
| C.4 | The exact `payments.metadata.cartItems` entry shape *today* | The 89 DEV rows predate the Zod strip; the current shape is only provable from the schema | Code-derived: `{ id, quantity }` (`schemas.ts:20-25`); confirm on a fresh row |

---

*All database access was read-only and performed through throwaway scripts outside the repository (`%TEMP%\opencode\`), each of which was deleted after use. No production code, migration, schema or configuration file was modified. No secrets or buyer PII values were printed; UUIDs were deliberately not routed through `src/lib/piiScrubber.ts`.*
