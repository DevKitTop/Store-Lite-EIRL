# Delta for order-flow

## ADDED Requirements

### Requirement: Pickup Statuses

OrderStatusEnumV2 MUST include `READY_FOR_PICKUP` and `PICKED_UP`. These statuses SHALL only be valid for `shippingType = 'recojo'`.

**Scenario: Recojo order transitions to READY_FOR_PICKUP**

- GIVEN an order with `shippingType = 'recojo'` in `PREPARING_ORDER`
- WHEN the seller confirms "ready for pickup"
- THEN status MUST become `READY_FOR_PICKUP`

**Scenario: Delivery order rejected from pickup status**

- GIVEN an order with `shippingType = 'delivery'` in `PREPARING_ORDER`
- WHEN a transition to `READY_FOR_PICKUP` or `PICKED_UP` is attempted
- THEN the transition MUST be rejected with a validation error

### Requirement: Pickup Transitions

The state machine MUST include three new transitions for recojo orders:

| #   | From             | To               | Actor  | Precondition                                   | Event                  |
| --- | ---------------- | ---------------- | ------ | ---------------------------------------------- | ---------------------- |
| T15 | PREPARING_ORDER  | READY_FOR_PICKUP | Seller | `shippingType = 'recojo'`, no courier required | ORDER_READY_FOR_PICKUP |
| T16 | READY_FOR_PICKUP | PICKED_UP        | Seller | Customer presents pickup code                  | ORDER_PICKED_UP        |
| T17 | PICKED_UP        | COMPLETED        | System | 72h elapsed from PICKED_UP                     | ORDER_COMPLETED        |

**Scenario: Full pickup lifecycle**

- GIVEN a recojo order in `PREPARING_ORDER`
- WHEN T15 fires → status becomes `READY_FOR_PICKUP`, pickup code generated, `ORDER_READY_FOR_PICKUP` event recorded
- WHEN T16 fires → status becomes `PICKED_UP`, `ORDER_PICKED_UP` event recorded
- WHEN 72h passes → T17 fires, status becomes `COMPLETED`

### Requirement: Pickup Code Generation

For recojo orders, the pickup code MUST be generated on T15 (→ `READY_FOR_PICKUP`). For delivery orders, generation remains on T7 (→ `IN_TRANSIT`), unchanged. Format: `SL-XXXX-XXXX`, stored in `payments.pickupCode`.

**Scenario: Code generated for recojo on T15**

- GIVEN a recojo order transitioning `PREPARING_ORDER → READY_FOR_PICKUP`
- WHEN the transition completes
- THEN `payments.pickupCode` MUST be non-null with valid format

**Scenario: Delivery code gen unchanged**

- GIVEN a delivery order transitioning `READY_TO_SHIP → IN_TRANSIT`
- WHEN T7 fires
- THEN `payments.pickupCode` MUST be generated as per existing behavior

### Requirement: Pickup Auto-Complete Timeout

Orders in `READY_FOR_PICKUP` for 7 days MUST auto-complete to `COMPLETED`.

| Timeout              | From → To                    | Duration            | Query                                                                 |
| -------------------- | ---------------------------- | ------------------- | --------------------------------------------------------------------- |
| Pickup auto-complete | READY_FOR_PICKUP → COMPLETED | 7d from `updatedAt` | WHERE status = READY_FOR_PICKUP AND updatedAt < NOW() - INTERVAL '7d' |

**Scenario: Unclaimed pickup auto-completes**

- GIVEN an order in `READY_FOR_PICKUP` for more than 7 days
- WHEN the cron job runs
- THEN status MUST become `COMPLETED` with `ORDER_COMPLETED` event and `actorType = 'system'`

### Requirement: Pickup Timeline Events

Two new event types MUST be added to `order_timeline_event_type`: `ORDER_READY_FOR_PICKUP`, `ORDER_PICKED_UP`.

**Scenario: Events recorded on pickup transitions**

- GIVEN a recojo order at each pickup transition
- WHEN T15 fires → `ORDER_READY_FOR_PICKUP` event inserted with `actorType = 'seller'`
- WHEN T16 fires → `ORDER_PICKED_UP` event inserted with `actorType = 'seller'`

