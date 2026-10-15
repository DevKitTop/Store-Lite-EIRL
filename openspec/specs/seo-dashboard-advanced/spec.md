# Delta Spec: seo-dashboard-advanced — T7

> **Change**: `seo-dashboard-advanced`
> **Scope**: T7 (mandatory) + T8 (optional — OUT)
> **Groups**: Grupo 3 — Dashboard UX — Paid Plans Only (gated by `entitlements.seoEnabled`)
> **Status**: Draft

---

## 1. Context

The current SEO form is flat. Novice sellers don't know what to write or see the result. Advanced features must remain gated to paid plans while providing auto-generated defaults as a starting point.

**Existing patterns observed:**

- `app/[slug]/(app)/settings/components/SettingsClient.tsx` — SEO section (lines 1280–1460): already has `SearchPreview` + `CharCounter` wired to `formData`; `seoEnabled` gate at line 1306.
- `app/[slug]/(app)/settings/constants.tsx` — `SearchPreview` (line 321), `CharCounter` (line 397); `SettingsBusiness` type includes `seoTitle`, `seoDescription`, `seoKeywords`, `city`, `name`.
- `app/[slug]/(app)/settings/settings.module.css` — `searchPreview`/`googlePreview`/`charCounter` styles exist.
- `src/shared/seo/buildStorefrontMeta.ts` — `buildStoreTitle(business)` and `buildStoreDescription(business)` pure functions, `BusinessLike` interface (name, seoTitle, seoDescription, description, city).

---

## 2. Requirements

### R1 — Auto-filled SEO defaults from generated values

**User story:** As a paid-plan seller, when I open the SEO section, the Title and Description fields are pre-filled with the auto-generated values so I start with an optimized baseline.

**Acceptance criteria (Given/When/Then):**

1. **Given** a seller on Emprendedor+ plan opens Settings > SEO. **When** the SEO section renders. **Then** `formData.seoTitle` is initialized with `buildStoreTitle(business)` if the seller has no existing `seoTitle` override (i.e., `business.seoTitle` is null).
2. **Given** same context. **When** the SEO section renders. **Then** `formData.seoDescription` is initialized with `buildStoreDescription(business)` if `business.seoDescription` is null.
3. **Given** the seller already has an `seoTitle` override saved. **When** the section renders. **Then** the existing override is shown (not the auto-generated value).
4. **Given** the seller clears the title field. **When** the field is empty. **Then** the placeholder shows the auto-generated value as ghost text (not pre-filled).
5. **Given** free plan seller. **When** they open Settings > SEO. **Then** the entire section is gated off (existing upgrade banner) — no changes here.

**Implementation notes:**

- Compute `autoTitle = buildStoreTitle(business)` and `autoDesc = buildStoreDescription(business)` inside SEOSection using the `business` prop (already available as `SettingsBusiness`).
- Use auto values as `initialForm.seoTitle` / `initialForm.seoDescription` only when `business.seoTitle` / `business.seoDescription` are null.
- `BusinessLike` interface in `buildStorefrontMeta.ts` is compatible with `SettingsBusiness` (subset of fields). Export `BusinessLike` from `buildStorefrontMeta.ts` for client import, or cast locally.
- No new server call; all data already in SettingsClient props.

**Testability:** Pure function extraction — `computeSeoDefaults(business: BusinessLike): { title: string; description: string }` in `src/shared/seo/seoPreview.ts` (new). Vitest unit tests: returns auto title/desc when overrides null; returns override when set; truncation correctness.

### R2 — Live SERP preview

**User story:** As a seller, I see a Google-style SERP preview (blue title + green URL + gray description) that updates live as I type.

**Acceptance criteria:**

1. **Given** the SEO section renders. **When** `formData.seoTitle` changes. **Then** the SearchPreview component updates the title in real-time.
2. **Given** `formData.seoDescription` changes. **When** the user types. **Then** the SearchPreview description updates in real-time.
3. **Given** `formData.seoTitle` is empty. **When** the preview renders. **Then** it shows the fallback: "Título de tu tienda | Store Lite" (existing behavior).
4. **Given** `formData.seoDescription` is empty. **When** the preview renders. **Then** it shows the fallback: "Configurá la descripción SEO..." (existing behavior).

**Implementation notes:**

- `SearchPreview` is already wired to `formData.seoTitle`/`formData.seoDescription` at line 1355 of SettingsClient.tsx. This requirement is ALREADY SATISFIED by current code — no changes needed. Verify during implementation that the live binding works after adding defaults (R1).

