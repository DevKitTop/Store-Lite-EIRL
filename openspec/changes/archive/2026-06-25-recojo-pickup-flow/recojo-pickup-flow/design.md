# Design: Recojo In-Store Pickup Flow

## Technical Approach

Add 2 new statuses (`READY_FOR_PICKUP`, `PICKED_UP`) to the existing V2 state machine by extending the `TRANSITION_MATRIX` adjacency, adding 3 new transitions (T15–T17), and gating pickup statuses behind a `shippingType` check in `validateTransitionFull`. The pickup code generation moves from the `IN_TRANSIT` pre-hook to a new `READY_FOR_PICKUP` pre-hook in `orderService.ts`. UI changes add pickup-specific action buttons gated by `isPickup`, reusing the existing modal/phase wiring pattern. All delivery flow logic is untouched.

## Architecture Decisions

### Decision: Shipping Gate in validateTransitionFull vs. Caller Check

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Gate in `validateTransitionFull` | Single enforcement point, no missed paths | **Adopted** — central validation prevents bypass via any code path |
| Gate in each caller (server action) | Duplicate logic, easy to miss one | Rejected |

### Decision: New Server Actions vs. Reusing notifyDelivery/finalizationActions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| New `markReadyForPickup`, `confirmPickedUp` | Clear separation, matches existing pattern | **Adopted** — follows `notifyDelivery` pattern in `ticketActions.ts` |
| Reuse + branch on `shippingType` | Bloated callers, risk of delivery regressions | Rejected |

### Decision: DB Enum Extension via ALTER TYPE vs. New Enum

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `ALTER TYPE order_status_v2 ADD VALUE 'READY_FOR_PICKUP'` | Additive, no table rewrite | **Adopted** — matches existing migration pattern |
| New `order_status_pickup_v3` enum | Migration complexity, dual-enum maintenance | Rejected |

---

## Data Flow

```
Seller clicks "Mark as ready"
       │
       ▼
  markReadyForPickup(paymentId, businessId)
       │
       ├─► fetch payment, validate ownership
       ├─► transition({ toStatus: READY_FOR_PICKUP, ... })
       │      ├─► validateTransitionFull(from=PREPARING_ORDER, to=READY_FOR_PICKUP, actor=seller, shippingType=recojo)
       │      ├─► PRE-HOOK: generatePickupCode() → updateData.pickupCode
       │      ├─► version-locked UPDATE payments SET status=READY_FOR_PICKUP, pickupCode, version++
       │      └─► recordEvent(ORDER_READY_FOR_PICKUP)
       └─► revalidatePath, return result

Seller clicks "Confirm picked up"
       │
       ▼
  confirmPickedUp(paymentId, businessId)
       │
       ├─► transition({ toStatus: PICKED_UP, ... })
       │      ├─► validateTransitionFull(from=READY_FOR_PICKUP, to=PICKED_UP, actor=seller)
       │      ├─► version-locked UPDATE
       │      └─► recordEvent(ORDER_PICKED_UP)
       └─► revalidatePath, return result

Cron (every 15 min)
       │
       ▼
  processTimeouts()
       │
       └─► ['pickup-auto-complete']: WHERE status IN ('READY_FOR_PICKUP') AND updatedAt < NOW() - 7d
              └─► transition({ toStatus: COMPLETED, actor: { type: 'system' } })
```

---

## File Changes

### Core: Enums & Statuses

| File | Action | Description |
|------|--------|-------------|
| `src/core/orders/orderStatus.ts` | Modify | Add `READY_FOR_PICKUP`, `PICKED_UP` to `ORDER_STATUS_V2` |
| `src/core/database/schema/enums.ts` | Modify | Add 2 values to `orderStatusEnumV2`, 2 values to `orderTimelineEventTypeEnum` |

### Core: State Machine

| File | Action | Description |
|------|--------|-------------|
| `src/core/orders/orderStateMachine.ts` | Modify | Add T15, T16, T17 to `TRANSITION_MATRIX`; add `PREPARING_ORDER→CANCELLED`, `PREPARING_ORDER→ISSUE_REPORTED`, `READY_FOR_PICKUP→CANCELLED`, `READY_FOR_PICKUP→ISSUE_REPORTED`, `PICKED_UP→CANCELLED`, `PICKED_UP→ISSUE_REPORTED` during migration; add `shippingType` gate in `validateTransitionFull` |
| `src/core/orders/orderService.ts` | Modify | Move pickup code gen from `IN_TRANSIT` pre-hook to `READY_FOR_PICKUP` pre-hook; add `mapTransitionToEvent` entries for new transitions |

