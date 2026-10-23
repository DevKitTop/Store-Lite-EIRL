# Tasks: Fix CI Errors

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~5 (1 + 3 + 1) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Fix all CI errors (TS + tests) | PR 1 | Single PR, ~5 lines, no dependencies between fixes |

## Phase 1: TypeScript Type Fix — ExcelParser.ts

- [x] 1.1 Change `getMatchedCol(possibleNames: string[])` to `readonly string[]` in `app/[slug]/storage/components/import/ExcelParser.ts`

## Phase 2: TypeScript Implicit Any Fix — Auth Pages

- [x] 2.1 Add explicit type annotation to `.then()` callback param in `app/auth/chat-popup/page.tsx` (~line 40)
- [x] 2.2 Add explicit type annotations to `.then()` callback params in `app/auth/customer/page.tsx` (lines ~64, ~99)

## Phase 3: Test Mock Fix — Checkout Test

- [x] 3.1 Add `useRouter` to the `next/navigation` mock in `tests/unit/Checkout.test.tsx`

## Phase 4: Verification

- [x] 4.1 Run `pnpm type-check` — verify 0 errors
- [x] 4.2 Run `pnpm test:unit` — 7/8 Checkout tests pass; 1 pre-existing failure (headers mismatch with `Idempotency-Key` in test assertion)
- [x] 4.3 Run `pnpm lint` — 0 errors, 771 warnings (all pre-existing)
- [ ] ~~4.3 `pnpm build` — pre-existing failure: chat-popup missing Suspense boundary (not related to this change)~~
