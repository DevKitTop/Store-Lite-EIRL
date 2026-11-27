# Store Customizer — Implementation Plan

- **Reference audit**: `docs/audits/store-customizer/AUDIT.md`
- **Scope**: the current "Personalizar tienda" system only (themes, colors, patterns, typography, editor UX, permissions, persistence, theme coverage across the public store).
- **Explicitly out of scope**: structural storefront templates (Classic/Editorial/Showcase/Catalog) and any store builder. Those are a separate, later initiative.
- **Branch**: `docs/store-customizer-implementation-plan` (based on `origin/develop`).
- **Language**: English, consistent with the audit. Merchant-facing strings stay Spanish.
- **Mode**: planning only. No source, config, dependency, or schema changes were made. Every verification below is a proposed check, not a result.

---

## 0. How this plan was validated

Each audit finding was re-checked against the current working tree before being carried over. Verification status:

| Audit ID | Finding                                                                             | Re-checked                                                                                                                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1       | Seller-supplied CSS strings reach the SSR `<style>` block unvalidated               | **Confirmed** — `normalizeStorefrontBackground` only trims (`storefrontTheme.ts:485-523`); `buildStorefrontThemeStyleTag` filters only `<`/`>` (`buildStorefrontThemeVars.ts:123`)                                                                          |
| H2       | Pattern mask/blend/filter/animation stripped; preview ≠ result; SSR without pattern | **Confirmed** — `buildStorefrontThemeVars.ts:45-63` deletes the keys; the client repaints only image/size/position/repeat (`BusinessPageContent.tsx:423-446`); `::before` is the only consumer of the deleted vars (`BusinessPageContent.module.css:16-46`) |
| H3       | Saving overwrites the store default scheme with the edited tab                      | **Confirmed** — `StorefrontEditor.tsx:292-297`, `StorefrontThemeEditor.tsx:69`, `actions.ts:349`                                                                                                                                                            |
| H4       | Wrong-scheme SSR for returning visitors; OS preference unused                       | **Confirmed (mechanism)** — SSR uses `defaultScheme` only (`(home)/page.tsx:170-172`); viewer value is read in `useEffect` (`useStorefrontViewerTheme.ts:58-63`)                                                                                            |
| M1       | Stores without a saved theme are still painted with a hardcoded palette             | **Confirmed** — `(home)/page.tsx:171` falls back to `createDefaultStorefrontTheme()`; `BusinessPageContent.tsx:165-167` always applies it                                                                                                                   |
| M2       | Partial, non-tonal MD3 override                                                     | **Confirmed** — `buildStorefrontThemeVars.ts:65-101` (container == base, no outline/background/error/inverse roles)                                                                                                                                         |
| M3       | Two editors with different capabilities and gating                                  | **Confirmed** — no `setScheme` call in `StorefrontThemeEditor.tsx`; random/default replace the whole theme (`:337-356`), erasing the pattern; FAB rendered for any staff (`BusinessPageContent.tsx:546`)                                                    |
| M4       | Store font does not reach MD3 components/portals                                    | **Confirmed** — `--storefront-font-family` consumed only in `BusinessPageContent.module.css:6`, `Receipt.module.css`, and a settings preview; MD3 uses `--md-ref-typeface-*` from `theme-fonts.css`                                                         |
| M5       | Duplicated font maps; inaccurate editor preview                                     | **Confirmed** — `buildStorefrontThemeVars.ts:11-23`, `settings/constants.tsx:194-207`, `storefrontTheme.ts` `FONT_OPTIONS`, `StorefrontEditor` `FONT_OPTIONS`; preview uses literal `'Inter'`/`'Roboto'`                                                    |
| M6       | Lost updates on the shared `preferences` JSONB                                      | **Confirmed (pattern)** — read-modify-write in `actions.ts:331-352` and `:259-279`; `unique_business_settings` on `business_id` exists (`businesses.ts:252`) but the insert path has no conflict handling                                                   |
| M7       | Analytics inside the save `try`; global revalidation                                | **Confirmed** — `actions.ts:362-372`                                                                                                                                                                                                                        |
| M8       | Pattern browser "Quitar" is a no-op; double-click applies the stale pattern         | **Confirmed** — `PatternBrowser.tsx:225-235`, `:272-275`                                                                                                                                                                                                    |
| M9       | No dirty state; ambiguous reset; transient feedback                                 | **Confirmed** — `StorefrontEditor.tsx:288-329`, `:703`                                                                                                                                                                                                      |
| M10      | Editor/picker accessibility gaps                                                    | **Confirmed** — panel stays mounted off-screen with focusable controls; toggle hides its checkbox without `:focus-visible`                                                                                                                                  |
| M12      | Platform MD3 class applied after hydration                                          | **Hypothesis** — needs browser verification                                                                                                                                                                                                                 |
| M13      | Viewer toggle writes the platform-wide theme                                        | **Confirmed** — `useStorefrontViewerTheme.ts:83-87`                                                                                                                                                                                                         |
| —        | Theme applied only to the home route                                                | **Confirmed** — no `BusinessPageContent`/theme scope on product routes                                                                                                                                                                                      |
| L1       | Client-supplied slug used for `revalidatePath`                                      | **Confirmed** — `actions.ts:362-363`                                                                                                                                                                                                                        |
| L2       | `themeMode` not validated at runtime                                                | **Confirmed** — TypeScript-only union, no runtime check                                                                                                                                                                                                     |

### Corrections and new findings

1. **Correction to AUDIT §7 ("no theme reference on product pages")**: the product CSS _does_ reference storefront variables — `ProductDetail.module.css:639`, `RelatedProductsSection.module.css:100`, `AboutSection.module.css:60,69,214`, `storefrontAbout.module.css:49`, `ProductPreviewSheet.module.css` (7 uses). The conclusion still holds for a different reason: those variables are **never defined**.
2. **New finding (confirmed)** — dead variables: `--storefront-primary`, `--storefront-on-surface`, and `--storefront-on-surface-variant` are consumed across store components but are not emitted by `buildStorefrontThemeVars` nor defined in any stylesheet (grep finds no definitions). Every consumer silently falls back to `--md-sys-color-*`, which is the _platform_ scheme, not the store scheme.
3. **New finding (confirmed)** — `(home)/page.tsx` derives `defaultScheme` twice (`:170` and `:211`).
4. **New finding (confirmed)** — the pattern is painted on `<html>` with `background-attachment: fixed` (`BusinessPageContent.tsx:445`), while the mask/filter/blend pipeline lives on `.storefrontThemeRoot::before`; two competing surfaces for one pattern.

