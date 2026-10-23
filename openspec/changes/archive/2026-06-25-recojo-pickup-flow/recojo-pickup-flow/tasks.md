# Tasks: Recojo In-Store Pickup Flow

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~280 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Decision needed before apply | No |

## Batch 1 — Foundation (DB Schema + Enum Constants)

### RPF-1: Create Migration SQL for Recojo Statuses

- **Dependencies**: None
- **Files to modify**: `migrations/0028_recojo_pickup_flow.sql` (new)
- **Description**: Create additive DDL migration following the pattern from `0018_order_flow_v2_schema.sql`. Add `READY_FOR_PICKUP` and `PICKED_UP` to `order_status_v2` enum via `ALTER TYPE ... ADD VALUE`. Add `ORDER_READY_FOR_PICKUP` and `ORDER_PICKED_UP` to `order_timeline_event_type` enum. Include one-time `UPDATE` to migrate existing recojo orders stuck in `IN_TRANSIT` or `DELIVERED` → `READY_FOR_PICKUP` (with `version + 1`, `updated_at = NOW()`), bounded by `shipping_type = 'recojo'`. Each `ALTER TYPE` must be its own statement (PG does not allow multiple `ADD VALUE` in the same implicit transaction). Use `--> statement-breakpoint` separators matching the project's migration pattern.
- **Acceptance criteria**:
  - [ ] SQL file created at `migrations/0028_recojo_pickup_flow.sql`
  - [ ] Runs successfully against a test DB (or validates syntax)
  - [ ] Existing recojo orders in `IN_TRANSIT` / `DELIVERED` are migrated to `READY_FOR_PICKUP`
  - [ ] Delivery orders are NOT touched by the UPDATE
  - [ ] Additive only — no DROP, no column changes
- **Estimated lines**: ~25

### RPF-2: Add Status Constants and Enum Values

- **Dependencies**: None
- **Files to modify**:
  - `src/core/orders/orderStatus.ts`
  - `src/core/database/schema/enums.ts`
- **Description**:
  - **`orderStatus.ts`**: Add `READY_FOR_PICKUP: 'READY_FOR_PICKUP'` and `PICKED_UP: 'PICKED_UP'` to `ORDER_STATUS_V2` constant object, after `PREPARING_ORDER` and before `WAITING_CUSTOMER_CONFIRMATION`. The order matters for readability (logical lifecycle).
  - **`enums.ts`**: Add `'READY_FOR_PICKUP'` and `'PICKED_UP'` to `orderStatusEnumV2` pgEnum array. The order in the pgEnum must match the migration SQL order. Add `'ORDER_READY_FOR_PICKUP'` and `'ORDER_PICKED_UP'` to `orderTimelineEventTypeEnum` pgEnum array.
  - The `OrderTimelineEventType` type in `orderTypes.ts` auto-updates since it's derived from `(typeof orderTimelineEventTypeEnum.enumValues)[number]` — no manual change needed there.
- **Acceptance criteria**:
  - [ ] `ORDER_STATUS_V2.READY_FOR_PICKUP` and `ORDER_STATUS_V2.PICKED_UP` exist and are typed
  - [ ] `orderStatusEnumV2` includes the 2 new values
  - [ ] `orderTimelineEventTypeEnum` includes the 2 new event types
  - [ ] TypeScript compiles without errors
- **Estimated lines**: ~10

## Batch 2 — Core Logic (State Machine, Service, Timeouts, Actions)

### RPF-3: Extend State Machine with Pickup Transitions and Shipping Gate

