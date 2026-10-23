# Tasks: Checkout Buyer Name — Culqi "first_last_name" Fix

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 230–300 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | splitFullName single-token duplication (R4) | PR 1 | RED: fullName.test.ts → GREEN: fullName.ts; chargeRoute.test.ts untouched |
| 2 | Shared validator buyerName.ts (R2) | PR 1 | RED: buyerName.test.ts → GREEN: buyerName.ts |
| 3 | Zod refines on both billing schemas (R3) | PR 1 | RED: billingSchemas.test.ts → GREEN: schemas.ts |
| 4 | Google full-name prefill on Checkout (R1) | PR 1 | RED: Checkout.test.tsx (a) → GREEN: Checkout.tsx both call sites |
| 5 | Inline error + payment guard (R2) | PR 1 | RED: Checkout.test.tsx (b) → GREEN: CheckoutPaymentStep.tsx + useCheckoutPayment.ts |

## Work Unit 1: splitFullName single-token duplication (R4)

- [x] 1.1 RED: Update `tests/unit/fullName.test.ts` single-token expectation to `{ first_name: 'Juan', last_name: 'Juan' }`; add trimmed/padded single-token case; run `pnpm test:unit` → expect fail
- [x] 1.2 GREEN: Modify `src/shared/payments/fullName.ts` `splitFullName` (L21) → `return { first_name: name, last_name: name }`; run → fullName + `chargeRoute.test.ts` green (route file untouched)

## Work Unit 2: Shared two-word validator (R2)

- [x] 2.1 RED: Create `tests/unit/buyerName.test.ts` — `isTwoWordName` (valid, accents, multi-token, single-token, empty, length<3, bad chars, trim), `validateBuyerName` (empty→null, valid→null, invalid→message), `prefillBuyerName` (current wins; empty current + fullName; null/undefined fullName; trims); run → fail (module missing)
- [x] 2.2 GREEN: Create `src/shared/payments/buyerName.ts` — isomorphic (no imports, no 'use client'): `BUYER_NAME_ERROR_MESSAGE = 'Ingresá tu nombre y apellido'`, `isTwoWordName`, `validateBuyerName` (null when empty/valid), `prefillBuyerName`; run → green

## Work Unit 3: Server-side refine (R3)

- [x] 3.1 RED: Create `tests/unit/billingSchemas.test.ts` — for BOTH `chargeRequestSchema` and `createOrderRequestSchema`: two-word name parses; single-token rejected with `BUYER_NAME_ERROR_MESSAGE` at path `customerName`; absent name parses; run → fail
- [x] 3.2 GREEN: Modify `src/features/billing/schemas.ts` — chain `.refine((d) => !d.customerName || isTwoWordName(d.customerName), { message: BUYER_NAME_ERROR_MESSAGE, path: ['customerName'] })` on both schemas; keep existing `.trim().min(3)`; run → green

## Work Unit 4: Google full-name prefill (R1)

- [x] 4.1 RED: Extend `tests/unit/Checkout.test.tsx` (test a): google session with `full_name 'Ernesto Pérez'` prefills "Nombre completo" input and stays editable; session without `full_name` leaves field empty, no error; run → fail
- [x] 4.2 GREEN: Modify `app/[slug]/(app)/components/Checkout.tsx` — import `prefillBuyerName`; at BOTH google call sites (L170-area, L204-area) add `setCustomerName((prev) => prefillBuyerName(prev, user.user_metadata?.full_name))`; run → green

## Work Unit 5: Inline error + payment guard (R2)

- [x] 5.1 RED: Extend `tests/unit/Checkout.test.tsx` (test b): single-token submit → inline "Ingresá tu nombre y apellido" shown AND `window.Culqi.open` NOT called; empty input → no two-word error, legacy empty handling unchanged; run → fail
- [x] 5.2 GREEN: Modify `app/[slug]/(app)/components/CheckoutPaymentStep.tsx` (L108-118) — consume `isTwoWordName` + `BUYER_NAME_ERROR_MESSAGE`; render inline `<p>` for non-empty invalid input
- [x] 5.3 GREEN: Modify `app/[slug]/(app)/components/hooks/useCheckoutPayment.ts` (L123-128) — `!trimmedName` → keep legacy toast `'Por favor, ingresá tu nombre completo (mínimo 3 letras).'`; else `validateBuyerName(trimmedName)` → `onError` + return (Culqi NOT opened); run full `pnpm test:unit` → green (final gate)