---

## 1. Problems to solve

Grouped by the areas the merchant experiences. Each maps to audit IDs and to the verified evidence above.

### P1. Security of custom CSS

Seller-controlled strings (`cssOverlay.*`) are persisted with only `trim()` and emitted into a server-rendered `<style>` block where only `<`/`>` are filtered. `;`, `}`, and `url(` pass through. CSP keeps `style-src 'unsafe-inline'` and allows remote images. Anyone with `storefront.edit` on a paid plan can inject rules or beacons into a buyer-facing page. **Files**: `storefrontTheme.ts`, `buildStorefrontThemeVars.ts`, `settings/actions.ts`, `create-business/actions.ts`.

### P2. Preview ≠ published result (patterns)

Mask ("Fade"), blend mode, filter, opacity, box-shadow and animation are visible in the picker preview and dropped by the store pipeline. On first paint the server emits no pattern at all. **Files**: `buildStorefrontThemeVars.ts`, `BusinessPageContent.tsx`, `BusinessPageContent.module.css`, `PatternBrowser.tsx`.

### P3. Light/dark semantics

- Saving from either editor persists the _edited tab_ as the store's default scheme.
- Visitors who previously chose a scheme see the opposite one until hydration.
- The visitor's OS preference is never consulted.
- Toggling a store's scheme rewrites the platform-wide theme preference.
  **Files**: `StorefrontEditor.tsx`, `StorefrontThemeEditor.tsx`, `actions.ts`, `useStorefrontViewerTheme.ts`, `(home)/page.tsx`.

### P4. Wrong defaults

- Stores without a saved theme are painted with a hardcoded indigo palette although the domain documents "inherit platform MD3".
- The Settings switch "Usar colores de plataforma" changes the stored flag but not what buyers see.
  **Files**: `(home)/page.tsx`, `BusinessPageContent.tsx`, `StorefrontThemeEditor.tsx`.

### P5. Theme coherence

- Theme applies to the home route only; product, about and other store routes render with platform colors.
- Store-scoped variables referenced by store components are never emitted (dead variables).
- Only a subset of MD3 roles is overridden, and `*-container` equals its base color.
  **Files**: `(app)/layout.tsx`, `BusinessPageContent.tsx`, `buildStorefrontThemeVars.ts`, several store `*.module.css`.

### P6. Typography

- The chosen font reaches one wrapper `div`; MD3 components and portals keep Google Sans Flex.
- The editor's font preview uses literal family names that do not exist as browser families (the fonts are registered as hashed names exposed through CSS variables).
- Five font maps, one unreachable font (Poppins) that is nonetheless preloaded.
  **Files**: `app/layout.tsx`, `theme-fonts.css`, `buildStorefrontThemeVars.ts`, `settings/constants.tsx`, `StorefrontEditor.tsx`, `storefrontTheme.ts`.

### P7. Two editors

Settings (`Apariencia`) and the public page (`Personalizar tienda`) edit the same blob with different capabilities: Settings cannot edit the dark palette, cannot configure the pattern, and its random/default buttons erase the pattern. Entitlement checks differ between UI (`canCustomizeStorefront`) and server (`plan === 'lite'`). The FAB is rendered for any team member regardless of `storefront.edit` or plan.
**Files**: `StorefrontThemeEditor.tsx`, `SettingsClient.tsx`, `BusinessPageContent.tsx`, `StaffManagementTools.tsx`, `settings/actions.ts`, `plans.ts`.

### P8. Persistence and stability

- Whole-`preferences` read-modify-write without locking → concurrent saves can drop keys.
- Insert path has no `ON CONFLICT` despite the unique constraint.
- PostHog `capture` + `flush` inside the save `try` → a successful save can be reported as failed.
- Every save purges the whole app cache (`revalidatePath('/', 'layout')`).
  **Files**: `settings/actions.ts`.

### P9. Editor UX and accessibility

No dirty state, always-enabled Save, unsaved preview silently discarded on refresh, "Restablecer" resets only the background, no dialog semantics or focus management, closed panel remains tabbable, invisible keyboard focus, unlabeled color inputs, icon-only close buttons, no keyboard affordance in the pattern grid, and on phones the 100vw panel fully covers the store being edited.
**Files**: `StorefrontEditor.tsx`, `StorefrontEditor.module.css`, `PatternBrowser.tsx`, `PatternBrowser.module.css`.

---

## 2. Expected behavior

Acceptance-level statements. These are what tasks are verified against.

### A. Theme behavior

1. Editing the light or dark palette never changes which scheme visitors get by default.
2. The default scheme is an explicit, labeled choice, persisted separately from the edited tab.
3. A visitor who toggles the store scheme keeps that choice across visits and reloads, with no flash of the opposite scheme on first paint.
4. A visitor with no stored choice gets the store default; whether the OS preference is used as a fallback is a decision (§10, D4).
5. Saving the same values twice is idempotent; a second save reports success without changing data.

### B. Colors and appearance

1. The palette and background the merchant configured are what buyers see on every store route (home, product, about, and any other public store page).
2. A store with no saved theme renders with the platform MD3 colors and no injected storefront overrides.
3. Text and UI elements stay legible: primary/secondary/accent are used with a computed readable foreground, and the merchant is warned when a chosen combination falls below WCAG AA.
4. Every store-scoped CSS variable that store components consume is actually defined, or the component stops consuming it.

### C. Decorative patterns

1. The pattern the merchant selects renders identically in the selector preview and in the published store, on first paint (SSR) and after hydration.
2. Removing the pattern removes it visibly and persists the removal.
3. Selecting a pattern by click + "Aplicar", by double click, or by keyboard produces the same result.
4. Unknown, malformed or legacy pattern data never produces unbounded CSS: it is either resolved from the catalog or dropped.
5. The catalog stays a curated, quality-checked set; the selection flow remains a single, understandable step.

