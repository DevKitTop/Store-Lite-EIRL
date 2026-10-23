# Proposal: delete-dead-create-business

## Intent

Delete `app/actions/CreateBusiness.ts` — a dead legacy server action with zero importers across the entire repo. Removing it eliminates the last non-kebab-case file in `app/actions/` and removes 129 lines of unused code.

## Scope

### In Scope

| Action | Detail |
|--------|--------|
| Delete `app/actions/CreateBusiness.ts` | 129 lines, `'use server'`, exports `createBusiness(prevState, formData)`. Dead — confirmed zero importers, zero barrel re-exports, zero test/dynamic references, not a Next.js special file. |
| Convention compliance | After deletion, all files in `app/actions/` use kebab-case naming (`business.ts`, `kyb.ts`, `team/`). |

### Out of Scope

| Item | Why excluded |
|------|-------------|
| Demo/fixture code (`MaterialDemo.tsx`, `MenuDemos`, `OverlayDemos`, `AllMaterialComponents`, `test-components` page, `scripts/create-culqi-test-user.ts`) | Legit UI showcases and provisioning script — not dead code. |
| `app/create-business/actions.ts` (299 lines) | The active superset replacement — untouched, already handles storefront themes, legal reps, businessSettings + businessSubscriptions inserts, logo upload. |
| `CreateBusinessInput` type in `src/features/business/schemas.ts` | PascalCase by correct TS convention — not a naming violation. |
| `CreateBusinessButton` component | PascalCase by correct React convention — not a naming violation. |
| Import updates, barrel changes, migrations | Single-file deletion; no behavior change. |

## Approach

1. `git rm app/actions/CreateBusiness.ts`
2. Verify no references remain: `grep -r "CreateBusiness" --include="*.ts" --include="*.tsx"` (expect zero hits for the dead path)
3. Verify compilation: `pnpm type-check` (0 errors)
4. Verify tests: `pnpm test:unit` (all pass)

## Affected Areas

| Area | Impact |
|------|--------|
| `app/actions/CreateBusiness.ts` | Deleted (129 lines removed) |
| No other files | No change |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Import breaks at runtime | None | Zero importers confirmed by grep; type-check will catch any missed reference |
| Active `create-business/actions.ts` affected | None | Different file, different path, untouched |

## Rollback Plan

`git restore app/actions/CreateBusiness.ts` retrieves the file. No other changes to revert.

## Dependencies

None — pure deletion, no new packages, no migrations.

## Success Criteria

- [ ] `app/actions/CreateBusiness.ts` deleted
- [ ] Grep confirms zero references to the dead file path
- [ ] `app/create-business/actions.ts` unchanged and still used
- [ ] `pnpm type-check` passes (0 errors)
- [ ] `pnpm test:unit` passes (all tests, expect 1106/1106)
- [ ] `app/actions/` directory all kebab-case after
- [ ] Diff: only 1 file deleted, ~129 lines removed
