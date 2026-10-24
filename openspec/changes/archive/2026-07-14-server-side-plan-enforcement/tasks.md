# Tasks: Server-side plan enforcement in settings actions

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~200 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: Server Actions — `app/[slug]/settings/actions.ts`

- [ ] 1.1 Add `import { getBusinessEntitlements } from '@/core/entitlements'` at top
- [ ] 1.2 `updateBusinessSlug`: remove `plan` param, add `const entitlements = await getBusinessEntitlements(businessId)` after `requireAccessOnId`, replace `plan === 'basico'` with `entitlements.plan === 'basico'`
- [ ] 1.3 `toggleBusinessActive`: same pattern as 1.2
- [ ] 1.4 `updateBusinessSEO`: same pattern as 1.2
- [ ] 1.5 `updateStorefrontLayout`: remove `plan` param, add entitlements call, replace `plan === 'basico' || plan === 'emprendedor'` with `entitlements.plan === 'basico' || entitlements.plan === 'emprendedor'`
- [ ] 1.6 `updateStorefrontTheme`: same pattern as 1.5 (also drops `plan` from middle of param list, before optional `themeMode`)
- [ ] 1.7 `clearStorefrontTheme`: same pattern as 1.5
- [ ] 1.8 `updateCulqiCredentials`: remove `plan` param, add entitlements call, replace `plan !== 'business_pro' && plan !== 'enterprise_ai'` with `!entitlements.hasPaymentGateway`

## Phase 2: Client Call Sites — Remove `plan` argument

- [ ] 2.1 `SettingsClient.tsx` (BusinessSection): remove `entitlements.plan` from `updateBusinessSlug` call (L223) and `toggleBusinessActive` call (L237)
- [ ] 2.2 `SettingsClient.tsx` (StorefrontSectionEditor): remove `entitlements.plan` from `updateStorefrontLayout` call (L922)
- [ ] 2.3 `SettingsClient.tsx` (SEOSection): remove `entitlements.plan` from `updateBusinessSEO` call (L1167)
- [ ] 2.4 `StorefrontThemeEditor.tsx`: remove `entitlements.plan` from `clearStorefrontTheme` call (L59) and `updateStorefrontTheme` call (L65)
- [ ] 2.5 `PaymentsConfig.tsx`: remove `entitlements.plan` from `updateCulqiCredentials` call (L56)
- [ ] 2.6 `StorefrontEditor.tsx`: remove `plan` from `StorefrontEditorProps` interface (L29), remove `plan` from destructured props (L69), replace `plan || 'business_pro'` with just the remaining args in `updateStorefrontTheme` call (L283)

## Phase 3: Tests — `tests/unit/server-actions/settingsActions.test.ts`

- [ ] 3.1 Add test file with mocks for `db`, `requireAccessOnId`, and `getBusinessEntitlements`
- [ ] 3.2 Test: each action with `basico` plan returns error (actions 1-6: plan-string check, action 7: `hasPaymentGateway` check)
- [ ] 3.3 Test: each action expired subscription (expect `getBusinessEntitlements` returns `basico`) — same error as 3.2
- [ ] 3.4 Test: each action with valid premium plan succeeds (actions 1-6: `business_pro` passes, action 7: passes with `hasPaymentGateway: true`)
- [ ] 3.5 Test: direct RPC call with extra `plan` arg ignored — function ignores unknown params (TS enforcement at build, runtime ignores extra args)
