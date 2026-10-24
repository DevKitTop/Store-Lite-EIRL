# Exploration: Seller Fraud Guards

> Change: `seller-fraud-guards` | Phase: explore | Artifact store: openspec
> Generated: 2026-09-10

---

## Current State

### 1. `updateBusinessData` — Business identity mutation (NO guard, NO zod)

**File**: `app/actions/business.ts:164-232`

- **Signature**: `updateBusinessData(businessId: string, slug: string, data: Partial<{name, description, address, departamento, provincia, distrito, storeType, whatsappNumber, taxId, personType, country, city, email, legalRepName, legalRepRole, legalRepPhone, legalRepEmail}>): Promise<ActionState>`
- **Auth**: Supabase user check + manual `ownerId` comparison (lines 188-201)
- **Validation**: Only `whatsappNumber` is sanitized (9-digit check, lines 206-213). ALL other fields pass through raw — no zod, no format checks.
- **DB write**: Raw spread `{ ...sanitizedData, updatedAt }` into `db.update(businesses)` (lines 216-222)
- **Error convention**: `{ error: string }` on failure, `{ success: true, message: string }` on success (matches `ActionState` from `src/types/actions.ts`)
- **No payment awareness**: Zero checks against `payments` table.

**CRITICAL DISCOVERY — Two `updateBusinessData` functions exist**:

| Location | Signature | Fields handled |
|---|---|---|
| `app/actions/business.ts:164-232` | `(businessId, slug, data: Partial<{17 fields}>)` | name, taxId, legalRep, address, city, description, etc. |
| `app/[slug]/(app)/settings/actions.ts:536-563` | `(businessId, slug, data: {whatsappNumber?: string \| null})` | whatsappNumber only |

The plan's T1+T2 target is the FIRST function (`app/actions/business.ts`). The second function is WhatsApp-only and does not need a fraud guard.

### 2. `updateProduct` — Product mutation (NO payment awareness)

**File**: `src/features/storage/actions/products.ts:345-489`

- **Signature**: `updateProduct(businessSlug: string, productId: string, productData: ProductActionInput): Promise<{success, productId, error}>`
- **Auth**: `requireAccess(businessSlug, 'products.edit')` — resolves `businessId` internally (line 352)
- **No payment check**: Freely rewrites `title`, `price`, `description`, images, stock, etc. (lines 415-438)
- **Media rewrite**: Deletes ALL `productMedia` rows then reinserts (lines 441-452) — non-atomic
- **Error convention**: `{ success: false, productId: null, error: string }` on failure, `{ success: true, productId, error: null }` on success

**Key detail for T3**: The guard needs `businessId`, which is resolved at line 352 from the slug. The payment count query can use this resolved `businessId` + the `productId` parameter.

### 3. `updateBusinessSlug` — Slug change (NO order awareness)

**File**: `app/[slug]/(app)/settings/actions.ts:34-122`

- **Signature**: `updateBusinessSlug(businessId: string, newSlug: string): Promise<SlugActionState>`
- **Auth**: `requireAccessOnId(businessId, 'business.edit')` (line 39)
- **Plan gate**: blocks `basico` plan (line 45)
- **Slug mechanics**: format check (lines 49-59), alias recorded in `business_slug_aliases` (line 84-85), uniqueness check via `isBusinessSlugTaken` (line 74)
- **PostHog event**: `business_slug_updated` (lines 109-115)
- **No payment check**: Old tracking links 404 after slug change (strict slug match in tracking page)

**T2 touchpoint**: The payment count guard should be inserted AFTER the plan gate (line 47) and BEFORE the slug uniqueness check (line 74), around line 60.

### 4. Payments Model — Schema & Query Cost

**File**: `src/core/database/schema/orders.ts:40-125`

```sql
-- payments table (Drizzle schema)
businessId: uuid('business_id') → businesses.id ON DELETE RESTRICT  (line 44-46)
productId:  uuid('product_id')  → products.id  ON DELETE RESTRICT  (line 47-49)
```

**Indexes** (lines 117-121):
- `idx_payments_business_id` — index on `businessId` ✅ (count-by-business is an index scan)
- `idx_payments_product_id` — index on `productId` ✅ (count-by-product is an index scan)
- `idx_payments_status` — index on `status`

**Query pattern needed** (no pre-existing helper):
```ts
// Business guard — count payments for this business
const [{ count }] = await db
  .select({ count: sql<number>`count(*)` })
  .from(payments)
  .where(eq(payments.businessId, businessId));

// Product guard — count payments for this product
const [{ count }] = await db
  .select({ count: sql<number>`count(*)` })
  .from(payments)
  .where(eq(payments.productId, productId));
```

Both are cheap (indexed, O(log n) scan). The `orderService.ts` does NOT have a payment-count helper — this pattern is only used for entitlements checks in `createProduct` (lines 192-195). A shared helper is NOT needed for this minimal scope — inline count queries in each guard are sufficient.

