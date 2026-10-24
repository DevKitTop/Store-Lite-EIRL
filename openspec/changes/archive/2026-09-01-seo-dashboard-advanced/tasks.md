#663 [architecture] Tasks: seo-dashboard-advanced (T7 — first batch)
## What
SDD Implementation Tasks for `seo-dashboard-advanced` (T7, T8 OUT). Six tasks covering: pure functions + tests, CharCounter extension, defaults pre-fill, SERP preview verification, collapsible wrapper, and CSS + BusinessLike export.

## Why
Breaks the design into verifiable work units following the steel thread: pure logic first (TDD), then UI wiring, then styling. Each task maps to one commit with clear rollback scope.

## Where
- NEW: `src/shared/seo/seoPreview.ts`, `src/shared/seo/__tests__/seoPreview.test.ts`
- MODIFY: `constants.tsx`, `SettingsClient.tsx`, `settings.module.css`, `buildStorefrontMeta.ts`

## Learned
- No previous apply-progress exists — this is the first batch
- `CharCounter` (constants.tsx:397) has simple `{current, limit}` signature — clean extension point
- `buildStorefrontMeta.ts` line 3 `interface BusinessLike` is NOT exported — 1-line fix
- `SettingsClient.tsx` line 1276 uses `|| ''` not `??` — must change to `??` for nullish coalescing to work correctly with auto-defaults
- `useState` already imported in constants.tsx — CollapsibleSEOSection needs no new import
- `LinearProgress` already imported in constants.tsx — but design uses a raw div for the bar, not LinearProgress

---

## Task List

### T1: Pure functions + unit tests (TDD — RED phase)
**Files:**
- CREATE: `src/shared/seo/seoPreview.ts`
- CREATE: `src/shared/seo/__tests__/seoPreview.test.ts`

**Description:** Create `getCounterStatus` and `buildSeoPreviewState` pure functions. Write Vitest tests FIRST (RED), then implement to make them pass (GREEN).

**Acceptance criteria:**
- `getCounterStatus(count, {min, max})` returns `'ideal'`, `'ok'`, or `'poor'` per spec ranges
- `buildSeoPreviewState({title, description, businessName, slug})` returns `SeoPreviewState` with lengths, statuses, and preview strings (fallbacks for empty)
- All boundary tests pass: 29→poor, 30→ok, 50→ideal, 60→ideal, 61→ok, 70→ok, 71→poor (title); 119→poor, 120→ok, 150→ideal, 160→ideal, 161→ok, 170→ok, 171→poor (description)
- `buildSeoPreviewState` fallback: empty title → "Título de tu tienda | Store Lite"; empty desc → "Configurá la descripción SEO..."

**Tests (Vitest):**
- `getCounterStatus`: 14 boundary cases (7 for title optimal range, 7 for description)
- `buildSeoPreviewState`: empty title, empty desc, normal values, unicode, very long strings

**Dependencies:** None (first task — pure functions, no existing code modified)

**Verification:** `pnpm vitest run src/shared/seo/__tests__/seoPreview.test.ts`

---

### T2: Export `BusinessLike` from `buildStorefrontMeta.ts`
**Files:**
- MODIFY: `src/shared/seo/buildStorefrontMeta.ts` (line 3: `interface` → `export interface`)

**Description:** Add `export` keyword to `BusinessLike` interface so `seoPreview.ts` can import it for type safety. Single-line change.

**Acceptance criteria:**
- `BusinessLike` is exported from `buildStorefrontMeta.ts`
- No other code changes in this file
- `pnpm tsc --noEmit` passes (no type errors)

**Dependencies:** T1 (seoPreview.ts imports BusinessLike)

**Verification:** TypeScript compilation passes; existing tests still green

---

### T3: Extend `CharCounter` with `optimalRange` prop + color bar
**Files:**
- MODIFY: `app/[slug]/(app)/settings/constants.tsx` (CharCounter function at line 397)

**Description:** Add optional `optimalRange?: { min: number; max: number }` prop to `CharCounter`. When provided, call `getCounterStatus` and render a colored progress bar below the counter text. Backward-compatible: existing callers (terms/returns) pass no `optimalRange` → no bar.

**Acceptance criteria:**
- `CharCounter` accepts optional `optimalRange` prop
- When `optimalRange` provided: renders a 3px bar with color based on status (ideal=green, ok=amber, poor=red)
- Bar width = `Math.min((current / limit) * 100, 100)%`
- Existing CharCounter usage (terms/returns sections) unaffected — no bar rendered
- Import `getCounterStatus` from `@/shared/seo/seoPreview`

**Dependencies:** T1 (imports getCounterStatus), T2 (BusinessLike exported — not strictly needed here but aligns)

**Verification:** `pnpm tsc --noEmit` passes; manual check that terms/renders CharCounters still look correct

---

### T4: Auto-filled SEO defaults in SettingsClient (R1)
**Files:**
- MODIFY: `app/[slug]/(app)/settings/components/SettingsClient.tsx` (SEOSection, lines 1275-1277)

