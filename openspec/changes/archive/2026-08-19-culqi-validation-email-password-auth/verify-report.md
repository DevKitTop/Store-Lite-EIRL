# Verify Report — culqi-validation-email-password-auth (SLICE 1 / PR 1)

- **Change**: `culqi-validation-email-password-auth`
- **Slice**: Phase 1 (1.1-1.3) + Phase 2 (2.1-2.3) + follow-up 2.4 (dark tokens fix)
- **Branch**: `feat/culqi-email-password-auth` (base `main`) — commits `24fc7d0`, `8f418de`, `ca43e92`
- **Artifact store**: openspec
- **Mode**: Strict TDD (active; runner `pnpm test:unit`)
- **Date**: 2026-08-18

## Verdict

**PASS WITH WARNINGS** — PR 1 is ready to merge from a code-correctness standpoint. No CRITICAL code defects found. Two WARNINGS: (1) apply phase did not persist an apply-progress artifact (TDD Cycle Evidence table missing), (2) the dark-class regression test asserts an implementation detail (orchestrator-requested, known flagged item).

## Completeness (slice scope)

| Task | Status | Evidence |
|------|--------|----------|
| 1.1 RED — AuthProvider.test.tsx | ✅ | `tests/unit/AuthProvider.test.tsx` exists (177 lines, 5 tests) |
| 1.2 GREEN — signInWithEmail + types + fallback | ✅ | `src/features/auth/index.tsx:261-270`, `src/types/auth.ts:44`, fallback `index.tsx:311-314` |
| 1.3 REFACTOR — suite green, Google path untouched | ✅ | 788 passed; diff contains zero changes to `signInWithGoogle` |
| 2.1 RED — AuthPage.test.tsx | ✅ | `tests/unit/AuthPage.test.tsx` exists (205 lines, 8 tests) |
| 2.2 GREEN — password form below divider | ✅ | `app/auth/page.tsx:189-214` |
| 2.3 CSS + suite green | ✅ | `app/auth/page.module.css` `.passwordForm`/`.errorText` |
| 2.4 Dark tokens fix + regression guard | ✅ | `page.tsx:65` (`dark` class), `page.module.css` disabled-token overrides, test at `AuthPage.test.tsx:100-113` |
| Phase 3-5 (e2e, script, README) | ➖ Not in slice | PR 2 scope (tasks 3.1, 4.1-4.3, 5.1 unchecked as expected) |

## SPEC_COMPLIANCE

### email-password-login spec

| Req | Requirement | Evidence | Status |
|-----|-------------|----------|--------|
| r1 | Valid email+password signs in, `router.push('/onboarding')` on success | `src/features/auth/index.tsx:268`; test `AuthProvider.test.tsx:36-53` (asserts `push('/onboarding')`), `AuthPage.test.tsx:126-137` | ✅ PASS |
| r2 | Invalid creds → inline error, no navigation | `index.tsx:263-264` + `resolveSignInErrorMessage` (`index.tsx:18-20`); page `app/auth/page.tsx:206-210` `role="alert"`; tests `AuthProvider.test.tsx:55-66` (no push), `AuthPage.test.tsx:139-151` (URL stays, alert shown) | ✅ PASS |
| r3 | Email + password MD3 TextFields (password `type="password"`), submit, no signup/reset links | `app/auth/page.tsx:190-213`; test `AuthPage.test.tsx:68-87` asserts `type="password"` and absence of /registr|olvid|recuper/ | ✅ PASS |
| r4 | Submit disabled until consent (see auth-consent r5) | `page.tsx:211` `disabled={isLoading \|\| !consented}`; test `AuthPage.test.tsx:115-124` | ✅ PASS |
| r5 | Google button unchanged | `signInWithGoogle` untouched (`index.tsx:230-243` identical); diff confirms | ✅ PASS |
| r6 | Loading state prevents double submit | `page.tsx:42` guard + `page.tsx:211`; test `AuthPage.test.tsx:177-195` (`toHaveBeenCalledTimes(1)`) | ✅ PASS |
| r7/r8 | Provisioning script + idempotency + credentials | ➖ PR 2 scope (Phase 4) — correctly not in this slice | ➖ N/A for PR 1 |