- **Dependencies**: RPF-2
- **Files to modify**: `src/core/orders/orderStateMachine.ts`
- **Description**:
  1. **Add T15 to `PREPARING_ORDER.to[]`**: Insert `ORDER_STATUS_V2.READY_FOR_PICKUP` into the `PREPARING_ORDER` transition array (before `SELLER_TIMEOUT` for logical ordering).
  2. **Add `READY_FOR_PICKUP` entry**: Add new matrix entry:
     ```ts
     [ORDER_STATUS_V2.READY_FOR_PICKUP]: {
       to: [ORDER_STATUS_V2.PICKED_UP, ORDER_STATUS_V2.CANCELLED, ORDER_STATUS_V2.ISSUE_REPORTED],
       allowedActors: ['seller', 'customer', 'system'],
     },
     ```
  3. **Add `PICKED_UP` entry**: Add new matrix entry:
     ```ts
     [ORDER_STATUS_V2.PICKED_UP]: {
       to: [ORDER_STATUS_V2.COMPLETED, ORDER_STATUS_V2.CANCELLED, ORDER_STATUS_V2.ISSUE_REPORTED],
       allowedActors: ['system', 'customer'],
     },
     ```
  4. **Add shipping type gate in `validateTransitionFull`**: After the existing actor-specific precondition check, add a shipping type guard:
     ```ts
     // Shipping type gate: pickup statuses only valid for recojo orders
     if (
       (to === ORDER_STATUS_V2.READY_FOR_PICKUP || to === ORDER_STATUS_V2.PICKED_UP) &&
       input.preconditions?.shippingType !== 'recojo'
     ) {
       return { valid: false, error: 'Pickup statuses require shippingType = "recojo"' };
     }
     ```
     This gate goes BEFORE the existing `WAITING_CUSTOMER_CONFIRMATION` precondition (early bail). The `shippingType` value is injected by `orderService.ts` from the DB record (RPF-4), not from caller input.
- **Acceptance criteria**:
  - [ ] T15: `PREPARING_ORDER → READY_FOR_PICKUP` is valid for `seller` actors
  - [ ] T16: `READY_FOR_PICKUP → PICKED_UP` is valid for `seller` actors
  - [ ] T17: `PICKED_UP → COMPLETED` is valid for `system` actors
  - [ ] Terminal transitions: `READY_FOR_PICKUP → CANCELLED/ISSUE_REPORTED`, `PICKED_UP → CANCELLED/ISSUE_REPORTED`
  - [ ] Non-recojo orders are REJECTED when attempting to transition to `READY_FOR_PICKUP` or `PICKED_UP`
  - [ ] Existing T1–T14 transitions remain unchanged
  - [ ] TypeScript compiles without errors
- **Estimated lines**: ~30

### RPF-4: Move Pickup Code Gen, Inject Shipping Gate, Add Timeline Mapping

- **Dependencies**: RPF-2, RPF-3
- **Files to modify**: `src/core/orders/orderService.ts`
- **Description**:
  1. **Inject shippingType into validation** (lines 81-84 area): After reading `payment`, before calling `validateTransitionFull`, build `validationInput` with the DB's `shippingType` injected:
     ```ts
     const validationInput = {
       actor: input.actor,
       preconditions: {
         ...input.preconditions,
         shippingType: payment.shippingType,
       },
     };
     ```
     Then pass `validationInput` instead of the raw `input` to `validateTransitionFull`.

  2. **Move pickup code generation** (lines 110-115): Replace the existing `IN_TRANSIT` pre-hook with two guarded hooks:
     - New block for `READY_FOR_PICKUP` — generates pickup code for recojo orders
     - Modified `IN_TRANSIT` block — guarded with `payment.shippingType !== 'recojo'` to only generate for delivery orders:
     ```ts
     // Pre-hook: generate pickup code for pickup orders on READY_FOR_PICKUP
     if (input.toStatus === ORDER_STATUS_V2.READY_FOR_PICKUP) {
       const code = generatePickupCode();
       updateData.pickupCode = code;
       metadata.pickupCode = code;
     }

     // Pre-hook: generate pickup code for delivery orders on IN_TRANSIT (unchanged for non-pickup)
     if (input.toStatus === ORDER_STATUS_V2.IN_TRANSIT && payment.shippingType !== 'recojo') {
       const code = generatePickupCode();
       updateData.pickupCode = code;
       metadata.pickupCode = code;
     }
     ```

  3. **Add `mapTransitionToEvent` entries** (before the fallback at line 184): Add before the `ORDER_COMPLETED` check or in the right logical position:
     ```ts
     if (to === ORDER_STATUS_V2.READY_FOR_PICKUP) return 'ORDER_READY_FOR_PICKUP';
     if (to === ORDER_STATUS_V2.PICKED_UP) return 'ORDER_PICKED_UP';
     ```
     Best placement: right after the `ORDER_COMPLETED` block (line 171), before the issue flow section. The ordering isn't semantically critical but should be grouped near the main flow transitions.

  4. **Import `ORDER_READY_FOR_PICKUP` and `ORDER_PICKED_UP`**: These are auto-derived from the enum type, so no import change needed — the string literal matches the enum value. The return type `OrderTimelineEventType` auto-includes them via the union.