**Description:** Import `buildStoreTitle`/`buildStoreDescription` from `buildStorefrontMeta`. Compute auto-defaults and use nullish coalescing (`??`) to pre-fill `seoTitle`/`seoDescription` when business overrides are null.

**Acceptance criteria:**
- `autoTitle = buildStoreTitle(business)` computed inside SEOSection
- `autoDesc = buildStoreDescription(business)` computed inside SEOSection
- Line 1276: `seoTitle: business.seoTitle ?? autoTitle` (NOT `||`)
- Line 1277: `seoDescription: business.seoDescription ?? autoDesc` (NOT `||`)
- When `business.seoTitle` is null → auto-generated value shown
- When `business.seoTitle` is `''` (empty string saved) → `''` shown (not overridden)
- When `business.seoTitle` has a value → existing override shown
- `SearchPreview` (line 1355) already wired — verify it reflects defaults live (R2 satisfied)

**Dependencies:** T1, T2 (buildStorefrontMeta exports needed), T3 (CharCounter extended — optional but aligns)

**Verification:** `pnpm tsc --noEmit`; manual test: open Settings > SEO with null overrides → auto-filled; with existing override → shown; clear field → empty (no re-fill)

---

### T5: Collapsible "SEO avanzado" wrapper (R4)
**Files:**
- MODIFY: `app/[slug]/(app)/settings/constants.tsx` (add `CollapsibleSEOSection` component)
- MODIFY: `app/[slug]/(app)/settings/components/SettingsClient.tsx` (wrap form Card)

**Description:** Add `CollapsibleSEOSection` component to constants.tsx using `useState<boolean>(false)` for collapsed state. Wrap the "Metadata de Búsqueda" Card (lines 1365-1416) in SettingsClient.tsx. `SearchPreview` (line 1355) stays OUTSIDE — always visible.

**Acceptance criteria:**
- `CollapsibleSEOSection` component exported from constants.tsx
- Props: `defaultCollapsed?: boolean`, `label?: string`, `helperText?: string`, `children: ReactNode`
- Default state: collapsed (fields hidden)
- Click header → toggle expand/collapse
- Chevron rotates on expand (0deg → 90deg)
- Helper text: "Tu SEO ya está optimizado. Podés ajustarlo si querés." visible when expanded
- `SearchPreview` remains outside collapsible (always visible)
- `useState` already imported in constants.tsx (line 12) — no new import needed

**Dependencies:** T3, T4 (form fields must be correct before wrapping)

**Verification:** `pnpm tsc --noEmit`; manual test: page loads → fields collapsed, click → expand, click → collapse, SERP preview always visible

---

### T6: CSS styles for counter bar + collapsible section
**Files:**
- MODIFY: `app/[slug]/(app)/settings/settings.module.css` (after line 1404)

**Description:** Add CSS classes for character counter progress bar and collapsible section. Insert after existing `.charCountWarning` block.

**Acceptance criteria:**
- `.charCounterBar` — 3px height, border-radius 2px, margin-top 4px, transition on width and background-color
- `.charCounterBarIdeal` — green (#2e7d32)
- `.charCounterBarOk` — amber (#f9a825)
- `.charCounterBarPoor` — red (#c62828)
- `.collapsibleSection` — margin-bottom 8px
- `.collapsibleHeader` — flex, gap 8px, padding 12px 16px, border-radius 12px, surface-container-low bg, cursor pointer
- `.collapsibleHeader:hover` — surface-container bg
- `.collapsibleLabel` — 14px, weight 600
- `.collapsibleHelper` — 12px, on-surface-variant, margin-left auto
- `.collapsibleContent` — padding-top 8px

**Dependencies:** T3, T5 (components that use these classes)

**Verification:** Visual check in browser; `pnpm tsc --noEmit` still passes (CSS modules don't affect TS)

---

## Execution Order (Steel Thread)
```
T1 → T2 → T3 → T4 → T5 → T6
```
- T1+T2: Pure logic foundation (parallelizable but T2 is trivial)
- T3: CharCounter extension (depends on T1)
- T4: Defaults pre-fill (depends on T2)
- T5: Collapsible wrapper (depends on T3+T4)
- T6: CSS (depends on T3+T5)

## Review Workload Forecast
- **Estimated total changed lines:** ~241 (per design estimate)
- **Breakdown:**
  - T1: ~140 lines (60 impl + 80 tests) — NEW files
  - T2: 1 line
  - T3: ~25 lines (constants.tsx)
  - T4: ~10 lines (SettingsClient.tsx)
  - T5: ~30 lines (constants.tsx + SettingsClient.tsx)
  - T6: ~35 lines (settings.module.css)
- **Budget risk:** LOW — well under 400-line threshold
- **Chained PRs recommended:** No
- **Decision needed before apply:** None — all tasks are straightforward extensions of existing patterns