### D. Typography

1. The selected font applies to all store text, including MD3 components and content rendered in portals.
2. The editor preview shows the font actually used, using the same resolution as the store.
3. There is exactly one source of truth for font ids, labels, and CSS values.

### E. User experience

1. The merchant always knows whether changes are saved, pending, or failed.
2. Closing or leaving with unsaved changes is explicit, never silent.
3. Every reset control states exactly what it resets.
4. The editor can be opened, used, and closed with a keyboard alone, and the focus returns to where it was.
5. On a phone the merchant can see the store while editing, at least by toggling the panel.

### F. Security and permissions

1. Only owners and members with `storefront.edit` on a plan that includes storefront customization can open the customization UI or persist changes; UI and server enforce the same rule.
2. No merchant-supplied string can break out of a CSS declaration, rule, or `<style>` element, or trigger a network request.
3. A store's theme, and any change to it, can never affect another store's data or cache.

### G. Saving and stability

1. Two concurrent saves of different preference keys both survive.
2. First-ever save and subsequent saves behave identically.
3. A save that wrote successfully reports success even if a non-critical side effect (analytics) fails.
4. Cache invalidation is limited to the store that changed.

---

## 3. Recommended solutions

### 3.1 Pattern CSS: resolve from the catalog, never from the merchant

**Recommendation**: keep persisting `cssOverlay.patternId` (already written today by `patternToCssOverlay`), and make the **server** the only place that turns a pattern id into CSS by looking it up in `src/data/patterncraft`. Merchant-supplied free-form CSS becomes irrelevant for new saves.

- Why: fixes H1 by construction (no seller strings reach CSS), and gives H2 for free (the catalog CSS includes mask/blend/filter, and the same resolver can drive both preview and store).
- Cost: near zero — `patternId` is already stored; existing saved themes need no migration.
- Alternatives considered:
  - _Allowlist each CSS property_: weak (gradients/masks are compositional), high maintenance, still allows `url(`.
  - _Store a hash and re-derive_: same as the recommendation, more machinery.
  - _Keep raw CSS + harden_: cheapest to write, but keeps a buyer-facing injection surface permanently. Rejected.
- Legacy data: patterns saved before this change also carry `patternId` when they came from the PatternCraft browser; built-in overlays (`bg.overlay`) keep their existing dedicated renderer. Anything that cannot be resolved from the catalog is dropped (see D9).

This is also the precondition for a curated catalog (§3.5) and for SSR pattern parity.

### 3.2 One paint surface for the background/pattern

**Recommendation**: render the background and pattern exclusively on the store scope's `::before` (the element that already declares mask, filter, blend, opacity, box-shadow, image-rendering), and emit the **complete** variable set on the server. Remove the `<html>` painting performed in `BusinessPageContent`'s `useLayoutEffect`.

- Why: the current split is the root cause of H2 and of the "no pattern on first paint" symptom; `::before` is already the only consumer of the deleted variables.
- Cost: `BusinessPageContent` loses its DOM-mutating effect (simpler), and the SSR contract becomes "emit everything, strip nothing".
- Risk to manage: `.storefrontThemeRoot` is `position: relative; overflow: hidden; min-height: 100dvh`. A scoped wrapper must keep those properties, otherwise `inset: 0` no longer covers the viewport.
- Alternative: paint on `<html>` (pre-change behavior for the image only). Rejected: mask/filter on `<html>` interacts badly with fixed/portal content and cannot be scoped per store.

### 3.3 Scheme as three separate concepts

**Recommendation**: model explicitly

1. **Edit tab** — client state only, never persisted.
2. **Store default scheme** — the `business_settings.theme_mode` column, changed only by an explicit control, never by a save.
3. **Viewer preference** — a per-store cookie (`storefront-scheme-{slug}`), read server-side for SSR, written client-side on toggle.

- Why: today one piece of state serves all three purposes, which produces H3, H4 and M13.
- Cookie over `localStorage`: the server needs the value to render the right scheme on first paint; the project already reads cookies in server components (`app/[slug]/(app)/settings/page.tsx`, `product/[productId]/components/ProductDetailContent.tsx`, etc.).
- Keep `localStorage` as a tolerant fallback for one release if desired, but the cookie is the source of truth for SSR.
- Stop calling `setTheme` (platform theme) from store toggles; the store scheme becomes visual state of the store scope only.

### 3.4 Theme scope for every store route

**Recommendation**: extract a server component `StorefrontThemeScope` (in `app/[slug]/(app)/`) that resolves the theme once, reads the viewer cookie, and wraps `{children}` in `(app)/layout.tsx` with the variable set + `::before` surface.

- Why: `(app)/layout.tsx` already resolves the business and entitlements; adding `preferences`/`themeMode` to that query is one small read, and every store route (home, product, about) inherits the same theme.
- Cost: one additional column projection on an existing query in the layout; `(home)/page.tsx` drops its own style tag and duplicated `defaultScheme`.
- Tradeoff to approve: theme data is then read on every store navigation, not only on home (D8). Alternative: keep per-page injection and duplicate the scope in each route — more code, easy to forget, does not solve portals.

### 3.5 Patterns: curate the catalog, keep the capability

**Recommendation**: keep the feature, shrink the offer.

- Curate ~12–20 patterns across two families (soft gradients, subtle geometric), chosen for legibility over content and for rendering identically with mask/blend/filter.
- Exclude animation-based patterns (they require global `@keyframes`, add motion without merchant value, and need `prefers-reduced-motion` handling).
- Keep one selection step: category strip (reduced to 2–3) → grid → "Aplicar". No new interaction model.
- Why: 257 options cause decision paralysis; 38 masked geometric patterns cannot currently render; each option is a maintenance and QA cost.
- Migration: legacy patterns that are not in the curated set keep rendering (sanitized) until the merchant replaces them (D9).

### 3.6 Tokens and typography without new dependencies

**Recommendation**:

