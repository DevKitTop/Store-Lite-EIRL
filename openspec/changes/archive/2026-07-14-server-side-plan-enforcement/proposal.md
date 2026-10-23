# Proposal: Server-side plan enforcement in settings actions

## Intent

Remove a CRITICAL security gap: all 7 server actions in `app/[slug]/settings/actions.ts` accept a `plan: string` parameter from the client to gate premium features. An attacker can pass `plan: 'business_pro'` and bypass every check. Replace with server-side `getBusinessEntitlements(businessId)` which reads the true plan from the database.

## Scope

### In Scope

- Refactor all 7 server actions in `app/[slug]/settings/actions.ts` — drop `plan` param, use `getBusinessEntitlements` internally
- Update 4 client components that pass `plan` to these actions — remove the now-unnecessary argument
- Update `StorefrontEditor.tsx` (public page editor) — it passes `plan || 'business_pro'`, another trust gap

### Out of Scope

- Other server actions in the codebase that already use `getBusinessEntitlements` correctly
- `checkSlugAvailability` — it does NOT use `plan`, no change needed
- UI-level plan gating (e.g., hiding buttons for `basico` users) — that's a UX concern, not security

## Capabilities

### New Capabilities
None — pure refactor, behavior preserved.

### Modified Capabilities
None — no spec-level requirement changes; only the trust source moves from client to server.

## Approach

For each of the 7 actions:
1. Add `import { getBusinessEntitlements } from '@/core/entitlements'`
2. Remove the `plan` parameter from the function signature
3. Replace `if (plan === 'basico')` with `const entitlements = await getBusinessEntitlements(businessId)` then check `entitlements.plan`
4. Preserve the existing plan-level logic (which plans are rejected for each action)

For each client call site:
1. Remove the `entitlements.plan` argument from the server action call
2. For `StorefrontEditor.tsx`: also remove the `plan` prop from the component and its TypeScript interface

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/[slug]/settings/actions.ts` | Modified | 7 actions: drop `plan` param, add server-side entitlement check |
| `app/[slug]/settings/components/SettingsClient.tsx` | Modified | 4 call sites: remove `entitlements.plan` arg |
| `app/[slug]/settings/components/StorefrontThemeEditor.tsx` | Modified | 2 call sites: remove `entitlements.plan` arg |
| `app/[slug]/settings/components/PaymentsConfig.tsx` | Modified | 1 call site: remove `entitlements.plan` arg |
| `app/[slug]/components/StorefrontEditor.tsx` | Modified | 1 call site: remove `plan` prop, pass `plan || 'business_pro'` arg |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `getBusinessEntitlements` could fail or throw | Low | Wrap in try/catch; existing `requireAccessOnId` calls already have try/catch patterns |
| `updateCulqiCredentials` stores payment secrets — entitlements check must happen BEFORE key processing | Low | Current code already checks plan before processing keys; server-side check preserves this order |
| Existing behavior changes subtly (different plan gating) | Low | `entitlements.plan` is the same value the client was sending — same logic, same source |
| `StorefrontEditor.tsx` had a `plan` prop consumers didn't pass | Low | `BusinessPageContent.tsx` doesn't pass `plan` — removing the prop has zero impact on its consumer |

## Rollback Plan

Revert the commit on `app/[slug]/settings/actions.ts` and all 4 client component files. The old client-trusted `plan` parameter will be restored, restoring original (albeit vulnerable) behavior.

## Dependencies

None.

## Success Criteria

- [ ] All 7 actions use `getBusinessEntitlements` server-side instead of client-provided `plan`
- [ ] No TypeScript errors after removing `plan` params and args
- [ ] Existing behavior preserved: same plan tiers rejected for each action
- [ ] `pnpm test:unit` passes, `pnpm type-check` passes
