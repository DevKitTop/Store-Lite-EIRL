# Design: Dashboard Interactive Seller Phase Guide

## Technical Approach

Replace the flat `renderTimeline()` call in the order modal with a new interactive `SellerPhaseGuide` component that mirrors the customer-side `OrderPhaseGuide` pattern. The guide sits between the modal hero and the tab bar. Clicking an unlocked phase sets `selectedPhase` state — the Detalles tab content renders phase-specific sections instead of the current monolithic scroll. Both tabs (Ticket, Ayuda) remain unchanged. A `getSellerPhase` utility maps any V1/V2 status to the 4-phase model.

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|-------------|-----------|
| Component location | New `SellerPhaseGuide.tsx` in `dashboard/components/` | Inline in `RecentOrders.tsx` | Follows existing component separation pattern (like `OrderPhaseGuide`). Keeps RecentOrders.tsx under 2K lines and testable |
| Styling approach | Inline styles (same as `OrderPhaseGuide`) | CSS module | Consistency with customer-side guide. No CSS module needed — all styles use `var(--md-sys-color-*)` tokens |
| Phase content switching | Conditional render blocks in `renderModalContent()` by `selectedPhase` | New sub-components per phase | Keeps refactor minimal. Existing render functions (`renderTicketSection`, `renderShippingPathModal`) are reused inline — no need to extract them yet |
| Phase mapping utility | Standalone `getSellerPhase()` function exported from `SellerPhaseGuide.tsx` | Inline map in RecentOrders | The mapping is self-contained logic (V1/V2 → phase index). Exporting it makes the component testable and the mapping auditable |
| Locked phase behavior | `onClick` is a no-op. Phase step renders reduced opacity + lock icon | Gray out entire content panel | Content panel stays on the last valid selection. Locked phases are visually distinct but don't trap the user — they can still click completed phases |
| Terminal status handling | CANCELLED/DISPUTE/ISSUE_REPORTED → currentPhase=0, all other phases locked | No guide at all for terminal | Keeps the UI consistent. The content shows PEDIDO info with a status-appropriate message |

## Data Flow

```
Order Modal Opens (setSelectedOrder)
        │
        ▼
getSellerPhase(order.status) ──► { currentPhase: 0-3, phaseStates: [...] }
        │
        ├──► SellerPhaseGuide (receives { currentPhase, phaseStates, selectedPhase, onSelect })
        │         │
        │         └── Renders 4 clickable step indicators with completed/current/locked states
        │
        ├──► selectedPhase state (useState, defaults to currentPhase)
        │         │
        │         └── Click phase i ──► if unlocked ──► setSelectedPhase(i)
        │
        └──► Detalles tab content (conditional rendering by selectedPhase)
                  │
                  ├── phase 0 (PEDIDO)    → buyer/product section + shipping address
                  ├── phase 1 (VALIDACIÓN) → renderTicketSection(order)
                  ├── phase 2 (ENVÍO)      → renderShippingPathModal + courier/tracking info
                  └── phase 3 (CERRADO)    → completion seal + deadline
```

## Phase Mapping Contract

```typescript
// src/features/dashboard/utils/seller-phase.ts  — OR —  inline in SellerPhaseGuide.tsx

const SELLER_PHASES = ['PEDIDO', 'VALIDACIÓN', 'ENVÍO', 'CERRADO'] as const;

interface SellerPhaseInfo {
  currentPhase: number;     // 0-3
  phaseStates: ('completed' | 'current' | 'locked')[];
}

// V2 status → phase index
const V2_PHASE: Record<string, number> = {
  CREATED: 0, PAID: 0, PREPARING_ORDER: 0,
  WAITING_CUSTOMER_CONFIRMATION: 1, READY_TO_SHIP: 1,
  IN_TRANSIT: 2, DELIVERED: 2,
  COMPLETED: 3,
  // terminal — simplified guide
  ISSUE_REPORTED: 0, DISPUTE: 0, SELLER_TIMEOUT: 0, CANCELLED: 0,
};
// V1 status → phase index (same destinations)
const V1_PHASE: Record<string, number> = { /* per spec table */ };

function getSellerPhase(status: string): SellerPhaseInfo;
```

Terminal statuses (`CANCELLED`, `DISPUTE`, `ISSUE_REPORTED`, `failed`, `refunded`, `SELLER_TIMEOUT`) map to `currentPhase=0` with phases 1-3 locked. Unknown statuses default to phase 0 with all but phase 0 locked.

## Content per Phase

| Phase | Renders | Reuses |
|-------|---------|--------|
| PEDIDO (0) | Buyer DNI/phone/email, product title/image/price, shipping address (from existing Detalles "Comprador y Producto" + address) | Existing `UnifiedCard` JSX inline in renderModalContent |
| VALIDACIÓN (1) | Ticket upload form, ticket preview, status badge, notify buttons | `renderTicketSection(order)` — identical to Ticket tab |
| ENVÍO (2) | Courier name, tracking number, pickup code, shipping path, notify delivery/arrival buttons | `renderShippingPathModal(order)`, notify button JSX from Ticket tab |
| CERRADO (3) | Completion summary, finalization deadline (if pending), completedAt date | Existing `permanentSeal` + `finalizationPending` JSX |

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `app/[slug]/dashboard/components/SellerPhaseGuide.tsx` | Create | Interactive 4-step phase guide component with inline styles, `getSellerPhase()` mapping utility, phase indicator rendering, and locked state handling |
| `app/[slug]/dashboard/components/RecentOrders.tsx` | Modify | Add `selectedPhase` state (defaults to `getSellerPhase(order.status).currentPhase`); replace `renderTimeline()` call with `<SellerPhaseGuide>`; restructure Detalles tab content to switch on `selectedPhase`; remove `getTimelineSteps()` and `renderTimeline()` |

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | `getSellerPhase()` — all V1 statuses, all V2 statuses, terminal statuses, unknown | Vitest table-driven — verify correct currentPhase + phaseStates per input |
| Integration | SellerPhaseGuide renders, click completed/current phase switches content, click locked phase no-ops | @testing-library/react — mount with mock phase data, fireEvent.click, assert content changes |
| Integration | Ticket tab and Ayuda tab render identically after guide introduction | @testing-library/react — compare snapshot content with current behavior |

## Open Questions

- [ ] Should payment info (method, subtotal, total) render in PEDIDO phase or stay removed? The spec doesn't mention it — propose keeping it in PEDIDO as it's part of order detail.
- [ ] V1 status `processing` maps to PEDIDO per the phase table — confirm this is correct for seller context.