- **Acceptance criteria**:
  - [ ] `validateTransitionFull` receives `shippingType` from the DB record, not from caller input
  - [ ] Pickup code is generated on `READY_FOR_PICKUP` transition for recojo orders
  - [ ] Pickup code is NOT generated on `IN_TRANSIT` for recojo orders
  - [ ] Pickup code IS still generated on `IN_TRANSIT` for delivery orders
  - [ ] `mapTransitionToEvent` returns `'ORDER_READY_FOR_PICKUP'` for `to === READY_FOR_PICKUP`
  - [ ] `mapTransitionToEvent` returns `'ORDER_PICKED_UP'` for `to === PICKED_UP`
  - [ ] TypeScript compiles without errors
- **Estimated lines**: ~30

### RPF-5: Add Pickup Timeout Rules

- **Dependencies**: RPF-2, RPF-4
- **Files to modify**: `src/core/orders/orderTimeouts.ts`
- **Description**: Add two new timeout rules to the `TIMEOUT_RULES` array, after the existing `auto-complete` rule (insert before `];` of array):
  ```ts
  {
    label: 'pickup-auto-complete',
    legacyStatus: ORDER_STATUS.EN_REPARTO, // fallback — legacy pickup-like status for safety
    v2Status: ORDER_STATUS_V2.READY_FOR_PICKUP,
    toStatus: ORDER_STATUS_V2.COMPLETED,
    hours: 168, // 7 days — unclaimed pickup auto-completes
  },
  {
    label: 'picked-up-auto-complete',
    legacyStatus: ORDER_STATUS.EN_REPARTO, // fallback
    v2Status: ORDER_STATUS_V2.PICKED_UP,
    toStatus: ORDER_STATUS_V2.COMPLETED,
    hours: 72, // 3 days — after customer picked up, auto-complete
  },
  ```
  No changes to `processTimeouts()` itself — it already iterates all rules generically. The version-locked update inside `transition()` prevents double-processing. The existing `or()` query matching both `legacyStatus` and `v2Status` covers both migrated and non-migrated DB rows.
- **Acceptance criteria**:
  - [ ] `pickup-auto-complete` rule exists: 168h from `READY_FOR_PICKUP` → `COMPLETED`
  - [ ] `picked-up-auto-complete` rule exists: 72h from `PICKED_UP` → `COMPLETED`
  - [ ] `processTimeouts()` processes both new rules alongside existing 3 rules
  - [ ] TypeScript compiles without errors
- **Estimated lines**: ~15

### RPF-6: Add Pickup Server Actions

- **Dependencies**: RPF-2, RPF-4
- **Files to modify**: `src/features/dashboard/actions/ticketActions.ts`
- **Description**: Add two new exported async functions after the existing `notifyDelivery` function. Follow the exact pattern of `notifyDelivery` (same error handling, same return type `NotifyDeliveryResult`, same DB fetch + ownership validation + `transition()` call pattern).

  **`markReadyForPickup(paymentId, businessId)`**:
  - Fetch payment, validate exists + owned by `businessId`
  - Read `version` for optimistic locking
  - If `env.orderFlowV2`: call `transition()` with `toStatus: ORDER_STATUS_V2.READY_FOR_PICKUP`, `actor: { type: 'seller', id: businessId }`
  - Return `{ success: true }` or `{ success: false, error: '...' }`

  **`confirmPickedUp(paymentId, businessId)`**:
  - Same fetch + ownership pattern
  - If `env.orderFlowV2`: call `transition()` with `toStatus: ORDER_STATUS_V2.PICKED_UP`, `actor: { type: 'seller', id: businessId }`
  - Return same result shape

  Both functions should:
  - Not check specific `fromStatus` — the state machine validation handles that
  - Use the existing `mapTransitionError()` helper for friendly error messages
  - Log errors with `console.error` matching the existing pattern (`[markReadyForPickup]` / `[confirmPickedUp]`)
  - NOT wrap in confirmation dialogs (direct action, matches physical handover nature)

