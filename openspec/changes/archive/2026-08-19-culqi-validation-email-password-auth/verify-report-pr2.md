# Verify Report — culqi-validation-email-password-auth (SLICE 2 / PR 2)

- **Change**: `culqi-validation-email-password-auth`
- **Slice**: Phase 3 (3.1) + Phase 4 (4.1-4.3) + Phase 5 (5.1) + Phase 6 follow-up (toggle, `25ff9dd`)
- **Branch**: `feat/culqi-email-password-auth` (base `main`) — commits `fb2619c`, `26210e3`, `7fe7be9`, `25ff9dd` (diff `ca43e92...feat/culqi-email-password-auth`)
- **Artifact store**: openspec (+ engram observation)
- **Mode**: Strict TDD (active; runner `pnpm test`)
- **Date**: 2026-08-19 (delta re-verify: 2026-08-19)

## Verdict

**PASS WITH WARNINGS** — PR 2 is ready to merge. No CRITICAL issues. All three spec requirements (r7 provisioning, r8 idempotency, r9 external credentials) are implemented and statically verified; the e2e smoke test passes at runtime (7/7); the script's three graceful failure paths were executed safely. Warnings are process/robustness level, not code defects.

## Completeness (slice scope)

| Task | Status | Evidence |
|------|--------|----------|
| 3.1 E2E smoke — form renders, submit disabled until consent | ✅ | `tests/e2e/auth.spec.ts:22-39`; passed at runtime (7/7 suite) |
| 4.1 Script — tsx header, dotenv, admin client, env/CLI creds | ✅ | `scripts/create-culqi-test-user.ts` (126 lines) |
| 4.2 Idempotency — listUsers → updateUserById \| createUser + profiles upsert | ✅ | `create-culqi-test-user.ts:70-106` |
| 4.3 package.json script | ✅ | `package.json:27` `culqi:create-test-user` |
| 5.1 README ops checklist + creds warning | ✅ | `README.md:130-156` |

## SPEC_COMPLIANCE

### email-password-login spec (PR 2 requirements)

| Req | Requirement | Evidence | Status |
|-----|-------------|----------|--------|
| r7 | Script creates user via `auth.admin.createUser` with `email_confirm: true` AND inserts profiles row with `providerId: 'email'` | `create-culqi-test-user.ts:96-100` (createUser + `email_confirm: true`), `:87-92`/`:102-106` (profiles insert `providerId: 'email'`, `onConflictDoUpdate`/`onConflictDoNothing`); admin client `persistSession/autoRefreshToken/detectSessionInUrl: false` (`:63-65`) matching `ticketActions.ts:48-52`; column names verified against `src/core/database/schema/profiles.ts` (id/email/fullName/providerId) | ✅ PASS (static; ops script, no unit test by design) |
| r8 | Idempotent or clear error on existing user | `:70-79` `listUsers({ page: 1, perPage: 1000 })` case-insensitive email filter → exists: `updateUserById(id, { password, email_confirm: true })` + profile upsert "Usuario actualizado"; else create "Usuario creado". Re-run converges (self-heals password drift); duplicate-email createUser would fail with a clear Supabase error → graceful catch `:111-115` | ✅ PASS (static) |
| r9 | Credentials via CLI args or env, never hardcoded | `:40-46` env `CULQI_TEST_EMAIL`/`CULQI_TEST_PASSWORD` + `--email=`/`--password=` CLI override; grep confirmed zero credential literals in script and README (only placeholder `usuario@ejemplo.com` / `'...'`) | ✅ PASS (static + grep) |

### auth-consent spec (r5/r6 — via e2e smoke + PR 1 unit tests)

| Req | Requirement | Evidence | Status |
|-----|-------------|----------|--------|
| r5 | Email/password submit gated by consent | E2E `auth.spec.ts:32-38` — `md-filled-button[type="submit"]` has `disabled` attribute, removed after checking consent; passed at runtime | ✅ PASS |
| r6 | Consent persists across form errors | PR 1 unit coverage (`AuthPage.test.tsx:153-165`, per PR 1 report); consent state untouched by submit/error by construction | ✅ PASS (PR 1) |

## ADVERSARIAL_FINDINGS

### CRITICAL
- **None found.** Script never logs password/keys/tokens (only user ids, email, status lines); service-role key read from env only; graceful exits; imports use `../src/` (tsx-safe, not stale `./src/`); profiles columns match schema exactly; upsert handles all three profile edge cases (missing row, existing row, different providerId → overwritten to `'email'`).

