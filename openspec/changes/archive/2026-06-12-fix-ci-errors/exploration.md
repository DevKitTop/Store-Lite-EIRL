# Exploration: fix-ci-errors

## Current State

The CI pipeline runs 4 jobs. Current status:

| Job | Command | Status | Details |
|-----|---------|--------|---------|
| **Code Quality** | `pnpm lint && pnpm type-check` | ❌ FAILS | lint passes (0 errors, 771 warnings), type-check fails (19 TS errors) |
| **Build Check** | `pnpm build` | ❌ FAILS* | Build will fail because type-check errors block the Next.js build |
| **Commit Lint** | `npx commitlint ...` | ⚠️ NEEDS REVIEW | Config found; further investigation needed |
| **Running Tests** | `pnpm test:unit && pnpm test:e2e` | ❌ FAILS | unit: 1 test file fails (8 tests), e2e: 1 smoke test exists |

*\*Not directly verified but guaranteed to fail because Next.js build includes type-checking.*

---

## Affected Areas

### TypeScript Errors (19 total — BLOCKING)

#### 1. `app/[slug]/storage/components/import/ExcelParser.ts` — 17 errors (lines 434–490)

The `SYNONYMS` object at line 388 is declared with `as const`, making all nested arrays deeply `readonly` tuples. The `getMatchedCol` helper expects `possibleNames: string[]` (mutable). Every call site passing `SYNONYMS.code`, `SYNONYMS.brand`, etc. fails.

**Affected call sites:**
- Line 434: `SYNONYMS.code` (18 elements)
- Line 438: `SYNONYMS.brand` (16 elements)
- Line 442: `SYNONYMS.price` (22 elements)
- Line 446: `SYNONYMS.stock` (20 elements)
- Line 450: `SYNONYMS.category` (24 elements)
- Line 454: `SYNONYMS.image` (20 elements)
- Line 458: `SYNONYMS.title` (28 elements)
- Line 462: `SYNONYMS.description` (39 elements)
- Line 466: `SYNONYMS.tags` (10 elements)
- Line 470: `SYNONYMS.status` (9 elements)
- Line 474: `SYNONYMS.secondPrice` (16 elements)
- Line 478: `SYNONYMS.saleStatus` (12 elements)
- Line 482: `SYNONYMS.shippingInfo` (16 elements)
- Line 486: `SYNONYMS.seoTitle` (10 elements)
- Line 490: `SYNONYMS.seoDescription` (11 elements)

#### 2. `app/auth/chat-popup/page.tsx:40` — 1 error

```typescript
.then(({ error }) => {
```

`error` binding element has implicit `any` type. The `.then()` callback destructures from `exchangeCodeForSession()` but the destructured parameter doesn't get a properly inferred type.

#### 3. `app/auth/customer/page.tsx:64,99` — 2 errors

```typescript
.then(({ data, error }) => {
```

Same pattern: destructured `data` and `error` have implicit `any` types.

### Unit Test Failures (8 total — BLOCKING)

#### `tests/unit/Checkout.test.tsx` — all 8 tests fail

**Root cause**: The `next/navigation` mock at line 13–15 only provides `useParams`:
```typescript
vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
}));
```

But the source component `Checkout.tsx:208` also imports and calls `useRouter()`:
```typescript
const router = useRouter();
```

The mock doesn't export `useRouter`, so Vitest throws: `No "useRouter" export is defined on the "next/navigation" mock`.

**Affected tests:**
1. `calls POST /api/payment/create-order when amount exceeds YAPE_LIMITS.max`
2. `does NOT call create-order when amount is within YAPE_LIMITS`
3. `falls back to charge-only flow when order creation API fails`
4. `sets paymentInstructions when Culqi.order is present`
5. `keeps Culqi.token path unchanged when Culqi.order is absent`
6. `renders CIP code for PagoEfectivo`
7. `renders QR image for Billetera Móvil`
8. `overlay is closable`

### Remaining CI Jobs

