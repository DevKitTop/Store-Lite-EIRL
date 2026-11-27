# Store Customizer — Technical & Functional Audit

- **Scope**: public store by slug → "Personalizar tienda" → Appearance & Decorative Pattern (PatternCraft), plus the Settings → Apariencia editor that writes the same data.
- **Date**: 2026-11-23
- **Mode**: read-only (code reading + static analysis). The app was **not** run, no browser checks were performed, no tests were executed.
- **Source of truth**: current working tree (branch `feat/expired-plan-products-modal`; unrelated local changes exist and were ignored).
- **Status vocabulary**
  - **Confirmed (code)**: verified by following the code path; not reproduced at runtime.
  - **Hypothesis**: plausible from the code but depends on runtime/browser behavior or intent; listed in §12.
  - **Opportunity**: improvement, not a defect.
- **Not reviewed**: `openspec/` specs, `CustomerFloatingUi`, `Hero`, `FeaturedItems`, `StorefrontProductGridSection` internals, create-business wizard preview, `@material/web` internals.

---

## 1. Executive summary

The customizer works end to end and is tenant-safe on the server, but the visual pipeline has several structural defects that make what the merchant previews differ from what the buyer sees.

| #   | Headline                                                                                                                                                                                     | Severity |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| H1  | Seller-controlled `cssOverlay` strings are written unvalidated into an SSR `<style>` block (declaration/rule breakout, `url()` beacons). Only `<`/`>` are filtered.                          | HIGH     |
| H2  | PatternCraft "effects" (mask, blend, filter, animation, "Fade") are stripped before rendering; the browser preview shows them, the storefront does not. SSR also omits the pattern entirely. | HIGH     |
| H3  | Saving from the editor silently overwrites the store's default scheme (`themeMode`) with the tab being edited.                                                                               | HIGH     |
| H4  | Returning visitors get a light→dark flash; OS color preference is never used for stores.                                                                                                     | HIGH     |
| —   | Stores with no saved theme are still painted with a hardcoded indigo palette, contradicting the documented "inherit platform MD3" contract.                                                  | MEDIUM   |
| —   | The store font reaches only one wrapper `div`; Material Web components and portals keep Google Sans Flex.                                                                                    | MEDIUM   |
| —   | Two editors write the same JSON blob with different capabilities and different entitlement checks.                                                                                           | MEDIUM   |
| —   | Editor is not an accessible dialog; no dirty state; "Quitar" in the pattern browser does not remove anything; double-click applies the wrong pattern.                                        | MEDIUM   |

**No CRITICAL finding was confirmed.** H1 would be CRITICAL if a lower-privileged actor (or a public form) could reach `updateStorefrontTheme`; today it requires an authenticated owner/member with `storefront.edit` on a paid plan.

**Multitenancy**: no cross-tenant leak found. Writes are scoped by `businessId` after `requireAccessOnId`; reads derive `business.id` from the slug; client-side keys are namespaced by slug. Residual items are minor (§7).

**PatternCraft verdict**: **simplify** (curated catalog stored by id + parameters), do not extend. **Templates verdict**: feasible, but only after theme application is lifted out of `BusinessPageContent` and the product route is themed (§8).

---

## 2. Architecture and data flow

### 2.1 Components involved

| Layer                | File                                                                                           | Symbols                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Public page (server) | `app/[slug]/(app)/(home)/page.tsx`                                                             | `BusinessPage` (reads settings, builds SSR `<style>`)                                                          |
| Public page (client) | `app/[slug]/(app)/BusinessPageContent.tsx`                                                     | `BusinessPageContentUI`, `themeStyles`, theme `useLayoutEffect`                                                |
| Editor (inline, FAB) | `app/[slug]/(app)/components/StorefrontEditor.tsx`                                             | `StorefrontEditor`                                                                                             |
| Pattern picker       | `app/[slug]/(app)/components/PatternBrowser/PatternBrowser.tsx`                                | `PatternBrowser`, `classifyPattern`, `REMOVED`, `DARK_ONLY`                                                    |
| Editor (settings)    | `app/[slug]/(app)/settings/components/StorefrontThemeEditor.tsx`                               | `StorefrontThemeEditor`                                                                                        |
| Staff gating         | `app/[slug]/(app)/components/StaffManagementTools.tsx`                                         | renders `StorefrontEditor`                                                                                     |
| Viewer scheme        | `app/[slug]/(app)/components/useStorefrontViewerTheme.ts`, `schemeResolution.ts`               | `useStorefrontViewerTheme`, `resolveActiveScheme`                                                              |
| Domain               | `src/core/storefront/storefrontTheme.ts`                                                       | `normalizeStorefrontTheme`, `buildBackgroundCSS`, `patternToCssOverlay`, `mergeStorefrontThemeIntoPreferences` |
| CSS vars             | `src/core/storefront/buildStorefrontThemeVars.ts`                                              | `buildStorefrontThemeVars`, `buildStorefrontThemeStyleTag`                                                     |
| Server actions       | `app/[slug]/(app)/settings/actions.ts`                                                         | `updateStorefrontTheme`, `clearStorefrontTheme`                                                                |
| AuthZ                | `src/features/storage/actions/authz.ts`                                                        | `requireAccessOnId`                                                                                            |
| Pattern data         | `src/data/patterncraft/*`, `public/patterns/geometric.json`                                    | 4 category modules                                                                                             |
| Platform theme       | `src/shared/context/ThemeContext.tsx`, `src/shared/components/ThemeBoot.tsx`, `app/layout.tsx` | `ThemeProvider`, `THEME_BOOT_SCRIPT`                                                                           |
| Persistence          | `src/core/database/schema/businesses.ts`                                                       | `businessSettings`                                                                                             |