- Keep the manual palette inputs, but emit a coherent role set per scheme: `primary`/`on-primary`, `primary-container` (a tint of primary, not identical), `outline`, `outline-variant`, `surface-tint`, `background`, `error`/`on-error`, `inverse-surface`/`on-inverse-surface`, plus the existing surfaces.
- Generate containers/tints with a small in-repo color utility (mix toward the scheme surface; the file already has `getContrastRatio`/`getReadableTextColor` helpers).
- Map the store font onto `--md-ref-typeface-brand` and `--md-ref-typeface-plain` (and the `--md-sys-typescale-*-font-family-name` tokens) **inside the store scope**, which is exactly how `theme-fonts.css` wires them at `:root`.
- Why: no new dependency (`@material/material-color-utilities` is **not** installed; `@material/web` and `zod` are), and the existing token file already documents this wiring pattern.
- Alternative (needs approval, D5): add `@material/material-color-utilities` for a real tonal palette generated from a seed. Higher quality, one more dependency, larger change.
- Alternative: leave tokens as-is. Rejected: container==base removes hierarchy and `outline`/`error` stay platform-colored inside a dark store.

### 3.7 Editor UX and accessibility: reuse existing primitives

**Recommendation**:

- Keep the custom-styled panel (brand consistency, already animated) but adopt the project's existing accessible-surface conventions: `role="dialog"`, `aria-modal`, labelled title, focus trap, focus return, `inert`/`hidden` when closed, Escape to close, focus-visible styles.
- `src/shared/components/ui/surfaces/Sheet.tsx`, `Dialog.tsx`, `SteppedSheet.tsx` are available; evaluate them first, and only keep custom markup if they cannot carry the current visual design (D7).
- Dirty state via a saved snapshot (the Settings editor already implements exactly this pattern in `StorefrontThemeEditor.tsx:58-95`); reuse the same approach and the same `useSnackbarFeedback` hook so both editors behave alike.
- Mobile: keep the panel, add an explicit "Ver tienda" toggle that collapses it (simplest testable behavior). A bottom sheet is the alternative (D10).

### 3.8 Persistence: atomic merges

**Recommendation**: replace read-modify-write with one statement per key:

- `UPDATE business_settings SET preferences = coalesce(preferences,'{}'::jsonb) || :patch::jsonb, updated_at = now() WHERE business_id = :id` and, when the row is missing, `INSERT ... ON CONFLICT (business_id) DO UPDATE SET preferences = business_settings.preferences || excluded.preferences, updated_at = now()`.
- `unique_business_settings (business_id)` exists, so the conflict target is valid.
- Move `posthog.capture/flush` out of the save `try` (fire and forget with its own error handling).
- Revalidate only the affected store: `revalidatePath('/${slug}', 'layout')` instead of `revalidatePath('/', 'layout')`.
- Why: minimal, no transaction plumbing, no schema change, and it removes both the lost-update window and the "saved but reported failed" case.
- Alternative: `SELECT … FOR UPDATE` inside a Drizzle transaction. Correct, but more code and a lock held across two queries.

### 3.9 Validation

Use `zod` (already a dependency) at the action boundary for `themeMode`, slug shape, and the theme payload; keep `normalizeStorefrontTheme` as the canonical normalizer. Add the runtime check the column lacks (its TS enum is not enforced by the column).

---

## 4. Task breakdown

