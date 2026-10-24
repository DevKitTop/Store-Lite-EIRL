# Proposal: Dashboard Interactive Seller Phase Guide

## Intent

The dashboard order modal has a flat, non-interactive 4-step timeline (PEDIDO → VALIDANDO → ENVÍO → CERRADO) that only shows progress visually. The customer-facing side (`/order/[token]`) already has a clickable phase guide that changes the detail content as the buyer clicks each phase. This inconsistency creates a worse seller experience — they cannot explore phase-specific actions or understand what step the order is in beyond a colored dot.

Adding `SellerPhaseGuide` brings the same interactive exploration to sellers: click a phase to see relevant actions and info for that step, with locked states for phases not yet reached.

## Scope

### In Scope
- New `SellerPhaseGuide.tsx` component (interactive 4-step guide, replaces flat timeline)
- `SellerPhaseGuide.module.css` (optional — inline styles preferred, matching `OrderPhaseGuide` pattern)
- Refactor `renderModalContent()` in `RecentOrders.tsx` so Detalles tab content changes per selected phase
- Remove `renderTimeline()` and `getTimelineSteps()` from `RecentOrders.tsx`
- Map seller statuses (V1: `validando`, `delivered`; V2: `WAITING_CUSTOMER_CONFIRMATION`, `READY_TO_SHIP`, `IN_TRANSIT`) to the 4 seller phases
- Locked state for phases the seller hasn't reached yet

### Out of Scope
- Backend/API changes (status data already flows through existing order object)
- Timeline event timestamps (not available in dashboard — no `validatedAt`, `inTransitAt`, `deliveredAt`)
- Ticket tab behavior changes
- Ayuda tab content changes
- Customer-side `OrderPhaseGuide` modifications

## Capabilities

### New Capabilities
- `seller-phase-guide`: Interactive 4-step phase guide for the seller dashboard order modal. Covers phase selection, content switching per phase, locked/unlocked state rendering, and dual-status mapping (V1/V2 statuses).

### Modified Capabilities
- None — this is a pure UI refactor within the existing dashboard modal. Spec-level behavior of order display, ticket upload, and help content remains unchanged.

## Approach

**Option A** (selected): Replace the inline `renderTimeline()` call with a new `SellerPhaseGuide` component placed in the modal hero area (same position as the current timeline). The guide shows 4 clickable phases. Clicking a phase sets a `selectedPhase` state — the Detalles tab content then renders phase-specific sections instead of the current monolithic info dump.

Detalles content per phase:
- **PEDIDO**: Buyer info + product info + shipping address (current "Comprador y Producto" + shipping sections)
- **VALIDACIÓN**: Ticket upload/verify section (moved from Ticket tab into inline phase view)
- **ENVÍO**: Notify delivery / Notify arrival buttons + tracking data + shipping path
- **CERRADO**: Completion summary + finalization deadline if pending

Locked phases render grayed-out content with a lock indicator. The Ticket tab and Ayuda tab remain as separate tabs with their existing content.

To keep the PR under the 400-line budget, this will be delivered as a single PR with an `size:exception` if the refactor + new component + CSS cleanup exceeds 400 lines, or split into 2 chained PRs: (1) new `SellerPhaseGuide` component + basic integration, (2) per-phase content restructuring.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/[slug]/dashboard/components/RecentOrders.tsx` | Modified | Replace `renderTimeline()`, add `selectedPhase` state, restructure modal content per phase |
| `app/[slug]/dashboard/components/SellerPhaseGuide.tsx` | New | Interactive 4-step phase guide component |
| `app/[slug]/dashboard/components/RecentOrders.module.css` | Modified | Remove unused timeline CSS classes |
| `app/[slug]/dashboard/components/SellerPhaseGuide.module.css` | New | Minimal styles if inline approach insufficient |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Breaking existing order modal behavior | Low | The guide is a drop-in replacement for `renderTimeline()` — same position, same data. Tab state (`activeTab`) is preserved. |
| Content duplication between Detalles and Ticket tab | Low | Ticket upload section renders INSIDE the VALIDACIÓN phase content, making it contextually available without needing the tab switch. The Ticket tab still works independently. |
| CSS regressions from timeline class removal | Low | Keep timeline CSS classes in module until verified. Remove in a follow-up cleanup. |

## Rollback Plan

1. Revert the `renderModalContent()` changes and restore `renderTimeline()` call
2. Delete `SellerPhaseGuide.tsx` and `SellerPhaseGuide.module.css`
3. If CSS classes were removed, restore them from the module file
4. If committed separately (2-PR split), revert only the problematic PR

## Dependencies

- `RecentOrders.tsx` order `status` field already contains all needed data (V1/V2 string values)
- No new API routes or database queries required

## Success Criteria

- [ ] `SellerPhaseGuide` renders in place of the flat timeline
- [ ] Clicking each of the 4 phases updates the Detalles tab content to show phase-relevant sections
- [ ] Phases beyond the current status show locked state (disabled click, lock icon)
- [ ] Ticket tab and Ayuda tab work identically to before
- [ ] Both V1 (`validando`, `delivered`) and V2 (`WAITING_CUSTOMER_CONFIRMATION`, `IN_TRANSIT`) statuses map correctly to phases
- [ ] All existing unit tests pass; no regressions in modal behavior