### 2.2 Write path

```
StorefrontEditor (local UI state, drafts debounced 150 ms)
  → updateConfig/updateTheme → normalizeStorefrontTheme → onThemeChange
  → BusinessPageContent.editableTheme (useState)              ← live preview only
  → [Guardar cambios] handleSave
  → updateStorefrontTheme(businessId, slug, theme, scheme)    ← Server Action
      requireAccessOnId(businessId, 'storefront.edit')
      plan === 'lite' → reject
      normalizeStorefrontTheme(theme)
      read business_settings.preferences → merge key "storefrontTheme"
      UPDATE business_settings SET preferences, theme_mode = scheme WHERE business_id = :id
      revalidatePath(/slug, /slug/settings, '/' layout) ; posthog capture + flush
```

Persistence is a JSONB key `preferences.storefrontTheme` (`version: 2`, `fontFamily`, `light`/`dark` each with `palette` + optional `background{type, colors[≤4], gradientDirection, cssOverlay}`), plus the `theme_mode` column (default scheme). v1 → v2 migration happens lazily inside `normalizeStorefrontTheme` (`storefrontTheme.ts:672-689`).

### 2.3 Read path

```
(home)/page.tsx
  Promise.all([... businessSettings{preferences, themeMode} by business.id ...])
  savedTheme = hasCustomStorefrontTheme ? parse : undefined
  effectiveTheme = savedTheme ?? createDefaultStorefrontTheme()           ← always a theme
  ssrStyleTag = buildStorefrontThemeStyleTag(effectiveTheme, themeMode)   ← :root{...}
  <style dangerouslySetInnerHTML> + <BusinessPageContent storefrontTheme defaultScheme>
BusinessPageContent (client)
  editableTheme ← useState(storefrontTheme ?? default)
  activeScheme  ← viewer (localStorage, read in effect) ?? preview ?? defaultScheme
  themeStyles   ← buildStorefrontThemeVars(editableTheme, activeScheme)
  <div class=storefrontThemeRoot style={themeStyles}>     ← inline vars (wins for subtree)
  useLayoutEffect: copy vars to <html>, paint pattern on <html>, body bg transparent
```

Scheme state lives in five places: `business_settings.theme_mode` (DB), `localStorage storefront-theme-{slug}`, `localStorage storefront-preview-scheme-{slug}`, the editor's internal `scheme` tab, and the platform-wide `app-theme` (`ThemeContext`). See H4 and M5.

### 2.4 Two editors, one blob

`StorefrontEditor` (public page) edits palette + font + fill + PatternCraft. `StorefrontThemeEditor` (Settings → Apariencia) edits palette + font only, plus a "Usar colores de plataforma" switch that calls `clearStorefrontTheme`. Both write `preferences.storefrontTheme` (see M3).

---

## 3. Dark / Light diagnosis

### How it works today

- Each store has **two independent palettes and backgrounds** (`theme.light`, `theme.dark`). Good model: a pattern with its own dark base can be chosen only for dark.
- `buildStorefrontThemeVars` overrides `--md-sys-color-{primary,secondary,tertiary}` (+ `on-*`, `*-container`) and a fixed set of surface tokens; everything else comes from the platform `.light/.dark` body classes.
- Scheme resolution: `viewer ?? preview ?? defaultScheme` (`schemeResolution.ts:7-13`). `defaultScheme` is always defined (`page.tsx:211` → `settings?.themeMode ?? 'light'`), so the visitor's OS preference (`effectiveTheme`) is never the fallback.

### Findings

**H3 — Editor save overwrites the store default scheme** · HIGH · Confirmed (code)

- Evidence: `StorefrontEditor.tsx:292-297` passes the currently selected tab `scheme` as 4th arg; `actions.ts:349` does `...(themeMode && { themeMode })`. `StorefrontThemeEditor.tsx:69` does the same with its `scheme` state.
- Problem: the "Claro/Oscuro" tab is meant to choose _which palette to edit_; it is persisted as the store's _default scheme for every visitor_. A merchant tweaking dark colors and saving flips the whole storefront to dark by default.
- Impact: unrequested visible change for all buyers.
- Recommendation: separate "scheme being edited" from "default scheme"; make default scheme an explicit, labeled control; stop passing the edit tab to the action.

**H4 — Light→dark flash for returning visitors; OS preference ignored** · HIGH · Confirmed (code) for the mechanism, flash itself needs browser verification

- Evidence: SSR style uses `defaultScheme` only (`page.tsx:170-172`); `viewerTheme` starts `null` and is read from `localStorage` inside `useEffect` (`useStorefrontViewerTheme.ts:49,58-63`); the inline CSS vars on the wrapper are computed from that state (`BusinessPageContent.tsx:394-408`).
- Problem: SSR HTML is always rendered in the business default scheme; a visitor who previously chose the other scheme sees the wrong one until hydration. A visitor with `prefers-color-scheme: dark` never gets dark unless the store default is dark.
- Impact: visible flash on every visit; ignores a user-level accessibility/comfort preference.
- Recommendation: persist the viewer choice in a cookie (readable in the server component) and add a pre-paint inline script for the store scope; decide explicitly whether OS preference is a fallback when the visitor has no stored choice.

**M1 — Default stores are painted with a hardcoded palette, not platform MD3** · MEDIUM · Confirmed (code)

