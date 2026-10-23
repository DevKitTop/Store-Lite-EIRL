# Archive Report — culqi-validation-email-password-auth

**Change**: culqi-validation-email-password-auth
**Status**: ✅ ARCHIVED
**Archived on**: 2026-08-19
**Archived to**: `openspec/changes/archive/2026-08-19-culqi-validation-email-password-auth/`
**Artifact store mode**: openspec (archive report also persisted to Engram: `sdd/culqi-validation-email-password-auth/archive-report`, project `store-lite-eirl`)

## Verification Gate

| Check | Result |
|-------|--------|
| Verify report verdict (PR 1) | PASS WITH WARNINGS (no CRITICAL) |
| Verify report verdict (PR 2) | PASS WITH WARNINGS (no CRITICAL) |
| Delta verify (toggle `25ff9dd`) | PASS WITH WARNINGS (no CRITICAL) |
| Tasks complete | 9/9 (Phases 1–5 + follow-up 2.4 + Phase 6 toggle) |
| Unit tests | 791/796 pass — only pre-existing `settingsActions.test.ts` failures (PostHog env, unrelated) |
| E2E smoke | 7/7 pass |
| Type-check | 0 errors |
| CRITICAL issues blocking archive | None |

Archive gate passed — no CRITICAL issues present in any of the three verify reports.

## Specs Synced to Source of Truth

| Domain | Action | Main spec |
|--------|--------|-----------|
| `auth-consent` | Updated (delta R5/R6) | `openspec/specs/auth-consent/spec.md` — Purpose extended to cover email/password gating; **+2 requirements** (R5 Email/Password Submit Gating, R6 Consent Persists Across Form Errors) and +4 scenarios appended; R1–R4 preserved untouched |
| `email-password-login` | Created (new domain, no existing main spec) | `openspec/specs/email-password-login/spec.md` — copied verbatim from the delta (8 requirements, 14 scenarios) |

Verified: main `auth-consent` spec retains all pre-existing requirements (R1–R4); delta merge appended only R5/R6 and updated the Purpose. `email-password-login` main spec is byte-identical to the archived delta.

## Archive Contents

- `proposal.md` ✅
- `specs/auth-consent/spec.md` ✅ (delta)
- `specs/email-password-login/spec.md` ✅ (delta)
- `design.md` ✅
- `tasks.md` ✅ (9/9 tasks complete)
- `verify-report.md` ✅ (PR 1)
- `verify-report-pr2.md` ✅ (PR 2 + delta verification for toggle)
- `archive-report.md` ✅ (this file)

## Delivery Summary

- **Branches**: `feat/culqi-email-password-auth` (stacked-to-main)
- **PR #83 (slice 1)**: provider method + auth-page form + unit tests — commits `24fc7d0`, `8f418de`, `ca43e92` — merged to main at `8e907ad`
- **PR #84 (slice 2)**: e2e smoke + provisioning script + README — commits `fb2619c`, `26210e3`, `7fe7be9` + follow-up toggle `25ff9dd` — merged to main at `2305599`
- **Deployment**: production build passed via Vercel; both PRs deployed
- **Test account provisioned**: `validacion.culqi@devkittop.com` (id `ee25b901-4ee5-4402-bcf6-510f3aacb4f0`) via `pnpm culqi:create-test-user`

## Deployment / Ops Follow-Ups

1. **Culqi review ops checklist** (non-code, from `design.md` / README): `CULQI_ENFORCE_LIVE_KEYS=true` in prod, live keys on the test business, one demo product. Deploy-time config, not code.
2. **Declare `tsx` as a devDependency** — currently resolves as an optional peer of vitest; convention-consistent but fragile (verify-report-pr2 WARNING 3).
3. **`tsconfig.json` omits `scripts/**`** — the provisioning script is not type-checked by `pnpm type-check`; a `tsconfig.scripts.json` would close the gap (verify-report-pr2 WARNING 1). Do NOT add `scripts/**` to the main tsconfig (surfaces pre-existing errors in stale `./src`-importing scripts).
4. **>1000-auth-user pagination edge** — script scans only page 1 of `listUsers`; degrades to a raw "user already exists" error beyond that (acceptable for current user base).
5. **Flaky full-suite run observed once** (2 extra failures in 1 of 4 runs, not reproducible, AuthPage 11/11 in all runs) — monitor; likely timing/env-sensitive elsewhere in the 77-file suite.
6. **Optional polish (suggestions)**: `autocomplete="email"`/`current-password` attrs, `isLoading` reset on success path, styled `:focus-visible` on `.toggleLink`, expanded-label assertion, comment on form-state persistence across collapse/expand.
7. **Out of scope (flagged)**: `syncUserProfile` hardcodes `provider_id: 'google'` in `app/auth/callback/route.ts` — password logins bypass the callback entirely (script inserts the profile), so this is safe today, but a future auth-surface change should revisit it.

## Rollback Path

Per proposal: remove the form block from `app/auth/page.tsx` + the `signInWithEmail` method (Google login untouched), delete the provisioning script (idempotent; safe to re-run or remove), delete the test user via Supabase dashboard if needed. Archive is an audit trail — contents are read-only.

## Traceability

- **Apply-progress (Engram)**: observation #501 — `sdd/culqi-validation-email-password-auth/apply-progress` (full TDD Cycle Evidence table for all 9 tasks, PR 1 + PR 2 + Phase 6 toggle)
- **Verify reports (Engram)**: topic_key `sdd/culqi-validation-email-password-auth/verify-report` (upsert, includes delta section)
- **Archive report (Engram)**: topic_key `sdd/culqi-validation-email-password-auth/archive-report`, project `store-lite-eirl`
