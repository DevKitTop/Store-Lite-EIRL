# Spec: de-monolith-storefront-sections

## Requirements

### R1 — Public behavior unchanged

Every component extracted from `BusinessPageContent.tsx` MUST render identically before and after the refactor. No JSX structure, CSS class, conditional rendering, or event handler behavior MAY change.

### R2 — Exports resolve from new file locations

Each extracted component MUST be a named export from its new file under `app/[slug]/(app)/components/`:

| Component | Export name | New file |
|-----------|-------------|----------|
| StorefrontNoticeBar | `StorefrontNoticeBar` | `components/StorefrontNoticeBar.tsx` |
| StorefrontOwnerActions | `StorefrontOwnerActions` | `components/StorefrontOwnerActions.tsx` |
| HiddenCatalogNotice | `HiddenCatalogNotice` | `components/HiddenCatalogNotice.tsx` |
| CustomerFloatingUi | `CustomerFloatingUi` | `components/CustomerFloatingUi.tsx` |
| StaffManagementTools | `StaffManagementTools` | `components/StaffManagementTools.tsx` |
| StorefrontProductGridSection | `StorefrontProductGridSection` | `components/StorefrontProductGridSection.tsx` |
| mapToStorageProduct | `mapToStorageProduct` | `components/mapToStorageProduct.ts` |

### R3 — Theme state stays in parent

All theme-related state (`editableTheme`, `previewScheme`, `viewerTheme`, `activeScheme`, `themeStyles`) and the `useLayoutEffect` / `useEffect` hooks that manage theme CSS vars and localStorage MUST remain in `BusinessPageContentUI`. Extracted components receive theme values as props ONLY — no new theme context or hook calls.

### R4 — Extracted components are props-driven

Each extracted component MUST receive its data exclusively through props. No extracted component MAY:
- Create new global state (useState at module level, context providers)
- Call `useStorage()` directly (receive what they need via props)
- Import hooks that belong to the parent (`useTheme`, `useProductFilters`)
- Access `localStorage` directly (receive resolved values as props)

### R5 — One test import path updated + still passes

The file `tests/unit/storefrontProductGridSection.test.tsx` MUST add an import for `StorefrontProductGridSection` from its new file location (`@/app/[slug]/(app)/components/StorefrontProductGridSection`). The existing test assertions MUST continue to pass unchanged.

### R6 — No `as any` introduced

No new `as any` type casts MAY be introduced in any file. All existing type assertions MUST be preserved as-is.

### R7 — Runtime identical

No component behavior, rendering output, or event handling MAY change. The refactor is purely structural — moving code between files with the same prop interfaces.

### R8 — No out-of-scope files touched

Only these files MAY be modified or created:
- `app/[slug]/(app)/components/StorefrontNoticeBar.tsx` (new)
- `app/[slug]/(app)/components/StorefrontOwnerActions.tsx` (new)
- `app/[slug]/(app)/components/HiddenCatalogNotice.tsx` (new)
- `app/[slug]/(app)/components/CustomerFloatingUi.tsx` (new)
- `app/[slug]/(app)/components/StaffManagementTools.tsx` (new)
- `app/[slug]/(app)/components/StorefrontProductGridSection.tsx` (new)
- `app/[slug]/(app)/components/mapToStorageProduct.ts` (new)
- `app/[slug]/(app)/BusinessPageContent.tsx` (modified)
- `tests/unit/storefrontProductGridSection.test.tsx` (modified)

No other files MAY be modified.

## Scenarios

### Scenario 1 — StorefrontNoticeBar renders in product grid

```
Given BusinessPageContent renders with activeTab='products' and section.visible=true
When the page renders
Then StorefrontNoticeBar receives isOwner, business, hasPaymentGateway, isPaymentConfigured
  And renders the verified badge, payment prompts, or nothing (based on props)
```

### Scenario 2 — StorefrontOwnerActions renders for staff

```
Given BusinessPageContent renders with isStaff=true and activeTab='products'
When the product grid section renders
Then StorefrontOwnerActions receives isOwner={isStaff}, onCreateProduct, onShowLookupModal
  And renders the "Agregar Producto" button
```

### Scenario 3 — HiddenCatalogNotice renders when grid hidden

```
Given BusinessPageContent renders with section.visible=false and activeTab='products'
When the product grid section renders
Then HiddenCatalogNotice receives isOwner={isStaff}, onCreateProduct
  And renders the "Catálogo oculto" notice with owner action row
```

### Scenario 4 — CustomerFloatingUi renders for non-staff

```
Given BusinessPageContent renders with isStaff=false
When the page renders
Then CustomerFloatingUi receives business, paymentsEnabled, culqiPublicKey, chatEnabled, activeScheme, onViewerThemeToggle, onContactClick
  And renders FloatingCartButton, CartDrawer, FloatingChatFab (if chatEnabled), ThemeToggle, Footer
```

### Scenario 5 — StaffManagementTools renders for staff

```
Given BusinessPageContent renders with isStaff=true
When the page renders
Then StaffManagementTools receives all 14 props (business, previewProduct, isEditOpen, isCreateOpen, isDeleteOpen, onSheetClose, onSave, onDeleteClose, onDeleteConfirm, editableTheme, onThemeChange, onPreviewSchemeChange, detectedColorScheme, previewScheme, defaultScheme)
  And renders DeleteProductDialog, CreateProductSheet, StorefrontEditor
```

### Scenario 6 — StorefrontProductGridSection renders full grid

```
Given BusinessPageContent renders with activeTab='products' and section.visible=true
When the product grid section renders
Then StorefrontProductGridSection receives all 33 props
  And renders FilterBar, StorefrontNoticeBar, ProductFiltersTopBar, StorefrontOwnerActions, Feed, Pagination
  Or renders FilterBar, StorefrontNoticeBar, HiddenCatalogNotice (when grid hidden)
```

### Scenario 7 — mapToStorageProduct deduplication

```
Given mapToStorageProduct is defined in components/mapToStorageProduct.ts
When BusinessPageContentUI.handleSaveProduct needs to map a product
Then it imports mapToStorageProduct from the shared util
  And StaffManagementTools also imports mapToStorageProduct from the same util
  And both produce identical mapping output
```

### Scenario 8 — Test import path updated

```
Given storefrontProductGridSection.test.tsx previously tested via BusinessPageContent
When the test file is updated
Then it imports StorefrontProductGridSection from '@/app/[slug]/(app)/components/StorefrontProductGridSection'
  And all 3 existing test cases pass unchanged
```

### Scenario 9 — Theme state stays in parent

```
Given the refactor extracts CustomerFloatingUi and StaffManagementTools
When the components render
Then neither component calls useTheme() or useLayoutEffect for theme CSS vars
  And both receive activeScheme / editableTheme / previewScheme as props
  And the parent BusinessPageContentUI retains all theme hooks and effects
```

### Scenario 10 — Existing tests pass

```
Given all existing unit tests pass before this change
When the refactor is applied
Then pnpm type-check returns 0
  And pnpm lint returns 0
  And pnpm test:unit passes all existing tests
```

### Scenario 11 — No runtime behavior change

```
Given a storefront renders with products, staff, and customer views
When the refactor is applied
Then the rendered output is identical to before
  And no new console warnings appear
  And no new network requests are made
```