- Evidence: `storefrontTheme.ts:720-723` documents "When false, the storefront should inherit the platform's MD3 design system colors". But `page.tsx:171-172` falls back to `createDefaultStorefrontTheme()` and `BusinessPageContent.tsx:165-167,405` always applies it (indigo `#6366f1`, translucent surfaces).
- Problem: `hasCustomStorefrontTheme` is computed but the "no custom theme" state never reaches the renderer; the Settings switch "Usar colores de plataforma" (`StorefrontThemeEditor.tsx:184-192`) therefore changes the saved flag but not what the buyer sees.
- Impact: contract violation; merchant cannot get back to platform look.
- Recommendation: pass `undefined` through to the renderer and skip var injection when no theme is saved.

**M2 — MD3 tokens only partially overridden; palette is not tonal** · MEDIUM · Confirmed (code)

- Evidence: `buildStorefrontThemeVars.ts:67-78` sets `primary` and `primary-container` to the **same** value (same for secondary/tertiary); `:79-99` hardcodes surface tokens as fixed `rgba(...)`; no `surface-tint`, `outline`, `background`, `error`, `inverse-*`, `surface-dim/bright`.
- Problem: filled vs tonal components lose hierarchy (container == base). Un-overridden tokens come from the _platform_ theme class on `<body>` (`ThemeContext.tsx:87-89`), which can differ from the _store_ scheme → mixed light/dark tokens (e.g. store dark + platform light yields a light `outline`/`error`). ADR 0002 promises "seed color" dynamic color; no tonal generation exists (`@material/material-color-utilities` is not a dependency).
- Impact: inconsistent contrast and elevation; contrast only checked for `on-primary/secondary/tertiary` (`getReadableTextColor`), not for primary-as-text on surface.
- Recommendation: generate a tonal scheme per store scheme from the seed (see §10) and override the full role set, or scope the platform theme class to the store scheme inside the storefront root.

**M12 — Platform theme applies after hydration** · MEDIUM · Hypothesis

- Evidence: the inline `THEME_BOOT_SCRIPT` sets only `data-theme` and `colorScheme`; it computes `suffix` and never uses it (`layout.tsx:125-137`). The `.light/.dark` body class that carries the MD3 tokens (`src/styles/material-design/light.css:1`) is applied in `ThemeBoot`'s `useEffect` (`ThemeBoot.tsx:6-34`) and `ThemeProvider`'s effect (`ThemeContext.tsx:~82-107`). `ThemeProvider` starts with `effectiveTheme='light'` (`ThemeContext.tsx:56`).
- Impact: if no `:root` fallback defines the tokens, the first paint lacks MD3 colors until hydration. `app/layout.fouc.test.ts` asserts only the script's text, not the effect.
- Verify in browser (§12).

**L6 — Pattern painted with `background-attachment: fixed` on `<html>`** · LOW · Hypothesis

- Evidence: `BusinessPageContent.tsx:445`. Fixed attachment is known to be ignored or janky on iOS Safari and forces repaints on scroll. Verify on device.

**M13 — Viewer toggle mutates the platform-wide theme** · MEDIUM · Confirmed (code)

- Evidence: `useStorefrontViewerTheme.ts:83-87` calls `setTheme(next)`; `BusinessPageContent.tsx:490-505` also calls `setTheme(scheme)` and writes both localStorage keys when the _owner_ clicks a tab in the editor.
- Impact: toggling a store's scheme rewrites `app-theme` for every platform page; editing the "Oscuro" tab permanently stores a viewer preference for the owner.
- Recommendation: keep store viewer scheme scoped to the store.

---

## 4. PatternCraft evaluation

### 4.1 What exists

- Catalog (static data): gradients 48, decorative 44, effects 66, geometric 99 (`public/patterns/geometric.json`, 70 KB) = **257 patterns**; the browser hard-excludes 9 (`REMOVED`) and hides 11 in light (`DARK_ONLY`) (`PatternBrowser.tsx:114-139`). Data is generated from the external PatternCraft repo by `scripts/transform-patterns.js`.
- Selection: `PatternBrowser` (4 tabs, grid of live CSS previews, confirm button) → `patternToCssOverlay` copies **raw CSS strings** into `background.cssOverlay` → persisted verbatim.
- Rendering: `buildBackgroundCSS` → `buildStorefrontThemeVars` → painted on `<html>`.

### 4.2 Findings

**H1 — Unvalidated CSS strings reach an SSR `<style>` block** · HIGH · Confirmed (code); exploit not executed

- Evidence:
  - `normalizeStorefrontBackground` only `.trim()`s every `cssOverlay` field (`storefrontTheme.ts:485-523`): no allowlist, no length cap, no function whitelist. It runs server-side in `updateStorefrontTheme` (`actions.ts:328`) on client-supplied input, so any value an authorized caller posts is persisted.
  - `buildStorefrontThemeStyleTag` emits `:root{--storefront-bg-image:<value>;...}` and drops a declaration only if it contains `<` or `>` (`buildStorefrontThemeVars.ts:123-126`). `;` and `}` are not filtered.
  - CSP keeps `style-src 'unsafe-inline'` and `img-src https:` (`securityHeaders.ts:54,57`; rationale at `:26-28`).
  - The existing test covers only angle brackets (`tests/unit/buildStorefrontThemeStyleTag.test.ts`).
