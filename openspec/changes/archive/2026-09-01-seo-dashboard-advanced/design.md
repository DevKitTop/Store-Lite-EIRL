#662 [architecture] Design: seo-dashboard-advanced (T7 — SERP preview, counters, collapse, defaults)
**What**: SDD Technical Design for `seo-dashboard-advanced` — dashboard UX enhancement (T7 only, T8 OUT)

**Why**: Spec requires SERP preview, character counters with colored bars, collapsed "SEO avanzado" section, and auto-filled defaults from generated values. Minimal footprint constraint — only scoped files may change.

**Where**:
- NEW: `src/shared/seo/seoPreview.ts` (+ Vitest tests)
- MODIFY (minimal): `app/[slug]/(app)/settings/constants.tsx`, `SettingsClient.tsx`, `settings.module.css`, `src/shared/seo/buildStorefrontMeta.ts`

**Learned**:
- `BusinessLike` in buildStorefrontMeta.ts is NOT exported (line 3) — needs export addition only
- `SearchPreview` (constants.tsx:321) is already wired to `formData.seoTitle/seoDescription` — R2 is already satisfied, just verify after defaults change
- `CharCounter` (constants.tsx:397) takes `{current, limit}` — needs optional `optimalRange` prop
- No existing collapse/accordion component in project — ProductDetailContent uses inline `.accordion` class (not reusable). Will use `useState<boolean>` toggle inline in SEOSection.
- `business` prop (SettingsBusiness) is fully available in SEOSection — has `name`, `city`, `seoTitle`, `seoDescription`, `description` fields needed for defaults computation

---

## 1. NEW FILE: `src/shared/seo/seoPreview.ts`

Pure functions, zero side effects, Vitest-testable.

### Types

```ts
export type CounterStatus = 'ok' | 'ideal' | 'long' | 'poor';

export interface SeoPreviewState {
  titleLength: number;
  descLength: number;
  titleStatus: CounterStatus;
  descStatus: CounterStatus;
  previewTitle: string;
  previewUrl: string;
  previewDescription: string;
}
```

### Functions

```ts
/**
 * Compute status for a character count given optimal range.
 * Title: ideal 50–60, ok 30–49 or 61–70, poor <30 or >70
 * Desc:  ideal 150–160, ok 120–149 or 161–170, poor <120 or >170
 */
export function getCounterStatus(
  count: number,
  optimal: { min: number; max: number },
): CounterStatus

/**
 * Compute the full preview state for the SEO form.
 * Used by SettingsClient to derive display values.
 */
export function buildSeoPreviewState(params: {
  title: string;
  description: string;
  businessName: string;
  slug: string;
  kind?: 'store'; // extensible for 'product' later
}): SeoPreviewState
```

**`getCounterStatus` logic**:
```
if count >= optimal.min && count <= optimal.max → 'ideal'
if count > optimal.max && count <= optimal.max + 10 → 'ok' (warning zone for title)
if count >= optimal.min - 20 && count < optimal.min → 'ok' (warning zone)
else → 'poor'
```

More precisely for SEO ranges:
- Title (optimal 50–60): `ideal` ∈ [50,60], `ok` ∈ [30,49] ∪ [61,70], `poor` = <30 or >70
- Description (optimal 150–160): `ideal` ∈ [150,160], `ok` ∈ [120,149] ∪ [161,170], `poor` = <120 or >170

**`buildSeoPreviewState`**: calls `getCounterStatus` for title (optimal 50–60) and desc (optimal 150–160), returns lengths + statuses + preview strings. Preview strings use the existing `SearchPreview` display logic (fallback titles/descriptions when empty).

### Test Strategy (Vitest)
- `getCounterStatus`: boundary tests (29→poor, 30→ok, 50→ideal, 60→ideal, 61→ok, 70→ok, 71→poor) × (119→poor, 120→ok, 150→ideal, 160→ideal, 161→ok, 170→ok, 171→poor)
- `buildSeoPreviewState`: empty title → fallback, empty desc → fallback, normal values, unicode chars, very long strings

---

## 2. MODIFY: `app/[slug]/(app)/settings/constants.tsx`

### 2a. Extend `CharCounter` — ADD optional `optimalRange` prop

```ts
export function CharCounter({
  current,
  limit,
  optimalRange, // NEW — optional
}: {
  current: number;
  limit: number;
  optimalRange?: { min: number; max: number }; // NEW
}) {
  const isOver = current > limit;
  const status = optimalRange ? getCounterStatus(current, optimalRange) : null;
  return (
    <div className={styles.charCounter}>
      <span className={`${styles.charCountText} ${isOver ? styles.charCountWarning : ''}`}>
        {isOver && <Icon style={{ fontSize: 12, marginRight: 2, verticalAlign: 'middle' }}>warning</Icon>}
        {current}/{limit}
      </span>
      {/* NEW: color bar when optimalRange provided */}
      {status && (
        <div className={`${styles.charCounterBar} ${
          status === 'ideal' ? styles.charCounterBarIdeal :
          status === 'ok' ? styles.charCounterBarOk :
          styles.charCounterBarPoor
        }`} style={{ width: `${Math.min((current / limit) * 100, 100)}%` }} />
      )}
    </div>
  );
}
```

