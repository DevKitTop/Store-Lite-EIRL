# Tasks: de-monolith-storefront-sections

## Phase 1 — Extract mapToStorageProduct util

### 1.1 Create `components/mapToStorageProduct.ts`

**File:** `app/[slug]/(app)/components/mapToStorageProduct.ts` (~20 lines)

- [x] Add imports: `ProductWithRelations` from `@/features/products/types/productTypes`, `Product as StorageProduct` from `@/features/storage/data`
- [x] Move `mapToStorageProduct` function (current lines 87–103) to new file
- [x] Export `mapToStorageProduct` as named export

**Verify:** `pnpm type-check` — parent and `StaffManagementTools` will temporarily fail until imports are updated

---

## Phase 2 — Extract StorefrontNoticeBar

### 2.1 Create `components/StorefrontNoticeBar.tsx`

**File:** `app/[slug]/(app)/components/StorefrontNoticeBar.tsx` (~65 lines)

- [x] Add imports: `Business` from `@/types/business`, `Icon` from `@/shared/components/ui/data-display/Icon`, `styles` from `../BusinessPageContent.module.css`
- [x] Copy `StorefrontNoticeBarProps` interface (lines 940–945)
- [x] Copy `StorefrontNoticeBar` function (lines 947–1000)
- [x] Export both as named exports

**Verify:** `pnpm type-check`

---

## Phase 3 — Extract StorefrontOwnerActions

### 3.1 Create `components/StorefrontOwnerActions.tsx`

**File:** `app/[slug]/(app)/components/StorefrontOwnerActions.tsx` (~38 lines)

- [x] Add imports: `Button` from `@/shared/components/ui/buttons/Button`, `Icon` from `@/shared/components/ui/data-display/Icon`, `styles` from `../BusinessPageContent.module.css`
- [x] Copy `StorefrontOwnerActionsProps` interface (lines 1002–1006)
- [x] Copy `StorefrontOwnerActions` function (lines 1008–1035)
- [x] Export both as named exports

**Verify:** `pnpm type-check`

---

## Phase 4 — Extract HiddenCatalogNotice

### 4.1 Create `components/HiddenCatalogNotice.tsx`

**File:** `app/[slug]/(app)/components/HiddenCatalogNotice.tsx` (~30 lines)

- [x] Add imports: `Button` from `@/shared/components/ui/buttons/Button`, `Icon` from `@/shared/components/ui/data-display/Icon`, `filterStyles` from `../../(main)/home/FilterBar.module.css`, `styles` from `../BusinessPageContent.module.css`
- [x] Copy `HiddenCatalogNoticeProps` interface (lines 1037–1040)
- [x] Copy `HiddenCatalogNotice` function (lines 1042–1064)
- [x] Export both as named exports

**Verify:** `pnpm type-check`

---

## Phase 5 — Extract CustomerFloatingUi

### 5.1 Create `components/CustomerFloatingUi.tsx`

**File:** `app/[slug]/(app)/components/CustomerFloatingUi.tsx` (~50 lines)

- [x] Add imports: `StorefrontColorScheme` from `@/core/storefront`, `Business` from `@/types/business`, `FloatingCartButton`, `CartDrawer`, `FloatingChatFab`, `ThemeToggle`, `Footer`
- [x] Copy `CustomerFloatingUiProps` interface (lines 648–656)
- [x] Copy `CustomerFloatingUi` function (lines 658–692)
- [x] Export both as named exports

**Verify:** `pnpm type-check`

---

## Phase 6 — Extract StaffManagementTools

### 6.1 Create `components/StaffManagementTools.tsx`

**File:** `app/[slug]/(app)/components/StaffManagementTools.tsx` (~65 lines)

- [x] Add imports: `StorefrontColorScheme`, `StorefrontTheme` from `@/core/storefront`, `ProductWithRelations` from `@/features/products/types/productTypes`, `DeleteProductDialog`, `CreateProductSheet`, `StorefrontEditor`, `mapToStorageProduct` from `./mapToStorageProduct`
- [x] Copy `StaffManagementToolsProps` interface (lines 694–710) — includes `OwnerSheetSaveArgs` type reference (import from parent or define locally)
- [x] Copy `StaffManagementTools` function (lines 712–755)
- [x] Export both as named exports

**Verify:** `pnpm type-check`

---

## Phase 7 — Extract StorefrontProductGridSection

### 7.1 Create `components/StorefrontProductGridSection.tsx`

**File:** `app/[slug]/(app)/components/StorefrontProductGridSection.tsx` (~195 lines)

