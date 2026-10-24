# Design: de-monolith-storefront-sections

## Architecture

```
BusinessPageContent.tsx (1064 lines)
            │
            ▼
┌───────────────────────────────────────────────────────────────────┐
│  app/[slug]/(app)/BusinessPageContent.tsx  (~460 lines)           │
│                                                                   │
│  Keeps: props interface, StorageProvider wrapper,                 │
│  BusinessPageContentUI (all state/hooks/handlers),                │
│  theme useLayoutEffect, page assembly JSX,                        │
│  renderStorefrontSection switch,                                   │
│  ProductPreviewSheet, BasicContactDialog, LookupOrderModal        │
│                                                                   │
│  Imports from components/:                                         │
│  ├─ StorefrontProductGridSection                                   │
│  ├─ CustomerFloatingUi                                             │
│  ├─ StaffManagementTools                                           │
│  └─ mapToStorageProduct                                            │
└───────────────────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────────────┐
│  app/[slug]/(app)/components/                                      │
│                                                                   │
│  ┌──────────────────────────────┐  ┌─────────────────────────────┐│
│  │ StorefrontProductGridSection │  │ mapToStorageProduct.ts      ││
│  │ (interface + function)       │  │ (shared util)               ││
│  │ ~195 lines                   │  │ ~20 lines                   ││
│  └──────────────────────────────┘  └─────────────────────────────┘│
│  ┌──────────────────────┐  ┌──────────────────────────────────┐  │
│  │ StorefrontNoticeBar  │  │ StaffManagementTools             │  │
│  │ ~65 lines            │  │ ~65 lines                        │  │
│  └──────────────────────┘  └──────────────────────────────────┘  │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐  │
│  │ StorefrontOwnerActions   │  │ CustomerFloatingUi            │  │
│  │ ~38 lines                │  │ ~50 lines                     │  │
│  └──────────────────────────┘  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐                                │
│  │ HiddenCatalogNotice          │                                │
│  │ ~30 lines                    │                                │
│  └──────────────────────────────┘                                │
└───────────────────────────────────────────────────────────────────┘
```

## File Layout — Current Line Ranges

### BusinessPageContent.tsx (1064 lines)

| Line Range | Content | Action |
|------------|---------|--------|
| 1–59 | Imports, `'use client'` directive | Keep; add new imports for extracted components + util |
| 60 | `PAGE_SIZE` constant | Keep (used by `StorefrontProductGridSection`) |
| 62–83 | `BusinessPageContentProps` interface | Keep |
| 85 | `OwnerSheetSaveArgs` type | Keep (used by parent handlers) |
| 87–103 | `mapToStorageProduct` function | **Move** to `components/mapToStorageProduct.ts` |
| 105–168 | `BusinessPageContent` wrapper (StorageProvider) | Keep |
| 170–646 | `BusinessPageContentUI` function | Keep; delete inline component definitions |
| 648–692 | `CustomerFloatingUi` interface + function | **Move** to `components/CustomerFloatingUi.tsx` |
| 694–755 | `StaffManagementTools` interface + function | **Move** to `components/StaffManagementTools.tsx` |
| 757–938 | `StorefrontProductGridSection` interface + function | **Move** to `components/StorefrontProductGridSection.tsx` |
| 940–1000 | `StorefrontNoticeBar` interface + function | **Move** to `components/StorefrontNoticeBar.tsx` |
| 1002–1035 | `StorefrontOwnerActions` interface + function | **Move** to `components/StorefrontOwnerActions.tsx` |
| 1037–1064 | `HiddenCatalogNotice` interface + function | **Move** to `components/HiddenCatalogNotice.tsx` |

### New files in `components/`

| File | Lines | Exports |
|------|-------|---------|
| `StorefrontProductGridSection.tsx` | ~195 | `StorefrontProductGridSection` (default export) + `StorefrontProductGridSectionProps` interface |
| `StorefrontNoticeBar.tsx` | ~65 | `StorefrontNoticeBar` + `StorefrontNoticeBarProps` interface |
| `StorefrontOwnerActions.tsx` | ~38 | `StorefrontOwnerActions` + `StorefrontOwnerActionsProps` interface |
| `HiddenCatalogNotice.tsx` | ~30 | `HiddenCatalogNotice` + `HiddenCatalogNoticeProps` interface |
| `CustomerFloatingUi.tsx` | ~50 | `CustomerFloatingUi` + `CustomerFloatingUiProps` interface |
| `StaffManagementTools.tsx` | ~65 | `StaffManagementTools` + `StaffManagementToolsProps` interface |
| `mapToStorageProduct.ts` | ~20 | `mapToStorageProduct` function + `MapToStorageProductInput` type (optional) |

## Prop Interfaces

### StorefrontNoticeBarProps

```typescript
interface StorefrontNoticeBarProps {
  isOwner: boolean;
  business: Business;
  hasPaymentGateway: boolean;
  isPaymentConfigured: boolean;
}
```

