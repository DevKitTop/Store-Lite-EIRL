# Proposal: Seller Fraud Guards

## Intent

A seller can accept payments (orders + charges), then mutate their business identity — name, RUC/taxId, legal representative, address, slug — and product titles/prices, with zero validation tied to transaction history. Every buyer-facing proof (verify page, tracking page, receipts) renders **live joins**, so the old identity vanishes retroactively. This is an actionable fraud vector that must be closed.

The approved minimal fix: server-side mutation guards that block identity/title/price changes once a business or product has successful payments. Zod validation is added as a prerequisite — the current `updateBusinessData` is a raw `Partial<...>` spread with no field-level checks.

## Scope

### In Scope

- **T1**: Zod schema for the canonical `updateBusinessData` — field-level validation (name, taxId/RUC format, legalRep, address/city, contact, logo/cover, description) replacing the raw `Partial` spread
- **T2**: Business identity guard — when `payments.count(businessId) > 0` (SUCCESSFUL only), reject changes to identity fields (name, taxId, legalRep, address/city); cosmetic fields (logo, cover, description, contact) remain editable. Same rule for `updateBusinessSlug`
- **T3**: Product guard — when a product has successful payments, reject `title` and `price` changes; stock/images/description/availability remain editable
- **T4**: UI mirror — disable locked inputs when the guard applies, with a clear notice (server-side remains authoritative)
- **T5**: Unit tests following existing `vitest + vi.mock` patterns under `tests/unit/server-actions/`

### Out of Scope

- Order/product identity snapshot + render from snapshot
- Re-KYB flow for taxId changes after verification
- `business_identity_events` audit table + legal-hold bucket
- Slug alias resolution in verify/tracking pages for pre-existing changes
- RLS / DB read-role separation
- Any changes to `storefrontAbout.module.css`

## Capabilities

### New Capabilities

- `seller-fraud-guards`: Server-side mutation guards that block identity and price/title changes for businesses and products with successful payment history; includes zod validation for the business data action and UI mirror for locked fields

### Modified Capabilities

None — this is additive enforcement on existing actions; no existing spec behavior changes.

## Approach

Canonical `updateBusinessData`: **`app/actions/business.ts:164-232`** (the 17-field version that `BusinessSettingsModal` calls). The WhatsApp-only variant at `app/[slug]/(app)/settings/actions.ts:536-563` does not need a guard.

1. **T1**: Extend `src/features/business/schemas.ts` with `updateBusinessDataSchema` (zod, Spanish error messages, matching existing `createBusinessSchema` conventions). Apply in `updateBusinessData` before the DB write.
2. **T2**: After ownership check in `updateBusinessData` (line ~203), query `payments.count(businessId)` filtered to `status = 'SUCCESSFUL'`. If > 0, diff incoming fields against identity blocklist; reject if any identity field changed. Insert same guard in `updateBusinessSlug` after the plan gate (line ~60).
3. **T3**: After `requireAccess` resolves `businessId` in `updateProduct` (line ~352), query `payments.count(productId)` filtered to `status = 'SUCCESSFUL'`. If > 0, reject if `title` or `price` changed.
4. **T4**: Pass `hasPayments` flag from server to UI components. Disable `name` (IdentitySection), `city` (ContactSection), `legalRepRole` (LegalSection) in the old modal; disable `name` (BasicInfoSection), `price`/`secondPrice` (StockPriceSection) in product editor.
5. **T5**: Test files: `tests/unit/server-actions/sellerFraudGuards.test.ts` + `updateProductGuard.test.ts`. Cases: 0 payments → editable; 1+ payments → identity/title/price blocked; cosmetic fields always editable; slug blocked with payments.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/features/business/schemas.ts` | Modified | Add `updateBusinessDataSchema` |
| `app/actions/business.ts` | Modified | Zod validation + payment guard in `updateBusinessData` |
| `app/[slug]/(app)/settings/actions.ts` | Modified | Payment guard in `updateBusinessSlug` |
| `src/features/storage/actions/products.ts` | Modified | Payment guard in `updateProduct` |
| `src/features/business/components/settings-tabs/sections/IdentitySection.tsx` | Modified | Disable `name` when locked |
| `src/features/business/components/settings-tabs/sections/ContactSection.tsx` | Modified | Disable `city` when locked |
| `src/features/business/components/settings-tabs/sections/LegalSection.tsx` | Modified | Disable `legalRepRole` when locked |
| `src/features/storage/components/createProduct/CreateProductSheet.tsx` | Modified | Accept `hasPayments` prop |
| `src/features/storage/components/createProduct/BasicInfoSection.tsx` | Modified | Disable `name` when locked |
| `src/features/storage/components/createProduct/StockPriceSection.tsx` | Modified | Disable `price` when locked |
| `tests/unit/server-actions/sellerFraudGuards.test.ts` | New | Business + slug guard tests |
| `tests/unit/server-actions/updateProductGuard.test.ts` | New | Product guard tests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `useBusinessActions` hook may not be the active save path — exploration flagged it as possibly unused | Med | Verify during T4 implementation; trace the actual `onSave` call chain in `BusinessSettingsModal` before wiring UI |
| Old modal (`BusinessSettingsModal`) may be deprecated / unused by some users | Low | Server-side guard is authoritative regardless; UI disable is a UX improvement only |
| Payment status filter: counting ALL statuses vs. only SUCCESSFUL | Low | Scope explicitly requires SUCCESSFUL only — the plan was user-approved with this decision |

## Rollback Plan

All changes are additive (new zod schema, new guard checks, new UI disable logic). Revert by removing the 2 new test files, removing the `hasPayments` prop plumbing, and reverting the 4 modified server action files. No migrations, no schema changes, no data writes to reverse.

## Dependencies

None — the `payments` table and its indexes (`idx_payments_business_id`, `idx_payments_product_id`, `idx_payments_status`) already exist.

## Success Criteria

- [ ] `updateBusinessData` rejects identity field changes when business has ≥1 successful payment
- [ ] `updateBusinessSlug` rejects slug changes when business has ≥1 successful payment
- [ ] `updateProduct` rejects title/price changes when product has ≥1 successful payment
- [ ] Cosmetic fields (logo, cover, description, contact, stock, images) remain editable in all cases
- [ ] All existing tests pass; new tests cover 0-payment editable, 1+ payment blocked, cosmetic editable
- [ ] UI disables locked fields when `hasPayments` is true; server guard returns clear error on bypass