- Problem: a value such as `none;}body{...}:root{` closes the declaration/rule and injects arbitrary CSS into a page buyers view; `url(https://…)` enables tracking beacons. The hardening comment assumes palette fields are the free-form ones, but palette is hex-validated; the free-form fields are `cssOverlay.*`.
- Impact: defacement/phishing overlays on a buyer-facing storefront, request beacons, exfiltration via CSS selectors; attributable to the merchant but harmful to buyers and to platform trust.
- Recommendation: store `patternId` + validated parameters and resolve CSS from the server catalog; if raw CSS must remain, allowlist per property and reject `;{}` `url(` `@` `expression`, cap length, and emit via `style` attribute/`CSS.escape`-equivalent. Add tests for `;`, `}`, `url(`.

**H2 — Pattern effects are dropped; preview ≠ result; SSR has no pattern** · HIGH · Confirmed (code); visual outcome Hypothesis until seen

- Evidence:
  - When a background image exists, `buildStorefrontThemeVars` sets `--storefront-bg-image:none`, `--storefront-bg:transparent` and **deletes** size/position/repeat/blend/mask/filter/opacity/mix-blend/animation/box-shadow/image-rendering (`buildStorefrontThemeVars.ts:44-63`).
  - The client re-computes the original and paints only `backgroundImage/Size/Position/Repeat/Attachment` on `<html>` (`BusinessPageContent.tsx:423-446`). `.storefrontThemeRoot::before` (the only consumer of mask/filter/animation/blend vars, `BusinessPageContent.module.css:16-46`) therefore never receives them.
  - `PatternBrowser.previewStyle` applies **all** style properties to the preview tile (`PatternBrowser.tsx:31-40,278`).
  - `page.tsx:172,193` builds the SSR tag from the same stripped vars: server HTML contains no pattern and a transparent background until `useLayoutEffect` runs.
  - `tests/unit/patternRendering.test.ts` tests `buildBackgroundCSS` (which preserves effects), not the stripped pipeline output.
- Problem: masks ("Fade" badge, `PatternBrowser.tsx:280`; 38 of 99 geometric patterns have masks), blend modes, filters and animations are previewed but never reach the storefront. `@keyframes aurora/crystal-shimmer` live in a CSS module (`BusinessPageContent.module.css:58-81`); CSS modules normally localize keyframe names, so a pattern string referencing `aurora` would not match even if applied (Hypothesis).
- Impact: merchants pick an effect and publish something different; first paint of any patterned store shows the platform background (pattern flash).
- Recommendation: choose one rendering surface (see §10) and render everything the picker can select, or remove what cannot be rendered. Add a pipeline-level test (`buildStorefrontThemeVars` + client paint contract).

**M8 — Browser actions that do not do what they say** · MEDIUM · Confirmed (code)

- "Quitar" in the pattern browser only closes the modal: it clears local `selectedId` and calls `onClose()`; the comment admits "We'll rely on parent handling" and the parent receives no signal (`PatternBrowser.tsx:225-235`). Real removal exists only in the editor (`StorefrontEditor.tsx:366-370`).
- Double-click calls `setSelectedId(pattern.id)` then `handleConfirm()`, which closes over the **previous** `selectedId` (`PatternBrowser.tsx:272-275,196-203`): it applies the previously selected pattern (or nothing).

**Legibility** · MEDIUM · Hypothesis

- Surfaces are fixed translucent values (`buildStorefrontThemeVars.ts:79-99`, 62–82 % alpha) and text is fixed `#111827`/`#f3f4f6`. Nothing validates contrast against the chosen pattern/gradient, and `randomHexColor` + free color inputs can produce an illegible `primary` used as text/link color. Content placed directly on the pattern (not on a surface) has no guarantee. Needs visual verification with high-contrast patterns.

**Performance/complexity** · LOW · Confirmed (code) unless noted

- `geometric.ts` imports the 70 KB JSON statically; `loadGeometricPatterns` (`src/lib/patterns/loadPatterns.ts`) has **no callers**, so the "kept out of the client chunk" comment is false. The comment in `BusinessPageContent.tsx:48-51` cites a 159 KB lazy chunk, loaded only for staff (good).
- 9 removed patterns, built-in overlay types (`dots/lines/…`, ~120 lines in `storefrontTheme.ts:169-256` and legacy normalization) and the `overlayPending` state (`StorefrontEditor.tsx:87`, never read) are dead or legacy.
- Each preview tile renders a live CSS background (filters/animations on up to ~66 tiles in "Efectos") — Hypothesis for mobile jank.
- No dedicated tests for `StorefrontEditor` or `PatternBrowser` (only an unrelated dynamic-import test and a product-grid test reference them).
- License/attribution of the external PatternCraft data was not found in `README`, `docs/` or `package.json` (Hypothesis — verify).

### 4.3 Value assessment and recommendation

- **Merchant value is low relative to cost.** A page-wide decorative pattern does not drive conversion, 257 choices create decision paralysis, and a third of the catalog cannot render correctly. Palette + font + a restrained background are the high-value controls.
- **Recommendation: simplify.** Replace the 257-item catalog with a curated set (~12–20) in two families (soft gradients, subtle geometric/dots/grid), stored as `{patternId, intensity?}`; resolve CSS server-side from the catalog. This fixes H1 by construction, removes most of H2, shrinks the bundle, and makes legibility checkable. Drop the "Efectos" category. Keep existing saved overlays working through a read-time fallback.

---

## 5. UX/UI audit

**Structure** (`StorefrontEditor.tsx`): scheme tabs → Colores → Tipografía → Fondo (Relleno, Patrón, Acciones) → footer Save. Hierarchy is reasonable; the problems are behavioral.

