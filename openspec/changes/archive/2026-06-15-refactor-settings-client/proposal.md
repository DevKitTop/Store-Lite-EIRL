# Proposal: Refactor SettingsClient.tsx

## Intent

`SettingsClient.tsx` is a ~3100-line monolithic component mixing storefront theme editing, team management, payments config, SEO, business info, and inline constants. Hard to test, maintain, or reason about. Pure structural refactor — extract by feature, zero behavioral changes.

## Scope

### In Scope
- Extract `StorefrontThemeEditor.tsx` — visual preview + controls
- Extract `TeamManagementPanel.tsx` — members, invites, permissions
- Extract `PaymentsConfig.tsx` — Culqi/Yape credential forms
- Extract `useSettingsState.ts` — shared state hook
- Extract `constants.ts` — constants and utilities
- SettingsClient.tsx becomes a thin orchestrator (~300 lines)

### Out of Scope
- No behavioral changes, new features, CSS changes, or changes to `SettingsNav.tsx`, `PermissionsMatrix.tsx`, or existing server actions
- No storefront engine changes (`@/core/storefront`)

## Capabilities

### New Capabilities
None — pure refactor, no spec-level changes.

### Modified Capabilities
None — only structural extraction.

## Approach

1. Extract constants + pure utils to `constants.ts`
2. Build `useSettingsState.ts` for shared business state and optimistic updates
3. Extract each feature section into its own component file
4. SettingsClient becomes a thin orchestrator composing extracted pieces

One git commit per extraction. Build + type-check after each commit.

## Affected Areas

| Area | Impact |
|------|--------|
| `app/[slug]/settings/components/SettingsClient.tsx` | Modified (~300 lines) |
| `app/[slug]/settings/components/StorefrontThemeEditor.tsx` | New |
| `app/[slug]/settings/components/TeamManagementPanel.tsx` | New |
| `app/[slug]/settings/components/PaymentsConfig.tsx` | New |
| `app/[slug]/settings/hooks/useSettingsState.ts` | New |
| `app/[slug]/settings/constants.ts` | New |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Broken imports during extraction | Medium | Build + type-check after each commit |
| State logic split across components | Low | Centralize in `useSettingsState` first |
| Lost git blame history | Medium | Transfer blocks preserving line ancestry |

## Rollback Plan

Each extraction is one revertible commit. If cascading bugs appear, revert the full chain. Original file remains accessible in git history.

## Dependencies

Working build and passing tests before starting.

## Success Criteria

- [ ] `SettingsClient.tsx` < 500 lines
- [ ] `pnpm build` passes with zero errors
- [ ] `pnpm lint` passes, zero new warnings
- [ ] `pnpm test:unit` passes, no regressions
- [ ] Each extracted file < 400 lines
- [ ] Zero visual changes to settings page
