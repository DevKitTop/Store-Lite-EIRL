# Tasks: Seller Fraud Guards

## Review Workload Forecast

| Field                   | Value                                            |
| ----------------------- | ------------------------------------------------ |
| Estimated changed lines | 280–350                                          |
| 400-line budget risk    | Low                                              |
| Chained PRs recommended | No                                               |
| Suggested split         | Single PR                                        |
| Delivery strategy       | ask-on-risk                                      |
| Chain strategy          | pending                                          |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal                                 | Likely PR | Notes                              |
| ---- | ------------------------------------ | --------- | ---------------------------------- |
| 1    | Full change (helper + guards + UI)   | PR 1      | Single PR, < 400 lines, TDD order |

## Phase 1: Foundation — Shared Helper (TDD)

- [x] 1.1 **RED**: Create `tests/unit/server-actions/paymentGuards.test.ts` — table test: each `LOCKING_PAYMENT_STATUSES` entry → `hasLockingPayments` returns `true`; non-locking status → `false`; mock `db.select().from().where().` chain returning `[{ count }]`.
- [x] 1.2 **GREEN**: Create `src/core/orders/paymentGuards.ts` — export `LOCKING_PAYMENT_STATUSES` array (pending, validando, paid, completed, delivered, en_reparto, not_delivered) and `hasLockingPayments(input: { businessId?: string; productId?: string }): Promise<boolean>` using `db.select({ count: sql\`count(*)\` }).from(payments).where(and(...))`. Run `pnpm test:unit` — tests pass.
- [x] 1.3 **REFACTOR**: Verify helper uses existing indexes (`idx_payments_business_id`, `idx_payments_product_id`). No refactor needed if clean.

## Phase 2: Zod Schema + Business Guard (TDD)

- [x] 2.1 **RED**: Create `tests/unit/server-actions/businessDataGuard.test.ts` — mock `hasLockingPayments` via `vi.hoisted`; test: zod rejects malformed taxId (no DB write); unlocked business accepts identity changes; locked business rejects identity changes (name, taxId, legalRepName, legalRepRole, legalRepPhone, legalRepEmail, address, city); locked business accepts cosmetic changes (description, storeType, whatsappNumber, email).
- [x] 2.2 **GREEN**: Add `updateBusinessDataSchema` to `src/features/business/schemas.ts` — z.infer type, all fields optional, constraints from `createBusinessSchema` (name 3–100, taxId 11–20 alphanumeric, email format), Spanish error messages.
- [x] 2.3 **GREEN**: In `app/actions/business.ts` `updateBusinessData` — add zod `safeParse` after whatsapp normalize; if invalid, return `{ error }`. Extend `findFirst` with identity fields for diff. After ownership check, call `hasLockingPayments({ businessId })`. If locked, diff incoming identity keys against DB current; reject if changed. Return `{ error: FROZEN_FIELD_MESSAGE }`. Run `pnpm test:unit`.
- [x] 2.4 **GREEN**: In `app/[slug]/(app)/settings/actions.ts` `updateBusinessSlug` — insert `hasLockingPayments({ businessId })` after plan gate, before slug uniqueness check. Return `{ success: false, error: FROZEN_FIELD_MESSAGE }` if locked. Run tests.

## Phase 3: Product Guard (TDD)

- [x] 3.1 **RED**: Create `tests/unit/server-actions/updateProductGuard.test.ts` — mock `hasLockingPayments`; test: unlocked product accepts title/price change; locked product rejects title change; locked product rejects price change; locked product accepts stock/description/availability change.
- [x] 3.2 **GREEN**: In `src/features/storage/actions/products.ts` `updateProduct` — extend `existingProduct` fetch with `price`, `secondPrice`. After `requireAccess`, call `hasLockingPayments({ productId })`. If locked and title or price changed, return `{ success: false, error: FROZEN_FIELD_MESSAGE }`. Run `pnpm test:unit`.

## Phase 4: UI Mirror

- [x] 4.1 Create `getBusinessLockState(businessId: string)` in `app/actions/business.ts` — returns `{ locked: boolean }` using `hasLockingPayments`.
- [x] 4.2 Create `getProductLockState(productId: string)` in `src/features/storage/actions/products.ts` — returns `{ locked: boolean }` using `hasLockingPayments`.
- [x] 4.3 In `BusinessSettingsModal` / `useBusinessSettings` — fetch `getBusinessLockState` on open; pass `locked` to `NegocioTab`. In `IdentitySection`: disable `name` input when locked. In `ContactSection`: disable `city` when locked. In `LegalSection`: disable `legalRepRole` when locked. Add notice `<p>` with FROZEN_FIELD_MESSAGE on each disabled field.
- [x] 4.4 In `app/[slug]/(app)/settings/page.tsx` — compute `businessLocked` via helper; pass to `SettingsClient`. In `BusinessSection`: disable slug input when locked + notice.
- [x] 4.5 In `StorageContent` — fetch `getProductLockState` on edit-open; pass `hasPayments` to `CreateProductSheet`. In `BasicInfoSection`: disable `name` when locked. In `StockPriceSection`: disable `price`, `secondPrice` when locked. Add notice.

## Phase 5: Verification

- [x] 5.1 Run `pnpm test:unit` — all new + existing tests pass.
- [x] 5.2 Run `pnpm type-check` — no type errors.
- [x] 5.3 Verify `storefrontAbout.module.css` was NOT touched.