### Requirement: Shipping Type Validation Gate

`validateTransitionFull` MUST reject any transition involving `READY_FOR_PICKUP` or `PICKED_UP` when `shippingType != 'recojo'`. Attempts MUST return a validation error and NOT mutate state.

**Scenario: Validation guard active**

- GIVEN any order with `shippingType = 'delivery'` or `'agency'`
- WHEN any code path attempts to set `READY_FOR_PICKUP` or `PICKED_UP`
- THEN the state machine MUST reject the transition before any mutation

## MODIFIED Requirements

### Requirement: State Transition Rules (existing Section 3)

The transition table in openspec/changes/order-flow-enhancement/spec.md SHALL include T15, T16, T17 in addition to existing T1–T14. Each new transition MUST increment `payments.version` and insert a timeline event, per existing locking rules.
(Previously: 14 transitions for delivery flow only)

### Requirement: Pickup Code (existing Section 5)

Recojo orders generate the pickup code on T15 (→ `READY_FOR_PICKUP`) instead of T7 (→ `IN_TRANSIT`). Delivery-only orders generate on T7 as before.
(Previously: pickup code generated on IN_TRANSIT for all orders)

### Requirement: Timeout Rules (existing Section 4)

A fourth timeout is added: pickup auto-complete from `READY_FOR_PICKUP → COMPLETED` after 7 days, processed by the same 15-min cron job.
(Previously: 3 timeout rules — seller inactivity, customer auto-confirm, auto-complete)

### Requirement: Actor Model (existing Section 7)

Seller permitted transitions now include T15 (`PREPARING_ORDER → READY_FOR_PICKUP`) and T16 (`READY_FOR_PICKUP → PICKED_UP`), both gated by `shippingType = 'recojo'`.
(Previously: Seller had T3, T7, T8, T13)

### Requirement: Acceptance Criteria (existing Section 8)

New ACs appended after AC12:

| #    | Criterion                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| AC13 | Given a recojo order in PREPARING_ORDER, when the seller marks it ready, status MUST become READY_FOR_PICKUP and pickup code MUST be generated |
| AC14 | Given a recojo order in READY_FOR_PICKUP, when the seller confirms pickup, status MUST become PICKED_UP                                        |
| AC15 | Given a PICKED_UP order, after 72h the status MUST auto-complete to COMPLETED                                                                  |
| AC16 | Given a READY_FOR_PICKUP order unclaimed for 7 days, the system MUST auto-complete to COMPLETED                                                |
| AC17 | Given a non-recojo order, any transition to READY_FOR_PICKUP or PICKED_UP MUST be rejected                                                     |
| AC18 | Given any pickup transition, a corresponding timeline event MUST be inserted                                                                   |

## UI Behavior (Informative)

### SellerPhaseGuide — V2_PHASE_PICKUP

| Order Status     | Phase                           |
| ---------------- | ------------------------------- |
| READY_FOR_PICKUP | Phase 1 (actionable)            |
| PICKED_UP        | Phase 1 (waiting auto-complete) |
| COMPLETED        | Phase 2 (done)                  |

IN_TRANSIT and DELIVERED are removed from V2_PHASE_PICKUP (no longer valid for pickup).

### PhaseShippingSection / PickupContent Actions

| Visible When                    | Button / Content                                    | Action                                  |
| ------------------------------- | --------------------------------------------------- | --------------------------------------- |
| `PREPARING_ORDER` + `isPickup`  | "Mark as ready for pickup"                          | Calls `markReadyForPickup` action → T15 |
| `READY_FOR_PICKUP` + `isPickup` | Prominent pickup code display + "Confirm picked up" | Calls `confirmPickedUp` action → T16    |
| `PICKED_UP` + `isPickup`        | Status tag: "Picked up" (no action)                 | Waiting T17 auto-complete               |
| `COMPLETED`                     | Status tag: "Completed"                             | —                                       |

All buttons gated by `shippingType === 'recojo'`. Handlers wired as pickup-specific actions in `OrderModal` — NOT reusing delivery action handlers.