**Testability:** Manual verification. SearchPreview is a presentational component; no unit test extraction needed.

### R3 — Character counters with colored progress bar

**User story:** As a seller, I see a character counter with a color bar below each SEO field showing whether I'm in the optimal range (green = optimal, yellow = warning, red = over limit).

**Acceptance criteria:**

1. **Given** the SEO section renders. **When** the user types in the title field. **Then** a counter shows `{current}/{limit}` (limit=60 for title, limit=160 for description).
2. **Given** title count is between 50–60. **When** counter renders. **Then** the bar/indicator is green (optimal zone).
3. **Given** title count is between 30–49 or 61–70. **When** counter renders. **Then** the bar/indicator is yellow (warning zone).
4. **Given** title count is >70 or <30. **When** counter renders. **Then** the bar/indicator is red (poor zone).
5. **Given** description count is between 150–160. **When** counter renders. **Then** green.
6. **Given** description count is between 120–149 or 161–170. **When** counter renders. **Then** yellow.
7. **Given** description count >170. **When** counter renders. **Then** red.

**Implementation notes:**

- Extend existing `CharCounter` component in `constants.tsx` with an optional `optimalRange?: { min: number; max: number }` prop. When provided, render a `LinearProgress`-style color bar below the text.
- Add CSS classes in `settings.module.css`: `.charCounterBar`, `.charCounterBarOptimal`, `.charCounterBarWarning`, `.charCounterBarOver`.
- Backward-compatible: existing CharCounter usage (terms/returns at lines 930/950) passes no `optimalRange`, so no visual change for those.

**Testability:** Pure function — `getCounterColor(current: number, optimal: { min: number; max: number }): 'green' | 'yellow' | 'red'` in `src/shared/seo/seoPreview.ts`. Vitest unit tests for boundary conditions.

### R4 — Collapsed "SEO avanzado" wrapper

**User story:** As a paid-plan seller, the advanced SEO fields (title, description, keywords) are collapsed by default under a "SEO avanzado" header with helpful copy, reducing cognitive load.

**Acceptance criteria:**

1. **Given** the SEO section renders (paid plan). **When** the page loads. **Then** the SEO fields card (title, description, keywords) is collapsed (hidden) by default.
2. **Given** collapsed state. **When** the user clicks the "SEO avanzado" header. **Then** the card expands to reveal the fields.
3. **Given** expanded state. **When** the user clicks the header again. **Then** the card collapses.
4. **Given** collapsed state. **When** visible. **Then** the helper text reads: "Tu SEO ya está optimizado. Podés ajustarlo si querés." with a chevron indicator.
5. **Given** the search preview (R2). **When** the section renders. **Then** the SERP preview is ALWAYS visible (outside the collapsed wrapper) — only the form fields are collapsed.

**Implementation notes:**

- Create a new `CollapsibleSEOSection` component in `constants.tsx` (or inline in SettingsClient.tsx if simpler) using `useState<boolean>(false)` for collapsed state.
- Wrap the existing "Metadata de Búsqueda" Card (lines 1365–1416) in the collapsible.
- Keep `SearchPreview` (line 1355) OUTSIDE the collapsible — always visible.
- CSS: `.collapsibleHeader` with cursor pointer, chevron rotation on expand.

**Testability:** Manual UX verification. State management is trivial (boolean toggle).

### T8 — Product image alt text (OUT)

**Decision: OUT of this change.**

**Rationale:**

- Plan says T8 is "(Opcional)" — nice-to-have, not critical path.
- Product image upload component location is unknown (plan says "location TBD"). Requires exploration to find the upload handler, verify where alt text is stored, and determine the data flow.
- Alt text pre-fill is a simple, isolated change that can ship independently after T7.
- Including it here would expand the change scope without clear value for the "SEO avanzado" paid dashboard UX — which is the core of this change.

**Recommendation:** File as a separate, lightweight change (`seo-product-alt-text`) after T7 ships.

---

## 3. Acceptance Criteria / Scenarios

### R1 — Auto-filled defaults

