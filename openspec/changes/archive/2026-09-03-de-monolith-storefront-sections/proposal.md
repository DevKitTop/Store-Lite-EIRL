# Proposal: de-monolith-storefront-sections

## Intent

Extract 6 inline sub-components from `BusinessPageContent.tsx` (1064 lines → ~460 lines) into standalone files under `app/[slug]/(app)/components/`. Follows the `StorefrontAboutSection.tsx` extraction precedent. One utility deduplication (`mapToStorageProduct`) and one test import path update included.

## Scope

### In Scope

| Extraction | Target file | Est. lines | Source lines |
|------------|-------------|------------|--------------|
| `StorefrontNoticeBar` | `components/StorefrontNoticeBar.tsx` | ~65 | 940–1000 |
| `StorefrontOwnerActions` | `components/StorefrontOwnerActions.tsx` | ~38 | 1002–1035 |
| `HiddenCatalogNotice` | `components/HiddenCatalogNotice.tsx` | ~30 | 1037–1064 |
| `CustomerFloatingUi` | `components/CustomerFloatingUi.tsx` | ~50 | 648–692 |
| `StaffManagementTools` | `components/StaffManagementTools.tsx` | ~65 | 694–755 |
| `StorefrontProductGridSection` | `components/StorefrontProductGridSection.tsx` | ~195 | 757–938 |
| `mapToStorageProduct` util | `components/mapToStorageProduct.ts` | ~20 | 87–103 |

**Incidental cleanup:**

| Cleanup | Detail |
|---------|--------|
| Extract `mapToStorageProduct` to util | Duplicated in parent (line 121–137 inline map) and `StaffManagementTools` (line 729). Both use the same mapping logic. Extract to shared util, import in both places. |
| Update test import path | `storefrontProductGridSection.test.tsx` — import `StorefrontProductGridSection` from new file location. |

**What stays in `BusinessPageContent.tsx` (parent, ~460 lines):**
- `BusinessPageContentProps` interface + `OwnerSheetSaveArgs` type
- `BusinessPageContent` wrapper (StorageProvider)
- `BusinessPageContentUI` — all state/hooks (`activeTab`, `currentPage`, `previewProduct`, `previewSignal`, `previewImageIndex`, `isContactDialogOpen`, `isEditOpen`, `isCreateOpen`, `isDeleteOpen`, `showLookupModal`, theme state, `alert`, `useProductFilters` result, all handlers)
- Theme `useLayoutEffect` + localStorage effects
- Page assembly JSX: `page-container` div, `ProductPreviewSheet`, `BasicContactDialog`, `LookupOrderModal`
- Calls to extracted components (imported from new files)
- `renderStorefrontSection` switch — now calls `StorefrontProductGridSection` from import

### Out of Scope

- C1: Team actions split (done in previous change)
- C3: Conventions, documentation, or structural patterns
- D/E: Design system or extraction patterns beyond this change
- Runtime behavior changes (no logic, no new props, no new state)
- New global state or context providers
- New packages or migrations

## Approach

1. Extract `mapToStorageProduct` to shared util
2. Extract each of the 6 components to standalone files (each receives props from parent, no state moves)
3. Update parent imports, delete inline definitions, wire component calls
4. Update test import path
5. Verify: `pnpm type-check && pnpm lint && pnpm test:unit`

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/[slug]/(app)/components/` (new files) | New | 7 files (~463 lines) |
| `app/[slug]/(app)/BusinessPageContent.tsx` | Modified | Remove ~600 lines of inline components + `mapToStorageProduct`, add imports (~15 lines) |
| `tests/unit/storefrontProductGridSection.test.tsx` | Modified | Add import for `StorefrontProductGridSection` from new path |

**Estimated total:** ~463 new lines + ~15 changed lines in parent + 1 import line in test.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Large prop surface on `StorefrontProductGridSection` (33 props) | Known | This is the existing prop interface — no new drilling. Prop types are already defined inline. The extraction just moves them to a separate file. |
| `mapToStorageProduct` used by both parent and `StaffManagementTools` | Low | Extract to shared util; both import from same location. |
| Theme state coupling in `StaffManagementTools` (receives `editableTheme`, `onThemeChange`, `previewScheme`, etc.) | Low | Theme state stays in parent; `StaffManagementTools` receives it as props. No new state created. |
| Test mock paths change | Low | Test already mocks most dependencies via `@/` paths. Only the `StorefrontProductGridSection` import needs updating. |
| Diff exceeds 400 lines | Very low | ~463 new lines in new files + ~600 deleted from parent (net zero). Git rename-detection will show these as renames. |

## Rollback Plan

Revert restores the single `BusinessPageContent.tsx` file. No consumers change. No runtime impact.

## Dependencies

None — pure refactor, no new packages, no migrations.

## Success Criteria

- [ ] `app/[slug]/(app)/components/` contains 7 new files (~463 lines)
- [ ] `BusinessPageContent.tsx` reduced to ~460 lines
- [ ] All 6 components importable from new file locations
- [ ] `mapToStorageProduct` shared util imported by parent and `StaffManagementTools`
- [ ] `storefrontProductGridSection.test.tsx` import path updated
- [ ] `pnpm type-check` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test:unit` passes (existing tests)
- [ ] No runtime behavior change
- [ ] No new global state or context providers
- [ ] Parent keeps identical user-visible behavior
