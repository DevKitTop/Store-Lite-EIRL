# Design: Email+Password Login for Culqi Validation Account

## Technical Approach

Add `signInWithEmail` to `AuthProvider`: client-side `signInWithPassword`, es-PE error mapping, explicit `router.push('/onboarding')` on success (spec binds navigation to the method). Add a login-only password form below the Google button on `app/auth/page.tsx`, reusing MD3 `TextField`/`Button` and the existing `ConsentCheckbox` gating (disabled submit, matching Google). Provision the test user via a service-role script (`auth.admin.createUser` + Drizzle `profiles` insert, `provider_id: 'email'`). Profile sync needs no new code: the script inserts the row, `fetchProfile` already tolerates a missing profile (PGRST116 → `profile: undefined`, `index.tsx:102-108`), and server actions auto-create profiles (`getAuthenticatedUserId`, `ticketActions.ts:15-46`). A client-side sync would need a new API route carrying a service-role key — out of scope.

## Architecture Decisions

### Decision: `signInWithEmail` signature

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Throw-on-error (Google pattern, `index.tsx:218-231`) | Page needs try/catch; spec wants inline error | ❌ |
| Return `Promise<{ error?: string }>` | Form-friendly; matches action-result patterns | ✅ |

Mapping by `error.code` (message fallback): `invalid_credentials` → "Correo o contraseña incorrectos."; `email_not_confirmed` → "Debes confirmar tu correo electrónico antes de iniciar sesión." (defensive — script sets `email_confirm: true`); default → "No se pudo iniciar sesión. Inténtalo de nuevo." `useRouter()` added inside `AuthProvider` (root layout, in-router — valid); `router.push('/onboarding')` only on success.

### Decision: Profile sync after password login

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Client-side on-demand sync (new API route) | New surface; service-role never in browser | ❌ |
| Script insert + tolerant `fetchProfile` + existing server auto-create | Zero new code; covers all paths | ✅ |

Script insert is sufficient: `fetchProfile` treats missing profile as non-error; business ops auto-create server-side; only the OAuth callback hardcodes `provider_id: 'google'` (flagged, out of scope).

### Decision: Consent gating

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Hide form until consent | Contradicts spec scenario ("button has the `disabled` attribute") | ❌ |
| Visible form, disabled submit | Mirrors Google `disabled={!consented || isLoading}` (`page.tsx:125`) | ✅ |

Note: `ConsentCheckbox` already renders working `<Link>`s (R2) and supports `storeName` (R3); footer/legal pages belong to the sibling change. This change adds only R5/R6.

### Decision: Form placement and CSS

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Above Google button | Displaces primary CTA | ❌ |
| Below existing divider (`page.tsx:154-158`) | Secondary method, minimal diff | ✅ |

New CSS only in `page.module.css`: `.passwordForm` (flex column, `gap: 1rem`), `.errorText` (`role="alert"`). MD3 dark tokens already ship (`dark-mc.css`, `dark-hc.css`), so `md-outlined-text-field`/`md-filled-button` render dark-appropriate; tweak tokens only if contrast fails on `#080c14`.

### Decision: Provisioning script

| Option | Tradeoff | Decision |
|--------|----------|----------|
| ts-node / raw SQL | Repo runs `scripts/*.ts` via `npx tsx` (header convention) | ❌ |
| `tsx` + npm script | Matches convention; `pnpm culqi:create-test-user` | ✅ |

- **Credentials**: env `CULQI_TEST_EMAIL` / `CULQI_TEST_PASSWORD`, optional `--email=` / `--password=` CLI override (hand-parsed). Never hardcoded. `dotenv` loads `.env.local` first, then `.env` (Next precedence).
- **Admin client**: copy `createAdminClient()` from `ticketActions.ts:48-52` / `uploads.ts:10-18` (`persistSession/autoRefreshToken/detectSessionInUrl: false`).
- **Idempotency**: `admin.listUsers({ page: 1, perPage: 1000 })` filtered by email (version-safe — `getUserByEmail` is not in the documented `GoTrueAdminApi` surface). Exists → `updateUserById(id, { password, email_confirm: true })` + profile upsert, report "updated"; else `createUser({ email, password, email_confirm: true })` + insert, report "created". Re-run converges (self-heals password drift).
- **Profiles insert** (columns verified in `schema/profiles.ts`): `id`, `email`, `fullName` (NOT NULL — email local-part or "Culqi Test User"), `providerId: 'email'`. Via Drizzle with `onConflictDoNothing`/`onConflictDoUpdate`.
- **Gotcha**: existing scripts import `./src/...` (resolves to nonexistent `scripts/src`) — stale. New script uses `../src/...` (tsx does not resolve `@/` aliases).

### Decision: Double-submit guard

Reuse `isLoading`; submit `disabled={isLoading || !consented}`. Consent lives in page state, untouched by submit/error — R6 holds by construction.

## Data Flow

```
Form ─submit─▶ signInWithEmail ─ success ─▶ router.push('/onboarding')
                     └─ error ─▶ { error } ─▶ inline alert (stay on /auth)
Script: env creds ─▶ admin.listUsers ─(exists?)─▶ updateUserById | createUser
                     └▶ db.insert(profiles) ─▶ sign-in works at /auth
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/types/auth.ts` | Modify | Add `signInWithEmail` to `AuthContextType` |
| `src/features/auth/index.tsx` | Modify | Method + `useRouter`; `useAuth` fallback |
| `app/auth/page.tsx` | Modify | Password form below divider + inline error |
| `app/auth/page.module.css` | Modify | `.passwordForm`, `.errorText` |
| `scripts/create-culqi-test-user.ts` | Create | Service-role provisioning |
| `package.json` | Modify | `"culqi:create-test-user": "tsx scripts/create-culqi-test-user.ts"` |
| `README.md` | Modify | Reviewer credentials handling note |
| `tests/unit/AuthPage.test.tsx` | Create | Form tests |
| `tests/unit/AuthProvider.test.tsx` | Create | Provider method tests |
| `tests/e2e/auth.spec.ts` | Modify | Smoke test (renders, disabled until consent) |

## Interfaces / Contracts

```ts
signInWithEmail: (email: string, password: string) => Promise<{ error?: string }>; // AuthContextType
pnpm culqi:create-test-user --email=culqi-validation@store-lite.com --password='...'
# or CULQI_TEST_EMAIL / CULQI_TEST_PASSWORD env vars
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | Provider method | `AuthProvider` + probe consumer; mock `@/lib/supabase/client` per `Checkout.test.tsx:28-35` and `next/navigation`. Success → no error + push; wrong creds → es-PE error, no push; missing profile tolerated |
| Unit | Auth page form | Mock `useAuth` + router. Disabled without consent; enabled after; success → push; failure → inline error, URL stays; no double submit; consent persists after error (R6) |
| E2E | Smoke | `tests/e2e/auth.spec.ts`: form renders, disabled until consent. Real-credential login omitted (needs provisioning) |

## Migration / Rollout

No migration. Rollback per proposal (remove form + method, delete script, delete user via dashboard).

**Ops checklist (non-code, for apply's human)**: before Culqi review — `CULQI_ENFORCE_LIVE_KEYS=true` in prod, live keys on the test business, one demo product. Deployment config, not code.

## Open Questions

- None blocking. Apply-phase check: MD3 token contrast on the dark card; visual acceptance of divider placement.