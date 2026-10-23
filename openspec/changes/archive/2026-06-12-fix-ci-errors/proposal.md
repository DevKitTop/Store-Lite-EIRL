# Proposal: Fix CI Errors

## Intent

The CI pipeline currently fails on 3 blocking issues: 19 TypeScript errors in 3 source files and 8 unit test failures in 1 test file. These block all PRs from passing CI checks. Fix them with minimal, low-risk changes to unblock development.

## Scope

### In Scope
- Fix 17 TS errors in `ExcelParser.ts` — change `getMatchedCol` param from `string[]` to `readonly string[]`
- Fix 3 TS errors in auth pages — add explicit type annotations to destructured `.then()` callbacks
- Fix 8 unit test failures in `Checkout.test.tsx` — add `useRouter` to the `next/navigation` mock

### Out of Scope
- 771 lint warnings (no-explicit-any, security/detect-object-injection, etc.) — deferred to follow-up
- Commitlint verification — standard config, non-blocking
- E2E tests — single smoke test, requires full infra

## Capabilities

### New Capabilities
None — pure fix/refactor, no new functionality.

### Modified Capabilities
None — no spec-level behavior changes.

## Approach

Fix in dependency order:

1. **Type system** (`ExcelParser.ts`): Change `getMatchedCol(possibleNames: string[])` → `getMatchedCol(possibleNames: readonly string[])`. One-line signature change fixes all 17 call sites. Preserves existing `as const` declaration.
2. **Type annotations** (auth pages): Add `: { data: ...; error: ... | null }` types to destructured `.then()` params in `app/auth/chat-popup/page.tsx:40` and `app/auth/customer/page.tsx:64,99`.
3. **Test mocks** (`Checkout.test.tsx`): Add `useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() })` to the `next/navigation` mock.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/[slug]/storage/components/import/ExcelParser.ts` | Modified | Change param type in function signature |
| `app/auth/chat-popup/page.tsx` | Modified | Add type annotation (1 line) |
| `app/auth/customer/page.tsx` | Modified | Add type annotations (2 lines) |
| `tests/unit/Checkout.test.tsx` | Modified | Add `useRouter` to mock |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Build fails due to env-dependent issues (Supabase, DB vars) | Medium | Verify with `pnpm type-check` + `pnpm test:unit`; build requires env setup |
| Supabase type annotations wrong, mask real mismatches | Low | Use inferred types from the library; verify no new errors after fix |
| E2E smoke test may fail in CI | Low-Medium | Requires full infra; not blocking for unit/type-check pass |

## Rollback Plan

Per-file revert — each fix is independent with no migrations or side effects. Revert individual files if a specific fix causes issues.

## Dependencies

None.

## Success Criteria

- [ ] `pnpm type-check` passes (0 errors)
- [ ] `pnpm test:unit` passes (all 8 Checkout tests green)
- [ ] `pnpm build` passes (if env vars available)