**Status filter consideration**: The plan does not specify filtering by payment status. `payments.count(businessId) > 0` counts ALL payments including `pending`, `failed`, etc. This is the correct behavior — even a pending/failed payment means the business has transaction history that should protect identity fields.

### 5. Zod Conventions

**File**: `src/features/business/schemas.ts` (create-business schema)
```ts
import { z } from 'zod';
export const createBusinessSchema = z.object({
  commercialName: z.string().min(3, 'El nombre comercial debe tener al menos 3 caracteres').max(100, ...),
  taxId: z.string().min(11, 'El RUC/NIT debe tener al menos 11 caracteres').max(20, ...),
  legalRepName: z.string().min(3, 'El nombre del representante es obligatorio'),
  // ... Spanish error messages, .min/.max/.regex/.optional
});
export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
```

**File**: `src/features/billing/schemas.ts` (charge request schema)
```ts
export const chargeRequestSchema = z.object({...}).refine(...)
export type ChargeRequestInput = z.infer<typeof chargeRequestSchema>;
```

**Convention summary**:
- Schemas live in `src/features/{domain}/schemas.ts` or co-located with actions
- Spanish error messages
- `z.infer<typeof schema>` for type export
- Dynamic import pattern used in some places: `const { schema } = await import('module')`

**T1 recommendation**: Create `src/features/business/schemas.ts` updateBusinessData schema (extend the existing file). The schema should validate ALL accepted fields with appropriate constraints (name min/max, taxId format 11-20 chars, email format, phone regex, etc.).

### 6. UI Forms — Business Settings

**Two UI paths exist for editing business data**:

#### A. `BusinessSettingsModal` (old modal, `src/features/business/components/`)

| Section | Component | Editable fields | Already disabled |
|---|---|---|---|
| Identity | `IdentitySection.tsx` | name, storeType, description | (none) |
| Contact | `ContactSection.tsx` | city | whatsappNumber, email, address, country |
| Legal | `LegalSection.tsx` | legalRepRole | taxId, personType, legalRepName, legalRepPhone, legalRepEmail |

Uses `useBusinessActions` hook → calls `updateBusinessData(businessId, slug, formData)` from `app/actions/business.ts`.

**T4 scope for this UI**: The guard will block `name`, `taxId`, `legalRep*`, `address`, `city` on the server side. The UI already has most legal fields disabled. The only fields that need UI disabling when payments exist:
- `name` in `IdentitySection.tsx` (line 74-81)
- `city` in `ContactSection.tsx` (line 63-68)
- `legalRepRole` in `LegalSection.tsx` (line 65-69)

#### B. `SettingsClient` (new settings page, `app/[slug]/(app)/settings/components/SettingsClient.tsx`)

Shows legal info as read-only `ListItem` components (lines 817-868). Identity fields are NOT editable here — they're display-only. **T4 has no work for this UI path.**

#### C. Slug editor (SettingsClient.tsx)

The slug editor in SettingsClient is functional and calls `updateBusinessSlug`. When payments exist, the slug field should be disabled or show a tooltip. The slug field is in `BusinessSection` (lines 94+).

### 7. UI Forms — Product Editor

**File**: `src/features/storage/components/createProduct/`

| Section | Component | Editable fields for T3 |
|---|---|---|
| BasicInfo | `BasicInfoSection.tsx` | `name` (product title) |
| StockPrice | `StockPriceSection.tsx` | `price`, `secondPrice` |

Both are standard `TextField` components with no conditional disable logic. `CreateProductSheet.tsx` receives `initialProduct` prop (line 42) — `isEditMode` is `Boolean(initialProduct)` (line 43). The server response for `getProductById` could include a `hasPayments` flag, or the sheet could make a separate check.

**T4 approach**: The simplest approach is to pass `hasPayments: boolean` from the server to `CreateProductSheet` and conditionally disable `name`, `price`, `secondPrice` inputs. The server-side guard in `updateProduct` remains authoritative.

### 8. Existing Tests — Patterns

**File**: `tests/unit/server-actions/settingsActions.test.ts` (506 lines)
- Framework: vitest with `vi.mock`, `vi.hoisted`, `beforeEach` clearing
- Pattern: mock `requireAccessOnId`, `getBusinessEntitlements`, `db.*` with chained mocks
- Tests: plan enforcement (basico blocks), successful flow when premium

**File**: `tests/unit/server-actions/createProduct.test.ts` (540+ lines)
- Same pattern: mock `requireAccess`, `getBusinessEntitlements`, `db.*`
- Tests: entitlement limits, successful creation

**T5 test approach**: Follow the same mock pattern. Test cases:
- Business with 0 payments → identity fields editable (zod validation still applies)
- Business with 1+ payments → identity fields rejected with clear error
- Business with 1+ payments → cosmetic fields (logo, cover, description) still editable
- Product with 0 payments → title/price editable
- Product with 1+ payments → title/price rejected
- Product with 1+ payments → stock, images, description still editable
- Slug change blocked when business has payments

### 9. FK Constraints — Delete Blocking