### Core: Timeouts & Timeline Types

| File | Action | Description |
|------|--------|-------------|
| `src/core/orders/orderTimeouts.ts` | Modify | Add 4th timeout rule: `pickup-auto-complete` (7d, READY_FOR_PICKUP→COMPLETED) |
| `src/core/orders/orderTypes.ts` | No change | Types are derived from enum — auto-updates via `(typeof orderTimelineEventTypeEnum.enumValues)[number]` |

### Server Actions

| File | Action | Description |
|------|--------|-------------|
| `src/features/dashboard/actions/ticketActions.ts` | Modify | Add `markReadyForPickup()` and `confirmPickedUp()` — follows `notifyDelivery` pattern exactly |

### UI Components

| File | Action | Description |
|------|--------|-------------|
| `app/[slug]/dashboard/components/SellerPhaseGuide.tsx` | Modify | Update `V2_PHASE_PICKUP`: remove `IN_TRANSIT: 1`, `DELIVERED: 1`; add `READY_FOR_PICKUP: 1`, `PICKED_UP: 1` |
| `app/[slug]/dashboard/components/PhaseShippingSection.tsx` | Modify | Add `showMarkReadyForPickup` and `showConfirmPickedUp` guards; add buttons for each |
| `app/[slug]/dashboard/components/ShippingSection.tsx` | Modify | Add "Mark as ready for pickup" and "Confirm picked up" action buttons inside `PickupContent` |
| `app/[slug]/dashboard/components/PhaseContent.tsx` | Modify | Add new callback props `onMarkReadyForPickup`, `onConfirmPickedUp` + loading states; pass through to `PhaseShippingSection` |
| `app/[slug]/dashboard/components/OrderModal.tsx` | Modify | Add `markingReady`, `confirmingPickup` states; add handlers `handleMarkReadyForPickup`, `handleConfirmPickedUp`; pass new callbacks to `PhaseContent` |

### Migration

| File | Action | Description |
|------|--------|-------------|
| `migrations/0030_recojo_pickup_flow.sql` | Create | Additive DDL: `ALTER TYPE order_status_v2 ADD VALUE`, `ALTER TYPE order_timeline_event_type ADD VALUE`, one-time `UPDATE payments SET status=`READY_FOR_PICKUP` WHERE shipping_type='recojo' AND status='IN_TRANSIT'` |

---

## Section-by-Section Design

### 1. State Machine Extension (orderStateMachine.ts)

**Approach**: Extend `TRANSITION_MATRIX` entries for `PREPARING_ORDER`, `READY_FOR_PICKUP`, and `PICKED_UP`. Add a new `shippingType` precondition check in `validateTransitionFull`.

**Code pattern** — add to existing matrix:

```typescript
// In TRANSITION_MATRIX, modify PREPARING_ORDER entry:
[ORDER_STATUS_V2.PREPARING_ORDER]: {
  to: [
    ORDER_STATUS_V2.WAITING_CUSTOMER_CONFIRMATION,
    ORDER_STATUS_V2.DELIVERED,
    ORDER_STATUS_V2.SELLER_TIMEOUT,
    ORDER_STATUS_V2.CANCELLED,
    ORDER_STATUS_V2.READY_FOR_PICKUP,  // T15 — new
    ORDER_STATUS_V2.PICKED_UP,          // T15 compact? No, T15 goes to READY_FOR_PICKUP
  ],
  allowedActors: ['seller', 'system'],
},
```

Actually, let me be more precise. The spec says:
- T15: PREPARING_ORDER → READY_FOR_PICKUP [seller]
- T16: READY_FOR_PICKUP → PICKED_UP [seller]
- T17: PICKED_UP → COMPLETED [system]

Plus terminal transitions from READY_FOR_PICKUP and PICKED_UP for CANCELLED and ISSUE_REPORTED.

