# Design: Refactor Checkout.tsx

## Technical Approach

Structural decomposition of `Checkout.tsx` (~2183 lines) into 6 focused files. Zero behavioral changes. The orchestrator retains step coordination, customer auth, alert state, and `receiptRef`. Three extraction targets: `usePaymentGateway` (Culqi lifecycle), `ticketService` (blob + upload), and 4 view components (step 1, step 2, success, instructions).

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|----------|--------|----------|-----------|
| Culqi refs ownership | Inside `usePaymentGateway` | Split across hook+orchestrator | `paymentGuardRef`/`culqiCallbackGuardRef` are read+written by both `handlePayment` and the `window.culqi` callback — splitting would break atomicity of guard logic |
| `isPaymentProcessing` ownership | Inside `usePaymentGateway` | Orchestrator | State is set inside the culqi callback effect (lines 383, 521, 634, 661) and read by handlePayment validation — same argument as refs |
| Select options derivation | In the orchestrator, passed as props | Inside each component | `departments`/`provinces`/`districts`/`availableAgencies` depend on `shippingInfo` via synchronous derivation (lines 716–733) — computing inside the step keeps it co-located, but passing from orchestrator keeps component interface cleaner; **decision: compute in orchestrator, pass as props** for single source of truth |
| Google auth logic | Stays in orchestrator, callbacks passed as props | Extracted to own hook | Session check effect (228–254), message listener (256–290), and `handleGoogleSignIn` (292–316) read/write `customerAuth`/`isCheckingSession`/`isAwaitingAuth` — no other component needs this state, and extracting it would create a dependency on `supabase`/router that adds complexity disproportionate to the reduction |
| `handleValidation` (step 1) | Inside `CheckoutShippingStep` | Orchestrator | Validation is UI-specific and only concerns step 1 fields — extracting it with the component is natural and removes 50 lines from orchestrator |
| CSS modules | Each component imports from `Checkout.module.css` | Separate CSS files | Proposal spec: no new CSS files. Shared classnames (`input`, `formGroup`, `orderSummaryCard`, etc.) are already in `Checkout.module.css` — all components import the same module |

## Data Flow

