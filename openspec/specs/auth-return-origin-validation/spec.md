# Auth Return Origin Validation Specification

> **Archived state — 2026-09-28 (batch 2), updated 2026-09-30 (`access-hardening-followups`).**
> Promoted from `openspec/changes/access-hardening-batch2/` at SDD archive. This file describes what
> actually SHIPPED (tracker `feat/access-hardening-batch2` @ `9559f3a`, slice 3 = `9559f3a`, PR #199),
> then **extended by R4** from `openspec/changes/access-hardening-followups/` (slice A, commits
> `a861b25`, branch `feat/access-hardening-followups-a` @ `52b02bb`, PR #201 — **open, unmerged**).
>
> Reconciliations applied in the **2026-09-28** pass, marked inline: the corrected rationale for
> hostile schemes in R1, the un-normalized `authOrigin` comparison in R1, and the unguarded `window`
> read in R1.
>
> Reconciliations applied in the **2026-09-30** pass: R4 was added (the `env.authOrigin` clause is now
> compared as an origin), the two R1 archived-state notes that R4 supersedes are marked SUPERSEDED,
> and the "R2 and R3 have no runtime test" note is marked superseded by the T15 coverage closure.
> Read the archived `spec.md` for the full delta provenance.

## Purpose

`app/auth/customer/page.tsx` is the only `postMessage` emitter that posts `access_token` / `refresh_token`. It takes `targetOrigin` verbatim from the `origin` search param. `postMessage` accepts an arbitrary string, so a malicious opener can point the popup at itself and exfiltrate both tokens; receiver-side `event.origin` checks are irrelevant when the receiver IS the attacker. This spec adds a shared allowlist helper and applies it at all three emit sites. The production storefront and the auth popup share `https://storelite.app`, so the same-origin clause is load-bearing in production.

## Requirements

### Requirement: R1 — `isAllowedAuthReturnOrigin` allowlist

`src/shared/utils/url.ts` MUST export `isAllowedAuthReturnOrigin(origin: string): boolean`. It MUST parse with `new URL()` inside try/catch and deny any non-URL input, then allow exactly these cases:

| Input                                                                         | Result   | Rationale                                                                                     |
| ----------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `window.location.origin`                                                      | allow    | prod storefront and popup share `storelite.app`; also covers localhost dev                    |
| `env.authOrigin` (`NEXT_PUBLIC_AUTH_ORIGIN`, `https://storelite.app` in prod) | allow    | strict superset of same-origin; covers the central-auth split                                 |
| tenant host while `featureSubdomainRewrite` is off                            | **deny** | branch prepared but deliberately disabled                                                     |
| tenant host while `featureSubdomainRewrite` is on                             | allow    | unreachable today (flag defaults false)                                                       |
| any other absolute origin                                                     | deny     | attacker-controlled opener                                                                    |
| `javascript:`, `data:`                                                        | deny     | parses, but yields `origin: "null"` and an empty `hostname`, so it falls through every clause |
| relative, empty                                                               | deny     | not a parseable absolute URL — `new URL()` throws                                             |

`env.authOrigin` MUST be added to `src/config/env.ts` (it is today read inline via `process.env` in 5 components) with an empty default. An empty `authOrigin` MUST NOT widen the allowlist.

Archived-state note (reconciled at archive, 2026-09-28) — the table's original last row collapsed
four inputs under the rationale _"not a parseable absolute URL"_. That was **wrong for
`javascript:` and `data:`**, which do parse: `new URL('javascript:alert(1)').origin` is the string
`"null"` and `hostname` is `""`, so both are denied by the **fallthrough**, not by the `catch`. Only
`/relative` and `''` actually throw. The shipped outcome is identical either way — every row denies
— so this is a rationale fix, not a behaviour change. It matters because a reader who trusts the old
wording would assume the `try/catch` handles schemes and could weaken the real guards. The same
imprecision was in the source comment at `src/shared/utils/url.ts:222`.

**SUPERSEDED (2026-09-30, by R4).** The comment fix is **done** — the rationale now lives at
`src/shared/utils/url.ts:248-249` (the line moved from `:222` to `:248` when `normalizeOrigin` was
inserted above the helper) and states the correct mechanism: relative/empty input throws, while
`javascript:`/`data:` do parse and are denied by the final fallthrough. The wording is **Spanish**,
matching the file (its JSDoc blocks are entirely Spanish, at `:227-242`, `:88-94`, `:126-133`); the
change was comment-only and is not test-verified. The table's _rationale_ column above is still the
canonical statement of the truth table.

Archived-state note (reconciled at archive, 2026-09-28) — `env.authOrigin` is compared **raw**:
`src/shared/utils/url.ts:227` reads `if (parsed.origin === env.authOrigin) return true;` against a
**normalized** `parsed.origin`. A trailing slash, a path, an uppercase host, or an explicit port in
`NEXT_PUBLIC_AUTH_ORIGIN` silently makes the clause dead (verified in node:
`'https://storelite.app/' === new URL('https://storelite.app').origin` → `false`). This is **not a
production lockout today** because the same-origin clause is load-bearing and independently covers
the current path-based topology — but it is a fail-closed-by-silence risk for the central-auth split
that `authOrigin` exists to serve. Hardening: compare against `new URL(env.authOrigin).origin` when
non-empty, or state "no trailing slash" at `.env.example:71`. Folded into the rollout precondition.

**SUPERSEDED (2026-09-30) — FIXED by R4.** The raw comparison at the old `:227` is gone. The clause
now reads `const configuredOrigin = normalizeOrigin(env.authOrigin); if (configuredOrigin !== null &&
parsed.origin === configuredOrigin) return true;` (`url.ts:254-255`). The "no trailing slash" clause
at `.env.example:71` was **not** added and is no longer needed for correctness — only the
"must be a real origin" rollout precondition survives, since a non-origin value now fails closed.

Archived-state note (reconciled at archive, 2026-09-28) — the helper reads `window.location.origin`
**unguarded** (`url.ts:226`), inside the function body only, so importing the module from server
code is still safe. Calling it during SSR would throw `ReferenceError: window is not defined`. The
single call site is `app/auth/customer/page.tsx:45`, in the render body of a `'use client'`
component, and two independent layers keep that unreachable on the server: `next build` prerenders
`/auth/customer` as `○ (Static)`, and `CustomerAuthContent` sits under a `<Suspense>` boundary
(`page.tsx:377-388`) so Next bails it out of the prerender. The safety is therefore **load-bearing
on the route staying static** — adding `export const dynamic = 'force-dynamic'` to that page would
make this the first failure (it precedes the pre-existing `typeof window`-guarded `createClient()`
at `page.tsx:59`). Cheap hardening consistent with the same module's precedent at `url.ts:81`:
`if (typeof window === 'undefined') return false;`.

#### Scenario: Same-origin is allowed

- GIVEN the popup runs on `https://storelite.app` and `origin=https://storelite.app`
- WHEN the helper is evaluated
- THEN true

#### Scenario: Configured auth origin is allowed

- GIVEN `NEXT_PUBLIC_AUTH_ORIGIN=https://storelite.app`
- WHEN `origin=https://storelite.app` is evaluated
- THEN true

#### Scenario: Foreign origin is denied

- GIVEN `origin=https://evil.example`
- WHEN the helper is evaluated
- THEN false

#### Scenario: Non-URL schemes are denied

- GIVEN `origin` is `javascript:alert(1)`, `data:text/html,x`, `/relative` or empty
- WHEN the helper is evaluated
- THEN false in every case (parse failure ⇒ deny)

#### Scenario: Tenant host is denied while the flag is off

- GIVEN `featureSubdomainRewrite` is false and `origin=https://acme.storelite.app`
- WHEN the helper is evaluated
- THEN false

#### Scenario: Tenant host is allowed once the flag is on

- GIVEN `featureSubdomainRewrite` is stubbed true and `origin` is a valid tenant host
- WHEN the helper is evaluated
- THEN true

### Requirement: R2 — A denied origin emits nothing

When the origin is absent or denied, the popup MUST call `window.close()` and MUST NOT call `postMessage` at all — no `AUTH_SUCCESS` with tokens, no `AUTH_ERROR`. Deny MUST be the default outcome for any input not explicitly allowed.

Archived-state note (reconciled at archive, 2026-09-28): the deny branch ships in **all three**
paths — `app/auth/customer/page.tsx:66-70` (OAuth-callback effect), `:111-115` (session-check
effect), `:150-154` (`handleContinueWithCurrent`) — each doing
`console.error('[CustomerAuth] origin rejected:', storeOrigin)` + `window.close()` + `return`. In
the OAuth effect the deny sits **after** the pre-existing `!code || !slug || !storeOrigin` guard
(`:65`) and **before** `processedRef.current = true` (`:71`) and before `exchangeCodeForSession`
(`:77`), so a denied origin never has its authorization code exchanged. Fail-closed holds by
construction: the helper has exactly three `true` returns, all explicit (mutation: flipping
`catch { return false }` to `catch { return true }` is caught by a test). The third branch,
`handleContinueWithCurrent`, is unreachable in practice (the confirmation screen only renders when
the session effect already passed) and is kept as defence in depth.

The "exactly three `true` returns" count above still holds **after R4** (`url.ts:253-258`): the
`env.authOrigin` clause remains a single explicit `return true`, it merely gained a `null` guard and a
normalization call in front of it.

#### Scenario: Foreign origin leaks no token

- GIVEN a hostile opener sets `origin=https://evil.example` and completes the OAuth callback
- WHEN the popup resolves the return origin
- THEN the popup closes and `postMessage` is never called; no `access_token` or `refresh_token` is emitted

#### Scenario: Absent origin is denied

- GIVEN the `origin` search param is missing
- WHEN the popup resolves the return origin
- THEN it closes without emitting; this is already the popup's own pre-existing behavior for a missing origin

### Requirement: R3 — All three emit sites are covered

The validated origin MUST be resolved once per render and used as the `targetOrigin` of all three emitters: the `AUTH_ERROR` post, the OAuth-callback `AUTH_SUCCESS` post, and the continue-with-current `AUTH_SUCCESS` post. Receiver components (`ChatDialog`, `Checkout`, `LookupOrderModal`, `OrderAuthGate`) already gate on `event.origin` and MUST NOT be modified.

Archived-state note (reconciled at archive, 2026-09-28): `app/auth/customer/page.tsx:45` resolves
`const returnOrigin = storeOrigin && isAllowedAuthReturnOrigin(storeOrigin) ? storeOrigin : null;`
**once per render** (the `storeOrigin &&` guard is required: `storeOrigin` is `string | null`, so
`''` must fall to the `null` branch rather than becoming an empty-string target). The three emitters
are `:81` (`AUTH_ERROR`), `:87-95` (OAuth `AUTH_SUCCESS`) and `:156-164` (continue-with-current
`AUTH_SUCCESS`) — **all three** take `returnOrigin`, and `rg` finds **zero** raw `storeOrigin`
passed to `postMessage`. `storeOrigin` survives only as allowlist input, the three non-null guards
(`:65`, `:105`, `:146`), the three deny logs, the dep arrays, and `:199` (`handleGoogleSignIn`'s
OAuth `redirectTo` param) — which is **not** a `postMessage` target: it is param propagation on a
URL built from the unspoofable `window.location.origin`, and the value is re-validated by
`returnOrigin` on the callback load. The three dep arrays gained `returnOrigin` (redundant, since it
derives from `storeOrigin`, but required by `react-hooks/exhaustive-deps`); it is a stable primitive,
so the deny effect cannot loop. R2 and R3 have **no runtime test** — T15 was deferred by decision
(structural proof only); the helper where the logic lives is fully covered and mutation-proven.

**SUPERSEDED (2026-09-30) — T15 is DONE.** Both R2 and R3 now have runtime coverage:
`tests/unit/customerAuthPage.test.tsx` (3 tests, **0 production lines** —
`app/auth/customer/page.tsx` is byte-identical to its pre-change blob) renders the **default export**
`CustomerAuthPage` and asserts:

- **R2** — `test.each` over `https://evil.example` **and** `javascript:alert(1)`: `window.close()` is
  called, `postMessage` is **never** called, `exchangeCodeForSession` is **never** called. Two denial
  reasons are triangulated, which is what makes the `javascript:` case load-bearing: its
  `parsed.origin` is the string `"null"`, so any normalization that emitted into the opener would fail
  it.
- **R3** — with a canonical `env.authOrigin` and a matching `origin` param, `postMessage` is called
  exactly once with the full `AUTH_SUCCESS` payload and the validated origin as target.

All three emitters were additionally audited structurally and **all three** take `returnOrigin`
(`page.tsx:81` `AUTH_ERROR`, `:87-95` OAuth `AUTH_SUCCESS`, `:156-164` continue `AUTH_SUCCESS`), each
preceded by a `!returnOrigin → close` guard (`:67-68`, `:112-113`, `:151-152`).

#### Scenario: Every emitter uses the validated origin

- GIVEN each of the three emit sites in the auth/customer page
- WHEN a message is posted
- THEN `targetOrigin` is the validated origin, never the raw `origin` param

### Requirement: R4 — The `authOrigin` comparison is normalized on both sides

`isAllowedAuthReturnOrigin` MUST compare **origins, not strings**. The `env.authOrigin` clause MUST
normalize the raw `NEXT_PUBLIC_AUTH_ORIGIN` value through `new URL(...).origin` before comparing it
against the parsed request origin, so the clause is invariant to a trailing slash, a path, host case
and an explicit default port in the configured value.

A configured value MUST be rejected as an origin — falling through to the deny path, **without
throwing** — when it is:

| Configured `authOrigin`                                              | Why it cannot serve as an origin                                     | Shipped branch                                   |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| empty / `undefined`                                                  | nothing to normalize                                                 | `if (!value) return null`                        |
| unparseable (`not a url`, a relative path)                           | `new URL()` throws                                                   | `catch { return null }`                          |
| an **opaque origin** (`javascript:…`, `data:…`)                      | it **parses**, and `parsed.origin` is the literal string `"null"`    | `if (parsedValue.origin === 'null') return null` |
| a real origin with a non-default port (`https://storelite.app:8443`) | it normalizes to a **different** origin, so it simply does not match | falls through the comparison                     |

The `'null'` row is **load-bearing, not defensive decoration**. Without it, a hostile
`NEXT_PUBLIC_AUTH_ORIGIN` would normalize to the string `"null"` and then **match** a hostile request
origin whose `parsed.origin` is also `"null"` — turning a deny into an allow. Deleting that guard is
mutation-proven to fail exactly the hostile-env case.

Normalization MUST be **idempotent**: an already-canonical configured value MUST keep its current
outcome, so no previously-allowed input is revoked and no input is newly allowed except an
`authOrigin` spelling that resolves to the same origin.

Archived-state note (2026-09-30) — shipped in `src/shared/utils/url.ts`:

- `normalizeOrigin(value: string): string | null` at `:216-225` is **module-local and not exported**;
  its surface stays 0 (the truth table is fully reachable through the public helper).
- The clause at `:254-255` is
  `const configuredOrigin = normalizeOrigin(env.authOrigin); if (configuredOrigin !== null && parsed.origin === configuredOrigin) return true;`.
  The `!== null` guard is a second, independent layer: a `null` normalization can never equal a
  parsed origin, so an unusable value falls through instead of matching.
- **One `new URL` per side.** `window.location.origin` is already browser-normalized (`:253`) and the
  tenant clause (`:256`) is untouched, so the blast radius is the env clause plus the rationale
  comment. The SSR guard is **still absent** (see R1's archived-state note) and the SSR-hardening
  suggestion there remains open.
- No module-scope memoization was added, deliberately: the test suite re-imports the module per case,
  so a cache would pin a stale value across `stubEnv`/`resetModules`.

#### Scenario: Trailing slash does not break the clause

- GIVEN `NEXT_PUBLIC_AUTH_ORIGIN=https://storelite.app/`
- WHEN `https://storelite.app` is evaluated
- THEN true

#### Scenario: Host case and explicit default port are ignored

- GIVEN `NEXT_PUBLIC_AUTH_ORIGIN=https://StoreLite.app:443`
- WHEN `https://storelite.app` is evaluated
- THEN true

#### Scenario: Unparseable or empty configured origin still denies without throwing

- GIVEN `NEXT_PUBLIC_AUTH_ORIGIN` is `not a url` (or empty) and the page origin is a different host
- WHEN any origin is evaluated
- THEN false, and the helper does not throw

#### Scenario: A hostile configured origin cannot normalize into an allow

- GIVEN `NEXT_PUBLIC_AUTH_ORIGIN=javascript:alert(1)` (which **parses**, with `origin === "null"`)
- WHEN `javascript:alert(1)` is evaluated as the request origin
- THEN false — the `'null'` guard denies it rather than letting the two `"null"` strings match

#### Scenario: Normalization does not widen the allowlist

- GIVEN a canonical `NEXT_PUBLIC_AUTH_ORIGIN=https://storelite.app`
- WHEN `https://storelite.app`, `https://evil.example` and `javascript:alert(1)` are evaluated
- THEN true, false and false respectively — identical to R1 before this change

#### Scenario: A non-default port is a different origin

- GIVEN `NEXT_PUBLIC_AUTH_ORIGIN=https://storelite.app:8443/cb`
- WHEN `https://storelite.app:8443` is evaluated, and separately `https://storelite.app`
- THEN true for the first and **false** for the second — the default-port origin is not pulled in

Archived-state note (2026-09-30) — the T15 coverage-gap note in the archived delta said the allowed
case asserts `postMessage` was called with `targetOrigin === env.authOrigin`. **That wording is
wrong as written and is corrected here.** The page emits the **validated `origin` search param**, not
a re-normalized `env.authOrigin` and not `env.authOrigin` itself
(`page.tsx:45`: `const returnOrigin = storeOrigin && isAllowedAuthReturnOrigin(storeOrigin) ? storeOrigin : null`),
so with a non-canonical configured value the emitted target is the param's own spelling. The test
correctly pins the invariant — `targetOrigin` is the **allowlist-admitted param string**, and the
browser normalizes `targetOrigin` before delivery, so there is no security difference. Emitting a
normalized origin instead (old S2) stays out of scope and remains open. A test asserting a
requirement the spec deliberately excluded would be worse than no test.

## Out of Scope

- Receiver components: they are already validated, and their openers pass their own `window.location.origin` — unspoofable by construction.
- Consolidating the 5 duplicated `AUTH_ORIGIN` consts (`ChatDialog`, `Checkout`, `LookupOrderModal`, `OrderAuthGate`, `features/auth/index.tsx`) — a DRY refactor, not a vulnerability.
- `app/auth/chat-popup/page.tsx`, which already uses `window.location.origin` as its target.
- Enabling subdomain rewrite, or adding storefront base hosts to the allowlist beyond same-origin and `authOrigin`.
- A new opener added later that omits `origin`: it would now close instead of posting. That fail-closed default is intended.

## Carried forward (2026-09-30)

- **SSR guard on the helper (old S1, still open).** `window.location.origin` is still read unguarded at `url.ts:253`. Safety is load-bearing on `/auth/customer` staying statically prerendered plus the `<Suspense>` boundary. R4 did not touch this. `if (typeof window === 'undefined') return false;` remains the one-line fix.
- **Emit a normalized origin (old S2, still open).** The page emits the raw validated param; see R4's archived-state note for why the spec text was corrected. Safe today (`postMessage` re-parses `targetOrigin`), but it depends on that equivalence holding across engines.
- **`.env.example` clause.** The "no trailing slash" wording is no longer needed (R4 normalizes), but `NEXT_PUBLIC_AUTH_ORIGIN` still must be a **real origin** — a hostile or non-origin value now fails closed silently, and the only symptom is a popup that closes with `[CustomerAuth] origin rejected:` in the console.
- **`.env:56` still says `.com`, the spec says `.app`.** Recorded by the batch-2 archive and untouched by this change; it is the file an operator actually reads.