#### Commit Lint
- Config exists at `.commitlintrc.json` — extends `@commitlint/config-conventional`
- Husky hooks configured (`.husky/commit-msg`) — runs `npx --no -- commitlint --edit "$1"`
- Pre-commit hook runs `npx lint-staged` (which runs eslint + prettier on staged files)
- CI-specific: will validate commit messages on push (against HEAD~1) and PR commits

#### Build Check
- Not directly run, but will fail because `next build` includes type-checking
- Will only pass once all 19 TS errors are fixed

#### E2E Tests
- 1 smoke test at `tests/e2e/home.spec.ts` — checks page loads with title "Store Lite"
- Depends on dev server + Playwright browsers
- Cannot be fully verified without a running environment

---

## Root Cause Analysis

### ExcelParser.ts (17 TS errors)

**Why it happens**: The `SYNONYMS` constant uses `as const` assertion (line 388), which makes the TypeScript compiler infer each array as a `readonly` tuple literal type (e.g., `readonly ["codigo", "código", "code", ...]`). The `getMatchedCol` function parameter `possibleNames: string[]` expects a mutable array. In strict TypeScript, a `readonly` tuple is NOT assignable to a mutable `string[]`.

**Why `as const` was used**: Provides literal type inference for the values, which is useful for type safety. But the tradeoff is that the arrays become readonly.

**Corrective approaches:**
- **A**: Change `getMatchedCol` signature to accept `readonly string[]` — non-breaking, allows both mutable and readonly arrays
- **B**: Remove `as const` from `SYNONYMS` — but loses literal inference on values
- **C**: Add type assertions at each call site — verbose, repetitive
- **D**: Type `SYNONYMS` as `Record<string, readonly string[]>` — preserves `as const` intent

### Auth pages (3 TS errors)

**Why it happens**: `@supabase/ssr`'s `exchangeCodeForSession(code)` returns `Promise<{ data: ..., error: SupabaseError | null }>` but the generic type resolution through `.then()` callback destructuring results in an implicit `any` for the destructured bindings. This is likely because the return type uses a conditional or mapped type that doesn't fully narrow in the destructured context, or the library's generated types don't propagate correctly through the `.then()` unboxing.

**Why it wasn't caught before**: If `skipLibCheck` is true (it is), `.d.ts` files are skipped, but this error is in `.tsx` source files where `noImplicitAny` is enforced.

**Corrective approach:** Add explicit type annotations to the destructured callback parameters:
```typescript
.then(({ data, error }: { data: ...; error: ... | null }) => {
```

### Checkout test (8 test failures)

**Why it happens**: The mock was written before `useRouter` was added to the component (or the mock was incomplete). The component grew to use `useRouter` but the test mock was never updated.

**Corrective approach:** Add `useRouter` to the `next/navigation` mock with a `vi.fn()` implementation.

---

## Approaches

### Category 1: ExcelParser.ts — readonly tuple vs string[]

| Approach | Pros | Cons | Effort |
|----------|------|------|--------|
| **A: Change `getMatchedCol` to `readonly string[]`** | 1 fix in 1 function signature fixes all 17 call sites. Preserves `as const`. | None significant. `readonly string[]` accepts both. | Low |
| **B: Remove `as const` from `SYNONYMS`** | Also fixes the 17 call sites. | Loses type narrowing on values. Might affect other code relying on literal types. | Low |
| **C: `as string[]` assertions at each call site** | Preserves exact current behavior. | 17 changes needed, verbose, repetitive. | Medium |
| **D: Type `SYNONYMS` as `Record<string, readonly string[]>`** | Explicit typing, preserves `as const`. | Adds a type annotation; slightly more code than A. | Low |

**Recommendation: A** — simplest, least invasive. Single function signature change.

### Category 2: Auth pages — implicit `any` in destructured params

| Approach | Pros | Cons | Effort |
|----------|------|------|--------|
| **A: Add inline type annotation** | Explicit, clear, no structural changes. | Need to know the exact type. | Low |
| **B: Extract to named function with typed params** | Cleaner pattern, reusable. | Over-engineered for 3 call sites. | Low |
| **C: Disable the specific TS error** | Quick. | Hides real issues. Bad practice. | Very Low |

