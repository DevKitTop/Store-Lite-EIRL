# Design: delete-dead-create-business

## Why delete, not rename

The file is dead — zero importers, zero references. There is nothing to rename it _to_ that would make it alive. The active replacement already exists at a different path with a superset implementation. Deleting is the only correct action; renaming would just move dead code to a different location.

## Superset Replacement Overview

`app/create-business/actions.ts` (299 lines) is the full active replacement. It handles:

- Storefront theme selection (not in legacy file)
- Legal representatives (not in legacy file)
- `businessSettings` + `businessSubscriptions` inserts (not in legacy file)
- Logo upload (not in legacy file)
- The same core flow: auth → profile ensure → limit check → validate → slug → insert → redirect

The legacy `CreateBusiness.ts` was a strict subset. No behavior is lost.

## Dependency Map

```
app/actions/CreateBusiness.ts
  ├── imports from: @/config/env, @/core/business/slug, @/core/database/*
  ├── imports from: @/features/business/schemas, @/shared/utils/*
  ├── imports from: @types/actions, @supabase/ssr, drizzle-orm, next/*
  └── IMPORTED BY: ??? (nothing — orphaned)
```

The file imports 10 modules but is imported by **zero** modules. It is a pure orphan. No barrel re-exports it. No test covers it. No magic string or dynamic import references it. No Next.js convention file (`page.tsx`, `layout.tsx`, `route.ts`, `middleware.ts`) matches its name.

## Risk Assessment: LOW

| Factor | Assessment |
|--------|-----------|
| Importers | Zero (confirmed by grep) |
| Behavior change | None — dead code removal |
| Active replacement | Exists and is a superset |
| Package dependencies | None added or removed |
| Migration | None |
| Test impact | None — no tests reference the file |
| Rollback | Simple `git restore` |

This is the lowest-risk possible change: deleting an unreferenced file. The only failure mode is a missed import, which `pnpm type-check` catches at compile time.

## Verification Method

### Step 1 — Grep for references

```bash
grep -r "CreateBusiness" --include="*.ts" --include="*.tsx" .
```

Expected: hits only for `app/create-business/` (active replacement), `CreateBusinessInput` (type), `CreateBusinessButton` (component). Zero hits for the deleted path.

### Step 2 — Type-check

```bash
pnpm type-check
```

Expected: 0 errors. If any error references the deleted module, a missed import exists.

### Step 3 — Unit suite

```bash
pnpm test:unit
```

Expected: all tests pass (1106/1106). If any test fails referencing the deleted module, a missed test import exists.

### Step 4 — Diff check

```bash
git diff --stat
```

Expected: 1 file changed, ~129 deletions, 0 additions. Well under 400-line budget.

## Edge Cases

| Case | Handling |
|------|----------|
| Future consumer imports dead path | Impossible — file deleted; import fails at compile time |
| Barrel re-exports dead path | Confirmed: no barrel in `app/actions/` exists that references `CreateBusiness.ts` |
| Next.js convention file | `CreateBusiness.ts` is not `page.tsx`, `layout.tsx`, `route.ts`, `middleware.ts`, or `loading.tsx` — not a special file |