- [x] Add imports: `react` (Dispatch, SetStateAction), `ProductGridSection`, `StorefrontTheme` from `@/core/storefront`, `BrandFilterOption` from `@/features/products/hooks/useProductFilters`, `ProductWithRelations` from `@/features/products/types/productTypes`, `Business` from `@/types/business`, `ProductCategory` from `@/types/product`
- [x] Add component imports: `FilterBar`, `Feed`, `Pagination`, `ProductFiltersTopBar`, `StorefrontNoticeBar`, `StorefrontOwnerActions`, `HiddenCatalogNotice`, `StorefrontAboutSection`, `styles` from `../BusinessPageContent.module.css`
- [x] Move `PAGE_SIZE` constant (line 60) into this file
- [x] Copy `StorefrontProductGridSectionProps` interface (lines 757–794)
- [x] Copy `StorefrontProductGridSection` function (lines 796–938)
- [x] Export both as named exports

**Verify:** `pnpm type-check`

---

## Phase 8 — Update parent imports + delete inline definitions

### 8.1 Update `BusinessPageContent.tsx`

**File:** `app/[slug]/(app)/BusinessPageContent.tsx` (~460 lines after)

- [x] Add imports for all 6 extracted components + `mapToStorageProduct`
- [x] Remove `PAGE_SIZE` constant (line 60) — moved to `StorefrontProductGridSection`
- [x] Remove `mapToStorageProduct` function (lines 87–103) — replaced by import
- [x] Remove `CustomerFloatingUi` interface + function (lines 648–692)
- [x] Remove `StaffManagementTools` interface + function (lines 694–755)
- [x] Remove `StorefrontProductGridSection` interface + function (lines 757–938)
- [x] Remove `StorefrontNoticeBar` interface + function (lines 940–1000)
- [x] Remove `StorefrontOwnerActions` interface + function (lines 1002–1035)
- [x] Remove `HiddenCatalogNotice` interface + function (lines 1037–1064)
- [x] Update `handleSaveProduct` to use imported `mapToStorageProduct`
- [x] Update inline `mappedProducts` (lines 121–137) to use imported `mapToStorageProduct` via `products.map(mapToStorageProduct)`
- [x] Verify `renderStorefrontSection` still calls `StorefrontProductGridSection` from import

**Verify:** `pnpm type-check && pnpm lint && pnpm test:unit`

---

## Phase 9 — Full verification

### 9.1 Type check

- [x] `pnpm type-check` — 0 errors

### 9.2 Lint

- [x] `pnpm lint` — 0 errors

### 9.3 Unit tests

- [x] `pnpm test:unit` — all tests pass (including `storefrontProductGridSection.test.tsx`)

### 9.4 Consumer verification

- [x] `grep -r "StorefrontProductGridSection\|StorefrontNoticeBar\|StorefrontOwnerActions\|HiddenCatalogNotice\|CustomerFloatingUi\|StaffManagementTools\|mapToStorageProduct" --include="*.tsx" --include="*.ts" app/` — confirms all consumers resolve
- [x] No consumer files modified beyond `BusinessPageContent.tsx`

### 9.5 Diff check

- [x] Verify total changed lines < 400 (excluding new files)
- [x] Verify no out-of-scope files modified
- [x] Verify no runtime behavior change

---

## Line Estimate

| Phase | New lines | Deleted lines | Changed lines | Total |
|-------|-----------|---------------|---------------|-------|
| Phase 1 (mapToStorageProduct util) | ~20 | 0 | 0 | ~20 |
| Phase 2 (StorefrontNoticeBar) | ~65 | 0 | 0 | ~65 |
| Phase 3 (StorefrontOwnerActions) | ~38 | 0 | 0 | ~38 |
| Phase 4 (HiddenCatalogNotice) | ~30 | 0 | 0 | ~30 |
| Phase 5 (CustomerFloatingUi) | ~50 | 0 | 0 | ~50 |
| Phase 6 (StaffManagementTools) | ~65 | 0 | 0 | ~65 |
| Phase 7 (StorefrontProductGridSection) | ~195 | 0 | 0 | ~195 |
| Phase 8 (parent cleanup) | ~15 | ~600 | 0 | ~615 |
| Phase 9 (verification) | 0 | 0 | 0 | 0 |
| **Total** | ~478 | ~600 | 0 | ~1078 |

**Net diff:** ~478 new lines added, ~600 lines deleted. Changed-line footprint via git rename-detection should be well below 400 lines (git detects renames when >50% of content matches).
