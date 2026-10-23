# Spec: delete-dead-create-business

## Requirements

### R1 — Dead file removed

`app/actions/CreateBusiness.ts` MUST NOT exist after this change. The file contained 129 lines, a `'use server'` directive, and exported `createBusiness(prevState, formData)`. It is confirmed dead: zero importers, zero barrel re-exports, zero dynamic or magic-string references.

### R2 — Zero references to dead path remain

After deletion, a full-repo grep for `CreateBusiness` (scoped to `.ts` and `.tsx` files) MUST return zero hits that reference the deleted file path `app/actions/CreateBusiness`. Hits that reference the active replacement at `app/create-business/actions.ts` or the `CreateBusinessInput` type / `CreateBusinessButton` component are expected and acceptable.

### R3 — Active replacement unchanged and still used

`app/create-business/actions.ts` MUST remain unchanged by this change. Its import by `app/create-business/page.tsx` (and any test files) MUST continue to resolve without edits.

### R4 — Type-check passes

`pnpm type-check` MUST return 0 errors after the deletion.

### R5 — Unit suite passes

`pnpm test:unit` MUST pass all tests (expect 1106/1106 or current total). No test modifications required.

### R6 — Directory convention compliance

All files in `app/actions/` MUST use kebab-case naming after the deletion. No PascalCase files may remain in that directory.

### R7 — No out-of-scope files modified

No files outside `app/actions/CreateBusiness.ts` (deleted) MUST be modified. No demo items, no PascalCase types/components, no active replacement files, no barrel/index changes.

## Scenarios

### Scenario 1 — Dead file removed

```
Given app/actions/CreateBusiness.ts existed as a 129-line server action file
When the deletion is applied
Then app/actions/CreateBusiness.ts no longer exists
  And no other file in app/actions/ is modified
```

### Scenario 2 — Zero references to dead path

```
Given a full-repo grep for "CreateBusiness" across .ts and .tsx files
When the grep runs after deletion
Then zero results reference the path "app/actions/CreateBusiness"
  And results may include "app/create-business/actions.ts" (the active replacement)
  And results may include "CreateBusinessInput" or "CreateBusinessButton" (correct PascalCase)
```

### Scenario 3 — Active replacement still works

```
Given app/create-business/actions.ts defines the active createBusiness action
When app/create-business/page.tsx imports from './actions'
Then the import resolves to the unchanged active file
  And the page compiles without errors
```

### Scenario 4 — Type-check green

```
Given the dead file is deleted
When pnpm type-check runs
Then it returns 0 errors
  And no type error references the deleted module
```

### Scenario 5 — Unit suite green

```
Given the dead file is deleted
When pnpm test:unit runs
Then all existing tests pass
  And no test failure references the deleted module
```

### Scenario 6 — Directory all kebab-case

```
Given app/actions/ contains files before deletion
When the deletion is applied
Then every file in app/actions/ (non-directory) uses kebab-case naming
  And no PascalCase .ts files remain in app/actions/
```

### Scenario 7 — Rollback works

```
Given the deletion is applied
When git restore app/actions/CreateBusiness.ts runs
Then the file is restored to its exact pre-deletion content
  And the repo returns to its previous state
```