### WARNING
1. **`pnpm type-check` does not cover `scripts/`** — `tsconfig.json` include omits `scripts/**/*` (confirmed via `tsc --listFilesOnly`: zero scripts files in compilation). Task 4.3's "verified via type-check" is therefore hollow for the script; its correctness rests on tsx runtime execution (validated: 3 failure paths exit 1 with clear messages) + static review. Fix: add a `tsconfig.scripts.json` (extending base, include `scripts/**/*`) and run it in the script task; do NOT add `scripts/**` to the main tsconfig — it would surface pre-existing errors in stale `./src`-importing scripts.
2. **Edge: user exists but target email beyond `perPage: 1000`** — `listUsers` only scans page 1. If the target is beyond the first 1000 auth users, the script attempts `createUser`, Supabase rejects the duplicate email, and the script reports a raw "user already exists" error instead of the friendly update path. Acceptable for this project's user base; fix if the tenant ever exceeds 1000 auth users (loop pages or use a dedicated lookup).

### SUGGESTION
3. **`tsx` is not a declared devDependency** — `pnpm culqi:create-test-user` works because tsx resolves as an optional peer of vitest (lock `vitest@4.1.9` peer `tsx: ^4.8.1`, resolved 4.22.4). Convention-consistent but fragile; declare `"tsx"` in devDependencies.
4. **CLI `--password=` leaks into shell history / process list** — README already presents env vars as the primary path; consider recommending env-only for the Culqi review.
5. **dotenv double-load** — tsx v4 auto-injects `.env` files (built-in) in addition to the explicit `dotenv.config({ path: ['.env.local', '.env'] })`; precedence behavior confirmed consistent (`.env.local` wins) but the double-load is redundant noise.

### Assertion quality audit (e2e smoke)
- No tautologies, ghost loops, or smoke-only assertions. `toBeVisible()` calls are preconditions; the behavioral assertions are the `disabled` attribute before/after consent. MD3 custom elements lack a `disabled` IDL property, so `toHaveAttribute` (not `toBeDisabled`) is the correct assertion — documented in the test comment. Selectors (`md-outlined-text-field[type=email]`, `md-filled-button[type=submit]`, `getByLabel('Accept terms and conditions')`) all match the rendered tree (verified against `TextField.tsx:73`, `Button.tsx:64`, `ConsentCheckbox.tsx:26`) and passed at runtime.

## TEST_RESULTS

| Check | Command | Result |
|-------|---------|--------|
| Unit | `pnpm test:unit` | **793 total / 788 passed / 5 failed** — exactly the expected pre-existing set (`settingsActions.test.ts`, PostHog env). **No new failures.** |
| E2E | `pnpm test:e2e` | **7/7 passed** (auth 4 + home 1 + seo 2) — includes the new smoke test `auth.spec.ts:22`; dev server auto-booted by Playwright |
| Type-check | `pnpm type-check` | 0 errors (repo scope) — **scripts/ NOT included** (see WARNING 1) |
| Lint | `pnpm lint` | 725 problems: 1 pre-existing error (gitignored `send-test-email.ts`), 724 warnings; changed lintable file `auth.spec.ts` clean (eslint direct run); `scripts/**` globally eslint-ignored (`eslint.config.mjs:45`, repo convention) |
| Coverage | — | Skipped for PR 2: changed files are e2e/ops/docs by design (vitest coverage not applicable to the script or Playwright spec) |

## SCRIPT_SAFETY