```typescript
// Add new entries to TRANSITION_MATRIX:
[ORDER_STATUS_V2.READY_FOR_PICKUP]: {
  to: [
    ORDER_STATUS_V2.PICKED_UP,       // T16
    ORDER_STATUS_V2.CANCELLED,        // terminal
    ORDER_STATUS_V2.ISSUE_REPORTED,   // terminal
  ],
  allowedActors: ['seller', 'customer', 'system'],
},
[ORDER_STATUS_V2.PICKED_UP]: {
  to: [
    ORDER_STATUS_V2.COMPLETED,        // T17 (system, 72h)
    ORDER_STATUS_V2.CANCELLED,
    ORDER_STATUS_V2.ISSUE_REPORTED,
  ],
  allowedActors: ['system', 'customer'],
},
```

Also add `ORDER_STATUS_V2.READY_FOR_PICKUP` to `PREPARING_ORDER.to[]` for T15.

**Shipping type gate** in `validateTransitionFull`:

```typescript
export function validateTransitionFull(
  from: OrderStatusV2,
  to: OrderStatusV2,
  input: Pick<TransitionInput, 'actor' | 'preconditions'>,
): ValidationResult {
  const base = validateTransition(from, to, input.actor.type);
  if (!base.valid) return base;

  // Shipping type gate: pickup statuses only valid for recojo orders
  if (
    (to === ORDER_STATUS_V2.READY_FOR_PICKUP || to === ORDER_STATUS_V2.PICKED_UP) &&
    input.preconditions?.shippingType !== 'recojo'
  ) {
    return {
      valid: false,
      error: 'Pickup statuses require shippingType = "recojo"',
    };
  }

  // Existing preconditions...
  if (to === ORDER_STATUS_V2.WAITING_CUSTOMER_CONFIRMATION && input.actor.type === 'seller') {
    // ... unchanged
  }

  return { valid: true };
}
```

**Dependency**: The caller must pass `shippingType` in `preconditions`. This means all callers that use `transition()` must include it — or the service reads it from DB.

**Alternative (preferred)**: Read `shippingType` from the payment row inside `orderService.ts` rather than relying on callers to pass it. This is safer because it ensures the gate cannot be bypassed.

In `orderService.ts`, after reading `payment`, add:

```typescript
// Pre-hook precondition: pass shippingType to validation
// (read from DB, not caller input, to prevent bypass)
const validationPreconditions = {
  ...input.preconditions,
  shippingType: payment.shippingType,
};
```

Then pass this to `validateTransitionFull` instead of the raw `input.preconditions`.

**Risk**: Low. All pickup transitions will now require the DB record's `shippingType` to be `recojo`. Delivery orders are unaffected because their transitions never target `READY_FOR_PICKUP` or `PICKED_UP`.

---

### 2. Shipping Type Validation Gate (orderService.ts + orderStateMachine.ts)

**Approach**: The gate lives in two layers:
1. **State machine** (`validateTransitionFull`): rejects transitions to pickup statuses when `shippingType !== 'recojo'`
2. **Transition service** (`orderService.ts`): injects the payment's `shippingType` from DB into the validation preconditions

**Code pattern** in `orderService.ts` after reading the payment:

```typescript
// 3. Validate transition via state machine
if (fromStatus !== input.toStatus) {
  // Inject DB-level shippingType into validation — caller cannot fake it
  const validationInput = {
    actor: input.actor,
    preconditions: {
      ...input.preconditions,
      shippingType: payment.shippingType,
    },
  };
  const validation = validateTransitionFull(fromStatus, input.toStatus, validationInput);
  // ... existing error handling
}
```

**Dependencies**: None — this is self-contained within the two existing files.

