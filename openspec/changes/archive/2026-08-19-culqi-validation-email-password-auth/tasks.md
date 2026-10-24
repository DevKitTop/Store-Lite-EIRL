# Tasks: Email+Password Login for Culqi Validation Account

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~540 (code + tests + docs) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: provider + form + unit tests → PR 2: e2e smoke + script + README |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | `signInWithEmail` + auth-page form + unit tests | PR 1 | Base: `main`. ~380 lines; tests before impl (TDD). |
| 2 | E2E smoke + provisioning script + npm script + README | PR 2 | Base: `main`. Needs PR 1 form to render; script is independent. |

## Phase 1: Auth Provider Method (Foundation)

- [x] 1.1 RED: Write `tests/unit/AuthProvider.test.tsx` — mock `@/lib/supabase/client` (pattern `Checkout.test.tsx:28-35`) + `next/navigation`; success → `{ error: undefined }` + `router.push('/onboarding')` (email-password-login.r1); wrong creds → es-PE "Correo o contraseña incorrectos." + no push (email-password-login.r2); `email_not_confirmed` → confirm-email message; unknown email → inline error, no nav (email-password-login.r2)
- [x] 1.2 GREEN: Add `signInWithEmail: (email, password) => Promise<{ error?: string }>` to `AuthContextType` in `src/types/auth.ts`; implement in `src/features/auth/index.tsx` via `signInWithPassword`, `error.code` → es-PE map with fallback, `useRouter()` + `push('/onboarding')` only on success; add `useAuth` fallback
- [x] 1.3 REFACTOR: `pnpm test:unit` green; confirm Google `signInWithGoogle` path untouched (email-password-login.r5)

## Phase 2: Auth Page Password Form (Core)

- [x] 2.1 RED: Write `tests/unit/AuthPage.test.tsx` — mock `useAuth` + router; submit disabled until consent (auth-consent.r5, email-password-login.r4), enabled after check + calls `signInWithEmail`, success → push (email-password-login.r1), failure → inline error + URL stays `/auth` (email-password-login.r2/r3), no double submit (email-password-login.r6), consent persists after error (auth-consent.r6), no signup/reset links (email-password-login.r3)
- [x] 2.2 GREEN: Add password form below divider in `app/auth/page.tsx` — MD3 `TextField` email + password (`type="password"`), submit `disabled={isLoading || !consented}`, inline error `role="alert"` (email-password-login.r2)
- [x] 2.3 Add `.passwordForm` + `.errorText` to `app/auth/page.module.css`; run `pnpm test:unit` GREEN
- [x] 2.4 Phase 2 follow-up (visual bug fix, commit `ca43e92`): force global `dark` MD3 token class on the /auth root container (`app/auth/page.tsx`) so MD3 fields/buttons inherit dark tokens in light OS theme; add `.passwordForm md-filled-button[disabled]` overrides using the installed @material/web `-disabled-*` token variants + opacity overrides so the disabled submit button stays visible on the dark card (`app/auth/page.module.css`); regression guard test asserting the root container carries the `dark` class (`tests/unit/AuthPage.test.tsx`)

## Phase 3: E2E Smoke Test

- [x] 3.1 Extend `tests/e2e/auth.spec.ts` — form renders (email, password, submit); submit disabled until consent (auth-consent.r5); no real-credential login (needs provisioning)

## Phase 4: Provisioning Script (Ops)

- [x] 4.1 Create `scripts/create-culqi-test-user.ts` — tsx header convention, `dotenv` (`.env.local` → `.env`), admin client per `ticketActions.ts:48-52`, creds from `CULQI_TEST_EMAIL`/`CULQI_TEST_PASSWORD` or `--email=`/`--password=` (email-password-login.r8, no hardcoded creds)
- [x] 4.2 Idempotency: `admin.listUsers({ page: 1, perPage: 1000 })` filter by email → exists: `updateUserById` + profile upsert, report "updated" | else `createUser({ ..., email_confirm: true })` + insert, report "created" (email-password-login.r7); profiles insert `id`, `email`, `fullName` (NOT NULL), `providerId: 'email'` via Drizzle `onConflictDoNothing`/`DoUpdate`; use `../src/` imports (tsx ignores `@/` aliases)
- [x] 4.3 Add `"culqi:create-test-user": "tsx scripts/create-culqi-test-user.ts"` to `package.json`; verify via `pnpm type-check` + manual run against dev (no unit tests per design — validate via type-check/manual)

## Phase 5: Documentation

- [x] 5.1 README: reviewer credentials note — provision via `pnpm culqi:create-test-user`, env/CLI creds never committed, ops checklist (`CULQI_ENFORCE_LIVE_KEYS=true`, live keys, demo product)

## Summary

| Task | Deps | Est. Lines | TDD |
|------|------|-----------|-----|
| Phase 1 (provider method + tests) | — | 165 | ✅ RED-GREEN-REFACTOR |
| Phase 2 (form + tests) | Phase 1 | 215 | ✅ |
| Phase 3 (e2e smoke) | Phase 2 | 20 | — |
| Phase 4 (script + npm) | — | 131 | — |
| Phase 5 (README) | Phase 4 | 10 | — |
| **Total** | | **~541** | |
