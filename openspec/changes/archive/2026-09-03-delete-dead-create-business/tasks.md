# Tasks: delete-dead-create-business

## Phase 1 — Delete the dead file

### 1.1 Remove `app/actions/CreateBusiness.ts`

```bash
git rm app/actions/CreateBusiness.ts
```

**Verify:** File no longer exists on disk. `git status` shows 1 deleted file.

---

## Phase 2 — Grep verify: zero imports to dead path

### 2.1 Search for remaining references

```bash
grep -r "CreateBusiness" --include="*.ts" --include="*.tsx" .
```

**Verify:** No results reference the deleted path `app/actions/CreateBusiness`. Acceptable hits: `app/create-business/` (active replacement), `CreateBusinessInput` (type), `CreateBusinessButton` (component).

---

## Phase 3 — Type-check

### 3.1 Run type checker

```bash
pnpm type-check
```

**Verify:** 0 errors.

---

## Phase 4 — Unit suite

### 4.1 Run all unit tests

```bash
pnpm test:unit
```

**Verify:** All tests pass (expect 1106/1106 or current total).

---

## Phase 5 — Diff check

### 5.1 Inspect diff

```bash
git diff --stat HEAD
```

**Verify:** Only 1 file deleted, ~129 lines removed, 0 lines added. No out-of-scope files modified.

### 5.2 Confirm directory convention

```bash
ls app/actions/
```

**Verify:** All files use kebab-case naming. No PascalCase `.ts` files remain.

---

## Line Estimate

| Phase | Added | Deleted | Changed | Total |
|-------|-------|---------|---------|-------|
| Phase 1 (delete file) | 0 | ~129 | 0 | ~129 |
| **Total** | 0 | ~129 | 0 | ~129 |

**Net diff:** ~129 lines deleted. Far under 400-line budget.