**Risk**: Very low. If `payment.shippingType` is null (shouldn't happen for V2 orders), the gate will reject all pickup transitions by default (null !== 'recojo'), which is the safe failure mode.

---

### 3. Pickup Code Generation Move (orderService.ts)

**Approach**: Move the `generatePickupCode()` call from the `IN_TRANSIT` pre-hook to a new `READY_FOR_PICKUP` pre-hook. Keep the `IN_TRANSIT` pre-hook but guard it with `!isPickup` so delivery orders still get code generation on `IN_TRANSIT`.

**Code pattern**:

```typescript
// Current pre-hook (IN_TRANSIT):
if (input.toStatus === ORDER_STATUS_V2.IN_TRANSIT) {
  const code = generatePickupCode();
  updateData.pickupCode = code;
  metadata.pickupCode = code;
}

// Replace with:
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

**How `payment.shippingType` is available**: The `payment` variable is already in scope (read at step 1 of `transition()`). We add the `shippingType` guard to the existing `IN_TRANSIT` hook without breaking existing behavior.

**Regeneration safety**: If a pickup order was migrated from `IN_TRANSIT` to `READY_FOR_PICKUP` and already has a `pickupCode`, the pre-hook will overwrite it. This is fine — the code is regenerated on T15 as per the spec. If you want to preserve existing codes, add a guard:

```typescript
if (input.toStatus === ORDER_STATUS_V2.READY_FOR_PICKUP && !payment.pickupCode) {
  const code = generatePickupCode();
  updateData.pickupCode = code;
  metadata.pickupCode = code;
}
```

**Dependencies**: None.

**Risk**: Delivery orders that transition through `IN_TRANSIT` after the migration must still get their pickup code. The guard `payment.shippingType !== 'recojo'` ensures this.

---

### 4. Phase Mapping Update (SellerPhaseGuide.tsx)

**Approach**: Replace the existing `V2_PHASE_PICKUP` content.

**Code pattern**:

```typescript
// Before:
const V2_PHASE_PICKUP: Record<string, number> = {
  CREATED: 0,
  PAID: 0,
  PREPARING_ORDER: 0,
  WAITING_CUSTOMER_CONFIRMATION: 1,
  READY_TO_SHIP: 1,
  IN_TRANSIT: 1,      // ← wrong for pickup
  DELIVERED: 1,        // ← wrong for pickup
  COMPLETED: 2,
  ISSUE_REPORTED: 0,
  DISPUTE: 0,
  SELLER_TIMEOUT: 0,
  CANCELLED: 0,
};

// After:
const V2_PHASE_PICKUP: Record<string, number> = {
  CREATED: 0,
  PAID: 0,
  PREPARING_ORDER: 0,
  READY_FOR_PICKUP: 1,  // ← new
  PICKED_UP: 1,          // ← new
  COMPLETED: 2,
  ISSUE_REPORTED: 0,
  DISPUTE: 0,
  SELLER_TIMEOUT: 0,
  CANCELLED: 0,
  // Removed: WAITING_CUSTOMER_CONFIRMATION, READY_TO_SHIP, IN_TRANSIT, DELIVERED
};
```

**Dependencies**: None — purely a constant change.

**Risk**: If any existing pickup order is still in `IN_TRANSIT` or `DELIVERED` and hasn't been migrated, it will fall to `phaseMap[status] ?? phaseMapV1[status] ?? 0` — the V1 map lookup will hit first for legacy statuses, and the fallback to 0 means it shows Phase 0. This is acceptable during the migration window.

---

### 5. Server Actions (ticketActions.ts)

**Approach**: Add two new exported functions following the exact `notifyDelivery` pattern.

**Code pattern**:

```typescript
// ── markReadyForPickup ──────────────────────────────────────────
export async function markReadyForPickup(
  paymentId: string,
  businessId: string,
): Promise<NotifyDeliveryResult> {
  try {
    const [existingPayment] = await db
      .select({ status: payments.status, businessId: payments.businessId, version: payments.version })
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.businessId, businessId)))
      .limit(1);

    if (!existingPayment) return { success: false, error: 'Pedido no encontrado' };
    if (existingPayment.businessId !== businessId) return { success: false, error: 'No tienes permisos' };

    const expectedVersion = existingPayment.version ?? 0;

    if (env.orderFlowV2) {
      const result = await transition({
        paymentId,
        toStatus: ORDER_STATUS_V2.READY_FOR_PICKUP,
        actor: { type: 'seller', id: businessId },
        expectedVersion,
      });
      if (!result.success) return { success: false, error: result.error };
    } else {
      return { success: false, error: 'Pickup flow requiere orderFlowV2' };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: 'Error al marcar como listo para recojo' };
  }
}