**Backward compat**: existing callers (terms/returns sections at ~L930/L950) pass no `optimalRange` → no bar rendered → zero visual change.

Import `getCounterStatus` from `@/shared/seo/seoPreview`.

### 2b. Add `CollapsibleSEOSection` component

NOT a separate file — inline in constants.tsx next to other settings components.

```tsx
export function CollapsibleSEOSection({
  defaultCollapsed = true,
  label = 'SEO avanzado',
  helperText = 'Tu SEO ya está optimizado. Podés ajustarlo si querés.',
  children,
}: {
  defaultCollapsed?: boolean;
  label?: string;
  helperText?: string;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <div className={styles.collapsibleSection}>
      <button
        type="button"
        className={styles.collapsibleHeader}
        onClick={() => setCollapsed(!collapsed)}
      >
        <Icon style={{ fontSize: 20, transition: 'transform 0.2s', transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>
          chevron_right
        </Icon>
        <span className={styles.collapsibleLabel}>{label}</span>
        {!collapsed && <span className={styles.collapsibleHelper}>{helperText}</span>}
      </button>
      {!collapsed && <div className={styles.collapsibleContent}>{children}</div>}
    </div>
  );
}
```

### 2c. Import additions in constants.tsx
```ts
import { getCounterStatus } from '@/shared/seo/seoPreview';
```

---

## 3. MODIFY: `app/[slug]/(app)/settings/components/SettingsClient.tsx`

### 3a. Import additions (top of SEOSection or file-level)
```ts
import { buildStoreTitle, buildStoreDescription } from '@/shared/seo/buildStorefrontMeta';
import { CollapsibleSEOSection } from '../constants';
```

Note: `buildStorefrontMeta.ts` exports `buildStoreTitle` and `buildStoreDescription` already (lines 73, 86). The import path needs to use the module's public API.

### 3b. Compute auto-defaults in SEOSection (inside the function, after `business` is available)

```ts
// After line 1275 (inside SEOSection):
const autoTitle = buildStoreTitle(business);
const autoDesc = buildStoreDescription(business);
```

`business` is `SettingsBusiness` which is a superset of `BusinessLike` (has `name`, `city`, `seoTitle`, `seoDescription`, `description`). `buildStoreTitle`/`buildStoreDescription` accept `BusinessLike` — TypeScript structural typing makes this work without casting.

### 3c. Modify `initialForm` (R1 — auto-filled defaults)

Change lines 1276–1277:

```ts
// BEFORE:
seoTitle: business.seoTitle || '',
seoDescription: business.seoDescription || '',

// AFTER:
seoTitle: business.seoTitle ?? autoTitle,
seoDescription: business.seoDescription ?? autoDesc,
```

Key: `??` (nullish coalescing) — only applies when `seoTitle`/`seoDescription` are `null`/`undefined`. If seller saved an empty string `''`, that stays as `''` (not overridden). This matches spec AC3 (existing override shown) and AC4 (clear field → empty → placeholder shows auto value).

**Edge case — seller clears field**: When seller clears the field, `formData.seoTitle` becomes `''`. The `SearchPreview` component already handles empty title with fallback text (line 338: `title || 'Título de tu tienda | Store Lite'`). The `CharCounter` shows `0/60`. This is correct — no auto-re-fill on clear.

### 3d. Update CharCounter calls (R3 — colored progress bars)

Lines 1380 and 1397:

```ts
// BEFORE (line 1380):
<CharCounter current={formData.seoTitle.length} limit={60} />

// AFTER:
<CharCounter current={formData.seoTitle.length} limit={60} optimalRange={{ min: 50, max: 60 }} />

// BEFORE (line 1397):
<CharCounter current={formData.seoDescription.length} limit={160} />

// AFTER:
<CharCounter current={formData.seoDescription.length} limit={160} optimalRange={{ min: 150, max: 160 }} />
```

### 3e. Wrap form fields in collapsible (R4 — collapsed section)

Lines 1365–1416 (the "Metadata de Búsqueda" Card) → wrap the Card in `CollapsibleSEOSection`:

```tsx
{/* R4: SERP preview stays OUTSIDE collapsible — always visible */}
<SearchPreview ... /> {/* line 1355 — unchanged */}

{/* R4: Form fields wrapped in collapsible — default collapsed */}
<CollapsibleSEOSection defaultCollapsed={true}>
  <Card variant="outlined" className={styles.infoCard}>
    <p className={styles.cardLabel}>Metadata de Búsqueda</p>
    <div className={styles.metaFields}>
      {/* existing TextField + CharCounter fields — unchanged */}
    </div>
  </Card>
</CollapsibleSEOSection>
```

