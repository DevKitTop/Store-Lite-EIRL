# Proposal: Checkout Buyer Name — Culqi "first_last_name" Fix

## Intent

Culqi's panel renders buyer "ernesto first_last_name" because the checkout sends a single-token name and `splitFullName` returns only `first_name` — Culqi shows a placeholder when `last_name` is missing. Fix at all three layers: prefill from Google auth, require two words (name + surname) with an inline Spanish error, and normalize single-token names to `{ first_name, last_name }` in the shared splitter.

## Scope

### In Scope
- **L1 Prefill**: `Checkout.tsx` — prefill `customerName` from Google `user_metadata.full_name` when empty.
- **L2 Validation**: 2-word requirement (Spanish-letters regex + word count ≥ 2) in `CheckoutPaymentStep.tsx` + shared guard in `useCheckoutPayment.ts`; add INLINE error text (Spanish) — currently none exists.
- **L2b Server**: zod refine in `src/features/billing/schemas.ts` (both charge + create-order schemas); field stays optional.
- **L3 Normalization**: `src/shared/payments/fullName.ts` — single token → `{ first_name: name, last_name: name }`; PRESERVE empty-name `{}` branch.
- **Tests**: RED first — update `tests/unit/fullName.test.ts` single-token case; new validator unit tests; `tests/unit/chargeRoute.test.ts` empty-name coverage stays green.

### Out of Scope
- Culqi panel rendering (external).
- Backfilling already-created orders/charges.
- Name policy changes on the auth/customer page.

## Capabilities

### New Capabilities
- `checkout-buyer-name`: buyer full-name capture (Google prefill), 2-word validation with inline error, and normalization of single-token names into `first_name`/`last_name` for Culqi antifraud/client_details.

### Modified Capabilities
- `payment-orders` (delta): R2 `client_details` SHALL include `first_name`/`last_name` when `customerName` is present (derived via `splitFullName`).

## Approach

3-layer defense-in-depth; every layer independently revertible:

| Layer | File | Change |
|-------|------|--------|
| 1 | `Checkout.tsx` (~L160-171) | `setCustomerName(user.user_metadata?.full_name \|\| '')` when empty |
| 2 | `CheckoutPaymentStep.tsx` L102-118 | word count ≥ 2 + inline error — Spanish copy (e.g. "Ingresá tu nombre y apellido") |
| 2 | `useCheckoutPayment.ts` L123-128 | shared guard parity — extract a single testable validator reused by both |
| 2b | `src/features/billing/schemas.ts` | zod refine (optional field, ≥ 2 words) |
| 3 | `fullName.ts` L21 | single token → duplicate into `last_name`; keep `{}` branch |

**Billing tradeoff decision — ACCEPT universal duplication.** Billing (`CulqiCheckout.tsx`, prefill feed from `PricingCard` L107) only pre-fills the Culqi modal; there is no API payload consequence. A single-token business name ("Ferreteria") renders as "Ferreteria Ferreteria" in the modal prefill — cosmetic, and strictly better than Culqi's "first_last_name" placeholder. No opt-in flag keeps `splitFullName`'s API unchanged: simplest and safest.

**schemas.ts refine — INCLUDED.** Billing never sends `customerName` through these route schemas (modal prefill only), so the refine cannot break the billing flow.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/[slug]/(app)/components/Checkout.tsx` | Modified | L1 prefill |
| `app/[slug]/(app)/components/CheckoutPaymentStep.tsx` | Modified | L2 + inline error |
| `app/[slug]/(app)/components/hooks/useCheckoutPayment.ts` | Modified | L2 shared guard |
| `src/shared/payments/fullName.ts` | Modified | L3 duplication |
| `src/features/billing/schemas.ts` | Modified | L2b zod refine |
| `tests/unit/fullName.test.ts` | Modified | RED first (L3) |
| `tests/unit/chargeRoute.test.ts` | Modified | extend empty-name coverage (stays green) |
| `app/api/payment/charge/route.ts`, `app/api/payment/create-order/route.ts` | Unchanged | consume `splitFullName` as-is |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Billing modal shows duplicated business name | Med | Cosmetic, modal prefill only; accepted — flagged to owner |
| zod refine rejects a legit single-word name server-side | Low | Client blocks first with inline error; field optional |
| chargeRoute empty-name test breaks | Low | `{}` branch preserved; coverage extended not altered |
| Previously-created single-token orders stay broken in panel | High | Out of scope — no backfill; all NEW orders fixed |

## Rollback Plan

Per-layer revert: L1 drop the `setCustomerName` call; L2 relax the validator; L2b remove the refine; L3 one-line revert in `fullName.ts`. No data migration involved.

## Dependencies

None. Uses the existing Vitest suite (`pnpm test:unit`, strict TDD — RED-GREEN-REFACTOR).

## Success Criteria

- [ ] New Culqi orders/charges always receive `last_name` — no more placeholders
- [ ] Single-token name in checkout is blocked with an inline Spanish error
- [ ] Google-authed checkout prefills "Nombre completo"
- [ ] `pnpm test:unit` green — revised single-token case, empty-name coverage, new validator tests
- [ ] Billing modal prefill still renders (duplication accepted, cosmetic)