# Seller Phase Guide Specification

## Purpose

Define the interactive 4-step phase guide that replaces the flat timeline in the seller dashboard order modal. The guide sits between the modal hero and the tabs, provides clickable phase navigation, and changes the Detalles tab content based on the selected phase while preserving Ticket and Ayuda tab behavior.

## Phase Mapping

The system SHALL map order statuses to 4 seller phases:

| #   | Phase      | V2 Statuses                                  | V1 Statuses                           |
| --- | ---------- | -------------------------------------------- | ------------------------------------- |
| 1   | PEDIDO     | CREATED, PAID, PREPARING_ORDER               | pending, paid, processing, analizando |
| 2   | VALIDACIÓN | WAITING_CUSTOMER_CONFIRMATION, READY_TO_SHIP | validando, aceptado, delivered        |
| 3   | ENVÍO      | IN_TRANSIT, DELIVERED                        | en_reparto, esperando_confirmacion    |
| 4   | CERRADO    | COMPLETED                                    | completed, finalizado                 |

## Requirements

### Requirement: PhaseGuide renders in modal hero area

The system MUST render a `SellerPhaseGuide` component below the modal hero section (order header) and above the tab bar, in the same position currently occupied by `renderTimeline()`.

#### Scenario: PhaseGuide replaces the flat timeline

- GIVEN the order modal is open
- WHEN the modal renders
- THEN `SellerPhaseGuide` SHALL appear between the modal hero and the tabs
- AND the flat timeline SHALL NOT be rendered

#### Scenario: Component does not render for closed modals

- GIVEN the order modal is closed
- WHEN the component tree renders
- THEN no `SellerPhaseGuide` SHALL be present in the DOM

### Requirement: Phase states and interactivity

Each phase MUST render in one of three visual states: **completed** (past phase), **current** (phase the order is in now), or **locked** (future phase not yet reached).

#### Scenario: Current phase is highlighted

- GIVEN an order with status `WAITING_CUSTOMER_CONFIRMATION`
- WHEN the guide renders
- THEN phase 2 (VALIDACIÓN) SHALL show the "current" state (highlighted indicator, accent color)
- AND phase 1 (PEDIDO) SHALL show "completed" state
- AND phases 3 and 4 SHALL show "locked" state

#### Scenario: Completed phase is clickable

- GIVEN an order with status `IN_TRANSIT` (current = phase 3)
- WHEN the seller clicks phase 2 (completed)
- THEN the Detalles tab content SHALL switch to phase 2 content
- AND no error SHALL occur

#### Scenario: Locked phase is not clickable

- GIVEN an order with status `PAID` (current = phase 1)
- WHEN the seller clicks phase 3 (locked)
- THEN the Detalles tab content SHALL NOT change
- AND the click SHALL produce no effect

#### Scenario: Locked phase shows lock indicator

- GIVEN an order with status `PAID`
- WHEN the guide renders
- THEN phase 3 SHALL display a lock icon (or equivalent visual indicator)
- AND the phase label SHALL have reduced opacity

### Requirement: Phase switching updates Detalles tab content

Clicking an unlocked phase MUST update the Detalles tab content to show sections relevant to that phase.

#### Scenario: Selecting PEDIDO shows buyer and product info

- GIVEN the order modal is open with any status
- WHEN the seller clicks phase 1 (PEDIDO)
- THEN the Detalles tab SHALL display: buyer info (DNI, phone, email), product info (title, image, price), and shipping address

#### Scenario: Selecting VALIDACIÓN shows ticket section inline

- GIVEN the order modal is open with status >= validando
- WHEN the seller clicks phase 2 (VALIDACIÓN)
- THEN the Detalles tab SHALL display the ticket upload/verify section inline (same content as `renderTicketSection()`)

#### Scenario: Selecting ENVÍO shows shipping actions

- GIVEN the order modal is open with status >= IN_TRANSIT
- WHEN the seller clicks phase 3 (ENVÍO)
- THEN the Detalles tab SHALL display: notify delivery / notify arrival buttons, tracking number, courier info, and shipping path

#### Scenario: Selecting CERRADO shows completion summary