**SearchPreview stays OUTSIDE** the collapsible — always visible per spec AC5. Only the form Card is wrapped.

---

## 4. MODIFY: `app/[slug]/(app)/settings/settings.module.css`

### 4a. Character counter bar styles (add after `.charCountWarning` ~line 1404)

```css
/* ── Character Counter Progress Bar ──────────────────────────────── */
.charCounterBar {
  height: 3px;
  border-radius: 2px;
  margin-top: 4px;
  transition: width 0.2s ease, background-color 0.3s ease;
}

.charCounterBarIdeal {
  background-color: #2e7d32; /* green — optimal zone */
}

.charCounterBarOk {
  background-color: #f9a825; /* amber — warning zone */
}

.charCounterBarPoor {
  background-color: #c62828; /* red — poor zone */
}
```

### 4b. Collapsible section styles (add after charCounter styles)

```css
/* ── Collapsible Section ─────────────────────────────────────────── */
.collapsibleSection {
  margin-bottom: 8px;
}

.collapsibleHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 12px 16px;
  border: none;
  border-radius: 12px;
  background: var(--md-sys-color-surface-container-low);
  cursor: pointer;
  text-align: left;
  transition: background 0.2s ease;
}

.collapsibleHeader:hover {
  background: var(--md-sys-color-surface-container);
}

.collapsibleLabel {
  font-size: 14px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
}

.collapsibleHelper {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
  margin-left: auto;
}

.collapsibleContent {
  padding-top: 8px;
}
```

---

## 5. MODIFY: `src/shared/seo/buildStorefrontMeta.ts`

### Export BusinessLike (line 3)

```ts
// BEFORE:
interface BusinessLike {

// AFTER:
export interface BusinessLike {
```

That's it — one keyword change. No logic modifications.

**Why needed**: `seoPreview.ts` imports `BusinessLike` for type safety. `SettingsBusiness` is structurally compatible but importing `BusinessLike` from the canonical source is cleaner and avoids duplication.

**Alternative if export is rejected**: `seoPreview.ts` can define its own `BusinessLike` interface (identical shape). Less ideal but still correct. The design prefers the single-source export.

---

## 6. Edge Cases & Behaviors

| Scenario | Behavior |
|----------|----------|
| Empty `business.seoTitle` (null) | `buildStoreTitle` returns auto-generated fallback → used as initial form value |
| Seller saves with auto-default | The auto-default becomes the saved override (intentional — seller accepted it) |
| Seller clears title field | `formData.seoTitle` = `''`, SearchPreview shows fallback, CharCounter shows `0/60` |
| Seller reopens page after clear | `business.seoTitle` is `''` (saved), not `null` → stays `''`, no auto-refill |
| Very long title (>70 chars) | Status = `poor` (red), bar extends, counter shows warning icon |
| Unicode characters (é, ñ, etc.) | `String.length` counts code units — acceptable for display counting (same as current behavior) |
| Toggle collapse open/close | State is component-local `useState(false)` — resets on page reload (default collapsed) |
| Free plan seller | Entire SEO section gated at line 1306 — no new code path needed |

---

## 7. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| `buildStoreTitle`/`buildStoreDescription` import path breaks | Low | Verify import resolves; fallback: duplicate logic inline in SEOSection |
| `BusinessLike` export causes circular import | None | `seoPreview.ts` → `buildStorefrontMeta.ts` is one-way, no cycle |
| `CharCounter` bar changes visual weight for terms/returns counters | None | `optimalRange` is optional; existing callers pass none → no bar |
| Collapse default-closed hides fields users need | Low | Helper text "Podés ajustarlo si querés" signals discoverability; chevron is visible |
| Auto-default saves as override (not separate "reset") | Low | By design — matches spec AC3. Seller who accepts default = happy with it |

---

## 8. File Impact Summary

| File | Action | Lines changed (est.) | Justification |
|------|--------|---------------------|---------------|
| `src/shared/seo/seoPreview.ts` | NEW | ~60 | Pure functions for preview state + counter status |
| `src/shared/seo/seoPreview.test.ts` | NEW | ~80 | Vitest unit tests |
| `app/[slug]/(app)/settings/constants.tsx` | MODIFY | ~45 | Extend CharCounter + add CollapsibleSEOSection |
| `app/[slug]/(app)/settings/components/SettingsClient.tsx` | MODIFY | ~15 | Import defaults, modify initialForm, add optimalRange props, wrap in collapsible |
| `app/[slug]/(app)/settings/settings.module.css` | MODIFY | ~40 | Counter bar colors + collapsible styles |
| `src/shared/seo/buildStorefrontMeta.ts` | MODIFY | 1 | Export `BusinessLike` keyword |

**Total estimated changed lines**: ~241 (well under 400-line threshold).

---

## 9. Next Phase

`sdd-tasks` — break this design into implementation tasks following the steel thread: Slice 1 (R2+R3: CharCounter extension + verify SearchPreview) → Slice 2 (R1: auto-defaults) → Slice 3 (R4: collapsible wrapper).