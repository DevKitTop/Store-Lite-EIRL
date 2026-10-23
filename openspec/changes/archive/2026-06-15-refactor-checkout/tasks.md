# Tasks: Refactor Checkout.tsx

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2200+ |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: Foundation (hook + service) → PR 2: View components → PR 3: Orchestrator cutover |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Foundation: `usePaymentGateway` + `ticketService` | PR 1 | Zero behavioral change. New files only, no imports swapped. Trivially reviewable (~350 lines) |
| 2 | View components: 4 new sub-components | PR 2 | Pure extraction, line-by-line movable. Reviewable in isolation (~1200 lines) |
| 3 | Orchestrator cutover: rewrite Checkout.tsx | PR 3 | Wire everything together. Requires PR 1 + PR 2 merged first. Single file diff (~1700 removed, ~450 added) |

## Phase 1: Foundation — Hooks & Services

- [x] 1.1 Create `app/[slug]/services/ticketService.ts` — extract `generateTicketBlob(receiptRef)`, `uploadTicket(blob, orderNumber)`, `downloadLocally(blob, orderNumber)` from Checkout.tsx lines 96–180. Pure functions, no React state.
- [x] 1.2 Create `app/[slug]/components/hooks/usePaymentGateway.ts` — extract Culqi state (`culqiReady`, `isCulqiProcessing`, `isPaymentProcessing`), refs (`paymentGuardRef`, `culqiCallbackGuardRef`), `YAPE_LIMITS` constant, script loading effect (lines 344–365), `window.culqi` callback effect (lines 367–663), and `handlePayment` (lines 786–900). Export `UsePaymentGatewayOptions` + `UsePaymentGatewayReturn` interfaces.
- [x] 1.3 Add cleanup: set `window.culqi = undefined` in the callback effect's return cleanup (new — previously missing per design). Type-check pass.

## Phase 2: View Components

- [x] 2.1 Create `app/[slug]/components/CheckoutShippingStep.tsx` — extract step 1 UI (lines 1606–1757), location handlers (675–714), and `handleNextStep` validation (735–784). Props: `cartItems, totalAmount, shippingInfo, onShippingInfoChange, departments, provinces, districts, availableAgencies, businessAddress, businessCity, onNext`. Imports `Checkout.module.css`.
- [x] 2.2 Create `app/[slug]/components/CheckoutPaymentStep.tsx` — extract step 2 UI (lines 1758–2143): order summary, DNI/email inputs, Google auth section, payment methods list, privacy messages. Props: `cartItems, shippingInfo, onShippingInfoChange, finalTotal, email, onEmailChange, customerAuth, isCheckingSession, isAwaitingAuth, onGoogleSignIn, loading`. Imports `Checkout.module.css`.
- [x] 2.3 Create `app/[slug]/components/CheckoutSuccessView.tsx` — extract receipt portal (lines 904–1138): confetti, receipt with `Receipt` component, download button, tracking link. Props: `completedOrder, cartItems, totalAmount, finalTotal, shippingInfo, businessName, businessRuc, businessAddress, businessCity, businessLogoUrl, email, receiptRef, loading, showConfetti, onDownloadTicket, onClose, slug`. Imports `Checkout.module.css`.
- [x] 2.4 Create `app/[slug]/components/PaymentInstructionsView.tsx` — extract async payment portal (lines 1140–1521): CIP display for PagoEfectivo, QR for Billetera Móvil, Cuotéalo info, expiration countdown, `formatPaymentMethodName`. Props: `paymentInstructions, alert, onDismiss, onAlertClose`. Imports `Checkout.module.css` + `AlertSnackbar`.

## Phase 3: Orchestrator Cutover

- [x] 3.1 Rewrite `Checkout.tsx` — trim from ~2183 to ~450 lines. Retain: types (`CheckoutProps`, `ShippingInfo`, `Courier`), customer auth (206–316), shipping state (189–201), email state (204), derived select options (716–733), mount effect (335–341), Culqi close effect (182–187), alert state (318–329), `Mounted` guard (335–341, 902), loading overlay (1532–1578), header + stepper (1581–1602), main render composing 4 sub-components + overlays. Use `usePaymentGateway` hook and `ticketService`.
- [x] 3.2 Update imports in `Checkout.tsx` — remove direct `toBlob`/`html-to-image` import (moved to `ticketService`), remove direct Culqi-related state/refs/effects (moved to `usePaymentGateway`). Add imports for new hook + service + 4 sub-components.
- [x] 3.3 Verify no stale exports — `ShippingInfo` and `Courier` types remain exported from `Checkout.tsx` (used by `CartDrawer.tsx`, `ProductPreviewSheet.tsx`, `PurchaseActions.tsx`). Component default export stays `Checkout`.

## Phase 4: Verification

- [x] 4.1 Run `pnpm type-check` — PASSED (zero errors)
- [x] 4.2 Run `pnpm lint` — PASSED (0 errors, 0 new warnings; 778 pre-existing warnings untouched)
- [x] 4.3 Run existing `tests/unit/Checkout.test.tsx` — PASSED (8/8 tests pass; all 213 project-wide tests pass)
- [x] 4.4 Import audit — PASSED (all 4 consumers: `CartDrawer.tsx` → `'./Checkout'`, `ProductPreviewSheet.tsx` → `'./Checkout'`, `PurchaseActions.tsx` → `'../../../components/Checkout'`, `ProductItemView.tsx` → `'@app/[slug]/components/Checkout'`, `ProductCard.tsx` → `'@app/[slug]/components/Checkout'` — all unchanged, default export `Checkout` preserved)
- [ ] 4.5 Manual Culqi sandbox test — **REQUIRED BEFORE MERGE** (see critical paths below)