### StorefrontOwnerActionsProps

```typescript
interface StorefrontOwnerActionsProps {
  isOwner: boolean;
  onCreateProduct: () => void;
  onShowLookupModal: () => void;
}
```

### HiddenCatalogNoticeProps

```typescript
interface HiddenCatalogNoticeProps {
  isOwner: boolean;
  onCreateProduct: () => void;
}
```

### CustomerFloatingUiProps

```typescript
interface CustomerFloatingUiProps {
  business: Business;
  paymentsEnabled: boolean;
  culqiPublicKey?: string;
  chatEnabled: boolean;
  activeScheme: StorefrontColorScheme;
  onViewerThemeToggle: () => void;
  onContactClick: () => void;
}
```

### StaffManagementToolsProps

```typescript
interface StaffManagementToolsProps {
  business: { id: string; slug: string };
  previewProduct: ProductWithRelations | null;
  isEditOpen: boolean;
  isCreateOpen: boolean;
  isDeleteOpen: boolean;
  onSheetClose: () => void;
  onSave: (...args: OwnerSheetSaveArgs) => Promise<void>;
  onDeleteClose: () => void;
  onDeleteConfirm: (id: string) => Promise<void>;
  editableTheme: StorefrontTheme;
  onThemeChange: (theme: StorefrontTheme) => void;
  onPreviewSchemeChange: (scheme: StorefrontColorScheme | undefined) => void;
  detectedColorScheme: StorefrontColorScheme;
  previewScheme?: StorefrontColorScheme;
  defaultScheme?: 'light' | 'dark';
}
```

### StorefrontProductGridSectionProps

```typescript
interface StorefrontProductGridSectionProps {
  section: ProductGridSection;
  business: Business;
  categories: ProductCategory[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  selectedCategories: string[];
  onSelectedCategoriesChange: Dispatch<SetStateAction<string[]>>;
  selectedBrands: string[];
  onSelectedBrandsChange: Dispatch<SetStateAction<string[]>>;
  absoluteMin: number;
  absoluteMax: number;
  currentMinPrice: number;
  onCurrentMinPriceChange: Dispatch<SetStateAction<number>>;
  currentMaxPrice: number;
  onCurrentMaxPriceChange: Dispatch<SetStateAction<number>>;
  showDiscountedOnly: boolean;
  onShowDiscountedOnlyChange: Dispatch<SetStateAction<boolean>>;
  brandOptions: BrandFilterOption[];
  filteredProducts: ProductWithRelations[];
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  currentPage: number;
  onPageChange: (page: number) => void;
  isOwner: boolean;
  isStaff: boolean;
  hasPaymentGateway: boolean;
  isPaymentConfigured: boolean;
  culqiPublicKey?: string;
  onProductPreview: (product: ProductWithRelations, initialIndex?: number) => void;
  onContactClick: () => void;
  onCreateProduct: () => void;
  storefrontTheme?: StorefrontTheme;
  previewCardTheme?: StorefrontTheme;
  onShowLookupModal: () => void;
}
```

## State/Hooks Split Decision

### Stays in parent (`BusinessPageContentUI`)

| State/Hook | Why |
|------------|-----|
| `activeTab`, `currentPage` | Coordinates which section renders; `StorefrontProductGridSection` reads as props |
| `previewProduct`, `previewSignal`, `previewImageIndex` | Shared between `ProductPreviewSheet` and `StaffManagementTools` |
| `isContactDialogOpen`, `isEditOpen`, `isCreateOpen`, `isDeleteOpen` | Dialog open/close coordination across multiple components |
| `showLookupModal` | Used by `LookupOrderModal` and `StorefrontOwnerActions` |
| `editableTheme`, `previewScheme`, `viewerTheme` | Theme state — coordinated with CSS vars, localStorage, global theme |
| `alert` | Alert state for `AlertSnackbar` (staff-only feedback) |
| `useTheme()` | Global theme context — stays in parent |
| `useStorage()` | Context consumer — stays in parent; `deleteProduct`/`saveProductBackground` called by parent handlers |
| `useProductFilters()` | Returns filter state used by `StorefrontProductGridSection`; stays in parent |
| Theme `useLayoutEffect` + localStorage `useEffect`s | DOM manipulation for CSS vars — must stay in parent |
| All handlers (`handleTabChange`, `handlePreviewProduct`, `handleSaveProduct`, `handleConfirmDelete`, etc.) | Coordinate multiple components; stay in parent |

### Moves with component

| Component | What moves |
|-----------|------------|
| `StorefrontProductGridSection` | `PAGE_SIZE` constant (line 60) — only used internally for pagination math |
| `StaffManagementTools` | Calls `mapToStorageProduct` from shared util (no local state needed) |
| All others | Nothing — pure render, all data via props |

## StorefrontAboutSection Precedent