| #     | Scenario                         | Given                                                 | When                 | Then                                                                                                             |
| ----- | -------------------------------- | ----------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| AC1.1 | Null overrides → auto defaults   | Business has `seoTitle: null`, `seoDescription: null` | SEO section renders  | `formData.seoTitle` = `buildStoreTitle(business)`, `formData.seoDescription` = `buildStoreDescription(business)` |
| AC1.2 | Existing override shown          | Business has `seoTitle: "Custom Title"`               | SEO section renders  | `formData.seoTitle` = `"Custom Title"` (not auto-generated)                                                      |
| AC1.3 | Empty string saved → stays empty | Business has `seoTitle: ""` (saved empty)             | SEO section renders  | `formData.seoTitle` = `""` (not overridden)                                                                      |
| AC1.4 | Clear field → no re-fill         | Seller clears title field                             | Field becomes empty  | Placeholder shows auto-generated value as ghost text; `formData.seoTitle` = `""`                                 |
| AC1.5 | Free plan gated                  | Free plan seller                                      | Opens Settings > SEO | Entire section gated off (existing upgrade banner)                                                               |

### R2 — Live SERP preview

| #     | Scenario                    | Given                            | When                            | Then                                           |
| ----- | --------------------------- | -------------------------------- | ------------------------------- | ---------------------------------------------- |
| AC2.1 | Title updates preview       | SEO section renders              | User types in title field       | SearchPreview title updates in real-time       |
| AC2.2 | Description updates preview | SEO section renders              | User types in description field | SearchPreview description updates in real-time |
| AC2.3 | Empty title fallback        | `formData.seoTitle` = `""`       | Preview renders                 | Shows "Título de tu tienda \| Store Lite"      |
| AC2.4 | Empty description fallback  | `formData.seoDescription` = `""` | Preview renders                 | Shows "Configurá la descripción SEO..."        |

### R3 — Colored character counter

| #     | Scenario                    | Given                 | When            | Then                                                                  |
| ----- | --------------------------- | --------------------- | --------------- | --------------------------------------------------------------------- |
| AC3.1 | Counter shows current/limit | SEO field renders     | User types      | Counter shows `{current}/{limit}` (60 for title, 160 for description) |
| AC3.2 | Title green (optimal)       | Title count 55        | Counter renders | Bar green, status `ideal`                                             |
| AC3.3 | Title yellow (warning)      | Title count 45        | Counter renders | Bar amber, status `ok`                                                |
| AC3.4 | Title red (poor)            | Title count 25        | Counter renders | Bar red, status `poor`                                                |
| AC3.5 | Description green           | Description count 155 | Counter renders | Bar green                                                             |
| AC3.6 | Description yellow          | Description count 130 | Counter renders | Bar amber                                                             |
| AC3.7 | Description red             | Description count 180 | Counter renders | Bar red                                                               |

### R4 — Collapsed SEO section

| #     | Scenario                    | Given                           | When                              | Then                                                                      |
| ----- | --------------------------- | ------------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| AC4.1 | Default collapsed           | SEO section renders (paid plan) | Page loads                        | Fields card collapsed, SERP preview visible                               |
| AC4.2 | Expand on click             | Collapsed state                 | User clicks "SEO avanzado" header | Fields expand, chevron rotates                                            |
| AC4.3 | Collapse on click           | Expanded state                  | User clicks header again          | Fields collapse, chevron rotates back                                     |
| AC4.4 | Helper text visible         | Expanded state                  | Header visible                    | Helper text "Tu SEO ya está optimizado. Podés ajustarlo si querés." shown |
| AC4.5 | SERP preview always visible | Any state                       | Section renders                   | SearchPreview remains outside collapsible, always visible                 |

---

## 4. Steel Thread (Minimal Vertical Slice)

**Slice 1 (core):** R2 + R3 — SERP preview + enhanced CharCounter with colored bar. Zero new components, just extending existing `CharCounter` and verifying `SearchPreview` live binding. This alone gives sellers visual feedback.

**Slice 2:** R1 — Auto-filled defaults. Compute `buildStoreTitle`/`buildStoreDescription` in SEOSection, pre-fill when overrides are null. Depends on Slice 1 for the preview to show the defaults live.

**Slice 3:** R4 — Collapsible wrapper. Wraps the form fields. Depends on Slices 1-2 being stable.

**Order of implementation:** Slice 1 → Slice 2 → Slice 3.

---

## 5. Non-Goals (Explicitly NOT in this change)

- Changing plan model, adding new entitlement flags (e.g. `seoAdvancedEnabled`).
- Backend changes (server actions, DB schema).
- OG images, sitemap, JSON-LD, canonicals, auth, pricing page, storage.
- Other dashboard sections (storefront, legal, GPS — untouched).
- AI suggestion button (nice-to-have, deferred).
- T8 alt text for product images (OUT — see rationale above).

---

## 6. Testability

### Unit Tests (Vitest)

