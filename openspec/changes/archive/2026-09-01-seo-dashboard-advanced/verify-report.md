#666 [architecture] Verify: seo-dashboard-advanced — PASS
## What
SDD Verify report for `seo-dashboard-advanced` (T7; T8 OUT). All 4 requirements PASS, tests pass, scope clean.

## Why
Verification phase proves implementation matches spec, design, and tasks. No CRITICAL or WARNING issues found.

## Where
- `src/shared/seo/seoPreview.ts` — pure functions (getCounterStatus, buildSeoPreviewState) + OptimalRange type with lowerOffset
- `src/shared/seo/__tests__/seoPreview.test.ts` — 35 Vitest unit tests
- `app/[slug]/(app)/settings/constants.tsx` — CharCounter extended with optimalRange + color bar; CollapsibleSEOSection added
- `app/[slug]/(app)/settings/components/SettingsClient.tsx` — auto defaults via `??` nullish coalescing, optimalRange props, SearchPreview outside collapsible
- `app/[slug]/(app)/settings/settings.module.css` — charCounterBar* + collapsible* classes
- `src/shared/seo/buildStorefrontMeta.ts` — BusinessLike exported

## Learned
- getCounterStatus lower warning zones are asymmetric: title ok [min-20,min-1], desc ok [min-30,min-1] via optional lowerOffset
- `??` (not `||`) correctly preserves empty string overrides from sellers
- SearchPreview is correctly OUTSIDE CollapsibleSEOSection (always visible)

## Verification Results
- **STATUS**: PASS
- **R1 Auto-filled defaults**: PASS — `business.seoTitle ?? autoTitle` (SettingsClient.tsx:1280), BusinessLike exported (buildStorefrontMeta.ts:3)
- **R2 Live SERP preview**: PASS — SearchPreview wired to formData (SettingsClient.tsx:1359-1367), outside collapsible
- **R3 Colored char counter**: PASS — CharCounter optimalRange prop (constants.tsx:398-431), getCounterStatus (seoPreview.ts:35-54), CSS classes (settings.module.css:1406-1424), correct ranges title {50,60} desc {150,160,lowerOffset:30}
- **R4 Collapsed SEO section**: PASS — CollapsibleSEOSection (constants.tsx:478-513), defaultCollapsed={true} (SettingsClient.tsx:1369), SearchPreview outside
- **Test results**: Vitest 3 files 72 tests PASS | type-check EXIT 0 | eslint clean
- **Scope audit**: PASS — only 6 expected paths touched (4M + 2??)
- **Edge cases**: `??` preserves empty strings; unicode counted correctly; empty business data falls back to defaults
- **CRITICAL**: none
- **WARNING**: none
- **SUGGESTION**: none