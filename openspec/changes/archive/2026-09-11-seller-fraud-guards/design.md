# Design: Seller Fraud Guards

## Technical Approach

Server-side mutation guards freeze buyer-facing identity and product title/price fields once a business or product has payment history in a locking status. One shared payment-awareness helper (indexed count query) composes into 3 server actions before any write, plus a zod `updateBusinessDataSchema` for the canonical action. UI disabling is a UX mirror only — the guard is authoritative (spec `seller-fraud-guards`).

## Architecture Decisions

### D1: Locked-status mapping (spec → DB enum)

The spec's "SUCCESSFUL (confirmed) OR PENDING (in-progress)" maps to the real lowercase enum (`src/core/database/schema/orders.ts:65-81`). Exploration's "count ALL payments" is superseded by the edited spec.

| Spec state | DB `payments.status` | Locks? |
|---|---|---|
| SUCCESSFUL (confirmed) | `paid`, `completed`, `delivered`, `en_reparto`, `not_delivered` | ✅ |
| PENDING (in-progress) | `pending`, `validando` | ✅ |
| failed / abandoned | `failed` | ❌ |
| Reversed / contested | `disputed`, `refund_requested`, `refunded` | ❌ |

**Choice**: export `LOCKING_PAYMENT_STATUSES` const next to the helper; changeable in one line.
**Rationale**: only money-in-pipeline states freeze identity; reversed/contested transactions did not durably materialize.

### D2: Shared payment-awareness helper

**Choice**: `hasLockingPayments(input: { businessId?: string; productId?: string }): Promise<boolean>` in new `src/core/orders/paymentGuards.ts` (payments domain home — `orderService.ts`/`orderTimeouts.ts` already query `payments` from here).
**Alternatives**: inline queries per action (3x duplication); DB function/RLS (out of scope). **Rationale**: one query shape, indexed, reusable for all three guards + future UI flag.

```ts
const [{ count }] = await db.select({ count: sql<number>`count(*)` })
  .from(payments)
  .where(and(
    input.businessId ? eq(payments.businessId, input.businessId)
                     : eq(payments.productId, input.productId!),
    inArray(payments.status, LOCKING_PAYMENT_STATUSES),
  ));
return count > 0;
```

Uses existing `idx_payments_business_id`, `idx_payments_product_id`, `idx_payments_status`. `count(*)` follows repo convention (`products.ts:369-372`).

### D3: Canonical action + zod (T1/T2)

**Choice**: canonical `updateBusinessData` is `app/actions/business.ts:164-232` — the 17-field version called via `useBusinessActions` → `useBusinessSettings` → `BusinessSettingsModal`. The WhatsApp-only `updateBusinessData` (`settings/actions.ts:536-563`) is untouched (contact field = cosmetic). Add `updateBusinessDataSchema` to `src/features/business/schemas.ts`: all fields `.optional()` (partial update), constraints mirroring `createBusinessSchema` (name 3–100; taxId 11–20 alphanumeric regex; legalRep; email format), Spanish messages, `z.infer` type. `whatsappNumber` stays out of zod — existing 9-digit normalize (business.ts:206-213) runs first.

Guard composition (new flow in `updateBusinessData`):

```
auth → ownership (extend findFirst columns: identity fields)
→ whatsapp normalize → zod safeParse → hasLockingPayments({ businessId })
→ if locked: diff identity keys present in data vs DB current → block
→ write
```

**Errors**: this action returns `ActionState` (`src/types/actions.ts`) — `{ error }` / `{ success, message }`; guards return `{ error }`, never throw.
**Identity blocklist**: `name, taxId, legalRepName, legalRepRole, legalRepPhone, legalRepEmail, address, departamento, provincia, distrito, city, country`. Cosmetic/unlocked: `description, storeType, whatsappNumber, email` (+ logo/cover actions). The modal always submits all fields, so the diff compares against DB values from the extended ownership query, not key presence.

### D4: Slug guard (T2)

`updateBusinessSlug` (`settings/actions.ts:34-122`): insert `if (await hasLockingPayments({ businessId })) return { success: false, error: '<frozen>' }` after the plan gate (line 47), before slug fetch. Conforms to this file's `SlugActionState` convention.

### D5: Product guard (T3)

`updateProduct` (`products.ts:345-489`): extend `existingProduct` fetch (line 354) with `price`, `secondPrice`. After `requireAccess` (line 352) and fetch:

```ts
if (await hasLockingPayments({ productId }) &&
    (normalizedProduct.name !== existingProduct.title ||
     String(normalizedProduct.price) !== existingProduct.price ||
     String(normalizedProduct.secondPrice ?? '') !== String(existingProduct.secondPrice ?? '')))
  return { success: false, productId: null, error: '<frozen>' };
```

Returns the object directly (matches plan-check pattern at line 375-380; no throw). Unlocked: stock, images, description, availability, brand.

**Frozen error (shared const)**: `'Este campo está bloqueado porque el negocio/producto tiene pagos registrados.'` — Spanish per repo.

### D6: UI disable mechanism (T4)

| Surface | Data source | Wiring |
|---|---|---|
| Old modal sections | New server action `getBusinessLockState(businessId)` in `app/actions/business.ts` | `useBusinessSettings` fetches on open → `locked` prop → `NegocioTab` → sections: `disabled` on `name` (IdentitySection), `city` (ContactSection), `legalRepRole` (LegalSection) + notice `<p>` |
| New settings slug editor | `settings/page.tsx` (server) computes `businessLocked` via helper | prop → `SettingsClient` → `BusinessSection`: disable slug input + notice |
| Product editor | New server action `getProductLockState(productId)` in `products.ts` | `StorageContent` fetches on edit-open → `hasPayments` prop → `CreateProductSheet` → `BasicInfoSection` (`name`) + `StockPriceSection` (`price`, `secondPrice`) disabled + notice |

### D7: Interactions with other payment-aware flows

- **Paid-plan gating** (`getBusinessEntitlements` over `businessSubscriptions`): orthogonal table; no double counting, distinct "plan vs payments" semantics.
- **Culqi double-submit guard** (`useCulqiCallback` `paymentGuardRef`): client-side only; unaffected.
- **Order status transitions** (`orderService`): read-only coupling; no changes to state machine.

## File Changes

| File | Action | Description |
|---|---|---|
| `src/core/orders/paymentGuards.ts` | Create | `LOCKING_PAYMENT_STATUSES` + `hasLockingPayments()` |
| `src/features/business/schemas.ts` | Modify | Add `updateBusinessDataSchema` |
| `app/actions/business.ts` | Modify | Zod + identity guard in `updateBusinessData`; add `getBusinessLockState` |
| `app/[slug]/(app)/settings/actions.ts` | Modify | Slug payment guard |
| `src/features/storage/actions/products.ts` | Modify | Product guard; add `getProductLockState` |
| `app/[slug]/(app)/settings/page.tsx` | Modify | Compute `businessLocked`, pass prop |
| `app/[slug]/(app)/settings/components/SettingsClient.tsx` | Modify | BusinessSection disables slug when locked |
| `BusinessSettingsModal.tsx`, `NegocioTab.tsx`, 3 section files | Modify | Thread `locked` prop; `disabled` + notice |
| `StorageClient.tsx`, `CreateProductSheet.tsx`, `BasicInfoSection.tsx`, `StockPriceSection.tsx` | Modify | `hasPayments` prop; `disabled` + notice |
| `tests/unit/server-actions/sellerFraudGuards.test.ts` | Create | Business + slug guard tests |
| `tests/unit/server-actions/updateProductGuard.test.ts` | Create | Product guard tests |

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | `hasLockingPayments` status filter | Table test: each status → locked/unlocked; mock `db.select` chain |
| Unit | `updateBusinessData` (zod + guard) | `vi.mock('@/core/database/client')` chain + mock helper; lock/unlock per identity vs cosmetic fields |
| Unit | `updateBusinessSlug` guard | Clone `settingsActions.test.ts` mock pattern (requireAccessOnId, entitlements, db) |
| Unit | `updateProduct` guard | Clone `createProduct.test.ts` pattern (requireAccess, db chains) |

**Mock seams**: mock the helper module (`@/core/orders/paymentGuards`) with `vi.hoisted` for action tests; mock `db.select().from().where()` chains returning `[{ count }]` for helper tests — exactly the repo pattern in `tests/unit/server-actions/{settingsActions,createProduct}.test.ts`.

## Migration / Rollout

No migration, no flags, no schema changes — existing indexes cover both queries. Rollback: delete 2 test files, revert 3 action files + schema + prop plumbing. Estimated < 400 changed lines, single PR.

## Open Questions

None blocking. If product later decides `disputed`/`refunded` must lock, it is a one-line change to `LOCKING_PAYMENT_STATUSES`.