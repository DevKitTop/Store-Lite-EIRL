# Proposal: Refactor Checkout.tsx

## Intent

`Checkout.tsx` (~2183 lines) mixes Culqi gateway logic, ticket generation (html-to-image + upload), multi-step UI, customer auth, and payment flow. Extract into focused hooks, services, and sub-components. Pure structural refactor — zero behavioral changes.

## Scope

### In Scope

- Extract Culqi lifecycle → `usePaymentGateway` hook (script loading, settings, options, open, callback dispatch, guards, ready state)
- Extract ticket generation → `ticketService` (html-to-image `toBlob`, Supabase storage upload, ticket URL update, local download)
- Extract step UIs → separate components: `CheckoutShippingStep`, `CheckoutPaymentStep`, `CheckoutSuccessView`, `PaymentInstructionsView`
- `Checkout.tsx` becomes a thin orchestrator composing the above

### Out of Scope

- Payment logic, Culqi API calls, order creation flow — NOT modified
- DB schema, API routes, webhook handlers — untouched
- CSS modules — extracted components keep `Checkout.module.css` imports

## Capabilities

### New Capabilities

None — pure refactor, no spec-level additions.

### Modified Capabilities

None — existing behavior preserved identically.

## Approach

1. **Hook extraction**: `usePaymentGateway` owns Culqi state (`culqiReady`, `isCulqiProcessing`), refs (`paymentGuardRef`, `culqiCallbackGuardRef`), and the `window.culqi` callback. Returns callback results via `onOrder` / `onToken` / `onError` handlers.
2. **Service extraction**: `ticketService` exports `generateTicketBlob(receiptRef)` and `uploadTicket(blob, orderNumber)` — pure functions, no component state.
3. **Component split**: Step 1 (shipping form), Step 2 (payment + order summary), Success view (receipt portal), Payment instructions (async methods portal) extracted as self-contained components. Data flows via props + callbacks.
4. **Integration**: `Checkout.tsx` wires state → hooks → sub-components. All logic paths preserved.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/[slug]/components/Checkout.tsx` | Modified | Reduced from ~2183 to < 500 lines |
| `app/[slug]/components/hooks/usePaymentGateway.ts` | New | Culqi lifecycle hook |
| `app/[slug]/services/ticketService.ts` | New | Ticket generation + upload |
| `app/[slug]/components/CheckoutShippingStep.tsx` | New | Step 1 UI (courier + location) |
| `app/[slug]/components/CheckoutPaymentStep.tsx` | New | Step 2 UI (summary + payment) |
| `app/[slug]/components/CheckoutSuccessView.tsx` | New | Receipt portal with download |
| `app/[slug]/components/PaymentInstructionsView.tsx` | New | Async payment instructions portal |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Payment flow regression (callback paths broken) | High | Follow existing specs; manual Culqi sandbox test |
| Guard refs decoupled across components | Medium | Pass refs as stable objects, not primitives |
| html-to-image DOM ref broken after split | Medium | Keep `receiptRef` in orchestrator, pass down |

## Rollback Plan

`git revert` the merge commit. No schema changes, no migrations — clean file-level revert.

## Dependencies

None.

## Success Criteria

- [ ] Checkout.tsx reduced from ~2183 to < 500 lines
- [ ] `pnpm test:unit`, `pnpm type-check`, `pnpm lint` all pass
- [ ] All 3 Culqi callback paths (order, token, error) execute correctly
- [ ] Ticket download + upload + storage URL update works identically
- [ ] Step 1 → Step 2 navigation + validation matches current behavior