```
  CheckoutProps (from CartDrawer, ProductItemView, etc.)
       │
       ▼
  ┌─────────────────────────────────────────────────┐
  │  Checkout (orchestrator)                        │
  │  ─ state: step, alert, customerAuth, receiptRef │
  │  ─ derives: departments, provinces, districts   │
  │  ─ session check effect + message listener      │
  └──┬───────┬────────┬─────────┬──────────┬───────┘
     │       │        │         │          │
     ▼       ▼        ▼         ▼          ▼
  shipping  payment  success  instructions  loading
  step      step     view     view          overlay

  ┌───────────────────┐     ┌────────────────────┐
  │ usePaymentGateway │     │ ticketService      │
  │ (hook, internal)  │     │ (pure functions)   │
  │                   │     │                    │
  │ script loading    │     │ generateTicketBlob │
  │ callback handler  │     │ uploadTicket       │
  │ paymentGuardRef   │     │ └→ Supabase + API  │
  │ openCulqi + sett. │     └────────────────────┘
  └───────────────────┘
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `app/[slug]/components/Checkout.tsx` | Modify | Reducer from ~2183 → ~450 lines. Retains orchestrator only. |
| `app/[slug]/components/hooks/usePaymentGateway.ts` | **Create** | Culqi lifecycle + guard refs + `handlePayment`. |
| `app/[slug]/services/ticketService.ts` | **Create** | `generateTicketBlob`, `uploadTicket`, `downloadLocally`. |
| `app/[slug]/components/CheckoutShippingStep.tsx` | **Create** | Step 1 UI: courier toggle + shipping form + validation. |
| `app/[slug]/components/CheckoutPaymentStep.tsx` | **Create** | Step 2 UI: order summary + DNI/email + Google auth UI + payment methods. |
| `app/[slug]/components/CheckoutSuccessView.tsx` | **Create** | Receipt portal + confetti + download button + navigation. |
| `app/[slug]/components/PaymentInstructionsView.tsx` | **Create** | Async payment portal: CIP code, QR, expiration. |

## Extraction Boundaries (Exact Line Ranges)

### `usePaymentGateway`
| Source lines | What | Verbatim? |
|---|---|---|
| 75, 78–79 | State: `culqiReady`, `isCulqiProcessing`, `isPaymentProcessing` | Yes (type annotations) |
| 93–94 | Refs: `paymentGuardRef`, `culqiCallbackGuardRef` | Yes |
| 344–365 | Effect: Culqi script loading | Yes |
| 367–663 | Effect: `window.culqi` callback registration (entire 296-line effect) | **Yes — CRITICAL** |
| 786–900 | `handlePayment`: validation + order creation + Culqi.open | **Yes — CRITICAL** |
| 823–869 | YAPE_LIMITS constant (from lines 23–26) | Moved inside hook |
| — | Cleanup: `window.culqi = undefined` on unmount | **Added** — previously missing |

The hook signature:

```typescript
interface UsePaymentGatewayOptions {
  culqiPublicKey?: string;
  businessId: string;
  businessName: string;
  cartItems: [CartItem, ...CartItem[]];
  shippingInfo: ShippingInfo;
  email: string;
  customerAuth: CustomerAuth | null;
  finalTotal: number;
  slug: string;
  businessAddress?: string;
  businessCity?: string;
  onOrderPaid: (order: { orderNumber: string; paymentMethod: string; trackingToken?: string }) => void;
  onPaymentInstructions: (instructions: PaymentInstructionsData) => void;
  onError: (message: string) => void;
}
interface UsePaymentGatewayReturn {
  culqiReady: boolean;
  isCulqiProcessing: boolean;
  isPaymentProcessing: boolean;
  handlePayment: () => Promise<void>;
}
```

### `ticketService`
| Source lines | What | Verbatim? |
|---|---|---|
| 96–180 | `handleDownloadTicket` logic | Yes, refactored into 3 functions |

```typescript
export async function generateTicketBlob(receiptRef: RefObject<HTMLDivElement | null>): Promise<Blob>;
export async function uploadTicket(blob: Blob, orderNumber: string): Promise<{ publicUrl: string } | null>;
export function downloadLocally(blob: Blob, orderNumber: string): void;
```

### `CheckoutShippingStep`
| Source lines | What | Verbatim? |
|---|---|---|
| 1606–1757 | Step 1 JSX (courier toggle, pickup card, form grid, shipping summary) | Yes — wrapped in component |
| 735–784 | `handleNextStep` validation logic | Yes — moved inside component as local function |
| 675–714 | Location handlers | Yes — kept inside component as local functions |

Props: `cartItems, totalAmount, shippingInfo, onShippingInfoChange, departments, provinces, districts, availableAgencies, businessAddress, businessCity, onNext`

### `CheckoutPaymentStep`
| Source lines | What | Verbatim? |
|---|---|---|
| 1758–2143 | Step 2 JSX (order summary, DNI, email, Google auth section, payment methods) | Yes |

Props: `cartItems, shippingInfo, finalTotal, email, onEmailChange, customerAuth, isCheckingSession, isAwaitingAuth, onGoogleSignIn, loading`

### `CheckoutSuccessView`
| Source lines | What | Verbatim? |
|---|---|---|
| 904–1138 | Full success portal (confetti, receipt, download button, navigation) | Yes |

Props: `completedOrder, cartItems, totalAmount, finalTotal, shippingInfo, businessName, businessRuc, businessAddress, businessCity, businessLogoUrl, email, receiptRef, loading, onDownloadTicket, onClose`

### `PaymentInstructionsView`
| Source lines | What | Verbatim? |
|---|---|---|
| 1140–1521 | Full instructions portal (CIP, QR, Cuotéalo, expiration, alert) | Yes — `formatPaymentMethodName` moves inside |

Props: `paymentInstructions, alert, onDismiss, onAlertClose`

### What Stays in Orchestrator
- Lines 1–18 (imports, trimmed), 28–57 (types, exported), 59–73 (component + destructured props)
- State: `step` (72), `loading` (73), `mounted` (74), `showReceipt` (76), `showConfetti` (77), `completedOrder` (80–84), `paymentInstructions` (85–91), `receiptRef` (92), `alert` (318–329)
- Customer auth: all (206–316)
- Shipping state (189–201), email state (204)
- Derived select options (716–733)
- Mount effect (335–341), Culqi close effect (182–187)
- `handleDownloadTicket` — reduced to orchestrator calls `ticketService` functions
- Main render: lines 902–2183 restructured to compose 4 sub-components

## Critical Paths (Sandbox Testing Required)

| # | Path | Risk | Before Merge |
|---|------|------|-------------|
| 1 | Culqi order callback → `paymentInstructions` set | `window.culqi` reassignment broken | Manual test: trigger Culqi.order with `pago_efectivo` in sandbox |
| 2 | Culqi token callback → `/api/payment/charge` | Guard refs not reset on error | Manual test: Culqi.token flow with error response |
| 3 | `handlePayment` → order creation → Culqi.open | `paymentGuardRef.current = false` not reached | Manual test: double-click pay button |
| 4 | Ticket generation (html-to-image) | `receiptRef` stale after split | Manual test: download ticket in success view |
| 5 | Auth popup message listener | `event.origin` check with hooks | Manual test: Google sign-in popup flow |

## Migration / Rollout

Single PR. No feature flags, no migration. Merge only after:
- `pnpm type-check` passes
- `pnpm lint` passes
- All 10 existing test cases in `Checkout.test.tsx` pass without modification (tests mock `import('@/app/[slug]/components/Checkout')` — path unchanged)
- Manual Culqi sandbox test on critical path #1, #2, #3

Rollback: `git revert` the merge commit. Clean file-level revert.

## Open Questions

None. All boundaries are line-mapped and type-checkable.