| What                               | Where                                         | Why                                                        |
| ---------------------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| `getCounterStatus(count, optimal)` | `src/shared/seo/__tests__/seoPreview.test.ts` | Pure function, boundary tests for title/description ranges |
| `buildSeoPreviewState(params)`     | Same file                                     | Verify lengths, statuses, fallback strings                 |

### Integration / Smoke Tests

| What                     | How                        | Why                              |
| ------------------------ | -------------------------- | -------------------------------- |
| Type-check passes        | `pnpm tsc --noEmit`        | Ensures all new files type-check |
| ESLint clean             | `pnpm eslint` on new files | No lint errors                   |
| Existing unit tests pass | `pnpm vitest run`          | No regressions                   |

### Manual Verification Checklist

- [ ] SEO section with paid plan: fields collapsed, SERP preview visible
- [ ] Click "SEO avanzado" header → fields expand, chevron rotates
- [ ] Click again → fields collapse
- [ ] Title field: type → counter shows current/60, color bar updates
- [ ] Description field: type → counter shows current/160, color bar updates
- [ ] Color zones: title 50–60 green, 30–49/61–70 amber, <30/>70 red; description 150–160 green, 120–149/161–170 amber, <120/>170 red
- [ ] Business with null seoTitle → auto-filled with `buildStoreTitle(business)`
- [ ] Business with existing seoTitle → shows that value
- [ ] Clear title field → empty, placeholder shows auto-generated ghost text
- [ ] Free plan seller: entire SEO section gated
- [ ] `pnpm type-check` passes
- [ ] `pnpm lint` passes
- [ ] All existing tests pass

---

## 7. Files to Create / Modify

### New Files

| File                                          | Purpose                                                    |
| --------------------------------------------- | ---------------------------------------------------------- |
| `src/shared/seo/seoPreview.ts`                | Pure functions: `getCounterStatus`, `buildSeoPreviewState` |
| `src/shared/seo/__tests__/seoPreview.test.ts` | 35+ Vitest unit tests                                      |

### Modified Files

| File                                                      | Change                                                                                                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/[slug]/(app)/settings/constants.tsx`                 | Extend `CharCounter` with `optimalRange` prop + color bar; add `CollapsibleSEOSection` component                                                                        |
| `app/[slug]/(app)/settings/components/SettingsClient.tsx` | Import `buildStoreTitle`/`buildStoreDescription`; compute auto defaults; modify `initialForm` with `??`; pass `optimalRange` to `CharCounter`; wrap form in collapsible |
| `app/[slug]/(app)/settings/settings.module.css`           | Add `.charCounterBar*` color classes, `.collapsible*` styles                                                                                                            |
| `src/shared/seo/buildStorefrontMeta.ts`                   | Export `BusinessLike` interface (1 line)                                                                                                                                |

### Unchanged Files

| File                                 | Reason             |
| ------------------------------------ | ------------------ |
| `app/[slug]/(app)/settings/page.tsx` | No changes needed  |
| `src/core/supabase/*`                | No backend changes |

---

## 8. Dependencies & Constraints

- `buildStoreTitle`/`buildStoreDescription` already exported from `buildStorefrontMeta.ts` — no new dependency.
- `CharCounter` exists with simple `{current, limit}` signature — clean extension point.
- `SearchPreview` already wired to `formData.seoTitle`/`formData.seoDescription` — no new wiring.
- `useState` already imported in `constants.tsx` — `CollapsibleSEOSection` needs no new import.
- No new packages or libraries required.

---

## 9. Risks

| Risk                                                               | Mitigation                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `BusinessLike` export may cause circular import                    | None — `seoPreview.ts` → `buildStorefrontMeta.ts` is one-way, no cycle   |
| `CharCounter` bar changes visual weight for terms/returns counters | `optimalRange` is optional; existing callers pass none → no bar          |
| Collapse default-closed hides fields users need                    | Helper text signals discoverability; chevron is visible                  |
| Auto-default saves as override (not separate "reset")              | By design — matches spec AC3. Seller who accepts default = happy with it |
| T8 scope creep                                                     | Explicitly OUT with rationale. Revisit as separate change                |

---

## 10. Verification Commands

```bash
pnpm type-check    # Ensure all new files type-check
pnpm lint          # Ensure no lint errors
pnpm vitest run    # Run unit tests (seoPreview)
```

Manual:

```bash
# SERP preview live binding
# Type in title/description fields, observe SearchPreview updates
# Check color bar transitions at boundary values
# Toggle collapsible, verify chevron rotation
```