- GIVEN the order modal is open with COMPLETED status
- WHEN the seller clicks phase 4 (CERRADO)
- THEN the Detalles tab SHALL display: completion summary, finalization deadline (if pending), and completed date

### Requirement: Dual status mapping (V1/V2)

The phase mapping MUST accept both V1 legacy statuses and V2 statuses as input, resolving both to the same 4-phase model.

#### Scenario: V1 status maps to correct phase

- GIVEN an order with V1 status `validando`
- WHEN the guide determines the current phase
- THEN the current phase SHALL be phase 2 (VALIDACIÓN)

#### Scenario: V2 status maps to correct phase

- GIVEN an order with V2 status `WAITING_CUSTOMER_CONFIRMATION`
- WHEN the guide determines the current phase
- THEN the current phase SHALL be phase 2 (VALIDACIÓN)

#### Scenario: Unknown status defaults to phase 1

- GIVEN an order with an unrecognized status string (e.g., `unknown_status`)
- WHEN the guide determines the current phase
- THEN the current phase SHALL default to phase 1 (PEDIDO)
- AND all phases except 1 SHALL render as locked

### Requirement: Tab preservation

The Ticket and Ayuda tabs MUST continue to render their existing content unchanged when the phase guide is present.

#### Scenario: Ticket tab unchanged

- GIVEN the order modal is open with the phase guide rendered
- WHEN the seller clicks the Ticket tab
- THEN `renderTicketSection()` SHALL render with identical behavior to before the phase guide was introduced

#### Scenario: Ayuda tab unchanged

- GIVEN the order modal is open with the phase guide rendered
- WHEN the seller clicks the Ayuda tab
- THEN `renderHelpTab()` SHALL render with identical content and behavior

### Requirement: Modal footer preserved

The modal footer (close button) MUST remain unchanged.

#### Scenario: Modal footer renders as before

- GIVEN the order modal is open with the phase guide
- WHEN the modal renders
- THEN the modal footer SHALL contain only the close button
- AND its behavior SHALL be identical to the existing implementation

### Requirement: Initial selected phase matches current order phase

When the modal opens, the selected phase MUST default to the phase that matches the order's current status.

#### Scenario: Modal opens on order in ENVÍO phase

- GIVEN an order with status `IN_TRANSIT`
- WHEN the seller opens the modal
- THEN the selected phase SHALL be phase 3 (ENVÍO)
- AND the Detalles tab SHALL show ENVÍO content immediately

### Requirement: Edge cases for terminal statuses

Terminal statuses (CANCELLED, DISPUTE, failed, refunded) MUST render a simplified guide — phase 4 locked — with all phases disabled beyond the terminal point.

#### Scenario: Cancelled order shows only PEDIDO unlocked

- GIVEN an order with status `CANCELLED`
- WHEN the guide renders
- THEN phase 1 SHALL be current
- AND phases 2-4 SHALL be locked

#### Scenario: Disputed order phases

- GIVEN an order with status `DISPUTE` and current phase was VALIDACIÓN
- WHEN the guide renders
- THEN phase 1 SHALL be completed, phase 2 SHALL be current
- AND phases 3-4 SHALL be locked

### Requirement: Content reuse

The system SHOULD reuse existing `renderTicketSection()`, shipping path rendering, and buyer/product info rendering functions from `RecentOrders.tsx` for phase content, rather than duplicating rendering logic.

#### Scenario: Phase 2 reuses renderTicketSection

- GIVEN an order with ticket uploaded
- WHEN the seller selects phase 2 (VALIDACIÓN)
- THEN the content panel SHALL call `renderTicketSection(order)` or equivalent shared rendering
- AND the rendered ticket card SHALL be identical to the Ticket tab version

## Removed Behavior

### `renderTimeline()` and `getTimelineSteps()`

These functions MUST be removed from `RecentOrders.tsx` after integration is verified. The corresponding CSS classes (`.timelineWrapper`, `.timeline`, `.timelineStep`, `.timelineIndicator`, `.timelineDot`, `.timelineLine`, `.timelineLabel`, `.stepCompleted`, `.stepCurrent`, `.stepFailed`, `.lineCompleted`) MAY be removed in a follow-up cleanup after verification.