**M9 — No dirty state, ambiguous scope of "Restablecer"** · MEDIUM · Confirmed (code)

- Changes apply live to the page via `editableTheme` but are only persisted by "Guardar cambios", which is always enabled (`StorefrontEditor.tsx:703`). Closing the panel keeps the unsaved preview on screen with no indicator; a refresh discards it silently. The settings editor does have dirty tracking (`StorefrontThemeEditor.tsx:92-95,367`) — inconsistent.
- "Restablecer" resets only the background (`handleReset`, `:311-313`), not palette or font; "Random" changes fill colors even when the fill is visually disabled by an active pattern (`:514-520`, `:315-329`).
- Feedback is a single footer string auto-cleared after 3 s; errors use generic text (`:299-306`).
- Recommendation: dirty indicator + confirm on close/discard, disabled Save when unchanged, a scoped "Reset all" vs "Reset background", persistent error state.

**M10 — Accessibility** · MEDIUM · Confirmed (code)

- Only one ARIA attribute exists in the editor and picker (`aria-label` on the FAB, `StorefrontEditor.tsx:381`). Panel and picker have no `role="dialog"`/`aria-modal`/labelling, no focus trap, no focus return.
- Closed panel stays in the DOM, only translated off-screen (`StorefrontEditor.module.css:47-66`) → its controls remain tabbable.
- Custom toggle hides the checkbox (`opacity:0; width:0` `:551-556`) and defines no `:focus-visible` style → keyboard focus is invisible. Color inputs have no associated `<label>` (spans only, `StorefrontEditor.tsx:446-458`); close buttons are icon/glyph only without `aria-label` (`:393`, `PatternBrowser.tsx:215`); scheme tabs and pattern cards expose no `aria-pressed`/`role=tab`.
- Recommendation: use the existing MD3 dialog/sheet primitives (the repo already has `Sheet.css`/`SteppedSheet.css`) or add `inert` + dialog semantics.

**Mobile** · MEDIUM · Hypothesis

- Panel is `100vw` below 420 px (`StorefrontEditor.module.css:791-794`) so the live preview is fully covered while editing; there is no collapsed/peek state. FAB is fixed top-right (`:4-8`) and may overlap the navbar. Needs device check.

**MD3 coherence** · LOW · Confirmed (code)

- Editor is hand-built CSS (custom toggle, chips, color rows) while Settings uses MD3 `Select`/`Switch`/`Button`. The two editors look and behave differently for the same data.

**M3 — Two editors, divergent behavior** · MEDIUM · Confirmed (code)

- `StorefrontThemeEditor` never calls `setScheme` (`StorefrontThemeEditor.tsx:51`), so the **dark palette cannot be edited from Settings**; "Combinación aleatoria"/"Valores iniciales" replace the entire theme (`:338-352`) and therefore **erase the background/pattern** configured in the public editor.
- Entitlement checks differ: UI uses `entitlements.canCustomizeStorefront` (`:132`, `plans.ts:127,141,155`), server uses `plan === 'lite'` (`actions.ts:321`). `StaffManagementTools` renders the editor for any staff (`BusinessPageContent.tsx:546-570`, `isStaff = owner || permissions.length > 0`) with no `storefront.edit` or plan check, so a member without permission or a `lite` store gets the FAB and only sees a server error on save.
- Recommendation: one editor surface (or one shared state/reducer), one capability check (`canCustomizeStorefront` + `storefront.edit`) used by UI and server.

---

## 6. Typography audit

### Loaded vs applied

| Font              | Loaded (`app/layout.tsx`) | Weights                | Selectable in UI | Applied to store                               |
| ----------------- | ------------------------- | ---------------------- | ---------------- | ---------------------------------------------- |
| Google Sans Flex  | local woff2 `:57-64`      | variable 1–1000        | "Predeterminado" | yes (wrapper)                                  |
| Inter             | local woff2 `:29-36`      | variable 100–900       | yes              | yes (wrapper)                                  |
| Roboto            | local woff2 ×3 `:38-46`   | 400/500/700, no italic | yes              | yes (wrapper)                                  |
| Poppins           | local woff2 ×4 `:66-75`   | 400/500/600/700        | **no**           | only as fallback in the platform display chain |
| Sora, Roboto Mono | local woff2               | variable               | no               | platform only                                  |

All fonts are self-hosted via `next/font/local`; no Google Fonts CSS is used for text. The one external font resource is Material Symbols Rounded via a stylesheet `<link>` to `fonts.googleapis.com` (`layout.tsx:157-160`, `display=block`).

### Findings

**M4 — The store font does not reach Material Web components or portals** · MEDIUM · Confirmed (code)

- Evidence: `--storefront-font-family` is consumed in only `BusinessPageContent.module.css:6` (the wrapper), `Receipt.module.css:17` and a settings preview. Typography for MD3/`@material/web` comes from `--md-ref-typeface-*` and `--md-sys-typescale-*-font-family-name`, defined on `:root` from `--mio-theme-*` (`src/styles/theme-fonts.css`) and never overridden by the store.
- Impact: buttons, text fields, chips and anything rendered in portals (sheets/dialogs outside `.storefrontThemeRoot`) keep Google Sans Flex regardless of the merchant's choice.
- Recommendation: map the selected font onto `--md-ref-typeface-brand/plain` (and typescale names) at the storefront scope; verify portals receive that scope.

**M5 — Inaccurate font preview and four copies of the font map** · MEDIUM · Confirmed (code)