The existing `StorefrontAboutSection.tsx` (already extracted) follows this pattern:
- Located in `app/[slug]/(app)/StorefrontAboutSection.tsx`
- Named export: `StorefrontAboutSection`
- Props-driven: receives `business`, `storefrontTheme`, `previewCardTheme`, `isOwner`
- No internal state, no hooks beyond what's needed for its own rendering
- Imported by `BusinessPageContent.tsx` at line 49

Our 6 new extractions follow the same pattern: named exports, props-driven, no new state/hooks.

## Import Graph

### StorefrontProductGridSection.tsx

```
imports from:
├── react (Dispatch, SetStateAction)
├── @/core/storefront (ProductGridSection, StorefrontTheme)
├── @/features/products/hooks/useProductFilters (BrandFilterOption type)
├── @/features/products/types/productTypes (ProductWithRelations)
├── @/types/business (Business)
├── @/types/product (ProductCategory)
├── ../(main)/home/FilterBar
├── ../(main)/home/Feed
├── ../(main)/home/Pagination
├── ../(main)/home/components/ProductFiltersTopBar
├── ./StorefrontNoticeBar
├── ./StorefrontOwnerActions
├── ./HiddenCatalogNotice
├── ./StorefrontAboutSection (for the about tab rendering)
└── ./BusinessPageContent.module.css (styles)
```

### StorefrontNoticeBar.tsx

```
imports from:
├── @/types/business (Business)
├── @/shared/components/ui/data-display/Icon
└── ./BusinessPageContent.module.css (styles)
```

### StorefrontOwnerActions.tsx

```
imports from:
├── @/shared/components/ui/buttons/Button
├── @/shared/components/ui/data-display/Icon
└── ./BusinessPageContent.module.css (styles)
```

### HiddenCatalogNotice.tsx

```
imports from:
├── @/shared/components/ui/buttons/Button
├── @/shared/components/ui/data-display/Icon
├── ../../(main)/home/FilterBar.module.css (filterStyles)
└── ./BusinessPageContent.module.css (styles)
```

### CustomerFloatingUi.tsx

```
imports from:
├── @/core/storefront (StorefrontColorScheme)
├── @/types/business (Business)
├── ./FloatingCartButton
├── ./CartDrawer
├── ./FloatingChatFab
├── ./ThemeToggle
└── ../Footer
```

### StaffManagementTools.tsx

```
imports from:
├── @/core/storefront (StorefrontColorScheme, StorefrontTheme)
├── @/features/products/types/productTypes (ProductWithRelations)
├── @/features/storage/components/DeleteProductDialog
├── @/features/storage/components/createProduct/CreateProductSheet
├── ./StorefrontEditor
└── ./mapToStorageProduct
```

### mapToStorageProduct.ts

```
imports from:
├── @/features/products/types/productTypes (ProductWithRelations)
└── @/features/storage/data (Product as StorageProduct)
```

## Test-Path Update

**File:** `tests/unit/storefrontProductGridSection.test.tsx`

Current test imports `BusinessPageContent` from `@/app/[slug]/(app)/BusinessPageContent` (line 125). This test renders the full `BusinessPageContent` which internally renders `StorefrontProductGridSection`. No import path change needed for the main test — the parent still imports and renders the section.

However, if the test is updated to directly import `StorefrontProductGridSection` (for focused unit testing), the import would be:

```typescript
import { StorefrontProductGridSection } from '@/app/[slug]/(app)/components/StorefrontProductGridSection';
```

**Current test behavior:** The test renders `BusinessPageContent` and asserts on rendered output. Since `BusinessPageContent` still imports and renders `StorefrontProductGridSection`, the existing tests pass without any import change. The test file only needs modification if we choose to add direct unit tests for the extracted component.

**Decision:** Keep existing test as-is (tests via parent). The extraction doesn't break it.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `StorefrontProductGridSection` has 33 props — large prop surface | Low | This is the existing interface. Extraction doesn't add props; it just moves them. Splitting props into sub-interfaces is a future optimization, not part of this change. |
| `StorefrontProductGridSection` imports `StorefrontAboutSection` for the about tab | Low | This is an existing dependency. The about tab rendering stays in the grid section since it's part of the section's tab switching logic. |
| `mapToStorageProduct` used in two places | Low | Extract to shared util; both import from same location. No duplication. |
| `HiddenCatalogNotice` uses `filterStyles` from `FilterBar.module.css` | Low | Import the CSS module directly. It's a sibling module in the same directory structure. |
| Import path for `../(main)/home/` components changes depth | Low | From `components/` dir, paths become `../../(main)/home/`. Verified by type-check. |

## Edge Cases

| Case | Handling |
|------|----------|
| New storefront section type added later | Add to `renderStorefrontSection` switch in parent; new component goes in `components/` |
| `StorefrontProductGridSection` needs new state in future | Add prop to interface; parent owns state; no new hooks in extracted component |
| Theme CSS vars need to affect extracted components | They already do via CSS custom properties on `:root`. No code change needed. |
| Test breaks due to mock path changes | Test mocks `@/app/[slug]/(app)/components/*` paths — these remain unchanged |
