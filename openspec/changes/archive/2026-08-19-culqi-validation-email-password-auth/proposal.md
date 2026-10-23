# Proposal: Email+password login for Culqi validation account

## Intent

Culqi requires a test account (email+password) to validate the production checkout before approving live keys — a hard requirement with a 12-hour response deadline. The app currently supports only Google OAuth. This change adds email+password login as a first-class auth method (login-only, no public signup) so we can provision an isolated Culqi validation account and complete the review.

## Scope

### In Scope
- `signInWithEmail` method + types in AuthProvider (`src/features/auth/index.tsx`)
- Password form on `app/auth/page.tsx` reusing MD3 `TextField` + `ConsentCheckbox`
- Post-login navigation: explicit `router.push('/onboarding')` (no OAuth redirect)
- Test-account provisioning script in `scripts/` (service-role `auth.admin.createUser`, `email_confirm: true`, `profiles` insert)
- README note on reviewer credentials handling

### Out of Scope
- Public signup UI, password reset, email confirmation flows
- Google auth changes; storefront customer auth (`app/auth/customer`); chat auth
- `syncUserProfile` hardcoded `provider_id: 'google'` in `app/auth/callback/route.ts` (flagged, not fixed here)

## Capabilities

### New Capabilities
- `email-password-login`: Email+password sign-in — provider method, auth-page form, post-login navigation, admin provisioning of isolated test users

### Modified Capabilities
- `auth-consent`: consent checkbox gating extends from the Google OAuth button to the new email/password submit control (DL 1729 compliance)

## Approach

Login-only to avoid a signup spam surface. An admin script provisions the test user via the existing service-role pattern: `auth.admin.createUser` with `email_confirm: true`, plus a `profiles` insert — required because the OAuth callback that normally syncs profiles never runs for password login. The form calls `signInWithEmail`, then `router.push('/onboarding')`, mirroring callback behavior. Reuse MD3 `TextField`/`ConsentCheckbox` for visual consistency. Reviewer validation additionally needs `CULQI_ENFORCE_LIVE_KEYS=true` + live keys on the test business — an ops step, not code.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/features/auth/index.tsx` | Modified | Add `signInWithEmail` + types |
| `app/auth/page.tsx` | Modified | Password form below Google button |
| `scripts/create-culqi-test-user.ts` | New | Service-role user + profile provisioning |
| `README.md` | Modified | Reviewer credentials handling |
| `app/auth/callback/route.ts` | Unchanged | `provider_id: 'google'` noted, out of scope |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Email confirmation default blocks login | High | `email_confirm: true` in script |
| Profile missing for password logins | Med | Script inserts `profiles` row |
| Visual mismatch on auth page | Med | Reuse MD3 TextField/ConsentCheckbox |
| Abuse surface | Low | Login-only; no signup in scope |
| Live-keys ops dependency | Med | Documented; ops step, not code |

## Rollback Plan

1. Remove the form block from `app/auth/page.tsx` and the `signInWithEmail` method — Google login untouched
2. Delete the provisioning script (idempotent create; safe to re-run or remove)
3. Delete the test user via Supabase dashboard if needed

## Dependencies

- Supabase service-role access (existing pattern)
- `CULQI_ENFORCE_LIVE_KEYS=true` + live keys on test business (ops)

## Success Criteria

- [ ] Test user created via script signs in with email+password at `/auth`
- [ ] Google login still works
- [ ] Password login lands on `/onboarding`
- [ ] No public signup endpoint exposed
- [ ] New unit tests for form + provider method pass; `pnpm test:unit` green