Validated by executing the safe failure paths (never touched real Supabase/DB):
1. **No creds** → `❌ Faltan credenciales...` + exit 1 ✅
2. **Invalid email** (`--email=invalid-email`) → `❌ Email invalido...` + exit 1 ✅
3. **Fake infra** (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9`, fake key, fake `DATABASE_URL`, CLI creds) → env checks pass, admin client constructs, `listUsers` fetch fails → `❌ Error: fetch failed` + exit 1 (graceful catch) ✅
Happy path (create/update branches) reviewed statically only — not run against real Supabase per instructions. Script is idempotent and self-healing, so the reviewer's first real run is safe to repeat.

## PR_READINESS

**Approve PR 2** (`fb2619c` + `26210e3` + `7fe7be9`, diff `ca43e92...feat/culqi-email-password-auth` = 4 files, 170 insertions, 0 deletions — well within the 400-line budget). All slice requirements met, e2e passes at runtime, script failure paths graceful, no security defects, no hardcoded credentials. Before merge: (a) note the tsconfig `scripts/` coverage gap for follow-up, (b) PR 1 (#83) must merge first (stacked-to-main) so the PR 2 diff stays clean.

## Risks

- Low: real provisioning happy path untested against live Supabase (requires real env creds) — manual reviewer step; idempotent + self-healing makes a failed first run safe.
- Low: >1000-auth-user pagination edge degrades to a raw "already exists" error (clear, but less friendly).
- Process: apply-progress persisted in **engram** (`sdd/culqi-validation-email-password-auth/apply-progress`, observation #501) with full TDD Cycle Evidence table — archive phase must read it there; the openspec dir is gitignored in this repo.

## skill_resolution

`paths-injected` — loaded `sdd-verify/SKILL.md` + `strict-tdd-verify.md` (Strict TDD active) from the injected path.

---

# DELTA VERIFICATION — commit `25ff9dd` (Phase 6: discreet toggle)

Re-verified 2026-08-19 after `feat(auth): hide email/password form behind discreet toggle` landed on top of `7fe7be9` (PR #84 diff now includes it).

## Delta verdict

**PASS WITH WARNINGS** — toggle commit is safe to push to PR #84. No CRITICAL. All pre-toggle spec requirements still hold when the form is expanded; Google flow byte-identical; toggle is a real `<button>` with correct `aria-expanded`/`aria-controls` wiring; conditional render removes hidden fields from the tab order (no tab stops on collapsed form). One non-blocking WARNING: a single full unit run showed 2 extra failures beyond the pre-existing 5 (789/7) that did NOT reproduce in 3 subsequent runs (stable at 791/5) — flake unrelated to the delta (AuthPage passed 11/11 in every run).

## SPEC_COMPLIANCE (delta)

| Requirement | Evidence | Status |
|-------------|----------|--------|
| email-password-login.r2 — inline error, stay on `/auth` | `AuthPage.test.tsx:229-239` ("shows an inline error and stays on /auth") — passed | ✅ PASS |
| email-password-login.r3 — email + password `type="password"`, no signup/reset links when form rendered | `AuthPage.test.tsx:156-171` (toggle expanded first) — passed | ✅ PASS |
| email-password-login.r6 — double-submit guard | `AuthPage.test.tsx:254-276` (loading disables submit; 1 call) — passed | ✅ PASS |
| auth-consent.r5 — submit disabled until consent | `AuthPage.test.tsx:186-196` + e2e `auth.spec.ts:42-48` (disabled → enabled after consent) — passed | ✅ PASS |
| auth-consent.r6 — consent persists across errors | `AuthPage.test.tsx:241-251` — passed | ✅ PASS |
| Google flow untouched (email-password-login.r5 regression) | Diff `7fe7be9...25ff9dd` touches only `page.tsx` (below Google button), `page.module.css`, `AuthPage.test.tsx`, `auth.spec.ts`; `signInWithGoogle`/`handleGoogleSignIn`/`ConsentCheckbox` zero diff | ✅ PASS |
| Toggle is a real `<button type="button">` with `aria-expanded` + `aria-controls="password-sign-in"`; container carries the id | `page.tsx:187-198`; asserted `AuthPage.test.tsx:120-124` | ✅ PASS |
| Hidden semantics — conditional render, no tab stops on hidden fields | `page.tsx:197-236` (`{showPasswordForm ? ... : null}`); asserted `AuthPage.test.tsx:109-125` (fields/form/divider absent from DOM) | ✅ PASS |

## ADVERSARIAL_FINDINGS (delta)

### CRITICAL
- **None found.**

### WARNING
1. **Flaky full unit run (1 of 4)**: run 1 `789 passed / 7 failed`; runs 2-4 `791 passed / 5 failed` (exactly the documented pre-existing `settingsActions.test.ts` PostHog-env set). The 2 extra failures did not reproduce in 3 consecutive runs; AuthPage passed 11/11 in all runs and the delta only modified `AuthPage.test.tsx` + the page/CSS/e2e. Not attributable to this commit — flag for separate flake investigation (suspects: timing/env-sensitive test elsewhere in the 77-file suite).

### SUGGESTION
2. **Dangling `aria-controls` IDREF when collapsed** — `password-sign-in` div is conditionally removed from the DOM, so `aria-controls` references a non-existent id while collapsed (`aria-expanded="false"` mitigates; SRs announce state correctly). Alternative per WAI-ARIA disclosure pattern: keep the container mounted with `hidden`. Acceptable given the deliberate conditional-render decision (strongest hidden semantics); note only.
3. **No explicit `:focus-visible` on `.toggleLink`** — default UA focus ring applies (verified: no global `outline: none` button reset in `globals.css`/`buttons.css`), so WCAG 2.4.7 is satisfied; a styled ring matching the `#135bec` hover would be design-consistent.
4. **Expanded label not asserted** — the expand test checks `aria-expanded="true"` but not the label switch to `'Ocultar'` (only the collapsed `'¿Acceso con correo electrónico?'` text is asserted at `AuthPage.test.tsx:124`). Add `toHaveTextContent(/ocultar/i)` to the expand test.
5. **Form state persists across collapse/expand** — `email`/`password`/`passwordError` are not reset when the form collapses; consistent with R6 consent persistence, likely intentional, but a one-line comment would remove doubt.

### Assertion quality audit (delta)
- ✅ All new assertions verify real behavior (DOM absence/presence, `type="password"`, `aria-*` values, disabled toggle). No tautologies, no ghost loops, no smoke-only assertions. Type-only `not.toBeNull()` at `AuthPage.test.tsx:121` is combined with value assertions in the same test. Mock/assertion ratio healthy (2 mocks / ~35 expects).
- E2E locator change (`md-filled-button[type="submit"]` → `getByRole('button', { name: 'Iniciar sesión' })`) is stable: `'Iniciar sesión'` appears once on `/auth` (Google button is `'Continuar con Google'`, toggle is `'¿Acceso con correo electrónico?'`/`'Ocultar'`); other matches (`LandingNav.tsx:85,95`, `TeamManagementPanel.tsx:432`) are on different pages. The React 19 custom-element property claim in the test comment was empirically confirmed by the apply-phase DOM probe (host `outerHTML` had no `type` attribute).

## TDD COMPLIANCE (Strict TDD — Phase 6 rows of apply-progress #501)

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | apply-progress #501 Phase 6 rows 6.1-6.4 |
| All tasks have tests | ✅ | 6.1/6.2 unit + 6.4 e2e; 6.3 CSS (by design) |
| RED confirmed (tests exist) | ✅ | `AuthPage.test.tsx` 3 new toggle tests exist; 6.1 reported 10 failed → green |
| GREEN confirmed (tests pass) | ✅ | AuthPage 11/11 executed (isolated ×2 + 4 full runs); e2e 7/7 executed |
| Triangulation adequate | ✅ | 3 states (closed → open → re-closed) + all prior behaviors re-asserted (consent, error, double-submit, R6) |
| Safety Net for modified files | ✅ | baseline 8/8 (AuthPage) before toggle changes |

**TDD Compliance**: 6/6 checks passed.

## TEST_RESULTS (delta run)

| Check | Command | Result |
|-------|---------|--------|
| Unit (full) | `pnpm test:unit` ×4 | **791 passed / 5 failed** (3 of 4 runs) — exact pre-existing set (`settingsActions.test.ts`, PostHog env). Run 1: 789/7 (flake, see WARNING 1) |
| Unit (AuthPage) | `pnpm vitest run tests/unit/AuthPage.test.tsx` | **11/11 passed** (was 8; +3 toggle tests) |
| E2E | `pnpm test:e2e` | **7/7 passed** (auth 4 + home 1 + seo 2) — toggle-aware smoke included |
| Type-check | `pnpm type-check` | **0 errors** |
| Lint | `pnpm lint` | 725 problems: 1 pre-existing error (`app/auth/send-test-email.ts`, `unicorn/filename-case`) + 724 warnings; **changed files clean** (no output for `page.tsx`/`AuthPage.test.tsx`/`auth.spec.ts`) |
| Coverage (changed file) | `AuthPage.test.tsx --coverage` | `app/auth/page.tsx`: 77.14% stmts / **100% branches** / 87.5% funcs / 75.75% lines; uncovered `33-38` (Google catch) + `56-58` (password catch) — **pre-existing error branches, not toggle logic** (toggle branches 100% covered) |

## Test layer distribution (delta)

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 16 (AuthPage 11 + AuthProvider 5) | 2 | vitest + testing-library |
| Integration | — (AuthPage tests classify as unit per repo convention) | — | — |
| E2E | 4 (incl. toggle smoke) | 1 | Playwright |
| **Total (delta)** | **20** | **3** | |

## PR_READINESS (delta)

**Approve push to PR #84** — `25ff9dd` (4 files, +163/−37, ~163 lines) keeps the total PR 2 chain well within budget. All delta behaviors verified at runtime (unit + e2e); spec regressions none; a11y wiring correct; type-check/lint clean on changed files. Non-blocking follow-ups: investigate the once-seen flake (WARNING 1) and apply SUGGESTIONs 2-5 at leisure.

## Risks (delta)

- Low: flaky full-suite run observed once (2 extra failures) — monitor; if it recurs, isolate the failing file before merge.
- Low: `aria-controls` IDREF dangling while collapsed — negligible AT impact (state conveyed by `aria-expanded`).
- Process: openspec dir is gitignored; this delta section is also persisted to engram (`sdd/culqi-validation-email-password-auth/verify-report`, topic upsert).

## skill_resolution (delta)

`paths-injected` — loaded `sdd-verify/SKILL.md` + `strict-tdd-verify.md` from the injected path; TDD evidence cross-referenced against apply-progress observation #501.