- Editor preview uses literal `'Inter'`/`'Roboto'` (`StorefrontEditor.tsx:488-497`), but `next/font/local` registers hashed family names exposed through CSS variables; the literal only works if the font is installed on the user's machine. The settings preview correctly uses variables.
- The font→CSS mapping is duplicated in `buildStorefrontThemeVars.ts:11-23`, `settings/constants.tsx:194-205`, `STOREFRONT_FONT_OPTIONS` (`storefrontTheme.ts:90-98`), the editor's own `FONT_OPTIONS` (`StorefrontEditor.tsx:39-43`) and `FONT_OPTIONS` in the domain (`:387`). `poppins` is valid in type, normalization and resolvers but unreachable from either UI.
- The "Predeterminado — Google Sans" label is actually Google Sans Flex.
- Recommendation: one font registry (id, label, CSS variable, weights) consumed by editor, settings and resolver; either expose or delete Poppins.

**L5 — Font loading cost/CLS** · LOW · Hypothesis

- Six `localFont` instances are created in the root layout (~240 KB of woff2 in total), so Next may preload them on every route including non-store pages; `display: 'swap'` with `adjustFontFallback: false` for Inter/Google Sans Flex can add layout shift. Verify in built HTML/Lighthouse.

**L4 — Material Symbols from external CDN** · LOW · Confirmed (code)

- Render-blocking stylesheet from `fonts.googleapis.com` with `display=block` (`layout.tsx:157-160`) while text fonts are self-hosted; CSP must allow the origin (`securityHeaders.ts:57-58`). Icon ligature text can show until the font loads. Consider self-hosting a subset.

---

## 7. Persistence and multitenant isolation

### Isolation: what was verified

- Authorization: `requireAccessOnId(businessId, 'storefront.edit')` loads the business, accepts owner or a member with the permission (`authz.ts:72-100`); both `updateStorefrontTheme` and `clearStorefrontTheme` call it first.
- Writes are always `WHERE business_id = :id` (`actions.ts:344-352,419-425`). There is a `unique(business_id)` constraint on `business_settings` (`businesses.ts:252`).
- Reads derive `business.id` from the resolved slug and query `businessSettings` by that id (`page.tsx:123-129`). The theme blob is stored per business, so tenants cannot read each other's themes.
- Client storage keys are namespaced by slug (`storefront-theme-{slug}`, `storefront-preview-scheme-{slug}`). Platform keys `app-theme`/`app-color-scheme` are global by design (see M13).
- **Conclusion**: no cross-tenant read/write path found.

### Findings

**M6 — Lost updates on the shared `preferences` blob** · MEDIUM · Confirmed (code) for the pattern, likelihood Hypothesis

- Evidence: read-modify-write of the whole JSONB without a transaction or row lock in `updateStorefrontTheme` (`actions.ts:331-352`) and `updateStorefrontLayout` (`:259-279`); both rewrite `preferences` that also holds other keys. Two concurrent saves (theme + layout, or two members) can drop each other's key. First-save path inserts without conflict handling against `unique_business_settings` (`:354-359`).
- Recommendation: `jsonb_set`-style partial update or `UPDATE … SET preferences = preferences || :patch`, or `SELECT … FOR UPDATE` in a transaction; `ON CONFLICT` for the insert.

**M7 — Save side effects can report failure after success; global cache purge** · MEDIUM · Confirmed (code)

- `posthog.capture` + `await posthog.flush()` run inside the same `try` after the DB write (`actions.ts:366-372`): if flush throws, the catch returns `success:false` although the theme was saved. Analytics also adds latency to the user's save.
- Every save calls `revalidatePath('/', 'layout')` (`:364`), invalidating the whole app's cache for a single tenant's cosmetic change.
- Recommendation: run analytics fire-and-forget outside the try; revalidate only `/${slug}` (or use tags).

**L1 — `slug` argument is trusted for cache invalidation** · LOW · Confirmed (code)

- `revalidatePath(`/${slug}`)` uses the client-supplied slug, not the slug of `businessId` (`actions.ts:362-363`). An authorized member of tenant A can invalidate any other tenant's page cache. No data exposure; derive slug server-side.

**L2 — `themeMode` is only type-checked** · LOW · Confirmed (code) for no runtime check; DB state Hypothesis

- The parameter is `'light'|'dark'` in TypeScript only (`actions.ts:312`); the column is `text` with a TS-level enum (`businesses.ts:238`) and no `CHECK` constraint was found in `migrations/` or `supabase/migrations/` (the `theme_mode` enum type exists but is not used by the column). A crafted call could persist any string. Validate server-side.

**L3 — Legacy/dead storage** · LOW · Confirmed (code)

- `business_settings.custom_colors` and `contrast_level` have no readers outside schema/types/a seed script; they predate `preferences.storefrontTheme`.

**Plan downgrade** · LOW · Hypothesis (intent unknown)

- The public page renders the saved custom theme regardless of current entitlements (`page.tsx:166-172` has no `canCustomizeStorefront` check); only _writes_ are gated. A store that downgrades to `lite` keeps its custom look. Confirm whether this is intended.

**Theme scope is home-only** · MEDIUM · Confirmed (code)

- Only `(home)/page.tsx` and the two `opengraph-image.tsx` files reference the theme. `product/[productId]/page.tsx` and its components contain no theme reference, and vars are removed on unmount (`BusinessPageContent.tsx:464-473`), so product pages appear to render with the platform theme. Visual confirmation pending.