// ── confirmPickedUp ─────────────────────────────────────────────
export async function confirmPickedUp(
  paymentId: string,
  businessId: string,
): Promise<NotifyDeliveryResult> {
  try {
    const [existingPayment] = await db
      .select({ status: payments.status, businessId: payments.businessId, version: payments.version })
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.businessId, businessId)))
      .limit(1);

    if (!existingPayment) return { success: false, error: 'Pedido no encontrado' };
    if (existingPayment.businessId !== businessId) return { success: false, error: 'No tienes permisos' };

    const expectedVersion = existingPayment.version ?? 0;

    if (env.orderFlowV2) {
      const result = await transition({
        paymentId,
        toStatus: ORDER_STATUS_V2.PICKED_UP,
        actor: { type: 'seller', id: businessId },
        expectedVersion,
      });
      if (!result.success) return { success: false, error: result.error };
    } else {
      return { success: false, error: 'Pickup flow requiere orderFlowV2' };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: 'Error al confirmar recojo' };
  }
}
```

**Dependencies**: `ORDER_STATUS_V2.READY_FOR_PICKUP` and `ORDER_STATUS_V2.PICKED_UP` must exist in `orderStatus.ts`.

**Risk**: Low. Pattern is identical to `notifyDelivery`. The `env.orderFlowV2` guard is for safety — pickup flow only makes sense in V2.

---

### 6. UI Component Changes

#### 6a. PhaseShippingSection.tsx

**Approach**: Add pickup action buttons, gated by `isPickup` + status.

```typescript
// New guards:
const showMarkReadyForPickup = isPickup && status === 'PREPARING_ORDER';
const showConfirmPickedUp = isPickup && status === 'READY_FOR_PICKUP';

// New props:
interface PhaseShippingSectionProps {
  // ... existing props
  onMarkReadyForPickup?: () => void;
  onConfirmPickedUp?: () => void;
  markingReady?: boolean;
  confirmingPickup?: boolean;
}

// In render, after existing buttons:
{showMarkReadyForPickup && (
  <div className={styles.actionsWrapper}>
    <Button variant="filled" onClick={onMarkReadyForPickup} disabled={markingReady}>
      <span className={styles.buttonInner}>
        {markingReady ? <RefreshCw size={18} /> : <Store size={18} />}
        {markingReady ? 'Preparando...' : 'Marcar como listo para recojo'}
      </span>
    </Button>
  </div>
)}

{showConfirmPickedUp && (
  <div className={styles.actionsWrapper}>
    <Button variant="filled" onClick={onConfirmPickedUp} disabled={confirmingPickup}>
      <span className={styles.buttonInner}>
        {confirmingPickup ? <RefreshCw size={18} /> : <CheckCircle size={18} />}
        {confirmingPickup ? 'Confirmando...' : 'Confirmar recojo'}
      </span>
    </Button>
  </div>
)}
```

#### 6b. ShippingSection.tsx — PickupContent

**Approach**: Add action buttons inside `PickupContent` when status allows. The `PickupContent` component needs new props for the callbacks.

```typescript
function PickupContent({
  order,
  status,
  onMarkReadyForPickup,
  onConfirmPickedUp,
  markingReady,
  confirmingPickup,
}: {
  order: ShippingSectionOrderItem;
  status: string;
  onMarkReadyForPickup?: () => void;
  onConfirmPickedUp?: () => void;
  markingReady?: boolean;
  confirmingPickup?: boolean;
}) {
  // ... existing pickup card with pickupCode display ...
  
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
    <StatusTag status="PICKED_UP" />
  )}
}
```

**Prop drilling**: `ShippingSection` (the default export) needs to accept and pass through the new props:

```typescript
interface ShippingSectionProps {
  order: ShippingSectionOrderItem;
  onMarkReadyForPickup?: () => void;
  onConfirmPickedUp?: () => void;
  markingReady?: boolean;
  confirmingPickup?: boolean;
}
```

#### 6c. PhaseContent.tsx

**Approach**: Add new props and pass them to `PhaseShippingSection`.

```typescript
interface PhaseContentProps {
  // ... existing
  onMarkReadyForPickup?: () => void;
  onConfirmPickedUp?: () => void;
  markingReady?: boolean;
  confirmingPickup?: boolean;
}

// In render, add to PhaseShippingSection:
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

**Important**: The existing `{isPickup && selectedPhase === 1}` block already renders `PhaseShippingSection` for pickup. The new buttons will appear there.

#### 6d. OrderModal.tsx

**Approach**: Add state, handlers, and wiring for the two new actions.

```typescript
// New state:
const [markingReady, setMarkingReady] = useState(false);
const [confirmingPickup, setConfirmingPickup] = useState(false);

// New handlers (follow handleNotifyDelivery pattern exactly):
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

// Pass to PhaseContent:
<PhaseContent
  // ... existing
  onMarkReadyForPickup={handleMarkReadyForPickup}
  onConfirmPickedUp={handleConfirmPickedUp}
  markingReady={markingReady}
  confirmingPickup={confirmingPickup}
/>
```

