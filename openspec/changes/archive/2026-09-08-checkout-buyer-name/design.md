# Design: Checkout Buyer Name — Culqi "first_last_name" Fix

## Technical Approach

Three independently revertible layers (spec R1-R4): (1) prefill `customerName` from Google `user_metadata.full_name` at both session call sites in `Checkout.tsx`; (2) extract ONE shared, isomorphic validator `src/shared/payments/buyerName.ts` consumed by the input UI, the `useCheckoutPayment` guard, and the zod refines (R2/R3); (3) normalize single-token names in `splitFullName` (R4). Defense-in-depth per proposal; route payloads unchanged.

## Architecture Decisions

### D1: Validator module location and exports

| Option | Tradeoff | Decision |
|---|---|---|
| **`src/shared/payments/buyerName.ts`** — `isTwoWordName`, `validateBuyerName`, `prefillBuyerName`, `BUYER_NAME_ERROR_MESSAGE` | One new file; mirrors `fullName.ts`; consumed by client components AND server schemas | **Chosen** |
| Colocate regex in each consumer | Duplication; drift risk (the exact bug class we're fixing) | Rejected |
| `src/features/payment/...` | Client-feature layering; wrong home for a rule also enforced by billing schemas | Rejected |

`buyerName.ts` is pure and isomorphic (no imports, no `'use client'`) — safe to import from `Checkout.tsx`/`CheckoutPaymentStep.tsx`/`useCheckoutPayment.ts` (client) and `src/features/billing/schemas.ts` (server routes).

### D2: Predicate + validator + shared message const

| Option | Tradeoff | Decision |
|---|---|---|
| `isTwoWordName(name)` predicate + `validateBuyerName(name)` returning the error string (or null) + exported `BUYER_NAME_ERROR_MESSAGE` | UI needs boolean (border state); guard/zod need the message; one const = single source of Spanish copy | **Chosen** |
| Validator only, UI re-derives | Duplicated rule logic | Rejected |
| Message literal inlined per consumer | Copy drift | Rejected |

```
export const BUYER_NAME_ERROR_MESSAGE = 'Ingresá tu nombre y apellido';
export function isTwoWordName(name: string): boolean;      // trim, non-empty, len>=3, Spanish letters, >=2 words
export function validateBuyerName(name: string): string | null; // null if empty/valid; else BUYER_NAME_ERROR_MESSAGE
export function prefillBuyerName(current: string, fullName?: string | null): string; // current.trim() ? current : fullName?.trim() || ''
```

`isTwoWordName`: `trim`; reject empty; reject `length < 3` (mirrors existing `min(3)` in both UI and zod — keeps prior constraint); reject non-`/^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s]+$/`; accept `trimmed.split(/\s+/).length >= 2`.

### D3: Empty-input semantics (spec R2 scenario 3)

| Option | Tradeoff | Decision |
|---|---|---|
| Guard keeps explicit empty branch → existing toast; UI error only when non-empty; `validateBuyerName('')` → null | "Existing empty-field handling applies unchanged"; 2-word error never shown for empty input | **Chosen** |
| Empty treated as 2-word failure everywhere | Breaks R2 scenario 3; empty shows "Ingresá tu nombre y apellido" | Rejected |

`useCheckoutPayment.ts` L123-128 becomes: `!trimmedName` → keep toast `'Por favor, ingresá tu nombre completo (mínimo 3 letras).'`; else `validateBuyerName(trimmedName)` → `onError(...)` + return.

### D4: Prefill seam (spec R1)

| Option | Tradeoff | Decision |
|---|---|---|
| Pure `prefillBuyerName(current, fullName)` + functional `setCustomerName((prev) => prefillBuyerName(prev, user.user_metadata?.full_name))` at BOTH google call sites (L170-area, L204-area) | Unit-testable; no stale closure; honors "when empty"; buyer can still edit (controlled input) | **Chosen** |
| Inline ternary in effects | Untestable seam; duplicated in 2 places | Rejected |
| New effect watching `customerAuth` | Extra render cycle; races with typing | Rejected |

### D5: zod refine

| Option | Tradeoff | Decision |
|---|---|---|
| `.refine((d) => !d.customerName || isTwoWordName(d.customerName), { message: BUYER_NAME_ERROR_MESSAGE, path: ['customerName'] })` on BOTH `chargeRequestSchema` (chained after existing refine) and `createOrderRequestSchema` | Field stays optional; absent name passes; closed server-side hole | **Chosen** |
| Skip server refine | Client-only defense; curl/API could still send single tokens | Rejected |

Keep existing `.trim().min(3)` — redundant but harmless; minimal diff.

### D6: splitFullName normalization (spec R4)

| Option | Tradeoff | Decision |
|---|---|---|
| `fullName.ts` L21 → `return { first_name: name, last_name: name }` | Always sends `last_name` to Culqi (also fixes billing modal prefill — cosmetic "Ferreteria Ferreteria", accepted per proposal §Billing tradeoff) | **Chosen** |
| Leave as `{ first_name: name }` | Dashboard placeholder persists | Rejected |

## Data Flow

```
Google session ──► Checkout.tsx effect ──► prefillBuyerName ──► customerName state
                                                                      │
        ┌─────────────────────────────────────────────────────────────┤
        ▼                                                             ▼
CheckoutPaymentStep (isTwoWordName ─ inline error)          useCheckoutPayment (validateBuyerName ─ toast)
        └───────────────► createOrder / charge ──► zod refines (isTwoWordName ─ 400)
                                                          ▼
                                        splitFullName ──► {first_name, last_name} ──► Culqi
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/shared/payments/buyerName.ts` | Create | `isTwoWordName`, `validateBuyerName`, `prefillBuyerName`, `BUYER_NAME_ERROR_MESSAGE` |
| `tests/unit/buyerName.test.ts` | Create | Validator + prefill unit tests |
| `tests/unit/billingSchemas.test.ts` | Create | R3 refines for both schemas |
| `src/shared/payments/fullName.ts` | Modify | L21 single-token duplication |
| `tests/unit/fullName.test.ts` | Modify | L16-19 RED: expect `{ first_name: 'Juan', last_name: 'Juan' }` |
| `app/[slug]/(app)/components/Checkout.tsx` | Modify | Prefill at 2 google call sites |
| `app/[slug]/(app)/components/CheckoutPaymentStep.tsx` | Modify | L108-118: validator + inline `<p>` "Ingresá tu nombre y apellido" |
| `app/[slug]/(app)/components/hooks/useCheckoutPayment.ts` | Modify | L123-128 shared guard |
| `src/features/billing/schemas.ts` | Modify | Refine both schemas |
| `tests/unit/Checkout.test.tsx` | Modify | 2 new integration tests |
| `app/api/payment/charge/route.ts`, `create-order/route.ts`, `tests/unit/chargeRoute.test.ts` | Unchanged | Empty-name `{}` preserved (L245-262 stays green) |

## Testing Strategy (strict TDD — RED → GREEN each step)

| Order | RED test | GREEN impl |
|---|---|---|
| 1 | `fullName.test.ts` single-token duplication (+ padded-single-token case) | `fullName.ts` L21 |
| 2 | `buyerName.test.ts` (isTwoWordName: valid/accent/multi/single/empty/bad-chars/trim; validateBuyerName; prefillBuyerName) | create `buyerName.ts` |
| 3 | `billingSchemas.test.ts` (R3: two-word OK, single-token rejected w/ message, absent OK — both schemas) | `schemas.ts` refines |
| 4 | `Checkout.test.tsx`: (a) google session w/ `full_name` prefills input; (b) single-token name → inline error shown + `Culqi.open` NOT called | `Checkout.tsx`, `CheckoutPaymentStep.tsx`, `useCheckoutPayment.ts` |

Final gate: full `pnpm test:unit` green; `chargeRoute.test.ts` untouched. Style follows existing conventions: dynamic `await import('@/shared/...')`, RTL `render`/`userEvent` with `mockGetSession`, `window.Culqi` mock.

## Migration / Rollout

No migration, no flags. Per-layer revert (proposal §Rollback): drop prefill call / relax validator / remove refine / revert L21.

## Open Questions

None blocking. Confirm during apply: the empty-name guard toast keeps the legacy copy "mínimo 3 letras" (D3) — flagging to product for future copy cleanup is optional, out of scope.