---

## 8. Compatibility with future Storefront Templates

_Proposal only; nothing here is implemented or requires schema changes today._

### Theme vs Template — keep them separate

- **Theme (visual)**: palette per scheme, font, background. Pure data → CSS variables. Already modeled in `preferences.storefrontTheme`.
- **Template (structural)**: which sections exist, their order/variants, header/card/grid structure. Not modeled today except through `storefrontLayout`.

### What already helps

- `preferences.storefrontLayout` (`storefrontLayout.ts`) is a versioned section list (`hero`, `featured_categories`, `product_grid` with `columns/gap/cardStyle`) rendered by a `switch` in `BusinessPageContent.renderStorefrontSection`. It is the natural seed of a section registry.
- Theme output is already template-agnostic CSS custom properties, and `preferences` is JSONB, so a future `storefrontTemplate: {id, version}` key would not need a migration.

### Blockers to address first

1. Theme application lives inside `BusinessPageContent` (client component, `useLayoutEffect` on `<html>`/`<body>`). Templates need a server-rendered `StorefrontThemeScope` shared by every store route (including product, order, chat).
2. The theme is not applied outside home (§7), so templates would split the store into two visual systems.
3. Section types are a closed union and a hard-coded switch; adding Editorial/Showcase/Catalog variants would multiply branches.
4. H1/H2 and the partial MD3 override (M2) would be inherited by every template.
5. No tests around the editor or the full theme pipeline.

### Mapping (indicative)

| Template  | Structural idea                                                   | Needs                                                     |
| --------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| Classic   | Current: hero → categories → grid                                 | already exists                                            |
| Editorial | Large imagery, storytelling blocks, fewer products above the fold | new section variants, content blocks                      |
| Showcase  | Featured product(s) first, curated rows                           | featured selection, hero variants                         |
| Catalog   | Dense grid, filters first                                         | existing grid config + compact card + filter-first layout |

Recommended direction: a template is a **preset over a section registry** (ordered sections + per-section variant + default grid config), not a fork of pages. The merchant's theme applies on top unchanged.

---

## 9. Prioritized findings

### CRITICAL

None confirmed.

### HIGH

| ID  | Title                                                                | Status              | Where                                                                                              |
| --- | -------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------- |
| H1  | Unvalidated `cssOverlay` strings in SSR `<style>`                    | Confirmed (code)    | `storefrontTheme.ts:485-523`, `buildStorefrontThemeVars.ts:123-126`, `securityHeaders.ts:54,57`    |
| H2  | Pattern effects/mask stripped; preview ≠ result; SSR without pattern | Confirmed (code)    | `buildStorefrontThemeVars.ts:44-63`, `BusinessPageContent.tsx:423-446`, `PatternBrowser.tsx:31-40` |
| H3  | Save overwrites store default scheme                                 | Confirmed (code)    | `StorefrontEditor.tsx:292-297`, `actions.ts:349`                                                   |
| H4  | Wrong-scheme SSR flash; OS preference ignored                        | Confirmed mechanism | `page.tsx:170-172`, `useStorefrontViewerTheme.ts:58-63`                                            |

### MEDIUM

| ID  | Title                                           | Status            | Where                                                                     |
| --- | ----------------------------------------------- | ----------------- | ------------------------------------------------------------------------- |
| M1  | Default stores painted with hardcoded palette   | Confirmed         | `page.tsx:171`, `BusinessPageContent.tsx:165`                             |
| M2  | Partial, non-tonal MD3 token override           | Confirmed         | `buildStorefrontThemeVars.ts:67-99`                                       |
| M3  | Two editors, divergent capabilities and gating  | Confirmed         | `StorefrontThemeEditor.tsx:51,132,338-352`, `StaffManagementTools.tsx:70` |
| M4  | Store font not applied to MD components/portals | Confirmed         | `theme-fonts.css`, `BusinessPageContent.module.css:6`                     |
| M5  | Inaccurate font preview; duplicated font maps   | Confirmed         | `StorefrontEditor.tsx:488-497`, `constants.tsx:194`                       |
| M6  | Lost updates on shared `preferences`            | Confirmed pattern | `actions.ts:331-352`                                                      |
| M7  | Analytics inside save `try`; global revalidate  | Confirmed         | `actions.ts:362-372`                                                      |
| M8  | Pattern browser "Quitar" and double-click bugs  | Confirmed         | `PatternBrowser.tsx:225-235,272-275`                                      |
| M9  | No dirty state; ambiguous reset; weak feedback  | Confirmed         | `StorefrontEditor.tsx:288-329,703`                                        |
| M10 | Editor/picker accessibility gaps                | Confirmed         | `StorefrontEditor.module.css:47-66,551-556`                               |
| M12 | Platform MD3 class applied after hydration      | Hypothesis        | `layout.tsx:125-137`, `ThemeBoot.tsx`                                     |
| M13 | Viewer toggle writes platform-wide theme        | Confirmed         | `useStorefrontViewerTheme.ts:83-87`                                       |
| —   | Theme applied to home only                      | Confirmed (code)  | `product/[productId]/page.tsx`                                            |
| —   | Legibility not validated against patterns       | Hypothesis        | `buildStorefrontThemeVars.ts:79-99`                                       |
| —   | Editor covers preview on mobile                 | Hypothesis        | `StorefrontEditor.module.css:791`                                         |

### LOW