- **Acceptance criteria**:
  - [ ] `markReadyForPickup(paymentId, businessId)` exported, calls `transition()` to `READY_FOR_PICKUP`
  - [ ] `confirmPickedUp(paymentId, businessId)` exported, calls `transition()` to `PICKED_UP`
  - [ ] Both validate ownership and return friendly errors for unauthorized access
  - [ ] Both return `NotifyDeliveryResult` shape (matching existing `notifyDelivery`)
  - [ ] TypeScript compiles without errors
- **Estimated lines**: ~60

### RPF-7: Update Pickup Phase Mapping

- **Dependencies**: RPF-2
- **Files to modify**: `app/[slug]/dashboard/components/SellerPhaseGuide.tsx`
- **Description**: Update the `V2_PHASE_PICKUP` constant. Replace the current mapping (which uses delivery states `IN_TRANSIT: 1`, `DELIVERED: 1`, `WAITING_CUSTOMER_CONFIRMATION: 1`, `READY_TO_SHIP: 1`) with pickup-correct statuses. Remove all delivery-only states. New mapping:
  ```ts
  const V2_PHASE_PICKUP: Record<string, number> = {
    CREATED: 0,
    PAID: 0,
    PREPARING_ORDER: 0,
    READY_FOR_PICKUP: 1,  // Phase 1 — actionable (seller marks ready)
    PICKED_UP: 1,          // Phase 1 — waiting auto-complete (72h)
    COMPLETED: 2,          // Phase 2 — done
    ISSUE_REPORTED: 0,
    DISPUTE: 0,
    SELLER_TIMEOUT: 0,
    CANCELLED: 0,
  };
  ```
  Removed entries: `WAITING_CUSTOMER_CONFIRMATION`, `READY_TO_SHIP`, `IN_TRANSIT`, `DELIVERED`. The `V1_PHASE_PICKUP` stays unchanged (it handles legacy status mapping fallback for older orders). No other code changes in this file.
- **Acceptance criteria**:
  - [ ] `READY_FOR_PICKUP` → Phase 1, `PICKED_UP` → Phase 1, `COMPLETED` → Phase 2
  - [ ] Delivery-only statuses removed from `V2_PHASE_PICKUP`
  - [ ] Delivery flow's `V2_PHASE` is UNCHANGED
  - [ ] TypeScript compiles without errors
- **Estimated lines**: ~10

## Batch 3 — UI Layer (Component Changes)

### RPF-8: Add Pickup Callback Props to PhaseContent

