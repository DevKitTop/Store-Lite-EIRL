# Proposal: RECOJO In-Store Pickup Flow

## Intent

RECOJO (in-store pickup) reuses delivery states — IN_TRANSIT, READY_TO_SHIP, DELIVERED — that have no pickup meaning. This causes locked UI, unreachable pickup codes, and incorrect phase mapping. We need a dedicated pickup flow with semantically correct states, transitions, and seller actions, without touching the delivery pipeline.

## Scope

### In Scope

1. New statuses `READY_FOR_PICKUP`, `PICKED_UP` in ORDER_STATUS_V2 + DB enum
2. New state machine transitions: `PREPARING_ORDER→READY_FOR_PICKUP`, `READY_FOR_PICKUP→PICKED_UP`, `PICKED_UP→COMPLETED`
3. Pickup code generation moved from IN_TRANSIT hook to READY_FOR_PICKUP hook in orderService.ts
4. Updated SellerPhaseGuide V2_PHASE_PICKUP: READY_FOR_PICKUP/PICKED_UP→Phase 1, COMPLETED→Phase 2
5. Seller action "Mark as ready for pickup" (→READY_FOR_PICKUP) in PhaseShippingSection
6. Seller action "Confirm picked up" (→PICKED_UP) in PhaseShippingSection
7. Updated ShippingSection PickupContent with prominent pickup code + action buttons
8. New pickup-specific server actions (or adapted finalizationActions)
9. Updated notifyDelivery to support pickup context
10. State machine validation: pickup statuses only valid for `shippingType = 'recojo'`
11. Timeline event types for new transitions
12. Timeout: auto-complete 7d after READY_FOR_PICKUP if never picked up

### Out of Scope

- Delivery/agency flow — 100% unchanged
- Customer-facing tracking portal (`app/[slug]/order/[token]/`)
- Schema changes beyond adding 2 statuses to existing enum
- CSS/styling beyond what new UI elements require
- Delivery flow tests

## Capabilities

### New Capabilities

- None (modifies existing `order-flow` capability)

### Modified Capabilities

- `order-flow`: Adds pickup-specific statuses, transitions, code gen, and UI actions; phase mapping updated for RECOJO shipping type

## Approach

1. **Add statuses**: Extend `orderStatusEnumV2` in `enums.ts` with `READY_FOR_PICKUP`, `PICKED_UP`. Generate migration.
2. **Extend state machine**: Add 3 new transitions to TRANSITION_MATRIX. Gate pickup statuses via shippingType check in `validateTransitionFull`.
3. **Move code gen**: Switch pickup code generation from `IN_TRANSIT` → `READY_FOR_PICKUP` hook in `orderService.ts`. Keep IN_TRANSIT gen for non-pickup.
4. **Phase mapping**: Update `V2_PHASE_PICKUP` — remove IN_TRANSIT/DELIVERED, add READY_FOR_PICKUP/PICKED_UP→Phase 1, COMPLETED→Phase 2.
5. **UI actions**: Add buttons to `PhaseShippingSection` and `PickupContent` — gated by `isPickup`. Wire through `OrderModal` as new handlers (not reusing delivery handlers).
6. **Server actions**: Add `markReadyForPickup` and `confirmPickedUp` actions using `transition()` facade.
7. **Timeout rule**: Add `pickup-auto-complete` — 7d from READY_FOR_PICKUP → COMPLETED.
8. **Timeline**: Add `ORDER_READY_FOR_PICKUP`, `ORDER_PICKED_UP` to timeline event enum and `mapTransitionToEvent`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/core/database/schema/enums.ts` | Modified | +2 statuses to orderStatusEnumV2 |
| `src/core/orders/orderStatus.ts` | Modified | +2 statuses in ORDER_STATUS_V2 |
| `src/core/orders/orderStateMachine.ts` | Modified | +3 transitions, shippingType gate |
| `src/core/orders/orderService.ts` | Modified | Pickup code moves to READY_FOR_PICKUP |
| `src/core/orders/orderTypes.ts` | Modified | +2 timeline event types |
| `src/core/orders/orderTimeouts.ts` | Modified | +1 timeout rule (7d pickup) |
| `app/[slug]/dashboard/components/SellerPhaseGuide.tsx` | Modified | V2_PHASE_PICKUP remap |
| `app/[slug]/dashboard/components/PhaseContent.tsx` | Modified | Pickup action routing |
| `app/[slug]/dashboard/components/PhaseShippingSection.tsx` | Modified | Pickup action buttons |
| `app/[slug]/dashboard/components/ShippingSection.tsx` | Modified | PickupContent actions |
| `app/[slug]/dashboard/components/OrderModal.tsx` | Modified | Pickup action handlers |
| `src/features/dashboard/actions/finalizationActions.ts` | Modified | Pickup finalization path |
| `src/features/dashboard/actions/ticketActions.ts` | Modified | adapt notifyDelivery for pickup |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Shipping type gate missed during pickup transition | Low | validateTransitionFull checks shippingType |
| Existing pickup orders in wrong states (IN_TRANSIT) | Low | One-time migration: map IN_TRANSIT→READY_FOR_PICKUP for recojo orders |
| Pickup code lost for orders already past IN_TRANSIT | Low | Regenerate on READY_FOR_PICKUP if missing |
| UI regressions in delivery phase content | Low | All changes gated by `isPickup` — delivery paths unchanged |

## Rollback Plan

- Git revert the change. Schema roll-forward (no drops). Revert `orderService.ts` pickup code gen to IN_TRANSIT. Delivery flow is untouched in all states.

## Dependencies

- Migration: additive DDL to `orderStatusEnumV2` (no column drops)

## Success Criteria

- [ ] New pickup flow: CREATED → PAID → PREPARING_ORDER → READY_FOR_PICKUP → PICKED_UP → COMPLETED
- [ ] Pickup code generates on READY_FOR_PICKUP, not IN_TRANSIT
- [ ] Pickup statuses rejected for non-recojo orders
- [ ] Seller can mark "ready for pickup" and "confirm picked up" from modal
- [ ] Pickup code visible in PickupContent when available
- [ ] All delivery transitions unchanged (existing tests pass)