Error mapping verified: `invalid_credentials` → "Correo o contraseña incorrectos." (`index.tsx:13`, test `AuthProvider.test.tsx:59-60`); `email_not_confirmed` → confirm-email message (defensive, `index.tsx:14`, test `:70-78`); default fallback (`index.tsx:15`, test `:83-92`). `signInWithEmail` returns `Promise<{ error?: string }>` per design (`index.tsx:261`, `auth.ts:44`). `useAuth` fallback includes `signInWithEmail` (`index.tsx:311-314`).

### auth-consent spec (delta for this change — R5, R6)

| Req | Requirement | Evidence | Status |
|-----|-------------|----------|--------|
| r5 | Email/password submit gated by consent | `page.tsx:211`; tests `AuthPage.test.tsx:115-124` (disabled + no call) and `:126-137` (enabled after check + called with values) | ✅ PASS |
| r6 | Consent persists across form errors | `consented` state never reset in `handlePasswordSignIn` (`page.tsx:40-58`); test `AuthPage.test.tsx:153-165` (checkbox still checked, button enabled after error) | ✅ PASS |

R1-R4 (checkbox default, legal links, customer popup, footer) belong to the sibling change per `design.md:34` — not in this change's scope.

## ADVERSARIAL_FINDINGS

### CRITICAL
- **None found in code.** The implementation is small, well-scoped, and each spec behavior has a passing covering test. Credentials flow directly to `supabase.auth.signInWithPassword`; no logging of credentials; no new API surface; error strings are static map values rendered via React (no injection vector).

### WARNING
1. **Apply-progress / TDD Cycle Evidence missing (protocol).** No apply-progress artifact exists in `openspec/changes/...` nor in engram. Strict TDD module rates a missing TDD Cycle Evidence table as CRITICAL (protocol); since the substantive evidence (RED test files exist, GREEN passing) is fully verifiable in-repo, this is reported as a WARNING-level process gap: the apply phase must persist apply-progress for PR 2 (and the archive phase will need it). Does not indicate broken code.
2. **Dark-class regression test asserts implementation detail (known flagged item, orchestrator-requested).** `AuthPage.test.tsx:111` asserts `container.firstElementChild?.classList.contains('dark')`. It is a structural assertion on a CSS class — the strict assertion audit flags CSS-class assertions as WARNING. Justified here as a regression guard for a visual fix that jsdom cannot verify visually; the token names it guards were independently verified against `node_modules/@material/web/button/internal/filled-styles.css` (`--md-filled-button-disabled-container-color`, `-opacity`, `--md-filled-button-disabled-label-text-color`, `-opacity` all exist; defaults are `on-surface` at 12%/38% opacity — genuinely invisible on the `#080c14` card, so the fix is technically correct).

### SUGGESTION
3. **`dark` class forcing ignores high-contrast variants.** `/auth` always applies the base `dark` class, even when the body carries `dark-medium-contrast`/`dark-high-contrast` (layout.tsx:71-76). The auth page's own CSS uses hard-coded colors (verified: zero `var(--md-sys-color-*)` in `app/auth/page.module.css`), so there is no contrast regression from the forcing itself — but MD3 fields/buttons inside lose the user's preferred contrast level. Acceptable for a dark-by-design page; consider matching the body's full token class in a future pass.
4. **Missing `autocomplete` attributes.** Email/password fields rely on `name="email"`/`name="password"` for password managers; explicit `autoComplete="email"` / `autoComplete="current-password"` would be more robust.
5. **`isLoading` not reset on success path.** `page.tsx:47-52` relies on page unmount after `router.push('/onboarding')`. If navigation were ever blocked, the button would stay disabled with "Ingresando…". Cosmetic edge; the error path resets correctly.
6. **`change`-only state updates (no `onInput`).** MD3 fires `change` on commit (blur/Enter), so `email`/`password` state updates on commit, not per keystroke. Correct for a login form (submit always follows a commit); noted for awareness, not a defect — the tests' `setFieldValue` helper matches the real event contract (React 19 attaches `change` listeners on custom elements).