**Confirm dialogs**: Optionally wrap both handlers with confirmation dialogs (same pattern as `wrappedNotifyDelivery`). For this change, direct execution without confirmation is simpler and matches the "destructive-ish" nature (the seller is physically present). This can be added later.

**Dependencies**: Import `markReadyForPickup` and `confirmPickedUp` from the actions module.

**Risk**: Very low — all changes are additive props, existing props unchanged.

---

### 7. Timeout Rule (orderTimeouts.ts)

**Approach**: Add a 4th rule to `TIMEOUT_RULES` for the 7-day pickup auto-complete.

```typescript
{
  label: 'pickup-auto-complete',
  legacyStatus: ORDER_STATUS.EN_REPARTO,  // fallback — legacy pickup-like status
  v2Status: ORDER_STATUS_V2.READY_FOR_PICKUP,
  toStatus: ORDER_STATUS_V2.COMPLETED,
  hours: 168,  // 7 days
},
```

**Note on 72h from spec**: The spec says T17 fires 72h from PICKED_UP → COMPLETED (in spec table T17 says 72h). And separately a 7d auto-complete from READY_FOR_PICKUP if unclaimed. These are TWO different timeouts:
1. **T17**: PICKED_UP → COMPLETED after 72h (order was picked up, auto-complete)
2. **Pickup auto-complete**: READY_FOR_PICKUP → COMPLETED after 7d (never picked up)

Both should be added as separate rules or handled differently. For T17, since it's a system transition from PICKED_UP → COMPLETED after 72h, add a second rule:

```typescript
{
  label: 'picked-up-auto-complete',
  legacyStatus: 'en_reparto',  // fallback
  v2Status: ORDER_STATUS_V2.PICKED_UP,
  toStatus: ORDER_STATUS_V2.COMPLETED,
  hours: 72,  // 3 days
},
```

**Code pattern**: `processTimeouts()` iterates all rules, queries expired orders, and calls `transition()` for each. The version-locked update prevents double-processing. Both new rules follow this pattern exactly.

**Dependencies**: None. `processTimeouts()` already handles both legacy and V2 status strings via the `or()` query.

**Risk**: Low. If the query matches a legacy order whose status string happens to match (e.g., 'en_reparto' for legacy pickup), the `transition()` call will validate against the V2 state machine, which will reject invalid transitions safely.

---

### 8. Timeline Events (orderTimeline.ts + enums.ts + orderService.ts)

**Approach**: Add 2 new event types to the DB enum and to `mapTransitionToEvent` in `orderService.ts`.

**Enum additions** in `enums.ts`:

```typescript
export const orderTimelineEventTypeEnum = pgEnum('order_timeline_event_type', [
  'ORDER_CREATED',
  'ORDER_PAID',
  'ORDER_PREPARING',
  'ATTACHMENT_UPLOADED',
  'CUSTOMER_CONFIRMED',
  'CUSTOMER_REPORTED_ISSUE',
  'DISPUTE_CREATED',
  'SHIPPING_PAYMENT_PENDING',
  'SHIPPING_PAYMENT_CONFIRMED',
  'PICKUP_CODE_GENERATED',
  'ORDER_READY_TO_SHIP',
  'ORDER_IN_TRANSIT',
  'ORDER_DELIVERED',
  'ORDER_COMPLETED',
  'SELLER_TIMEOUT',
  'AUTO_APPROVED',
  'ORDER_CANCELLED',
  'ORDER_READY_FOR_PICKUP',  // ← new
  'ORDER_PICKED_UP',          // ← new
]);
```

**mapTransitionToEvent additions** in `orderService.ts` (add before the fallback):

```typescript
if (to === ORDER_STATUS_V2.READY_FOR_PICKUP) return 'ORDER_READY_FOR_PICKUP';
if (to === ORDER_STATUS_V2.PICKED_UP) return 'ORDER_PICKED_UP';
```

**DB migration**:

```sql
ALTER TYPE "public"."order_timeline_event_type" ADD VALUE 'ORDER_READY_FOR_PICKUP';
ALTER TYPE "public"."order_timeline_event_type" ADD VALUE 'ORDER_PICKED_UP';
```

**Dependencies**: `ORDER_READY_FOR_PICKUP` and `ORDER_PICKED_UP` must be added to enum BEFORE the code references them (TypeScript won't compile if they're not in the type union).