IDs are stable. `P#` = work package. Every task states objective, expected result, dependencies, and verification. "High risk" marks tasks that touch security, stored data, or shared contracts (§9 of the audit's risk list) — they get their own commit and independent verification.

### Work package 0 — Security and persistence (do first)

#### T01 — Resolve pattern CSS server-side from the catalog

- **Objective**: make the catalog, not the merchant, the source of pattern CSS.
- **Expected result**: a pure function `resolvePatternOverlay(patternId, schemeHint?)` returns the CSS fields for a known id and `undefined` for anything unknown; `buildStorefrontThemeVars` uses it when `cssOverlay.patternId` exists instead of trusting stored strings.
- **Dependencies**: none.
- **Verification**: new unit test `tests/unit/storefrontPatternResolution.test.ts` — known id returns mask/filter/blend from the catalog; unknown id returns nothing; stored `cssOverlay.backgroundImage: 'none;}body{…'` never reaches the output. Component test: pattern selected in the picker produces the same CSS map as the store.
- **High risk**: yes (security contract, persisted data read path).

#### T02 — Validate and sanitize `cssOverlay` on write

- **Objective**: defense in depth for data that bypassed the UI (server actions accept client payloads).
- **Expected result**: `normalizeStorefrontBackground` accepts only known keys, caps lengths, rejects `;`, `{`, `}`, `@`, `url(`, `expression(`, and `<`/`>`, and drops non-catalog `patternId` unless it matches a legacy entry allowlist.
- **Dependencies**: T01 (shared allowlist).
- **Verification**: unit tests with hostile payloads (`;`, `}`, `url(https://…)`, 10 KB string, unknown props); existing `settingsActions` tests still pass.
- **High risk**: yes.

#### T03 — Make the SSR style tag breakout-proof

- **Objective**: even if an unexpected value reaches serialization, it cannot escape the declaration or the element.
- **Expected result**: `buildStorefrontThemeStyleTag` validates each value against a conservative character/property allowlist (or serializes with escaping) and drops anything invalid, not only `<`/`>`.
- **Dependencies**: none.
- **Verification**: extend `tests/unit/buildStorefrontThemeStyleTag.test.ts` with `;`, `}`, `url(`, newline, and `!important` cases; a snapshot asserting the produced string parses as one declaration list.
- **High risk**: yes.

#### T04 — Atomic preference writes

- **Objective**: concurrent saves cannot drop each other's keys; first save cannot fail on the unique constraint.
- **Expected result**: theme and layout writes use a single JSONB merge statement; insert path uses `ON CONFLICT (business_id) DO UPDATE`.
- **Dependencies**: none.
- **Verification**: unit test with a mocked DB asserting one statement and no read-then-write; integration-style test (or scripted check) that two sequential merges keep both `storefrontTheme` and `storefrontLayout`; first-save path inserts once and a repeat save updates.
- **High risk**: yes (persisted data).

#### T05 — Save side effects and cache scope

- **Objective**: a successful write reports success; cache invalidation is tenant-scoped.
- **Expected result**: analytics wrapped in its own try/catch and not awaited on the response path; `revalidatePath` limited to `/${slug}` layout; slug derived from the business record, not from the client argument.
- **Dependencies**: none.
- **Verification**: unit test simulating a rejected `posthog.flush` → `success: true`; spy asserting `revalidatePath` called only with the tenant path; a test proving a mismatched client slug cannot target another tenant.

#### T06 — Validate action inputs

- **Objective**: reject invalid values the type system cannot enforce at runtime.
- **Expected result**: `zod` schema for `themeMode`, slug, and the theme payload at the action boundary; invalid input returns a typed error, never a DB write.
- **Dependencies**: none.
- **Verification**: unit tests for `themeMode: 'purple'`, malformed slug, oversized payload.

### Work package 1 — Scheme semantics (light/dark)

#### T07 — Stop persisting the edit tab as the default scheme

- **Objective**: editing dark colors must not flip the store to dark.
- **Expected result**: both editors stop passing the tab; `updateStorefrontTheme` keeps `themeMode` unchanged unless the caller explicitly sends a default-scheme update.
- **Dependencies**: T06.
- **Verification**: unit test — save with a dark payload and no explicit default leaves `themeMode: 'light'`; component test — switching the tab and saving does not call the action with a scheme.

#### T08 — Explicit default-scheme control

- **Objective**: make the store's default scheme a visible, deliberate choice.
- **Expected result**: a labeled control ("Esquema que verán tus visitantes") in Settings → Apariencia, with a short explanation; it is the only writer of `themeMode`.
- **Dependencies**: T07.
- **Verification**: component test — changing it persists and reflects after reload; saving the palette does not touch it.

#### T09 — Viewer scheme cookie and first-paint correctness

- **Objective**: no flash, and the choice survives visits.
- **Expected result**: store toggle writes a per-store cookie; the server component reads it and renders that scheme in SSR; `localStorage` is either migrated once or kept as a tolerated legacy fallback.
- **Dependencies**: T12 (single paint surface) for the CSS side; can be developed in parallel with a feature flag.
- **Verification**: unit test for cookie parsing/precedence (cookie > legacy localStorage value > store default); manual browser check with network throttling — no scheme flash; devtools shows SSR HTML already in the chosen scheme.

#### T10 — Store toggle stops mutating the platform theme

- **Objective**: customizing one store must not change the seller's admin theme everywhere.
- **Expected result**: viewer toggle and editor tab changes no longer call the platform `setTheme`.
- **Dependencies**: T07, T09.
- **Verification**: unit/component test asserting `setTheme` is not called; manual check that the admin panel keeps its theme.
- **High risk**: no (but touches shared `ThemeContext` usage — verify no other consumer relies on the reverse sync).

#### T11 — Single source for the default scheme

- **Objective**: remove the duplicated derivation and the implicit fallback.
- **Expected result**: one computed value flows from the layout/scope; `(home)/page.tsx` stops recomputing it.
- **Dependencies**: T12.
- **Verification**: type-check + snapshot of the store page props.

### Work package 2 — Rendering parity

#### T12 — One paint surface, complete SSR variables

- **Objective**: the pattern renders identically in SSR, after hydration, and in the preview.
- **Expected result**: `buildStorefrontThemeVars` stops deleting background/mask/filter keys; the scope's `::before` receives them; the `<html>` painting effect is removed; the store root keeps `position/overflow/min-height` requirements.
- **Dependencies**: T01 (so the emitted CSS is trusted).
- **Verification**: unit test asserting the var map contains mask/filter/blend for a masked pattern; component test asserting no `document.documentElement` style mutation; manual browser check — first paint (disable JS) shows the pattern.
- **High risk**: yes (buyer-facing rendering contract).

#### T13 — No theme means platform colors

- **Objective**: honor the documented "inherit MD3" contract.
- **Expected result**: when `hasCustomStorefrontTheme` is false, no storefront variables are emitted and the wrapper uses platform tokens; the Settings "Usar colores de plataforma" switch becomes truthful.
- **Dependencies**: T12.
- **Verification**: unit test — `buildStorefrontThemeVars` not called when no theme; component test — scope renders children without a style attribute; manual visual check of a store with the switch on.
- **High risk**: no (visible change — see D2).

#### T14 — Fix or remove dead storefront variables

- **Objective**: store components must not read variables that do not exist.
- **Expected result**: either emit `--storefront-primary`, `--storefront-on-surface`, `--storefront-on-surface-variant` (recommended, since CSS already expects them and they carry store-scheme semantics) or replace those declarations with `--md-sys-color-*` where they are inside the scope.
- **Dependencies**: T12.
- **Verification**: a test that every `--storefront-*` referenced in `app/[slug]` CSS is present in the emitted map; visual check on product/about/preview sheet with a dark store theme.

#### T15 — Legibility guardrails

- **Objective**: warn instead of silently shipping unreadable combinations.
- **Expected result**: the editor flags contrast below WCAG AA using the existing `getContrastRatio`; the warning is advisory and never blocks saving; `primary` used as text has a computed readable pair.
- **Dependencies**: T19 (role set).
- **Verification**: unit tests at the 4.5:1 boundary; component test showing the warning appears/disappears.
- _(Confirm the problem visually first — this is the one item in the audit still marked Hypothesis.)_

### Work package 3 — Tokens and typography

#### T16 — Single font registry

- **Objective**: one source of truth for font id, label, CSS value, and availability.
- **Expected result**: a registry module exports the option list and the resolver; `buildStorefrontThemeVars`, `settings/constants.tsx`, both editors, and `storefrontTheme.ts` consume it; Poppins is either exposed in the UI or removed from the type and from `app/layout.tsx` (D6).
- **Dependencies**: none.
- **Verification**: unit test — registry entries all resolve to a `var(--font-*)` that exists in `app/layout.tsx`; grep-level test (or lint rule) that no second font map exists.

#### T17 — Store font reaches MD3 components

- **Objective**: the chosen font applies to buttons, fields, chips, and portal content.
- **Expected result**: inside the store scope, `--md-ref-typeface-brand`, `--md-ref-typeface-plain` and the `--md-sys-typescale-*-font-family-name` tokens resolve to the selected font; portal content rendered inside the scope inherits it.
- **Dependencies**: T16.
- **Verification**: component test asserting computed style on an MD3 button inside the scope; manual check of a dialog/sheet opened from a product page (portal).

#### T18 — Honest editor preview

- **Objective**: the preview shows the font that will ship.
- **Expected result**: preview uses the resolved CSS value (variable-based), not literal family names.
- **Dependencies**: T16.
- **Verification**: component test asserting the preview style references the same value as the store.

#### T19 — Complete, coherent role tokens

- **Objective**: containers differ from base, outline/error/inverse follow the store scheme.
- **Expected result**: expanded token map with a small in-repo tonal utility; `*-container` derived by mixing toward the scheme surface.
- **Dependencies**: T12.
- **Verification**: unit tests for the derived container (contrast/difference from base), snapshot of the token map per scheme; visual check of a filled button and an outlined input in a dark store.

#### T20 — Optional: seed-based tonal palette

- **Objective**: proper MD3 dynamic color from the merchant's primary.
- **Expected result**: only if D5 approves a dependency; otherwise this task is closed as not planned.
- **Dependencies**: T19, D5.
- **Verification**: contrast matrix per scheme (primary/on-primary, container/on-container) above AA for a sample of random seeds.

### Work package 4 — Editor UX and accessibility

#### T21 — Dirty state, save and discard

- **Objective**: the merchant always knows what is saved.
- **Expected result**: saved snapshot + `hasChanges`; Save disabled when clean and while pending; explicit Discard; confirming close when dirty; error feedback persists until dismissed or retried.
- **Dependencies**: T07 (so saving no longer has the scheme side effect).
- **Verification**: component tests for clean → dirty → save → clean; discard restores the snapshot; close-with-changes triggers confirmation; failed save keeps the error visible and keeps changes.

#### T22 — Pattern browser correctness

- **Objective**: the browser's controls do what they say.
- **Expected result**: "Quitar" calls a real clear callback and persists removal; double-click applies the clicked pattern (pass it as an argument, never read stale state); cards are keyboard reachable with a visible focus ring; Escape and focus return work.
- **Dependencies**: none.
- **Verification**: component tests — clear callback invoked with the active pattern; double-click applies the clicked id (regression test for the stale closure); keyboard: Tab into grid, Enter selects, double Enter applies.

#### T23 — Accessible surfaces

- **Objective**: the editor and picker are usable without a mouse and announced correctly.
- **Expected result**: `role="dialog"`, `aria-modal`, `aria-labelledby`, focus trap, initial focus, focus return, `inert`/`hidden` when closed; backdrop click and Escape behave consistently.
- **Dependencies**: T22.
- **Verification**: component tests with `userEvent.tab()` asserting focus containment; manual screen-reader smoke test (VoiceOver/NVDA) documented in the PR.

#### T24 — Labels, states and focus visibility

- **Objective**: every control is identifiable and keyboard-visible.
- **Expected result**: `<label>` (or `aria-label`) for each color input; `aria-pressed` on scheme tabs and pattern cards; `aria-label` on icon-only close buttons; `:focus-visible` on the custom toggle and tabs.
- **Dependencies**: T23.
- **Verification**: component tests for accessible names on all inputs/buttons; axe scan (if already configured) or manual checklist.

#### T25 — Mobile editing with visible store

- **Objective**: the merchant can see the result while editing on a phone.
- **Expected result**: a "Ver tienda" toggle collapses/expands the panel, or the panel becomes a bottom sheet (D10); FAB never overlaps the navbar.
- **Dependencies**: T23.
- **Verification**: manual device/viewport checks (375×667, 390×844); component test for the collapse toggle.

#### T26 — Settings editor parity

- **Objective**: the same data, edited consistently.
- **Expected result**: light/dark tabs in Settings; "Combinación aleatoria" and "Valores iniciales" preserve font **and** background/pattern (only palette changes); both editors share dirty-state and feedback behavior.
- **Dependencies**: T16, T21.
- **Verification**: component test — randomize twice, pattern survives; scheme tabs switch the edited palette; dirty state matches the public editor's semantics.

#### T27 — Gate customization correctly

- **Objective**: only authorized merchants on an eligible plan can customize.
- **Expected result**: the FAB and the Settings section are rendered only when the caller has `storefront.edit` **and** `canCustomizeStorefront`; server actions and UI use the same predicate; a member without permission sees no entry point instead of a server error.
- **Dependencies**: none (but coordinate with T26).
- **Verification**: tests for the four combinations (owner/member × eligible/lite); server action rejects with the same message the UI would have prevented.

### Work package 5 — Theme across the store

#### T28 — `StorefrontThemeScope`

- **Objective**: one server-resolved theme for every store route.
- **Expected result**: a server component in `app/[slug]/(app)/` resolves theme + viewer cookie + default scheme and wraps `{children}` in `(app)/layout.tsx`; the home page drops its own tag and props it no longer needs.
- **Dependencies**: T12, T09, D8.
- **Verification**: component/e2e — home, product, and about all report the same computed `--md-sys-color-primary`; one DB read added to the layout (assert with a query spy); no double injection.
- **High risk**: yes (applies to all store routes).

#### T29 — Store pages consume the scope

- **Objective**: product and secondary pages look like the store.
- **Expected result**: product detail, related products, about, and the preview sheet inherit store tokens; the editor's live preview still overrides them locally without mutating `<html>`.
- **Dependencies**: T28, T14.
- **Verification**: e2e — open a product with a dark custom theme and assert background, text, and buttons match the home page; visual diff of screenshots (before/after within the same run, not against a stored baseline).

#### T30 — Route coverage regression test

- **Objective**: prevent the scope from silently missing a route.
- **Expected result**: a test that enumerates public store routes and asserts the scope is present.
- **Dependencies**: T28.
- **Verification**: the test itself; it must fail if a new route is added without the scope.

### Work package 6 — Pattern catalog curation

#### T31 — Define the curated catalog

- **Objective**: a small, high-quality set that renders correctly.
- **Expected result**: ~12–20 ids with metadata (name, family, scheme suitability, mask/blend support), no animation-based entries, each verified to render identically from the catalog resolver.
- **Dependencies**: T01, T12, D1.
- **Verification**: a test iterating the curated set asserting each resolves to non-empty CSS and contains no `animation`/`url(`; visual sheet reviewed by the product owner.

#### T32 — Bundle and dead-code cleanup

- **Objective**: stop shipping data that is not used.
- **Expected result**: the geometric JSON import strategy matches reality (either the async loader is wired or the static import is justified and measured); unused `REMOVED`/`overlayPending`/legacy branches removed only where they are genuinely unreachable.
- **Dependencies**: T31.
- **Verification**: `pnpm analyze:bundle` (or the project's first-load measurement script) before/after, reported as a number.

#### T33 — Selection flow simplification

- **Objective**: keep one simple, understandable step.
- **Expected result**: 2–3 category tabs, a single "Aplicar"/"Quitar" affordance, no duplicated "Quitar" paths.
- **Dependencies**: T22, T31.
- **Verification**: component tests for the full select → apply → remove cycle; manual usability pass on mobile.

---

## 5. Order and phases

| Phase | Contents | Why here                                                                                             | Ships independently |
| ----- | -------- | ---------------------------------------------------------------------------------------------------- | ------------------- |
| 0     | T01–T06  | Closes a buyer-facing injection surface and data-integrity bugs without changing the visual contract | Yes                 |
| 1     | T07–T11  | Fixes the scheme semantics users notice most, on top of the validated write path                     | Yes                 |
| 2     | T12–T15  | Makes preview and published store agree; depends on T01 for trusted CSS                              | Yes (T15 after T19) |
| 3     | T16–T19  | Typography and token coherence; T19 is small and self-contained                                      | Yes                 |
| 4     | T21–T27  | Editor UX/a11y/permissions; benefits from stable save semantics                                      | Yes, task by task   |
| 5     | T28–T30  | Theme coverage across routes; needs the single paint surface and cookie                              | Yes                 |
| 6     | T31–T33  | Catalog curation; needs the resolver and parity                                                      | Yes                 |

Notes:

- T20 is conditional on D5 and may never run.
- T15 depends on T19, so it lands in phase 3–4 rather than 2.
- Within a phase, tasks with no dependency edge can run in parallel **only** if their edit surfaces are disjoint (§9).

---

## 6. Dependency graph

```
T01 ──> T02
 ├────> T12 ──> T13
 │        ├───> T14
 │        ├───> T19 ──> T15
 │        └───> T28 ──> T29
 │                      └──> T30
 ├────> T31 ──> T32
 └────> T12 (parity) ──> T31 ──> T33
T03  (independent)
T04  (independent)
T05  (independent)
T06 ──> T07 ──> T08
          └───> T21 ──> T26
T09 ──> T28
T10  (needs T07, T09)
T11  (needs T12)
T16 ──> T17
  ├───> T18
  └───> T26
T22 ──> T23 ──> T24
             └──> T25
T27  (independent)
```

Blocking external inputs: D1 (curation), D4 (OS preference), D5 (tonal palette), D6 (Poppins), D8 (layout scope), D9 (legacy CSS), D10 (mobile pattern).

---

## 7. Verification strategy

### Commands already available (from `package.json`)

- `pnpm test:unit` — vitest (unit + component tests).
- `pnpm test:e2e` — Playwright.
- `pnpm type-check` — `tsc --noEmit`.
- `pnpm lint` — eslint (note: `--max-warnings=955`).
- `pnpm quality` — encoding + lint + type-check.
- `pnpm analyze:bundle` / `pnpm audit:js` — first-load JS measurement.

### Where tests go

- Pure functions (`storefrontTheme`, `buildStorefrontThemeVars`, resolvers): `tests/unit/*.test.ts` — the existing home of `buildStorefrontThemeStyleTag.test.ts`, `patternRendering.test.ts`.
- Server actions: `tests/unit/server-actions/settingsActions.test.ts` (already exists).
- Components: `*.test.tsx` next to the component (follow `src/shared/context/__tests__/ThemeContext.migration.test.tsx` and `app/[slug]/(app)/BusinessPageContent.dynamic.test.ts`).
- Store routes end-to-end: Playwright specs under the existing e2e layout.

### Test-first expectation

Each task's behavior change gets a failing test first where a deterministic runner exists. Pure CSS output and rendering parity are deterministic; browser-only behaviors (flash, iOS `background-attachment`) are verified manually and documented in the PR as evidence, not as automated tests.

### Manual verification checklist (reused by every task touching rendering)

1. Store with custom theme → home: colors, font, background, pattern match the editor preview.
2. Same store → product page: identical palette/font/background.
3. Toggle the scheme → reload → same scheme, no flash.
4. Second browser profile (no cookie) → store default scheme.
5. Disable JavaScript → pattern and colors present (SSR parity).
6. Mobile viewport → editor usable, store visible.
7. Keyboard-only → reach every control, visible focus, Escape closes.
8. Lite plan and unauthorized member → no entry point, server rejects.
9. Two tabs saving different sections → both persist.
10. Store with no custom theme → platform colors, no injected variables.

### Known environmental notes

- PowerShell path quoting with `[slug]`/`(app)` breaks `Get-Content`/`rg` globs; use `-LiteralPath` or the editor tooling. Not a product issue, but it will slow verification if forgotten.

---

## 8. What must be preserved

1. **Stored data**: `preferences.storefrontTheme` v2 shape, and v1 payloads must keep migrating lazily via `normalizeStorefrontTheme`.
2. **Legacy overlays** (`background.overlay` with `patternType/color/size`) keep rendering until D9 decides otherwise.
3. Both existing entry points remain functional during the rollout: the public-page FAB and Settings → Apariencia (until T26/T27 deliberately change their behavior).
4. Existing merchant-facing copy and Spanish terminology, unless a task explicitly changes it.
5. `createRandomStorefrontTheme`, `createDefaultStorefrontTheme`, "Combinación aleatoria", "Valores iniciales" and "Restablecer" keep working (with corrected scope, per T21/T26).
6. The analytics event `STOREFRONT_CUSTOMIZED` keeps firing with the same properties.
7. Plan gating semantics: storefront customization stays unavailable on `lite` (only the _enforcement point_ is unified).
8. CSP as-is: no relaxation, and no new `unsafe-*` requirement introduced by the new code.
9. Self-hosted fonts via `next/font/local`; no external font hosting for body text.
10. Existing tests keep passing (`buildStorefrontThemeStyleTag`, `patternRendering`, `themeSyncConvergence`, `businessPreviewCard`, `settingsActions`, `BusinessPageContent.dynamic`, `layout.fouc`).
11. Tenancy isolation in all reads/writes: every new query stays scoped by `businessId`.
12. The `storefrontLayout` feature and its persistence are untouched except for the atomic-write change in T04.

---

## 9. Risks and mitigations

| Risk                                                             | Impact                                                | Mitigation                                                                                                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stored themes rendered differently after T12/T13                 | Merchants notice a visual change on an unrelated save | Ship T13 behind the explicit decision D2; before/after screenshots per store state; release note                                                                         |
| Existing `themeMode` values were already overwritten by H3       | Some stores may be dark "by accident"                 | Do not auto-migrate; expose the explicit control (T08) and document it (D3)                                                                                              |
| Moving the paint surface breaks element stacking                 | Content hidden behind `::before`                      | Keep `position: relative; z-index: 1` on children as today (`BusinessPageContent.module.css:48-55`); visual check on hero, cards, sheets                                 |
| `overflow: hidden` + fixed overlays at scope level               | Panels/sheets clipped                                 | Scope keeps overflow hidden only on the background surface's container; verify portals (T17, T29)                                                                        |
| Layout-level theme query adds latency to every store page        | Slower navigation                                     | Single-column projection on an existing query; measure with the existing audit script (D8)                                                                               |
| Atomic JSONB merge with a raw SQL fragment                       | Injection or malformed JSON                           | Bind parameters (`sql` template), never string interpolation; unit test with a payload containing quotes                                                                 |
| Cookie-based scheme conflicts with existing `localStorage` users | One-time inconsistency                                | Read precedence cookie → localStorage → default; document the transition                                                                                                 |
| Curated catalog removes patterns merchants use                   | Perceived loss of functionality                       | Legacy patterns keep rendering (D9); curation is additive until a merchant changes the pattern                                                                           |
| Accessibility refactor changes the panel's visual identity       | Design drift                                          | Reuse `Sheet`/`Dialog` only if they can carry the current design (D7); screenshot comparison                                                                             |
| Concurrent work on the same files                                | Merge conflicts                                       | Serialize tasks that touch `storefrontTheme.ts`, `buildStorefrontThemeVars.ts`, `BusinessPageContent.tsx`, `settings/actions.ts` (each is a single-owner file per phase) |
| Test runner gaps (no editor/picker tests today)                  | Regressions slip                                      | Add the missing tests inside the tasks that touch those components, not as a separate phase                                                                              |

---

## 10. Decisions requiring approval

| ID      | Decision                                                                                      | Options                                                                                           | Recommendation                                                           |
| ------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **D1**  | Curated pattern catalog content and size                                                      | (a) ~12–20 curated, no animation; (b) keep 257 with fixes; (c) curated + intensity control        | **(a)**                                                                  |
| **D2**  | Stores without a saved theme switch to platform MD3 colors (visible change)                   | (a) Yes, honor the documented contract; (b) keep the indigo default and fix only the switch label | **(a)**                                                                  |
| **D3**  | Existing stores whose default scheme was overwritten by the old save bug                      | (a) Leave as-is and let merchants fix it; (b) reset all to `light`; (c) attempt to infer intent   | **(a)** — no destructive migration                                       |
| **D4**  | OS `prefers-color-scheme` as fallback for visitors with no stored choice                      | (a) Yes; (b) No, always use the store default                                                     | **(a)** if the product wants OS respect; otherwise (b) — needs your call |
| **D5**  | Tonal palette approach                                                                        | (a) In-repo derivation (no dep); (b) add `@material/material-color-utilities`; (c) leave as-is    | **(a)**; (b) only if quality is insufficient                             |
| **D6**  | Poppins                                                                                       | (a) Expose in the UI; (b) stop loading it and remove from the type                                | **(a)** — the bytes are already paid                                     |
| **D7**  | Keep two editors or converge to one                                                           | (a) Minimal parity fix (T26); (b) Settings links to the public editor                             | **(a)** now, (b) as a later item                                         |
| **D8**  | Theme scope at `(app)/layout.tsx` (one extra read per store navigation) vs per-page injection | (a) Layout scope; (b) per-page                                                                    | **(a)**                                                                  |
| **D9**  | Legacy pattern data not in the curated catalog                                                | (a) Keep rendering sanitized; (b) stop rendering                                                  | **(a)**                                                                  |
| **D10** | Mobile editing pattern                                                                        | (a) Collapsible panel ("Ver tienda"); (b) bottom sheet                                            | **(a)** — smaller, testable                                              |

Questions that block specific tasks: **D1** (T31), **D4** (T09), **D5** (T20), **D6** (T16), **D8** (T28), **D9** (T01 legacy branch), **D10** (T25). Everything else can proceed on the stated recommendation.

---

## 11. Open observations (not blocking)

1. The audit's "theme applied only to home" remains true in effect, but the cause is two-fold: no scope outside home **and** store components referencing undefined variables (T14).
2. `app/layout.tsx` loads six `localFont` instances at the root; scope-level preloading could be narrowed later. Out of this plan's scope; noted for a performance pass.
3. `Material Symbols` is still loaded from `fonts.googleapis.com` via a render-blocking `<link>` while text fonts are self-hosted. Not part of this plan; flagged for a later optimization.
4. The Settings editor's copy uses Rioplatense voseo ("Personalizá", "Elegí") while the public editor uses neutral Spanish. Cosmetic inconsistency; resolve when T26 touches the strings.
5. `ProductDetailContent` already writes a cookie for order lookup; the same mechanism is available for T09 — no new infrastructure needed.
6. `business_settings.contrast_level` and `custom_colors` remain unused; do not delete in this plan (no schema changes), but avoid adding new readers.
7. The geometric JSON is 70 KB and statically imported; T32 must measure rather than assume the cost.

---

## 12. Out of scope (restated)

- Structural templates (Classic/Editorial/Showcase/Catalog) and any section builder.
- Changes to `storefrontLayout` behavior beyond the atomic write in T04.
- Database schema or migration changes.
- New dependencies, except the conditional D5.
- The platform-wide admin theme system, except removing the store's writes into it (T10).