- **Dependencies**: RPF-9 (needs to know PhaseShippingSection's new props)
- **Files to modify**: `app/[slug]/dashboard/components/PhaseContent.tsx`
- **Description**: Extend `PhaseContentProps` with four new optional callback/loading props:
  ```ts
  onMarkReadyForPickup?: () => void;
  onConfirmPickedUp?: () => void;
  markingReady?: boolean;
  confirmingPickup?: boolean;
  ```
  Destructure them in the component. Pass them through to the `PhaseShippingSection` in the `{isPickup && selectedPhase === 1}` block (line 71-79). Add them alongside the existing props:
  ```tsx
  {isPickup && selectedPhase === 1 && (
    <PhaseShippingSection
      order={order}
      onNotifyDelivery={onNotifyDelivery}
      onFinalizeOrder={onFinalizeOrder}
      notifyingDelivery={notifyingDelivery}
      finalizingOrder={finalizingOrder}
      onMarkReadyForPickup={onMarkReadyForPickup}
      onConfirmPickedUp={onConfirmPickedUp}
      markingReady={markingReady}
      confirmingPickup={confirmingPickup}
    />
  )}
  ```
  No changes to the delivery (`!isPickup`) blocks — they continue to pass only the delivery-relevant props. The `onNotifyDelivery` and `onFinalizeOrder` must still be passed to the pickup block (PhaseShippingSection still renders them for the delivery path of that component).
- **Acceptance criteria**:
  - [ ] `PhaseContentProps` includes `onMarkReadyForPickup`, `onConfirmPickedUp`, `markingReady`, `confirmingPickup`
  - [ ] All 4 new props are passed through to `PhaseShippingSection` in the pickup Phase 1 block
  - [ ] Delivery Phase 1 (`!isPickup`) block is unchanged
  - [ ] TypeScript compiles without errors
- **Estimated lines**: ~15

### RPF-9: Add Pickup Action Buttons to PhaseShippingSection

- **Dependencies**: RPF-2, RPF-7
- **Files to modify**: `app/[slug]/dashboard/components/PhaseShippingSection.tsx`
- **Description**: Extend `PhaseShippingSectionProps` with the same 4 new optional callback/loading props. Add two guards and their corresponding buttons:

  ```ts
  interface PhaseShippingSectionProps {
    order: PhaseShippingSectionOrderItem;
    onNotifyDelivery: () => void;
    onFinalizeOrder: () => void;
    notifyingDelivery: boolean;
    finalizingOrder: boolean;
    // New:
    onMarkReadyForPickup?: () => void;
    onConfirmPickedUp?: () => void;
    markingReady?: boolean;
    confirmingPickup?: boolean;
  }
  ```

  Inside the component, add two new guards:
  ```ts
  const showMarkReadyForPickup = isPickup && status === 'PREPARING_ORDER';
  const showConfirmPickedUp = isPickup && status === 'READY_FOR_PICKUP';
  ```

  Render two new button blocks (after the existing `showNotifyArrival` block, line 57-66). Use the same `styles.actionsWrapper` and `styles.buttonInner` CSS modules classes. Import `Store` and `CheckCircle` from `lucide-react` (add to existing import on line 4). Icons:
  - "Mark as ready": `<Store size={18} />`, loading text: "Preparando..."
  - "Confirm picked up": `<CheckCircle size={18} />`, loading text: "Confirmando..."

  These must be gated by `isPickup` to ensure delivery flow is completely unaffected.

- **Acceptance criteria**:
  - [ ] "Mark as ready for pickup" button visible when `isPickup && status === 'PREPARING_ORDER'`
  - [ ] "Confirm picked up" button visible when `isPickup && status === 'READY_FOR_PICKUP'`
  - [ ] Loading states (`markingReady`/`confirmingPickup`) show spinner + loading text, button disabled
  - [ ] Delivery flow buttons (`showNotifyDelivery`, `showNotifyArrival`) are unchanged
  - [ ] TypeScript compiles without errors
- **Estimated lines**: ~30

### RPF-10: Add Pickup Action Buttons to ShippingSection PickupContent

- **Dependencies**: RPF-2
- **Files to modify**: `app/[slug]/dashboard/components/ShippingSection.tsx`
- **Description**: Extend the `PickupContent` component and `ShippingSectionProps` to accept and use the 4 new callback/loading props. The `PickupContent` already renders the pickup code — we need to add action buttons below the code box.

  Update `ShippingSectionProps` and `PickupContent` props:
  ```ts
  interface ShippingSectionProps {
    order: ShippingSectionOrderItem;
    onMarkReadyForPickup?: () => void;
    onConfirmPickedUp?: () => void;
    markingReady?: boolean;
    confirmingPickup?: boolean;
  }
  ```

  Inside `PickupContent` props (function signature), add the same 4 optional props. After the `StatusTag` at the bottom of `PickupContent` (line 83), add action buttons gated by status:
  ```tsx
  {status === 'PREPARING_ORDER' && onMarkReadyForPickup && (
    <Button variant="filled" onClick={onMarkReadyForPickup} disabled={markingReady}>
      Marcar como listo para recojo
    </Button>
  )}
  {status === 'READY_FOR_PICKUP' && onConfirmPickedUp && (
    <Button variant="filled" onClick={onConfirmPickedUp} disabled={confirmingPickup}>
      Confirmar recojo
    </Button>
  )}
  {status === 'PICKED_UP' && (
    <StatusTag status={status} />
  )}
  ```

  The default export `ShippingSection` must accept and pass through the new props to `PickupContent`:
  ```tsx
  if (type === 'recojo') return <PickupContent order={order} status={status}
    onMarkReadyForPickup={onMarkReadyForPickup}
    onConfirmPickedUp={onConfirmPickedUp}
    markingReady={markingReady}
    confirmingPickup={confirmingPickup}
  />;
  ```

  Import `Button` from `@/shared/components/ui/buttons/Button` (add import at top). Also add `'PICKED_UP'` to `SHIPPING_STATUS_LABEL` with value `'Recogido'`.

  The `AgencyContent` and `DeliveryContent` are NOT modified.

- **Acceptance criteria**:
  - [ ] "Mark as ready for pickup" button in PickupContent when `status === 'PREPARING_ORDER'`
  - [ ] "Confirm picked up" button in PickupContent when `status === 'READY_FOR_PICKUP'`
  - [ ] `StatusTag` with `PICKED_UP` status renders when `status === 'PICKED_UP'`
  - [ ] Pickup code display remains unchanged
  - [ ] Delivery and Agency content are UNCHANGED
  - [ ] TypeScript compiles without errors
- **Estimated lines**: ~30

### RPF-11: Add Pickup Handlers and Wiring in OrderModal

- **Dependencies**: RPF-6, RPF-8
- **Files to modify**: `app/[slug]/dashboard/components/OrderModal.tsx`
- **Description**: Add state, handlers, and wiring for the two new pickup actions.

  1. **Imports**: Add `markReadyForPickup` and `confirmPickedUp` to the import from `@/features/dashboard/actions/ticketActions` (line 3-8).

  2. **New state** (after line 51 `finalizingOrder`):
     ```ts
     const [markingReady, setMarkingReady] = useState(false);
     const [confirmingPickup, setConfirmingPickup] = useState(false);
     ```

  3. **Reset in useEffect** (line 71-80): Add to the cleanup effect that resets states when order changes:
     ```ts
     setMarkingReady(false);
     setConfirmingPickup(false);
     ```

  4. **New handlers** (after `handleFinalizeOrder`):
     ```ts
     const handleMarkReadyForPickup = async () => {
       setMarkingReady(true);
       try {
         const result = await markReadyForPickup(order.id, order.businessId);
         if (result.success) {
           onOrderUpdate({ ...order, status: 'READY_FOR_PICKUP' as any });
         } else {
           alert(result.error || 'Error al marcar como listo para recojo');
         }
       } catch {
         alert('Error inesperado');
       } finally {
         setMarkingReady(false);
       }
     };

     const handleConfirmPickedUp = async () => {
       setConfirmingPickup(true);
       try {
         const result = await confirmPickedUp(order.id, order.businessId);
         if (result.success) {
           onOrderUpdate({ ...order, status: 'PICKED_UP' as any });
         } else {
           alert(result.error || 'Error al confirmar recojo');
         }
       } catch {
         alert('Error inesperado');
       } finally {
         setConfirmingPickup(false);
       }
     };
     ```
     **No confirmation dialog** — matches the direct-execution pattern for physical handover.

  5. **Pass to PhaseContent** (lines 237-261): Add the 4 new props to the `<PhaseContent>` render call:
     ```tsx
     onMarkReadyForPickup={handleMarkReadyForPickup}
     onConfirmPickedUp={handleConfirmPickedUp}
     markingReady={markingReady}
     confirmingPickup={confirmingPickup}
     ```

- **Acceptance criteria**:
  - [ ] `markReadyForPickup` and `confirmPickedUp` imported from `ticketActions`
  - [ ] `markingReady`/`confirmingPickup` state tracks loading status
  - [ ] `handleMarkReadyForPickup` calls server action, updates order on success, shows alert on error
  - [ ] `handleConfirmPickedUp` calls server action, updates order on success, shows alert on error
  - [ ] Both handlers are passed to `PhaseContent`
  - [ ] State resets when order changes
  - [ ] TypeScript compiles without errors
- **Estimated lines**: ~45

## Execution Order Summary

```
RPF-1 ─┐
        ├──► RPF-2 ──► RPF-3 ──► RPF-4 ──┬──► RPF-5
        │                                  ├──► RPF-6 ──┬──► RPF-11
        │                                  │             │
        │                                  └──► RPF-7    │
        │                                       │        │
        │                                       ▼        │
        │                                  RPF-9 ──► RPF-8
        │                                       │        │
        │                                       ▼        │
        │                                  RPF-10 ───────┘
        │
        └──► Apply migration before or after deploy
             (additive DDL, safe either way)
```

Total: ~290 lines across 11 tasks, 13 files (1 new, 12 modified).
