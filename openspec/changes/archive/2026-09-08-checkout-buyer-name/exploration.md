# Exploration: checkout-buyer-name

> Fix for Culqi dashboard showing buyer name as "ernesto first_last_name" (missing last_name).

## Current State

The Culqi panel's "Cliente" section is populated from `antifraud_details` (charges) / `client_details` (orders), both built with `splitFullName(customerName)`. When the checkout sends a single-token name, `splitFullName` returns only `first_name`, so Culqi never receives a `last_name` and its panel renders the placeholder text.

Confirmed chain (dev payment "ernesto" → `{first_name: "ernesto"}`, no last_name):

1. **Checkout.tsx** — `customerName` state starts empty (`app/[slug]/(app)/components/Checkout.tsx:112`). Google session detection (`Checkout.tsx:160-171`) stores `user.user_metadata?.full_name || ''` into `customerAuth.name` (L165) and prefills ONLY `email` (L170). `setCustomerName` is never called → no Google prefill today. Name flows to the payment hook at L287 and to `CheckoutPaymentStep` at L581-582.
2. **CheckoutPaymentStep.tsx** — "Nombre completo" input at L102-118. Visual error state (L108-114) only fires when `length > 0 && (length < 3 || !lettersRegex)` — no 2-word requirement, and there is NO inline error text (red border class only), no helper message.
3. **useCheckoutPayment.ts** — client guard at L123-128: `trimmedName.length < 3 || !/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]+$/.test(trimmedName)` → error "mínimo 3 letras". No 2-word check. Order flow passes `customerName: customerName.trim()` to `createOrder` (L149-157). Token/order callback (`src/features/payment/hooks/useCulqiCallback.ts`) forwards `customerName` to `chargePayment` in both flows (order L164, token L236).
4. **paymentApi.ts** — conditional passthrough in both helpers: `...(params.customerName ? { customerName } : {})` (L83 chargePayment, L128 createOrder).
5. **charge/route.ts** — `antifraud_details` built with `...splitFullName(customerName)` at L127-133 (import L28). Comment at L127-128 explicitly states this populates the CulqiPanel "Cliente" section. **Order flow:** `client_details` in `create-order/route.ts` L169-173 (import L17) also relies on `splitFullName`. Both confirmed.
6. **fullName.ts** — L16-18: empty/null/undefined → `{}`; **L21: `if (firstSpace === -1) return { first_name: name }`** — the exact culprit for the dashboard bug. Empty-name behavior documented and tested.
7. **CulqiCheckout.tsx (billing)** — second consumer (L4 import, L46 `const { first_name, last_name } = splitFullName(customerName)`, L52-53 conditional spread into modal prefill). Caller `app/pricing/components/PricingCard.tsx` auto-fills `buyerFullName` with the BUSINESS name (L107 `setBuyerFullName(biz.name || '')`) — single-token business names are plausible. Safety-net change is safe here (prefill improves; no API payload consequence in billing, CulqiCheckout only prefills the modal).
8. **schemas.ts** — server-side: `customerName: z.string().trim().min(3).optional()` in BOTH `chargeRequestSchema` (L19-23) and `createOrderRequestSchema` (L65-69). No 2-word requirement, no letters regex, optional.
9. **auth/customer/page.tsx** — L116: `name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Usuario'`. Google full_name is available for prefill; email-prefix fallback can itself be a single token → safety net still valuable.

## Affected Areas

- `app/[slug]/(app)/components/Checkout.tsx` — layer 1 (prefill customerName from customerAuth.name / user_metadata.full_name)
- `app/[slug]/(app)/components/CheckoutPaymentStep.tsx` — layer 2 (2-word validation + inline error text)
- `app/[slug]/(app)/components/hooks/useCheckoutPayment.ts` — layer 2 guard (L123-128) parity
- `src/shared/payments/fullName.ts` — layer 3 (single-token duplication)
- `src/features/billing/schemas.ts` — optional server-side 2-word delta (shared by both route schemas)
- `app/api/payment/charge/route.ts`, `app/api/payment/create-order/route.ts` — no change needed; they consume splitFullName
- `src/features/billing/components/CulqiCheckout.tsx` — benefits from layer 3 (shared consumer, no change needed)
- Tests: `tests/unit/fullName.test.ts` (WILL BREAK), plus new tests for 2-word validation

## Approaches

1. **3-layer defense-in-depth (prefill + 2-word validation + splitFullName duplication)** — the proposed plan
   - Pros: Fixes the dashboard for ALL paths (Google-authed, typed, legacy/pending orders); single-token names can no longer reach Culqi without a last_name; billing modal prefill improves too
   - Cons: Touches 4+ files; existing `fullName.test.ts` single-word test must be updated (RED first under strict TDD)
   - Effort: Low-Medium

2. **Layer 3 only (splitFullName duplication)**
   - Pros: One-file change; guarantees last_name always present
   - Cons: "ernesto" would render as "ernesto ernesto" — cosmetic fix only; UX still lets users type one word; Google-authed buyers still get no prefill
   - Effort: Low

3. **Layer 2 only (require 2 words)**
   - Pros: Prevents the bad input at the source
   - Cons: Existing single-token names already sent remain broken for that purchase; no prefill ergonomics; server-side schema still permissive (defense only client-side)
   - Effort: Low

## Recommendation

Adopt the 3-layer plan (Approach 1). All three layers are verified feasible with precise insertion points:
- Layer 1: in `Checkout.tsx` session effects (L160-171 area) — `setCustomerName(user.user_metadata?.full_name || customerAuth.name || '')` next to the existing `setEmail`.
- Layer 2: extend the shared validation (letter-regex + word count ≥ 2) in BOTH `CheckoutPaymentStep.tsx` L108-114 (visual + add inline error text, which currently does not exist) and `useCheckoutPayment.ts` L123-128 (guard). Optionally mirror as a zod refine in `schemas.ts` L19-23/L65-69 — recommend including it; both routes already validate through these schemas, low cost, closes server-side hole.
- Layer 3: `fullName.ts` L21 → `return { first_name: name, last_name: name }` (keep `if (!name) return {}` at L18 so the charge-route "omit keys when customerName missing" test stays green).

## Risks

- `tests/unit/fullName.test.ts:16-19` asserts current single-token behavior (`{ first_name: 'Juan' }`) — **must be updated**; this is the natural RED test for strict TDD (strict_tdd: true, `pnpm test:unit`, openspec/config.yaml:12).
- `tests/unit/chargeRoute.test.ts:245-262` asserts antifraud_details omits first/last_name when customerName absent — Layer 3 MUST preserve the empty-name `{}` branch.
- Billing flow (`PricingCard` L107) can send a single-token BUSINESS name into splitFullName; duplication changes billing modal prefill from "Ferreteria" only to "Ferreteria Ferreteria". Acceptable (modal prefill only), but confirm with product owner if undesirable.
- Culqi's exact panel rendering of a missing last_name is external and unverifiable from this repo — the fix is robust regardless (we now always send last_name).
- `CheckoutPaymentStep` currently has NO inline error text for the name field — layer 2 must add one (not just reuse the border class).
- No existing unit test covers name validation in `CheckoutPaymentStep`/`useCheckoutPayment` — new tests required (Checkout.test.tsx L98-99 only covers the happy path with 'Juan Perez').

## Ready for Proposal

Yes. All 10 verification points confirmed with evidence. Proposal should cover the 3 layers, the fullName test update, new 2-word validation tests, and the optional schemas.ts refine.