**Confirmed**: `payments.businessId → businesses.id ON DELETE RESTRICT` and `payments.productId → products.id ON DELETE RESTRICT` are defined in the Drizzle schema (`schema/orders.ts:46,49`). The `ON DELETE RESTRICT` means attempting to delete a business or product that has payments will throw a DB constraint violation. No migration needed — this is already active.

---

## Affected Areas

### Minimal file set for T1-T5

| File | Change type | Tasks |
|---|---|---|
| `src/features/business/schemas.ts` | Add `updateBusinessDataSchema` | T1 |
| `app/actions/business.ts` | Add zod validation + payment guard in `updateBusinessData` | T1, T2 |
| `app/[slug]/(app)/settings/actions.ts` | Add payment guard in `updateBusinessSlug` | T2 |
| `src/features/storage/actions/products.ts` | Add payment guard in `updateProduct` | T3 |
| `src/features/business/components/settings-tabs/sections/IdentitySection.tsx` | Disable `name` when locked | T4 |
| `src/features/business/components/settings-tabs/sections/ContactSection.tsx` | Disable `city` when locked | T4 |
| `src/features/business/components/settings-tabs/sections/LegalSection.tsx` | Disable `legalRepRole` when locked | T4 |
| `src/features/storage/components/createProduct/CreateProductSheet.tsx` | Pass/accept `hasPayments` prop | T4 |
| `src/features/storage/components/createProduct/BasicInfoSection.tsx` | Disable `name` when locked | T4 |
| `src/features/storage/components/createProduct/StockPriceSection.tsx` | Disable `price` when locked | T4 |
| `tests/unit/server-actions/sellerFraudGuards.test.ts` | New test file | T5 |
| `tests/unit/server-actions/updateProductGuard.test.ts` | New test file (or merge with above) | T5 |

### Files NOT in scope

- `app/[slug]/(app)/storefrontAbout.module.css` — user's pending change, DO NOT TOUCH
- `src/features/storage/actions/authz.ts` — no changes needed
- `src/core/database/schema/orders.ts` — no changes needed
- `src/core/orders/orderService.ts` — no changes needed

---

## Discrepancies Between Plan and Real Code

1. **T4 scope is smaller than expected**: The plan says "UI mirrors the guard" for settings + product editor. But the new settings page (`SettingsClient`) already shows legal fields as read-only `ListItem` — no editable form to disable. The OLD modal (`BusinessSettingsModal`) is where editable fields exist. T4 work is: (a) disable 3 fields in the old modal sections, (b) add `hasPayments` prop to product editor.

2. **Two `updateBusinessData` functions**: The plan references `app/actions/business.ts:164-232` for the guard. There's also a WhatsApp-only `updateBusinessData` in `settings/actions.ts:536-563` that does NOT need a guard (it only touches `whatsappNumber`).

3. **No pre-existing payment count helper**: The plan says `payments.count(businessId)` — the actual query needs to be written inline using `db.select({ count: sql`count(*)` }).from(payments).where(eq(payments.businessId, id))`. No helper exists.

4. **Slug guard is in a different file than business data guard**: The plan groups T2 as "in `updateBusinessData` (and slug action)". The slug action is in `app/[slug]/(app)/settings/actions.ts`, not in `app/actions/business.ts`. This is fine but means T2 touches two separate files.

5. **Product guard needs businessId from slug resolution**: `updateProduct` takes `businessSlug`, not `businessId`. The guard must query payments AFTER `requireAccess` resolves the `businessId` (line 352). This is straightforward — the resolved `businessId` is already available.

---

## Recommendation

The plan is **sound and ready for proposal**. The discrepancies above are minor implementation details that don't change the approach:

1. T1: Add zod schema to `src/features/business/schemas.ts`, apply in `app/actions/business.ts:164`
2. T2: Payment count guard in `app/actions/business.ts:203` (after ownership check) and `app/[slug]/(app)/settings/actions.ts:60` (after plan gate)
3. T3: Payment count guard in `src/features/storage/actions/products.ts:353` (after `requireAccess`)
4. T4: Disable fields in old modal sections + add `hasPayments` to product editor flow
5. T5: Tests following existing mock patterns in `tests/unit/server-actions/`

**Estimated effort**: Well under 400 lines (single PR).

---

## Risks

- **Old modal vs new settings page**: The `BusinessSettingsModal` may or may not be actively used by all users. The guard MUST be server-side regardless; UI disable is a UX improvement, not a security control.
- **`useBusinessActions` hook is unused**: The hook (`src/features/business/hooks/useBusinessActions.ts`) is defined but not imported by any component. The save flow may go through a different path. This needs verification during implementation — check if `BusinessSettingsModal` uses `useBusinessSettings` which might use a different save mechanism.
- **Payment status semantics**: The plan counts ALL payments. If a seller has only `failed` payments, should they be able to change identity? The plan says yes (count > 0 blocks). This is conservative and correct for fraud prevention.

---

## Ready for Proposal

**Yes** — the plan is verified against actual code. The minimal scope (2 guards + zod + UI disable + tests) is confirmed feasible. Proceed to `sdd-propose`.
