# Tasks: Refactor SettingsClient.tsx

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~3000 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Foundation) → PR 2 (StorefrontTheme) → PR 3 (Team) → PR 4 (Payments + Cleanup) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Foundation — constants + hooks | PR 1 | ~500 lines; no behavioral impact, every extraction depends on this |
| 2 | StorefrontThemeEditor extraction | PR 2 | ~770 lines; extracted code only, depends on PR 1 |
| 3 | TeamManagementPanel extraction | PR 3 | ~1130 lines; extracted code only, depends on PR 1 |
| 4 | PaymentsConfig + final cleanup | PR 4 | ~640 lines; extracted code + re-export type; depends on PR 1 |

## Phase 1 — Foundation (no behavioral impact)

- [x] 1.1 Create `constants.ts` with all types (`SettingsBusiness`, `Entitlements`, `SettingsClientProps`, `TeamMemberData`, `SelectValueEvent`), constants (`PLAN_CONFIG`, `COLUMN_OPTIONS`, `GAP_OPTIONS`, `SECTION_LABELS`, `THEME_COLOR_FIELDS`), utilities (`getFontFamilyCSS`, `getRemainingTime`, `moveSection`, `updateSection`, `getSelectValue`), and leaf components (`SectionHeader`, `CopyableValue`, `LimitItem`, `SearchPreview`, `CharCounter`, `DeviceCard`, `ColumnChips`)
- [x] 1.2 Create `hooks/useSettingsState.ts` with `useSnackbarFeedback()` hook — encapsulates `{ open, description, color, icon }` feedback state (used in 4 sections)
- [x] 1.3 Update SettingsClient.tsx — import types from `./constants`, replace all inline feedback state with `useSnackbarFeedback`, verify `pnpm type-check` passes

## Phase 2 — Extract StorefrontThemeEditor

- [x] 2.1 Create `components/StorefrontThemeEditor.tsx` — rename `AppearanceSection` to `StorefrontThemeEditor`, move lines 752–1136 with all JSX, state, and handlers
- [x] 2.2 Update SettingsClient.tsx — import `StorefrontThemeEditor`, replace `<AppearanceSection ... />` with `<StorefrontThemeEditor ... />`, remove inline AppearanceSection function

## Phase 3 — Extract TeamManagementPanel

- [x] 3.1 Create `components/TeamManagementPanel.tsx` — rename `TeamSection` to `TeamManagementPanel`, move lines 2217–2766 with all JSX, state, dialog handlers, and `PermissionsMatrix` usage
- [x] 3.2 Update SettingsClient.tsx — import `TeamManagementPanel`, replace `<TeamSection ... />` with `<TeamManagementPanel ... />`, remove inline TeamSection function

## Phase 4 — Extract PaymentsConfig

- [x] 4.1 Create `components/PaymentsConfig.tsx` — rename `PaymentsSection` to `PaymentsConfig`, move lines 2768–3082 with all JSX, credential validation, key visibility toggles, and config dialog
- [x] 4.2 Update SettingsClient.tsx — import `PaymentsConfig`, replace `<PaymentsSection ... />` with `<PaymentsConfig ... />`, remove inline PaymentsSection function

## Phase 5 — Final Cleanup + Verification

- [x] 5.1 Add `export type { SettingsBusiness } from './constants'` to SettingsClient.tsx for backward compat with page.tsx
- [x] 5.2 Run `pnpm type-check` — zero errors (verify all imports in extracted files resolve: storefront types, server actions, shared ui components)
- [x] 5.3 Run `pnpm test:unit` — all pass with zero changes (213/213)
- [ ] 5.4 Verify SettingsClient.tsx is under ~300 lines — **NOT ACHIEVABLE** (1545 lines remain, 5 inline sections: BusinessSection, PlanSection, LegalSection, StorefrontSectionEditor, SEOSection). Target revised: deferred to future extraction phases.
- [x] 5.5 Verify `pnpm lint` — zero NEW errors in extracted/changed files. Remaining warnings are pre-existing (complexity, cognitive complexity, `@typescript-eslint/no-explicit-any`, `security/detect-object-injection`).