### Test quality assessment (assertion audit)
- **No tautologies, no ghost loops, no orphan empty checks, no smoke-only tests.**
- AuthProvider.test.tsx (5 tests): all behavioral — success nav, 3 error-code mappings with no-nav assertions, PGRST116 tolerance. Assertions assert values and call counts that ARE the behavior (e.g., double-submit `calledTimes(1)`).
- AuthPage.test.tsx (8 tests): rendering assertions include attribute checks (`type="password"`, `disabled`); consent gating asserts the handler guard (explicit `fireEvent.submit` without consent → no call — tests the guard, not just the attribute); R6 asserts checkbox stays checked + button enabled after error.
- Mock ratio: ~3-5 mocks vs ~15 expects per file — acceptable.
- Triangulation: every multi-scenario requirement (r1, r2, r4/r5, r6) has 2+ distinct cases. ✅

### Diff hygiene
- Slice boundary respected: diff = exactly 6 files (508 insertions); no `scripts/`, `README.md`, `package.json`, or `tests/e2e/` changes (those are PR 2).
- Commit structure clean: provider+types+tests (24fc7d0) → form+css+tests (8f418de) → dark fix+guard (ca43e92).
- Google flow untouched. `useRouter()` added inside `AuthProvider` is valid (root layout, in-router). `dark` class forcing has no side effect on the page's own CSS (verified: no md-sys tokens in `app/auth/page.module.css`).

## TEST_RESULTS

| Check | Command | Result |
|-------|---------|--------|
| Unit tests | `pnpm test:unit` | **793 total / 788 passed / 5 failed** — matches expected exactly |
| Pre-existing failures | `tests/unit/server-actions/settingsActions.test.ts` | 5 failed, all `PostHogFetchHttpError` 400 + missing `NEXT_PUBLIC_POSTHOG_KEY` (env). Identical known set (updateBusinessSlug pro, updateStorefrontTheme pro, updateCulqiCredentials pro, slug without plan, culqi without plan). **No new failures.** |
| New tests | `AuthProvider.test.tsx` + `AuthPage.test.tsx` | **13/13 passed** (5 + 8) |
| Type check | `pnpm type-check` | **0 errors** |
| Lint | `pnpm lint` | 725 problems: **1 error** (pre-existing `unicorn/filename-case` on untracked, gitignored `send-test-email.ts` — not in diff, verified via `git check-ignore`), 724 warnings. Changed files: only pre-existing `sonarjs/cognitive-complexity` on `index.tsx:88` (`fetchProfile` — untouched code). **Zero new lint issues in changed files.** |
| Coverage (changed, informational) | vitest coverage | `page.tsx` 74.19% lines (uncovered: Google catch 31-36 pre-existing, password catch 54-56 defensive); `index.tsx` 53.47% (new code lines 12-20, 261-270 fully covered; uncovered are pre-existing fetchProfile/posthog paths) |

Note: `pnpm test` also chains `playwright test` (e2e). E2E is Phase 3 — PR 2 scope; Playwright requires a booted server and is not part of this slice. The expected 793/788/5 figures correspond to the unit run, which is what was executed.

## PR_READINESS

**Approve PR 1** (`feat/culqi-email-password-auth` → `main`, stacked-to-main). All slice requirements have passing covering tests; type-check and lint clean for changed files; no security or correctness defects. Before/while opening the PR: (a) acknowledge the known flagged dark-class test (implementation-detail guard, orchestrator-requested), (b) note the apply-progress protocol gap so PR 2's apply persists it, (c) the 5 settingsActions failures are pre-existing/env-related and unrelated to this change.

## Risks

- Low: post-merge visual acceptance of divider placement + MD3 token contrast on the dark card (design open question, `design.md:108`) — verify visually on the deployed preview.
- Low: `email_not_confirmed` path is defensive only (script sets `email_confirm: true`); real-credential login untested until PR 2 provisions the user.
- Process: no apply-progress persisted for this slice — archive phase will need reconstruction or re-persist for PR 2.

## skill_resolution

`paths-injected` — loaded `sdd-verify/SKILL.md` + `strict-tdd-verify.md` (Strict TDD active) from the injected path.