**Recommendation: A** — Add `: { data: ...; error: ... | null }` or simply `: any` (warned but not error) to the destructured params. Better to import and use proper types.

### Category 3: Checkout test — missing `useRouter` mock

| Approach | Pros | Cons | Effort |
|----------|------|--------|--------|
| **A: Add `useRouter` to existing mock** | Simple, 1-line addition. | None. | Very Low |
| **B: Create a shared `next/navigation` mock utility** | Reusable across tests. | Over-engineered for one test file. | Medium |

**Recommendation: A** — Add `useRouter: () => ({ push: vi.fn(), replace: vi.fn(), ... })` to the mock.

### Category 4: Lint warnings (771 warnings, 0 errors)

These are **non-blocking** for CI but represent technical debt. Key patterns:
- `@typescript-eslint/no-explicit-any` — ~103 occurrences across ~40 files
- `security/detect-object-injection` — ~40 occurrences
- `@typescript-eslint/no-non-null-assertion` — ~34 occurrences
- `sonarjs/cognitive-complexity` — ~14 functions over limit
- `complexity` — ~10 functions over limit
- `@typescript-eslint/no-unused-vars` — ~15 occurrences
- `promise/catch-or-return` / `promise/always-return` — ~10 occurrences

| Approach | Pros | Cons | Effort |
|----------|------|--------|--------|
| **A: Ignore — fix only blocking errors** | Quick, focused on CI pass. | Technical debt accumulates. | None |
| **B: Fix high-severity warnings (any, non-null)** | Reduces risk, improves code quality. | Lots of changes, risk of regressions. | High |
| **C: Add warning-count threshold to CI** | Prevents future warning accumulation. | Doesn't fix existing ones. | Low |

**Recommendation: A** for initial CI fix. Consider B as follow-up.

---

## Effort Estimate

| Category | Files | Changes | Complexity | Estimated Time |
|----------|-------|---------|------------|----------------|
| ExcelParser.ts (type param) | 1 | 1 line change | Very Low | 2 min |
| Auth pages (implicit any) | 2 | 3 lines | Very Low | 3 min |
| Checkout test mock | 1 | 1 line | Very Low | 2 min |
| **Total (blocking)** | **4 files** | **~5 lines** | **Very Low** | **~7 min** |
| Lint warnings (optional) | ~40 files | ~150-200 lines | Medium–High | 1-2 hours |

---

## Risks

1. **Changing `getMatchedCol` parameter type**: `readonly string[]` accepts both `readonly` and mutable arrays, so no runtime impact. **Risk: None.**
2. **Auth pages types**: Using wrong type annotations could mask real type mismatches. **Risk: Low** — Supabase types are well-documented.
3. **Checkout test mock**: Adding `useRouter` mock with wrong return shape could silently pass tests that should fail. **Risk: Low** — standard mock pattern.
4. **Build verification**: Cannot verify `pnpm build` without env vars for Supabase, DB, etc. **Risk: Medium** — there may be additional build-only errors not caught by `tsc --noEmit`.
5. **E2E tests**: Not verifiable locally without full infra. **Risk: Low-Medium** — basic smoke test unlikely to fail.
6. **Commitlint**: Cannot verify without actual git commits. **Risk: Low** — standard config, nothing custom.

---

## Recommendation

1. **Fix ExcelParser.ts** → Change `getMatchedCol` parameter from `string[]` to `readonly string[]`
2. **Fix auth pages** → Add explicit type annotations to destructured `.then()` callbacks in both files
3. **Fix Checkout test** → Add `useRouter: () => ({ push: vi.fn(), ... })` to the `next/navigation` mock
4. **Run after fixes**: `pnpm type-check` and `pnpm test:unit` to verify
5. **Post-fix optional**: `pnpm build` to check for build-specific issues (needs env vars)
6. **Defer**: 771 lint warnings — high-severity patterns (any, non-null assertions) can be addressed in a follow-up

---

## Ready for Proposal

Yes. All blocking issues are identified, root-caused, and have clear fix strategies with minimal effort. Proceed to proposal with confidence.
