# Platform Admin Access Specification

> **Archived state — 2026-09-28 (batch 2), updated 2026-09-30 (`access-hardening-followups`).**
> Promoted from `openspec/changes/access-hardening-batch2/` at SDD archive. This file describes what
> actually SHIPPED (tracker `feat/access-hardening-batch2` @ `9559f3a`, slice 2 = `0de1bdc` +
> `28fcb10`, PR #198 — **open, unmerged**). One reconciliation was applied during that pass and is
> marked inline: the `SASS_API_KEY` consolidation in R3, whose "replace the module-scope read"
> instruction is now history.
>
> **Extended 2026-09-30** by R5 and R6 from `openspec/changes/access-hardening-followups/` (slice A,
> commit `52b02bb`, branch `feat/access-hardening-followups-a` @ `52b02bb`, PR #201 — **open,
> unmerged**). Both are **specification of already-shipped behavior with zero production diff** — the
> broadcast route's blob is byte-identical to its pre-change state. The archive pass corrected one
> clause (an empty-string `target` is routed to the broadcast-all path, not rejected) and added a
> per-requirement line-anchor table. Read the archived `spec.md` for the full delta provenance.

## Purpose

`GET /api/billing/sunat-report` calls `requireAuthenticatedUserId()` and discards the returned id, then queries `planPayments` with no tenant filter. Any logged-in user of any business can export every other tenant's buyer document, amount and correlative as CSV. The route's own doc comment already states `Solo para administradores del SaaS` — this spec makes the code match that intent. Reuses the established `SASS_API_KEY` / `x-sass-key` header-secret idiom and the `env.ts` config surface; no migrations, no new dependency.

## Requirements

### Requirement: R1 — Platform admin allowlist configuration

`src/config/env.ts` MUST expose a pre-split, pre-trimmed `platformAdminIds: string[]` parsed from `PLATFORM_ADMIN_IDS` (comma-separated, blanks removed) and `sassApiKey` read from `SASS_API_KEY`. Both MUST keep an empty-string default **on their `process.env` read** (`platformAdminIds` is an array; the `|| ''` guard is on the string it splits), because `env.ts` is client-reachable via `src/shared/utils/url.ts:10`. An unset `PLATFORM_ADMIN_IDS` MUST resolve to an empty list, never to a wildcard.

Archived-state note (reconciled at archive, 2026-09-28): shipped at `src/config/env.ts:53-56`
(`platformAdminIds`, with the fail-closed note in the comment) and `env.ts:59` (`sassApiKey`); the
`|| ''` guards make the `.split()` input always a string, so the browser-side resolution is `[]`,
never a `TypeError`. The module stayed a plain `as const` literal — no zod.

#### Scenario: Unset variable is fail-closed

- GIVEN `PLATFORM_ADMIN_IDS` is unset in the environment
- WHEN the route resolves its allowlist
- THEN the list is empty and no authenticated user is allowlisted

#### Scenario: Whitespace and blanks are tolerated

- GIVEN `PLATFORM_ADMIN_IDS=" id-a , ,id-b "`
- WHEN the allowlist is parsed
- THEN it equals `['id-a', 'id-b']`

### Requirement: R2 — Route gate requires platform-admin or service-key authorization

The route MUST return 401 `{ error: 'No autorizado' }` unless the caller presents a valid `x-sass-key` OR `requireAuthenticatedUserId()` resolves to a user id in `platformAdminIds`. The gate MUST run BEFORE any `planPayments` query. The service key authorizes alone, without a session — `app/api/sass/notifications/broadcast/route.ts` is the in-repo precedent (key-only, no auth). The existing 400 for a missing/invalid `month`/`year` MUST still apply to authorized callers.

Archived-state note (reconciled at archive, 2026-09-28): the shipped branch order in
`app/api/billing/sunat-report/route.ts` is exactly this, and every step is anchored:

| Order | Line     | Step                                                                                          |
| ----- | -------- | --------------------------------------------------------------------------------------------- |
| 1     | `:23`    | `isSassScript = !!env.sassApiKey && request.headers.get('x-sass-key') === env.sassApiKey`     |
| 2     | `:25`    | `if (!isSassScript)` — a valid key **skips the session entirely**, never consults `cookies()` |
| 3     | `:28`    | `await requireAuthenticatedUserId()` inside a `try` narrowed to _that call only_              |
| 4     | `:33`    | `!userId \|\| !env.platformAdminIds.includes(userId)` → 401                                   |
| 5     | `:34`    | the single 401 `{ error: 'No autorizado' }` — byte-identical to the pre-change string         |
| 6     | `:43-48` | the 400 for missing `month`/`year`, still **after** authz                                     |
| 7     | `:53`    | `db.query.planPayments.findMany` — last                                                       |

Because the `try` wraps only step 3, a throw in the allowlist check or the `NextResponse`
construction propagates to a 500 and can never be misreported as a 401. Residual (pre-existing,
unchanged): a Supabase outage _inside_ `requireAuthenticatedUserId` still surfaces as 401, since
the `try/catch` scope is byte-identical to pre-change.

#### Scenario: Allowlisted operator exports

- GIVEN a session whose user id is in `platformAdminIds`, and valid `month`/`year`
- WHEN GET /api/billing/sunat-report
- THEN 200 with the cross-tenant CSV/JSON payload

#### Scenario: Non-allowlisted tenant user refused

- GIVEN an authenticated user of a paying business that is not allowlisted, and no `x-sass-key`
- WHEN GET /api/billing/sunat-report
- THEN 401, and `planPayments.findMany` is never called

#### Scenario: Anonymous request without a service key refused

- GIVEN no session and no `x-sass-key` header
- WHEN GET /api/billing/sunat-report
- THEN 401 before any query

### Requirement: R3 — Service-key branch is guarded against an unset key

The `x-sass-key` comparison MUST be guarded by a non-empty `env.sassApiKey`, so an unset key can never match an absent or empty header. The header name and comparison MUST be unchanged from `app/api/sass/notifications/broadcast/route.ts`. A wrong key MUST NOT authorize. `env.sassApiKey` MUST be the single source for that comparison, with no behavior change in the broadcast route.

Archived-state note (reconciled at archive, 2026-09-28) — this requirement was written as an
instruction ("**replacing** the module-scope `process.env` read in the broadcast route") and its
line anchor (`:28-31`) is now stale. The consolidation is **done**:

- `app/api/sass/notifications/broadcast/route.ts:28` now reads `if (!apiKey || apiKey !== env.sassApiKey)`,
  and the module-scope `const SASS_API_KEY = process.env.SASS_API_KEY` it used to open the file is
  **deleted**. The route imports `env` (`broadcast/route.ts:17`).
- `env.sassApiKey` is the single source. The only remaining `process.env.SASS_API_KEY` read in
  server TypeScript is `env.ts:59` itself. (`scripts/notify.mjs:19` still reads it directly — correct
  and out of scope: a plain Node script is the API _client_ and cannot reach `env.ts`. Do not
  "fix" it.)
- Behaviour is provably identical in the broadcast route by truth table: for any header `H`,
  pre-change the key was `undefined` when unset and post-change it is `''`; both branches reduce to
  `401 iff (!H || H !== key)`, which denies every `H` because `''` short-circuits and no string
  equals either `undefined` or `''`.
- The `!!env.sassApiKey &&` guard on the SUNAT side is mutation-proven load-bearing: deleting it makes
  the empty-vs-empty case return 200 (`'' === ''` is `true`, and `Request` really does return the
  empty string for an empty header, so the test is not vacuous).

#### Scenario: Valid key authorizes a script without a session

- GIVEN `SASS_API_KEY` is set, no session, and the header matches exactly
- WHEN GET /api/billing/sunat-report
- THEN the request is authorized (key-only path, parity with `broadcast/route.ts`)

#### Scenario: Wrong key refused

- GIVEN an `x-sass-key` that does not match and the caller is not allowlisted
- WHEN GET /api/billing/sunat-report
- THEN 401

#### Scenario: Unset key cannot be matched by an empty header

- GIVEN `SASS_API_KEY` is unset and no `x-sass-key` header is sent
- WHEN GET /api/billing/sunat-report
- THEN 401; the empty-vs-empty comparison never authorizes

### Requirement: R4 — Configuration is documented at the deploy boundary

`PLATFORM_ADMIN_IDS` MUST be documented in `.env.example` with its comma-separated format and in the README env table, and MUST be set in every deployed environment BEFORE the route ships. Setting it after deploy locks the operator out of the SUNAT export.

Archived-state note (reconciled at archive, 2026-09-28): shipped at `.env.example:91-94` (the key
plus a "solo para operadores del SaaS / fail-closed" comment) and `README.md:116` (env-table row)
with the "**o bien** allowlist **o bien** `x-sass-key` · configuralo **antes** de desplegar"
blockquote at `README.md:118-121`. **Accepted documentation gap:** both say "IDs de usuario de
Supabase" but neither says _where to read them_. `requireAuthenticatedUserId()` returns a Supabase
auth **UUID** (`src/features/storage/actions/authz.ts:20`), so the realistic lockout is pasting an
email instead — on a route that is fail-closed by design. Adding "Supabase → Authentication →
Users → UUID" is the one-clause follow-up recorded in the archive report.

#### Scenario: Operator is not locked out by an unset variable

- GIVEN `PLATFORM_ADMIN_IDS` is configured in the target environment before deploy
- WHEN the operator exports a month
- THEN 200; no 401 regression for the legitimate operator

### Requirement: R5 — The broadcast route rejects an unusable body before dispatch

`POST /api/sass/notifications/broadcast` MUST answer 400 and MUST NOT reach notification dispatch when
the body is unusable. A body that does not parse as JSON MUST be treated as an absent body. `title`
and `message` MUST both be present and non-empty. `target` MUST be absent **or otherwise falsy**
(`undefined`, `null`, `''`), the string `"all"`, or an array of business ids; any other shape —
including a bare non-`"all"` non-empty string — MUST be rejected. Validation MUST run **after** the
R3 key gate, so an unauthorized caller can never probe it.

(Previously: these 400 paths existed in `route.ts` but were specified nowhere, so the route had no
contract for them and no test could be written against one.)

Archived-state note (2026-09-30) — shipped in `app/api/sass/notifications/broadcast/route.ts`,
**zero production diff** (blob `27304506c153dcaf50f3dfc277c1894e026a642c` at the base and at the
branch tip):

| Step | Line     | Behavior                                                                                                                                                     |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `:27-30` | the R3 key gate — `x-sass-key` present **and** equal to a non-empty `env.sassApiKey`, else 401. Runs **first**.                                              |
| 2    | `:33-39` | `await request.json().catch(() => ({}))` — an unparseable body becomes `{}`, i.e. an absent body                                                             |
| 3    | `:41-43` | `if (!body.title \|\| !body.message)` → 400 `'title y message son requeridos'`. The `!` test rejects `''` as well as absent, so "non-empty" holds            |
| 4    | `:51`    | `if (!body.target \|\| body.target === 'all')` → resolve from active subscriptions. **This is a falsy test, not an absence test** — see the correction below |
| 5    | `:59-60` | `Array.isArray(body.target)` → used verbatim as the recipient id list                                                                                        |
| 6    | `:62-66` | anything else → 400 `'target debe ser "all" o un array de business IDs'`, **before** any query                                                               |

**Correction applied at archive (2026-09-30).** The original delta said "`target` MUST be absent, the
string `"all"`, or an array of business ids; any other shape — including a bare non-`"all"` string —
MUST be rejected." Read literally, that requires rejecting `target: ""`, but the shipped branch at
`:51` is a **falsy** test, so an empty string is routed to the **broadcast-to-all** path and produces
a full broadcast, not a 400. The requirement text was corrected to say "absent **or otherwise
falsy**" so it matches the code. Consequences of the divergence as shipped: it is reachable **only by
a caller that already holds a valid `x-sass-key`** (an unauthenticated caller is rejected at `:28`),
and the failure direction is _louder_, not quieter — the operator gets a broadcast to every active
subscriber instead of a validation error. No zod schema was introduced for this body (a deliberate
design decision: new infrastructure for no contract gain), so tightening `''` to a 400 would be a
one-clause code change if it is ever wanted.

#### Scenario: Missing title or message is rejected

- GIVEN a valid `x-sass-key` and a body carrying `message` but no `title`
- WHEN POST /api/sass/notifications/broadcast
- THEN 400, and `createBusinessNotification` is never called

#### Scenario: Unparseable body is rejected

- GIVEN a valid `x-sass-key` and a body that is not valid JSON
- WHEN POST /api/sass/notifications/broadcast
- THEN 400 (the parse failure counts as an absent body), and nothing is dispatched

#### Scenario: A target that is neither `all` nor an array is rejected

- GIVEN a valid `x-sass-key` and `target: "acme"` (a bare business-id string)
- WHEN POST /api/sass/notifications/broadcast
- THEN 400, and the subscription query is never issued

#### Scenario: An authorized caller with a bad key still gets 401, not 400

- GIVEN a **valid body** (`title` and `message` present) and a **wrong** `x-sass-key`
- WHEN POST /api/sass/notifications/broadcast
- THEN 401 and no database access — the key gate fires before any body parsing

> **Coverage caveat (open, from the slice-A verify).** The suite proves the key gate _fires_ (the case
> above sends a valid body and still gets 401), but no test sends a **bad body with a bad key** and
> asserts 401-not-400 — the only shape that distinguishes "the gate runs _first_" from "the gate runs
> at all". The ordering is proven statically by the line table above on a byte-frozen blob, so it
> cannot regress without the blob changing. Likewise, the **array-target acceptance branch**
> (`:60`) has no test and remains the route's only uncovered line.

### Requirement: R6 — The broadcast route reports the sent count

An authorized broadcast MUST answer 200 with `{ sent, total, errors }`, where `sent` counts only the
notifications that were created successfully. A rejected per-recipient dispatch MUST NOT fail the
whole request; its reason MUST be reported in `errorDetails`. An absent, falsy or `"all"` `target`
MUST resolve recipients from `businessSubscriptions` where `planStatus === 'active'`. A resolved
audience of zero MUST answer 200 with `{ sent: 0, message }` and MUST NOT dispatch anything.

(Previously: unspecified. The response shape is the route's only observability channel for the
operator running the broadcast, and it had no test contract.)

Archived-state note (2026-09-30) — shipped, **zero production diff**:

| Step | Line      | Behavior                                                                                                                                                                                                 |
| ---- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `:53-58`  | `db.select({ businessId }).from(businessSubscriptions).where(eq(businessSubscriptions.planStatus, 'active'))`, mapped to an id array                                                                     |
| 2    | `:68-73`  | zero-audience short-circuit → `{ sent: 0, message: 'No hay destinatarios para este target' }`, **before** any dispatch                                                                                   |
| 3    | `:77-87`  | `await Promise.allSettled(...)` over one `createBusinessNotification` per recipient — awaited, so per-recipient rejections are collected rather than thrown, and one failure cannot fail the request     |
| 4    | `:89-90`  | `sent` = count of `fulfilled`; `errors` = array of `rejected`                                                                                                                                            |
| 5    | `:93-101` | `{ sent, total: targetBusinessIds.length, errors: errors.length, errorDetails }`, where `errorDetails` is `reason?.message ?? 'unknown'` per rejection and is **omitted** (not `[]`) when there are none |

Note that `total` is the length of the **resolved recipient list**, so for an explicit array target it
is the number of ids the caller supplied — it is not re-filtered against active subscriptions.

#### Scenario: Every active subscriber is notified

- GIVEN a valid key, a complete body and `target: "all"` resolving to 2 active subscriptions
- WHEN POST /api/sass/notifications/broadcast
- THEN 200 `{ sent: 2, total: 2, errors: 0 }` and 2 dispatches

#### Scenario: A failed dispatch is counted, not fatal

- GIVEN 2 recipients where one `createBusinessNotification` rejects
- WHEN POST /api/sass/notifications/broadcast
- THEN 200 with `sent: 1`, `errors: 1`, and the reason present in `errorDetails`

#### Scenario: An empty audience short-circuits

- GIVEN `target: "all"` resolving to 0 active subscriptions
- WHEN POST /api/sass/notifications/broadcast
- THEN 200 `{ sent: 0, message }`, and no dispatch is attempted

### Coverage evidence (no new requirement)

The route's **401 key gate is already specified** by R3, which fixes the header name, mandates the
non-empty `env.sassApiKey` guard, forbids a wrong key from authorizing, and freezes the route with
"no behavior change in the broadcast route"; R3's archived-state note proves the truth table for every
header. Re-stating it as a requirement here would duplicate R3, so none was added. What was missing
was **evidence** — the route had 0% coverage and no test file existed anywhere in the repo. Closed by
`tests/unit/broadcastRoute.test.ts` (9 cases, **187 insertions, 0 production lines**): missing key ⇒
401 with no database access; wrong key ⇒ 401; unset `SASS_API_KEY` + empty header ⇒ 401, with an
explicit non-vacuity assertion that `Request` really returns `''` for an empty header.

Coverage after the change: **96.15% statements / 91.66% branches / 100% functions / 95.45% lines**, with
`route.ts:60` (the array-target assignment) the single uncovered line — see the caveat under R5.

## Out of Scope

- Per-tenant filtering or scoping of the exported CSV — the export is intentionally cross-tenant for the SaaS operator.
- An admin UI, role, or `businesses`-column flag; the allowlist is env-only and no `PLATFORM_ADMIN*` precedent exists in the repo.
- Any authenticated user reaching the route by being a business owner or admin.
- `scripts/notify.mjs` calling this route (it does not today).
- WhatsApp chain, RLS work, Culqi unification, and the duplicated `AUTH_ORIGIN` consts.

## Carried forward (2026-09-30)

- **The R5 ordering clause is not directly test-pinned.** See the coverage caveat under R5: the static
  line table proves the key gate runs before body parsing on a byte-frozen blob. One test — a bad body
  plus a wrong key asserting 401 — closes it if the route is ever unfrozen.
- **The array-target acceptance branch (`:60`) is untested** and is the route's only uncovered line.
  Same mitigation: frozen blob, pre-existing behavior.
- **"Present and non-empty" is only half-pinned.** The tests cover a _missing_ `title`, not
  `title: ""`. Both hit the identical `!body.title` branch at `:41`, so this is cosmetic coverage, not
  a behavior gap.
- **`===` on the shared secret is still not constant-time** — recorded by the batch-2 archive as a
  future batch that hardens both routes with `crypto.timingSafeEqual`. Untouched here by design.