| ID  | Title                                                                                                                            | Status                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| L1  | Client slug trusted for `revalidatePath`                                                                                         | Confirmed              |
| L2  | `themeMode` not runtime-validated; no DB CHECK found                                                                             | Confirmed / Hypothesis |
| L3  | Dead code and columns (`loadGeometricPatterns`, `REMOVED`, `overlayPending`, `custom_colors`, `contrast_level`, legacy overlays) | Confirmed              |
| L4  | Material Symbols via external render-blocking CSS                                                                                | Confirmed              |
| L5  | Font loading cost/CLS                                                                                                            | Hypothesis             |
| L6  | `background-attachment: fixed` on iOS/perf                                                                                       | Hypothesis             |
| L7  | No tests for editor/picker; pattern test misses final pipeline                                                                   | Confirmed              |
| —   | PatternCraft data attribution/license not found                                                                                  | Hypothesis             |
| —   | Custom theme persists after plan downgrade                                                                                       | Hypothesis (intent)    |

### Opportunities

- Cookie-based per-store viewer scheme with pre-paint script.
- Server-side `StorefrontThemeScope` reused by every store route.
- Contrast guardrails (warn when primary/on-surface ratio < 4.5:1).
- Curated pattern catalog with intensity control.

---

## 10. Technical recommendations

1. **Security first (H1, L1, L2)**: persist `patternId` (+ validated params) and resolve CSS from a server catalog; validate/allowlist any remaining CSS fields; derive slug from `businessId`; validate `themeMode`.
2. **One theme application path**: a server component `StorefrontThemeScope` that emits tokens once (SSR) and a thin client part for viewer toggle. Remove the duplicate computation split between `page.tsx` and `BusinessPageContent`, and decide a single paint surface for the background (wrapper pseudo-element _or_ `<html>`, not both).
3. **Scheme model (H3, H4, M13)**: three distinct concepts — _edit tab_ (UI only), _store default_ (DB, explicit control), _viewer preference_ (cookie, store-scoped). Keep OS preference as an explicit fallback.
4. **Tokens (M1, M2)**: render nothing when no theme is saved; otherwise generate a tonal scheme from the seed and override the full role set per scheme (adds a dependency — requires approval, not decided here).
5. **Typography (M4, M5)**: single font registry; wire selection to `--md-ref-typeface-*`; remove or expose Poppins; fix the preview.
6. **Editor (M3, M8, M9, M10)**: one editor with dirty state, accessible dialog semantics, scoped resets, and one capability check shared with the server.
7. **Persistence (M6, M7)**: partial JSONB update or locked transaction; analytics outside the critical path; targeted revalidation.
8. **PatternCraft**: curated catalog (§4.3); delete dead data/loader.
9. **Tests**: pipeline test (`normalize → vars → style tag → client paint contract`), injection cases, editor/picker interaction tests.

---

## 11. Proposed implementation phases

_Proposal only — requires review and an approved plan before any change._

| Phase | Goal                          | Contents                                                                                       | Notes                                                                                               |
| ----- | ----------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 0     | Safety & correctness hotfixes | H1 validation, L1, L2, H3, M8 (Quitar, double-click), M7 analytics move                        | small, independently shippable; high-risk item (security) → own commit and independent verification |
| 1     | Rendering pipeline coherence  | Decide paint surface; fix H2 SSR/pattern parity; M1 no-theme state; H4 cookie + pre-paint; M13 | needs browser verification (§12)                                                                    |
| 2     | Typography & tokens           | Font registry, MD typeface wiring, M2 tonal scheme                                             | dependency decision if a color library is adopted                                                   |
| 3     | Editor unification & a11y     | Single editor, dirty state, dialog semantics, mobile peek, shared capability check, tests      |                                                                                                     |
| 4     | PatternCraft curation         | Curated catalog, `patternId` storage, read-time fallback for legacy overlays, remove dead data | depends on Phase 0/1                                                                                |
| 5     | Templates groundwork          | `StorefrontThemeScope` on all store routes, product page theming, section registry             | prerequisite for any template work                                                                  |
| 6     | Storefront Templates          | Classic/Editorial/Showcase/Catalog as presets over the registry                                | separate proposal                                                                                   |

---

## 12. Items pending verification

Runtime / browser

- Whether the first paint lacks MD3 tokens before hydration (M12): inspect SSR HTML and `:root`/body class timing.
- Whether `.light/.dark` body-level custom properties shadow `:root` store overrides for elements outside `.storefrontThemeRoot` (portals, sheets, editor panel).
- Visible light→dark flash for a returning dark-mode visitor (H4) and pattern flash on first paint (H2).
- CSS-module keyframe localization (do `aurora`/`crystal-shimmer` match pattern `animation` strings?).
- Exploitability of H1 in a real browser (rule breakout, `url()` beacon) in an isolated environment.
- `background-attachment: fixed` on iOS Safari; preview tile cost in the "Efectos" tab on low-end Android.
- Font preload behavior and CLS on non-store routes (L5).
- Mobile layout of the editor panel and FAB overlap.

Product / policy

- Whether custom themes should persist after plan downgrade.
- Whether OS `prefers-color-scheme` should be a fallback for store visitors.
- Whether the Settings editor is meant to remain after the inline editor (or be removed).

Data / legal

- Live DB `CHECK`/enum state of `business_settings.theme_mode`.
- License and attribution terms of the PatternCraft data and Google Sans Flex usage.

Code not inspected

- `openspec/` specs, `CustomerFloatingUi`, `Hero`, `FeaturedItems`, product grid internals, create-business wizard preview, `BusinessPreviewCard`, `@material/web` token consumption.