**Note**: PostgreSQL doesn't allow `ALTER TYPE ... ADD VALUE` inside a transaction block if subsequent statements use the new value. The migration must be structured as:
1. DDL statements outside a transaction (each in its own implicit transaction)
2. Or use a `SAVEPOINT` approach if using a library

For this project's pattern (raw SQL files), each `ALTER TYPE` statement runs in its own implicit transaction via the migration runner.

---

### 9. Migration

**Approach**: Create a new migration SQL file following the existing pattern in `migrations/`.

```sql
-- 0030_recojo_pickup_flow.sql

-- Step 1: Add new order statuses
ALTER TYPE "public"."order_status_v2" ADD VALUE 'READY_FOR_PICKUP';
ALTER TYPE "public"."order_status_v2" ADD VALUE 'PICKED_UP';

-- Step 2: Add new timeline event types
ALTER TYPE "public"."order_timeline_event_type" ADD VALUE 'ORDER_READY_FOR_PICKUP';
ALTER TYPE "public"."order_timeline_event_type" ADD VALUE 'ORDER_PICKED_UP';

-- Step 3: One-time migration — map existing recojo orders in IN_TRANSIT to READY_FOR_PICKUP
-- These orders were stuck in a delivery state that has no pickup meaning.
UPDATE "payments"
SET status = 'READY_FOR_PICKUP',
    version = version + 1,
    updated_at = NOW()
WHERE shipping_type = 'recojo'
  AND status = 'IN_TRANSIT';

-- Step 4: Also map any recojo orders in DELIVERED to READY_FOR_PICKUP (safety net)
UPDATE "payments"
SET status = 'READY_FOR_PICKUP',
    version = version + 1,
    updated_at = NOW()
WHERE shipping_type = 'recojo'
  AND status = 'DELIVERED';
```

**Dependencies**: Runs before the code deploys (or before the enum changes go live). The migration is purely additive — no column drops, no table rewrites.

**Risk**: Low for additive DDL. The one-time `UPDATE` is bounded by `shipping_type = 'recojo'` — only recojo orders are affected. The `version` increment ensures no version conflicts with concurrent operations (though these are rare for migrated orders).

---

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit — State machine | T15, T16, T17 validity; shipping gate rejection for non-recojo | `validateTransition` / `validateTransitionFull` unit tests |
| Unit — OrderService | Pickup code gen fires on READY_FOR_PICKUP; not on IN_TRANSIT for pickup; delivery IN_TRANSIT still fires | Mock DB, assert `updateData.pickupCode` |
| Integration — Server actions | `markReadyForPickup`, `confirmPickedUp` return correct results | Use test DB with real transactions |
| Integration — Timeouts | `processTimeouts` finds READY_FOR_PICKUP orders older than 7d and auto-completes | Seed DB with expired orders, run processor |
| E2E — UI | Button visibility per status + shippingType; success/failure flows | Playwright/Cypress on the modal |
| Regression | All existing delivery transitions unchanged | Run existing test suite |

## Migration / Rollout

1. Run migration SQL (additive — safe to apply before code deploy)
2. Deploy code changes
3. Existing recojo orders in `IN_TRANSIT` / `DELIVERED` are migrated by the one-time UPDATE
4. The new pickup flow is active immediately for new recojo orders

**Rollback**: Git revert the code change. Migration is forward-only (no DROP VALUE on PostgreSQL enums). The extra enum values remain unused but cause no harm.

## Estimated Line Count

| Area | Est. Lines |
|------|-----------|
| Core (status, state machine, service, timeouts) | ~60 |
| Server actions | ~60 |
| UI components (6 files) | ~100 |
| Enum definitions | ~10 |
| Migration SQL | ~20 |
| **Total** | **~280** |

Well under the 400-line budget.

## Open Questions

- [ ] Should `confirmPickedUp` have a confirmation dialog (like `wrappedNotifyDelivery`), or fire directly? — Direct matches the "physical handover" nature.
- [ ] Should T17 (PICKED_UP → COMPLETED, 72h) be a separate timeout rule or handled differently? — Added as a separate rule in this design.
- [ ] `orderStatus.ts` `URBANO_STATUS_MAP` — should new statuses `READY_FOR_PICKUP` / `PICKED_UP` have entries in the map for the modal hero badge? — Recommended but optional for initial delivery.
