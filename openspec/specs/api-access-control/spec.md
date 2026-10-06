# API Access Control Specification

> **Archived state — 2026-09-27, updated 2026-09-30 (`access-hardening-followups`).** Promoted from
> `openspec/changes/prod-access-hardening/` at SDD archive. This file describes what actually SHIPPED
> (tracker `feat/prod-access-hardening` @ `a8306ac`, PRs #188-#194). Three reconciliations were
> applied during that pass and are marked inline: the blank-proof guard in R2, the UPDATE row-scoping
> note in R3, and the corrected dead-path reason under REMOVED.
>
> **Extended 2026-09-30** by the buyer order-access gate (the buyer half of the same DNI-guessing-oracle
> control), promoted from `openspec/changes/access-hardening-followups/` (slice B, commits `87a30a6`,
> `d774a340`, `870fca8`, branch `feat/access-hardening-followups-b` @ `870fca8`, PR #202 — **open,
> unmerged**). The buyer gate was deliberately folded into **this** capability rather than a new
> `order-access-management`: R8 already owns the identical control on the sibling surface and already
> names the exact primitives (`RATE_LIMITS.auth`, `checkRateLimit`, `getClientIdentifier`) that the
> gate now shares.
>
> **⚠️ Renumbering applied at the 2026-09-30 archive.** The two new requirements were written as R9 and
> R10 in the archived delta, but **R9 and R10 were already consumed** by the REMOVED requirements at
> the bottom of this file (`verifyOrderAccessByDniAndOrderNumber` = R9, `TrackOrderModal` = R10 — see
> `openspec/changes/prod-access-hardening/archive.md`). They are therefore published here as **R11 and
> R12**, which is the next free pair and keeps the REMOVED entries' historical numbers intact. A
> cross-reference table follows; the pipeline artifacts (proposal #1136, spec #1137, design #1138,
> tasks #1141, apply #1143, verify #1150) still say "R9/R10".
>
> **⚠️ Extended 2026-10-02 by `order-integrity` (C4) — IMPLEMENTED AND VERIFIED, PENDING MERGE.**
> **R13–R18 below were synced at SDD archive from `openspec/changes/order-integrity/`. The behavior is
> implemented and independently verified; it is NOT in production.** The change lives entirely in
> **two unmerged draft PRs**, neither of which has reached `main` or `develop`:
> **#204** `feat/order-integrity-a` → `feat/order-integrity-b` (slice B-i: R13/R18 cookie foundation +
> R15 live bug fix) and **#205** `feat/order-integrity-b` → `feat/order-integrity-b2` (slice B-ii: R14
> projection + R16/R17 + the dead-code deletion). Slice B-i alone left the cookie **inert** — the page
> still fetched the full `payment_orders` row, so buyer PII stayed visible to anyone holding a tracking
> URL. **R14/R16/R17 are the slice that actually closes the leak**; treat B-i's cookie as plumbing,
> not as access control.
>
> **No renumbering.** R13 is the first number free of any live **and** any REMOVED entry (R7, R9, R10
> keep their REMOVED numbers and their rationale text, which cross-references R8). **No requirement was
> modified or removed** — R13–R18 are additive. No destructive merge, so `config.yaml`'s
> `rules.archive` ("warn before merging destructive deltas") does not fire.

## Purpose

Tenant-data access hardening for anonymous API and realtime surfaces: ticket generation, penalty visibility, order-chat channels, and DNI+orderNumber lookup/track endpoints. Reuses in-repo primitives (`requireOwnedBusinessById`, `RATE_LIMITS.auth`, `checkRateLimit`, `getClientIdentifier`); no migrations, no new env vars.

## Requirements

### Requirement: Ticket generation owner branch

`POST /api/ticket/generate` MUST require access proof before any generation or storage write. An authenticated user who owns the payment's business (`requireOwnedBusinessById(payment.businessId)`) MAY generate and honor `forceRegenerate`; without proof the request MUST return 401 and create no ticket.

#### Scenario: Owner regenerates

- GIVEN a session whose user owns the business of payment P
- WHEN POST /api/ticket/generate with P.orderNumber and forceRegenerate: true
- THEN 200 with a fresh publicUrl and P.ticketUrl updated

#### Scenario: Unauthenticated request rejected

- GIVEN no session and no trackingToken in the body
- WHEN POST /api/ticket/generate with an existing orderNumber
- THEN 401; no upload and no payment-row update

### Requirement: Ticket generation buyer proof

An unauthenticated or non-owner caller MUST present a body `trackingToken` that matches the payment row's token, compared in constant time, to obtain or generate a ticket. The payment lookup MUST select `payments.trackingToken`. In the buyer branch `forceRegenerate` MUST be coerced to false: an existing ticket is returned, never overwritten.

A blank or absent proof MUST be rejected before the comparison is trusted: an empty-vs-empty comparison is true by contract, so a caller that presents an empty token MUST NOT be able to claim a row that has no stored token. Shipped as `!presentedToken || !storedToken || !safeTokenEqual(presented, stored)`. (`payments.trackingToken` is `notNull().unique()` at `src/core/database/schema/orders.ts:64`, so today the guard is defence-in-depth for legacy/NULL rows rather than a reachable branch.)

#### Scenario: Buyer download never overwrites

- GIVEN payment P with ticketUrl; caller presents P.trackingToken and forceRegenerate: true
- WHEN POST /api/ticket/generate
- THEN 200 returns the existing publicUrl; no upload or update occurs

#### Scenario: Buyer generates first ticket

- GIVEN payment P without ticketUrl; caller presents the valid trackingToken
- WHEN POST /api/ticket/generate
- THEN 200 returns a new publicUrl and updates only row P

#### Scenario: Wrong token rejected

- GIVEN payment P and a trackingToken that does not match the row
- WHEN POST /api/ticket/generate
- THEN 401; no write occurs

### Requirement: Cross-tenant write protection

The route MUST NOT generate or update a ticket unless the caller passed the owner branch or the buyer branch matched that payment's own trackingToken. The UPDATE MUST apply only to the authorized payment row.

Archived-state note (reconciled at archive, 2026-09-27): the shipped UPDATE scopes by `eq(payments.orderNumber, orderNumber)` (`app/api/ticket/generate/route.ts:283`), not by `payment.id`. `payments.order_number` carries no UNIQUE constraint in the schema or any migration, so the single-row guarantee holds only while order numbers are unique in practice. The access proof itself IS exact — `payments.tracking_token` is `notNull().unique()`. Pre-existing and untouched by this change; `WHERE id = payment.id` is the tightening candidate.

#### Scenario: Foreign order refused

- GIVEN an orderNumber whose payment belongs to business B and a caller with no proof for it
- WHEN POST /api/ticket/generate
- THEN 401; B's ticket and row are untouched

### Requirement: Penalties list owner gate

`GET /api/business/penalties` MUST return 401 after the existing 400 validation unless the session user owns the business (`requireOwnedBusinessById`). Owner-only; team roles are NOT widened in this change.

#### Scenario: Owner lists penalties

- GIVEN a session owning business B
- WHEN GET /api/business/penalties?businessId=B
- THEN 200 with B's penalty rows

#### Scenario: Anonymous or foreign owner refused

- GIVEN no session, or a session that does not own B
- WHEN GET /api/business/penalties?businessId=B
- THEN 401; no penalty rows returned

### Requirement: Penalty status two-branch response

`GET /api/business/penalty-status` MUST return `{ canAcceptPayments, culqiBlocked, blacklisted }` to unauthenticated callers, adding `penaltyDebt` and `penaltyCount` only when the session user owns the business. The public checkout banner flow MUST keep working unchanged.

#### Scenario: Anonymous banner subset

- GIVEN no session
- WHEN GET /api/business/penalty-status?businessId=B
- THEN 200 with only the three banner fields; penaltyDebt/penaltyCount absent

#### Scenario: Owner full payload

- GIVEN a session owning B
- WHEN GET /api/business/penalty-status?businessId=B
- THEN 200 includes penaltyDebt and penaltyCount

### Requirement: Realtime chat session scoping

The order-chat realtime channel MUST subscribe with `filter: 'session_id=eq.${sessionId}'` (ChatDialog pattern). Messages from other sessions MUST never reach the client via the channel; the client-side discard remains as defense-in-depth.

Scope note: the `filter` is channel SCOPING, not authorization — the `messages` table has no RLS in any migration. Closing that is out of this change's scope (Batch 2 / RLS work).

#### Scenario: Own-session message delivered

- GIVEN a messages INSERT for the subscribed sessionId
- WHEN the channel receives it
- THEN the client renders the message

#### Scenario: Foreign-session message not delivered

- GIVEN a messages INSERT for a different session
- WHEN the channel is subscribed to sessionId A
- THEN the row is not delivered by the channel; client discard is unreachable

### Requirement: Auth-intent rate limit on order lookup

`POST /api/order/lookup` MUST apply the same pre-zod `RATE_LIMITS.auth` check keyed `(IP, dni)`, returning 429 with `Retry-After` when exhausted.

#### Scenario: Limit exhausted

- GIVEN key (IP, dni) at its ceiling
- WHEN POST /api/order/lookup with the same IP and dni
- THEN 429 with Retry-After before any validation or DB query

### Requirement: R11 — Buyer order-access gate is limited per `(client, dni)` on the shared limiter

_(Published as R11 at the 2026-09-30 archive; the archived delta and all pipeline artifacts call this
R9.)_

`verifyOrderAccess` — the `'use server'` action behind `OrderAuthGate` — MUST count every attempt
against the **shared** auth-intent limiter (`checkRateLimit` with `RATE_LIMITS.auth`), keyed by
`(clientId, dni)` through the existing `buildOrderAccessIdentifier` composition: the same primitive,
window and ceiling as R8's `POST /api/order/lookup`. The action MUST NOT keep a module-local counter
store, and the shared limiter's periodic cleanup MUST be the only lifecycle for these buckets.

The check MUST be evaluated **before** the payment lookup, so a refused caller cannot learn whether the
order exists. A caller with no usable `dni` MUST collapse into the **per-client** missing-dni bucket,
never into one global bucket. Because this is a server action, an exhausted budget MUST be reported
with the action's existing result contract — `{ success: false, error: <string>, rateLimited: true }` —
and MUST NOT become an HTTP 429 and MUST NOT throw.

(Previously: a hand-rolled, module-local 5-per-15-minutes counter keyed **IP only**, whose no-header
fallback collapsed every such caller into a single `'unknown'` bucket.)

Archived-state note (2026-09-30) — shipped in `app/[slug]/(app)/order/[token]/actions.ts` and
`src/lib/{rateLimit,orderAccessRateLimit}.ts`:

| Step | Location             | Shipped                                                                                                                                                                                                                                                                                                                    |
| ---- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `actions.ts:120`     | `const clientId = getClientIdentifierFromHeaders(await headers())` — a **server action** has no `NextRequest`, so the header read is structural: `ClientHeaderReader { get(name): string \| null }` (`rateLimit.ts:98-100`), which `ReadonlyHeaders` satisfies with no cast and no new import                              |
| 2    | `actions.ts:121`     | `checkOrderAccessRateLimitFor(clientId, { dni })` → `checkRateLimit(buildOrderAccessIdentifier(clientId, { dni }), RATE_LIMITS.auth)` (`orderAccessRateLimit.ts:56-61`, `:31-37`)                                                                                                                                          |
| 3    | `actions.ts:122-128` | `!allowed` → `{ success: false, error: 'Demasiados intentos. Esperá N segundos.', rateLimited: true }` — **exactly three keys**, no field added or removed, and `Math.ceil(rateLimit.resetInMs / 1000)` interpolated into the **pre-existing** string (rounding direction is mutation-pinned: `Math.floor` fails the test) |
| 4    | `actions.ts:130-132` | the payment lookup — strictly after the gate, so an exhausted budget never issues a query                                                                                                                                                                                                                                  |
| 5    | —                    | the module-local store (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `RateLimitEntry`, `rateLimitMap`, `checkRateLimit`, `clearRateLimit`) is **deleted** (−45 lines); `grep` finds zero residue, and `cleanup()` (`rateLimit.ts:38-47`) is the sole bucket lifecycle                                                         |

Two primitives were added to the shared limiter, both additive and both with **no existing signature
change**:

- `resetRateLimit(identifier: string, config: RateLimitConfig): void` (`rateLimit.ts:89-91`) — deletes
  `` `${identifier}:${config.windowMs}` ``. The store key is private, so the signature mirrors
  `checkRateLimit` and the private formula is never duplicated by a caller. Idempotent by
  construction: `Map.delete` on a missing key is a no-op.
- `getClientIdentifierFromHeaders(headers: ClientHeaderReader): string` (`rateLimit.ts:106-113`) —
  the `x-forwarded-for > x-real-ip > cf-connecting-ip > 'unknown'` chain moved verbatim, and
  `getClientIdentifier(request: NextRequest)` (`:119-121`) became a one-line delegation, so the two
  entry points cannot drift. `proxy.ts` and the lookup route are behaviorally untouched.

The **`'unknown'` sentinel was deliberately kept**. The old collapse was IP-only keying —
`(unknown, <nothing>)` put every header-less caller in one bucket regardless of dni — and the composite
key fixes it structurally: `(unknown, dni1)` and `(unknown, dni2)` are independent. A per-call nonce
was rejected because the bucket would never accumulate, silently **removing** the control from the
exact anonymous path it protects (and making the header-less test pass vacuously).

#### Scenario: Distinct dnis from one client are independent

- GIVEN one client id and 11 distinct dnis, none matching an order
- WHEN `verifyOrderAccess` is invoked 11 times
- THEN all 11 return `{ success: false }` with no `rateLimited` — each spent only its own bucket

#### Scenario: Header-less callers do not share a bucket

- GIVEN two callers with no `x-forwarded-for` and no `x-real-ip`, with different dnis
- WHEN both invoke `verifyOrderAccess`
- THEN neither is refused as rate limited (before this change both resolved the `'unknown'` bucket and the second was refused)

#### Scenario: An exhausted budget denies before the order lookup

- GIVEN one `(clientId, dni)` above the shared `RATE_LIMITS.auth` ceiling
- WHEN `verifyOrderAccess` is invoked
- THEN `{ success: false, error: <string>, rateLimited: true }`, and the payment query is never issued

Archived-state note (2026-09-30) — **this gate is strictly LOOSER per IP than what it replaced**, and
that is accepted, not a defect:

|                | Before                            | After                                                                                                                       |
| -------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Key            | IP only                           | `(clientId, dni)`                                                                                                           |
| Ceiling        | 5 / 15 min per IP                 | 10 / 15 min per `(clientId, dni)`                                                                                           |
| Store          | module-local `Map`, never cleaned | the shared limiter, with periodic cleanup                                                                                   |
| Proxy backstop | none                              | **still none** — `proxy.ts:36-40` only assigns a bucket for `/auth/` and `/api/`, and this action POSTs to a **page** route |

So one IP can now spend `10 × N dnis` attempts where it previously spent 5. That is the price of
parity with R8's seller-side oracle, which sits under `RATE_LIMITS.api` and therefore keeps a proxy
backstop this page route does not. Recorded in commit `d774a340`'s body and in PR #202's description.

### Requirement: R12 — A verified access resets the caller's budget

_(Published as R12 at the 2026-09-30 archive; the archived delta and all pipeline artifacts call this
R10.)_

A successful verification MUST clear the caller's own `(clientId, dni)` bucket, so a buyer who proves
ownership is not charged for the attempt. The reset MUST be scoped to that key — other dnis' buckets
MUST be untouched — and a failed verification MUST NOT reset it.

(Previously: `clearRateLimit()` on success already existed against a module-local IP-only map. This
requirement pins the same intent on the shared key so the consolidation cannot silently drop it.)

Archived-state note (2026-09-30) — shipped as `resetOrderAccessRateLimit(clientId, { dni })`
(`orderAccessRateLimit.ts:68-70`) called at `actions.ts:148`. It sits on the **success path only**,
after the order is found (`:134`) and the order number matches (`:142`); both failure returns (`:135`,
`:143`) return before it.

Scoping is **structural, not conventional**: `buildOrderAccessIdentifier` is composed in exactly one
module for both the charge (`:60`) and the refund (`:69`), so "reset one dni" cannot become "reset the
client" without changing that single function.

#### Scenario: Proof restores the budget

- GIVEN `(clientId, dni)` exhausted by failed attempts, and a matching tracking token plus order number
- WHEN `verifyOrderAccess` is invoked
- THEN `{ success: true }`, and the next attempt on the same key starts from a fresh budget

#### Scenario: A failure does not restore the budget

- GIVEN `(clientId, dni)` with 9 failed attempts
- WHEN a 10th attempt presents a wrong order number
- THEN `{ success: false }` with no `rateLimited`, and the 11th attempt on that key is refused

Archived-state note (2026-09-30) — the archived delta's scenario 1 was written as "an **exhausted**
key plus a matching token ⇒ `{ success: true }`". That sequence is **unreachable**: an exhausted key
is refused at the gate before the lookup ever runs. The scenario above states the reachable reading —
"the next attempt starts fresh" — which is what the test actually pins (9 wrong → the 10th correct
⇒ `{ success: true }` + reset → 10 more wrong all served → the 11th refused), and the 11th refusal
proves a failed verification does not refund. The normative outcome of the requirement is unchanged;
only the wording was corrected.

## Added 2026-10-02 — `order-integrity` (C4): server-proven access and a PII-free public projection

> Synced at SDD archive from `openspec/changes/order-integrity/specs/api-access-control/spec.md`
> (change artifacts: proposal, design D1–D13, tasks WU-B1…B4, apply-progress, verify-report-b-ii).
> **All six requirements below are implemented and independently verified — pending merge of draft PRs
> #204 and #205.** Read the state note at the top of this file before relying on them in production.
>
> These continue the same family as **R11** (`verifyOrderAccess`) and **R12** (its budget reset): they
> tighten **what the server proves and what it then serves** on `order/[token]`, reusing the two entry
> points R11/R12 already govern rather than introducing new comparison logic. The proposal's
> `buyer-order-access` "new capability" entry is **superseded** by this placement — folding it into
> the published pair was a direct precedent, not a fresh judgment (see `R11`'s note).

### R13: A verified order access MUST mint a signed, httpOnly access cookie

On **every** successful verification — `verifyOrderAccess` with a real matching `orderNumber`, and
`verifyOrderByGoogleIdentity` — the server MUST set a cookie named `order_access_{trackingToken}`,
`httpOnly`, `maxAge` 3600 s, `SameSite=Lax`, `path: /`, no `Domain`, and `Secure` in production, whose
value is `{expMs}.{base64url(HMAC-SHA256(secret, "v1|{trackingToken}|{expMs}"))}`. The tracking token
MUST be **bound into the signature**, so a cookie minted for one order MUST NOT verify on another
order. `path: /` is fixed rather than narrowed: the route is `/{slug}/order/{token}`, so no narrower
fixed path can match.

The signature comparison MUST NOT use raw `timingSafeEqual` on the cookie value — the caller controls
its length and `timingSafeEqual` throws on a mismatch. It MUST go through the length-safe
`safeTokenEqual` (`src/lib/tokenCompare.ts`), which digests both sides first. A malformed or
attacker-sized cookie value MUST return `false` without throwing.

Any verification failure — a refused rate-limit budget, a missing order, a mismatched `orderNumber`,
a wrong DNI, a missing or mismatched Google identity — MUST NOT touch the cookie store at all: no set,
no clear, no overwrite. This includes a failure leaving an **already-stored stale or expired cookie
byte-identical**: clearing it on a wrong guess would turn the gate into a logout primitive for anyone
who knows a tracking URL. Minting MUST NOT change the actions' existing return contracts (R11's
three-key return is preserved).

The mint runs inside the actions' existing `try`/`catch`, so an unavailable cookie store degrades to
the action's existing refusal shape (`{ success: false }` / `{ success: false, reason }`) rather than
a half-written authorization.

#### Scenario: DNI verification mints the cookie

- GIVEN a matching tracking token, DNI and order number
- WHEN `verifyOrderAccess` succeeds
- THEN the cookie store receives `order_access_{token}` with `httpOnly`, `maxAge` 3600,
  `SameSite=Lax` and `path: /`, and no `Domain`
- AND its value has the shape `{expMs}.{base64url signature}`
- AND the action still returns `{ success: true }`

#### Scenario: Google-identity verification mints the same cookie

- GIVEN an order whose stored `customerAuth.authId` matches the caller's identity
- WHEN `verifyOrderByGoogleIdentity` succeeds
- THEN the same cookie is set with the same attributes

#### Scenario: A failure never touches the cookie store

- GIVEN a wrong DNI, an unknown order, a mismatched order number, an exhausted rate-limit budget, a
  wrong Google account, or an order with no Google link
- WHEN the corresponding action is invoked
- THEN the cookie store receives **no** set and **no** delete

#### Scenario: A stale cookie survives a failed attempt untouched

- GIVEN a buyer whose `order_access_{token}` cookie has lapsed, and a verification attempt that fails
- WHEN the action runs
- THEN the stored cookie value is byte-identical afterwards — not cleared, not overwritten

#### Scenario: A malformed cookie value is refused without throwing

- GIVEN a cookie value that is a bare word, a short signature, a non-numeric expiry, or empty
- WHEN it is verified
- THEN verification returns `false` and raises nothing

#### Scenario: A cookie is bound to one order

- GIVEN a valid cookie minted for order A's tracking token
- WHEN its exact value is presented under order B's cookie name
- THEN it does not verify for order B, and order B is served the public projection

Archived-state note (2026-10-02) — shipped as `src/lib/orderAccessCookie.ts` + two call sites in
`order/[token]/actions.ts`. The cookie attributes are produced by **one shared helper**
(`cookieAttributes(maxAge)`, `orderAccessCookie.ts:53-65`) used by both `set` (`:89`) and `delete`
(`:140`), so the two cannot drift apart.

**Two invariants the shipped order preserves, recorded because both are load-bearing:**

| Invariant                                                                                                  | Why it matters                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **The signature is verified BEFORE the `Date.now() < expMs` check** (`orderAccessCookie.ts:128-130`)       | A forged `expMs` in an otherwise-invalid cookie decides nothing. Checking expiry first would let an attacker-shaped value take the cheap branch                                                                                                                                                  |
| **The tracking token is inside the signed payload, and the lookup is `eq(payments.trackingToken, token)`** | The token↔order binding is enforced **structurally by the query**, not merely by the URL. `payments.trackingToken` is `.unique()`, so a cookie valid for token A can only ever unlock the row whose token **is** A. There is one global secret and no business scoping in it, and none is needed |

**Why `node:crypto` and not `src/utils/crypto.ts`:** that module holds AES-GCM encrypt/decrypt only and
has no HMAC; `createHmac` comes from `node:crypto`, so **no new dependency** was added.

### R14: Without a valid access cookie the order page MUST serve a PII-free public projection

The server component at `order/[token]/page.tsx` MUST branch on its own signed access cookie. When the
cookie is **absent, expired, invalidly signed, or bound to another token**, the `payments` row MUST be
fetched with an **explicit column projection** — a concrete allowlist of column names — that:

- selects **no** buyer PII key, and
- does **not** select the `metadata` column at all (it carries `customerAuth` and `shippingInfo`), and
- excludes by name at minimum: `buyerEmail`, `buyerPhone`, `buyerDni`, `shippingAddress`,
  `shippingDistrict`, `shippingProvince`, `shippingDepartment`, `shippingAgency`, `shippingReference`,
  `shippingPhone`, `shippingUbigeo`, `pickupCode`, `ticketUrl`, `ticketImageUrl`, `deliveryCodeHash`,
  `deliveryCodeExpiresAt`, `metadata`.

When the cookie verifies, the **full** row MUST be selected, with no projection narrowing.

Both paths MUST retain the existing `with: { product: true, business: true }` relation load (public
storefront relations), the tracking-token lookup, and every existing `notFound()` condition.

`trackingToken` MUST remain selected on both paths: the visitor already holds it (it is the URL), and
the page's own gate, chat and action props depend on it. `rejectionReason` / `rejectionImage` are not
rendered anywhere in the page, so excluding them is optional and is **not** required.

#### Scenario: No cookie yields a PII-free projection

- GIVEN a request to `order/{token}` with no `order_access_{token}` cookie
- WHEN the page fetches the payment row
- THEN the selection carries an explicit column projection that contains none of the excluded column
  names and no `metadata` column

#### Scenario: A valid cookie yields the full row

- GIVEN a request carrying a validly signed `order_access_{token}`
- WHEN the page fetches the payment row
- THEN the full row is selected and the PII sections render

#### Scenario: Expired and tampered cookies are refused

- GIVEN a cookie past its expiry, one with a broken signature, and one signed for a different token
- WHEN the page fetches the payment row
- THEN each is treated as absent and the public projection is served

#### Scenario: The public projection keeps the storefront relations

- GIVEN the public-projection path
- WHEN the payment row is fetched
- THEN the `product` and `business` relations are still loaded, so the public sections render

Archived-state note (2026-10-02) — shipped as `page.tsx:49-132`:

| Element                             | Shipped                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the allowlist                       | `PUBLIC_ORDER_COLUMNS` (`page.tsx:49`) — **16 scalar keys**: `id, businessId, productId, trackingToken, orderNumber, status, amount, currency, paymentMethod, shippingType, sellerNote, courierName, trackingNumber, createdAt, updatedAt, completedAt`. Every key was verified verbatim in `src/core/database/schema/orders.ts:43-114` (the `payments` table lives there; `src/core/database/schema.ts` is a barrel re-export, so grepping **it** for `payments` returns nothing) |
| the relations                       | `PUBLIC_ORDER_RELATIONS = { product: true, business: true }` (`page.tsx:74`)                                                                                                                                                                                                                                                                                                                                                                                                       |
| the branch                          | `hasFullAccess = await verifyOrderAccessCookie(token)` (`:113`) once, before the fetch; `with: PUBLIC_ORDER_RELATIONS` **plus** `...(hasFullAccess ? {} : { columns: PUBLIC_ORDER_COLUMNS })` (`:131-132`)                                                                                                                                                                                                                                                                         |
| `generateMetadata` is projected too | `page.tsx:82` carries `columns: { businessId: true }` — it is the **second** unprojected `payments.findFirst` in the file and it only needs `business.name`. Planner note **N4**; **D11 missed it** and the task plan caught it                                                                                                                                                                                                                                                    |

**Two Drizzle rules this requirement depends on. Both fail silently or catastrophically if reversed:**

1. **`with` MUST be a SIBLING of `columns`, never nested inside it.** A nested `with` is parsed as a
   _column name_ and the relations are stripped — with **no error**. The projection suite therefore
   asserts `expect(columns).not.toHaveProperty('with')` alongside `expect(with).toEqual({…})`.
2. **The conditional spread `...(hasFullAccess ? {} : { columns })` resolves to the FULL row type.**
   Design **D11** predicted one cast at this site; that cast was **unnecessary and harmful** — adding
   `Parameters<typeof findFirst>[0]` breaks relation inference (`TS2551: Property 'business' does not
exist`, 12 errors) and would re-cascade `| undefined` across the ~1950-line page. It was dropped.

**Accepted trade-off of dropping the cast:** an unguarded `order.<pii>` read now **type-checks** and
renders `undefined` instead of failing the build. See the "sole control" note in Carried forward.

### R15: A bare DNI MUST NOT unlock an order whose `orderNumber` is NULL

`verifyOrderAccess` MUST NOT treat "both sides normalize to `null`" as a match. When the payment row's
`orderNumber` is NULL, a caller presenting only `(trackingToken, dni)` — the `?dni=` auto-auth path,
which passes no order number — MUST be denied. The check MUST be: if there is **no provided order
number** (after trimming), deny the access — this explicitly closes the `null !== null` hole without
changing the real-match behavior. Denial MUST use the action's existing `{ success: false }` shape.

This is a live bug, not a hardening nicety: both operands currently normalize to `null`, so
`null !== null` is false and a bare DNI unlocks the order. With the cookie mint now attached to the
success path, leaving it would let a bare DNI mint a full-access cookie.

Unchanged by this requirement: presenting a real matching `orderNumber` still succeeds; presenting no
order number against an order that **has** one still fails; `verifyOrderByGoogleIdentity` is unaffected
(it validates identity against stored `customerAuth`, not the DNI pair).

#### Scenario: A bare DNI is refused on an order with no order number

- GIVEN a payment row whose `orderNumber` is NULL and whose `buyerDni` matches the caller
- WHEN `verifyOrderAccess(TOKEN, dni)` is invoked with no order number
- THEN it returns `{ success: false }` and no cookie is set

#### Scenario: A matching order number still succeeds

- GIVEN a payment row with a real `orderNumber`
- WHEN `verifyOrderAccess(TOKEN, dni, matchingOrderNumber)` is invoked
- THEN it returns `{ success: true }` and mints the cookie per R13

#### Scenario: Omitting the order number still fails for a numbered order

- GIVEN a payment row with a real `orderNumber`
- WHEN `verifyOrderAccess(TOKEN, dni)` is invoked with no order number
- THEN it returns `{ success: false }` (unchanged behavior)

Archived-state note (2026-10-02) — shipped as the single conjunct at `actions.ts:145`
(`!providedOrderNumber || providedOrderNumber !== dbOrderNumber`) plus the same shape at `:310` on the
Google-identity path. `!providedOrderNumber` is what closes the hole; a real match and the numbered-order
refusal are byte-identical to before. No new branch was introduced.

**Side effect recorded, because R15 makes an existing flow dead code (see Carried forward).** The
`?dni=` auto-auth path can now never succeed for a numbered order, which made `OrderAuthGate` spin
forever. Fixed in slice B-i (`OrderAuthGate.performAutoAuth` gained an else/catch branch calling
`setIsAuthenticated(false)`; RED proven by removing that branch again). **The flow itself is still
recommended for removal** — it is a spinner that cannot complete.

### R16: Logout MUST revoke the signed access cookie server-side

A server action MUST clear `order_access_{trackingToken}` — a delete on the same path with the same
name, so no cookie survives the logout. The order page's `LogoutButton` MUST invoke that action in
addition to its existing `localStorage` / `sessionStorage` logout-intent markers and the
`order_session_{token}` removal, which are preserved as-is.

Clearing the cookie MUST leave the client-side markers working exactly as they do today; the change is
additive. After logout, a subsequent request to the same order page MUST be served the public
projection.

#### Scenario: Logout deletes the cookie

- GIVEN a valid `order_access_{token}` cookie
- WHEN the logout action is invoked for that token
- THEN the cookie store receives a delete for `order_access_{token}` with the same path

#### Scenario: LogoutButton calls the server action

- GIVEN the order page renders its logout control
- WHEN it is activated
- THEN the server action is invoked, and the existing local/session-storage markers are still set

#### Scenario: Access is revoked after logout

- GIVEN a buyer logged out of an order
- WHEN the order page is requested again with the old cookie value replayed
- THEN the public projection is served, because the cookie is no longer in the store

Archived-state note (2026-10-02) — shipped as `actions.ts:331-333` (a `'use server'` action delegating
to the module's `deleteOrderAccessCookie`) called at `LogoutButton.tsx:35`. Because the cookie is
`httpOnly`, **this server action is the only way to revoke it** — no client-side script can.

**The set and delete MUST repeat the same attributes byte-identically**, or the delete silently fails
and the cookie survives logout. `orderAccessCookie.ts` enforces this by construction: both go through
the one `cookieAttributes(maxAge)` helper, so `path: '/'`, no `domain`, `httpOnly` and `sameSite`
cannot diverge. `handleLogout` became `async` and wraps the call in `try/catch` + `console.error`, so
a failed revocation can never trap the buyer — the redirect still runs.

### R17: The order page MUST render with nullable buyer PII

The page MUST render every existing section without throwing when the public projection is active and
the buyer PII keys are absent. `OrderChatSection`'s `buyerEmail` and `buyerDni` props MUST become
**nullable**; its display-name derivation MUST NOT assume a string. The `syncChatSession` fallback that
yields a `guest-${paymentId}` guest id when no DNI is available MUST remain reachable, so an
unverified visitor does not become a shared `dni-{dni}` guest.

The PII-derived sections (contact, shipping address, pickup code, ticket image, Google verification)
MUST degrade to absent/placeholder rather than rendering a wrong or partial value. No UI redesign is
in scope.

#### Scenario: The chat section tolerates a null buyer identity

- GIVEN `OrderChatSection` with `buyerEmail: null` and `buyerDni: null`
- WHEN it renders and runs its chat-session sync
- THEN it does not throw, and the session sync uses the `guest-${paymentId}` identity

#### Scenario: The page renders without the PII keys

- GIVEN the public projection is active, so `buyerEmail`, `buyerDni`, `buyerPhone`, `pickupCode`,
  `ticketImageUrl`, the shipping address fields and `metadata` are absent
- WHEN the page renders
- THEN it completes without throwing, and the public sections still render their values

Archived-state note (2026-10-02) — **five** page/component edits, each with a specific reason:

| Edit                                                                                                                   | Why                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page.tsx:1317` `buyerEmail ?? null`, `:1319` `buyerDni ?? null` (was `?? ''`)                                         | matches `OrderChatSection`'s already-nullable `buyerName`; `?? ''` would have produced an empty-string identity, not a null one                                                                                         |
| `page.tsx:1607` Email cell wrapped in `order.buyerEmail && (…)`                                                        | the PII section disappears entirely rather than rendering an empty string                                                                                                                                               |
| `page.tsx:1542` `order.shippingAddress \|\| (isPickup ? 'Recojo en Tienda' : '—')`                                     | the old `\|\| 'Recojo en Tienda'` **asserted PICKUP for a delivered-to-address order** — a _wrong_ value, which R17 forbids. `isPickup` is precomputed at `:249` from `shippingType`, which **is** in the R14 allowlist |
| `OrderChatSection.tsx:22,25` props → `string \| null`; `:56` `buyerName \|\| buyerEmail?.split('@')[0] \|\| 'Cliente'` | the bare `split` was the throw site                                                                                                                                                                                     |
| `actions.ts:176` `dni: string \| null`, `guest-${paymentId}` fallback intact at `:183-184`                             | keeps the unverified visitor on the guest identity instead of the buyer's `dni-{dni}` thread. **This narrows W-A2** — see Carried forward                                                                               |

### R18: An unset `ORDER_ACCESS_COOKIE_SECRET` MUST fail closed

`src/config/env.ts` MUST expose `orderAccessCookieSecret` from `ORDER_ACCESS_COOKIE_SECRET` and MUST
warn when the variable is absent, mirroring the existing `OTP_HASH_SECRET` warn block.

**Deliberate divergence from the `otpHashSecret` precedent**: the value MUST NOT have a
non-empty development fallback. `otpHashSecret` falls back to a literal string, but reusing that shape
here would make R18 unsatisfiable — with a known fallback in place, a cookie signed with that same
fallback would verify, and an unset production secret would silently _authorize_. The default MUST
therefore be the empty string, and cookie verification MUST treat an empty or absent secret as
"verification always fails". The naming and warn-if-missing convention follow the precedent; the
fail-closed direction is inverted on purpose.

The operator-facing consequence MUST be documented before the slice ships: `ORDER_ACCESS_COOKIE_SECRET`
SHOULD be documented in `.env.example` and the README env table, and MUST be set in every deployed
environment, because an unset secret is fail-closed by design and buyers then lose their own contact
and address sections on the order page (proposal risk R4).

#### Scenario: An unset secret invalidates every cookie

- GIVEN `ORDER_ACCESS_COOKIE_SECRET` is unset and a well-formed, unexpired `order_access_{token}`
  cookie is presented
- WHEN the page evaluates it
- THEN verification fails and the public projection is served — never the full row

#### Scenario: The warning is emitted

- GIVEN `ORDER_ACCESS_COOKIE_SECRET` is absent from the environment
- WHEN the config module loads
- THEN a warning is emitted, matching the existing `OTP_HASH_SECRET` warn block's behavior

Archived-state note (2026-10-02) — `env.ts` gained `orderAccessCookieSecret:
process.env.ORDER_ACCESS_COOKIE_SECRET || ''` beside `otpHashSecret` plus the warn block, with an
inline comment stating **why there is no dev fallback**. `orderAccessCookie.ts:111-112` returns `false`
**immediately and unconditionally** on an empty secret — not as a fallback path. `ORDER_ACCESS_COOKIE_SECRET`
is documented in `.env.example` **and** the README env table, both including the deliberate absence of
a development fallback and the requirement to keep the value **stable across deploys**.

## Non-requirement obligations (cleanup, no behavioral change)

- **Deleted the dead `getOrderDetails` server action.** `git grep` confirms zero callers (only its own
  file and a comment in `types.ts`), and it returned just
  `{ buyerDni, buyerEmail, buyerPhone, amount, currency }` — it could not serve the shipping,
  `pickupCode`, `ticketImageUrl` or `customerAuth` data the page renders, so it was never a viable SSR
  data path. Deleting it removes the shape a client-side PII fetch could be reintroduced through.
  `git grep -n "getOrderDetails\|GetOrderDetailsResult"` returns **zero hits**; `GetOrderDetailsResult`
  was dropped from `types.ts` and its shape block from `tests/unit/orderTrackingTypes.test.ts`.
  `CallerProof` (`ActionModals`, `ReportV2Flow`) is untouched — **W-A1 stays out of scope**.
- **Cookie signing uses no new dependency**: `node:crypto` `createHmac` / `timingSafeEqual`, following
  the `safeTokenEqual` precedent in `src/lib/tokenCompare.ts`. `src/utils/crypto.ts` has only AES and
  no HMAC.
- **The page is already dynamic** (`createClient()` → `cookies()`), so reading the access cookie adds no
  rendering constraint.

## REMOVED Requirements

> **Numbering note (2026-09-30).** The three requirements below carry the historical numbers
> **R7, R9 and R10** from `prod-access-hardening` (`archive.md` §Reconciliation). R7 and R9/R10 are
> consumed by these removed entries — they are **not** live requirements and are unrelated to the live
> R11/R12 buyer-gate pair above. Do not reuse the numbers.

### Requirement: Auth-intent rate limit on order track

(Reason: superseded by removal — `POST /api/order/track` had zero callers once WU1 deleted `TrackOrderModal`, its only consumer, and it duplicated the public DNI+orderNumber surface that `POST /api/order/lookup` already serves, without the seller self-confirmation block. The endpoint was deleted instead of limited, so there is nothing left to rate-limit. The auth-intent limit is a single requirement on the live surface: R8.)

### Requirement: verifyOrderAccessByDniAndOrderNumber

(Reason: dead — zero callers on this branch. The only live DNI+orderNumber surface left is `POST /api/order/lookup` (rate-limited, R8); `/api/order/track` was also removed in this change (see above). The private helper `getBusinessSlug` it exclusively used was removed with it — `git grep` returns 0 hits for both symbols.)

### Requirement: TrackOrderModal

(Reason: dead — defined, never rendered; the public storefront DNI+orderNumber surface is LookupOrderModal, which remains and is rate-limited via /api/order/lookup.)

## Numbering cross-reference (2026-09-30 archive)

This file's requirement numbers are **implicit in document order** for the original `prod-access-hardening`
requirements, and the delta's own references pin **R8 = "Auth-intent rate limit on order lookup"**. Two
different pairs therefore map onto the same numbers. Use this table:

| Published as                             | Is                                                    | Historical number                                                               | Source                       |
| ---------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------- |
| (unnumbered heading)                     | live — the 6 pre-existing non-rate-limit requirements | R1–R6                                                                           | `prod-access-hardening`      |
| `Auth-intent rate limit on order lookup` | live                                                  | **R8**                                                                          | `prod-access-hardening`      |
| **R11** (this file)                      | live — buyer gate on the shared limiter               | **R9** in delta #1137 / design #1138 / tasks #1141 / apply #1143 / verify #1150 | `access-hardening-followups` |
| **R12** (this file)                      | live — verified access resets the budget              | **R10** in those same artifacts                                                 | `access-hardening-followups` |
| `Auth-intent rate limit on order track`  | REMOVED                                               | R7                                                                              | `prod-access-hardening`      |
| `verifyOrderAccessByDniAndOrderNumber`   | REMOVED                                               | **R9**                                                                          | `prod-access-hardening`      |
| `TrackOrderModal`                        | REMOVED                                               | **R10**                                                                         | `prod-access-hardening`      |

**Why the live pair moved.** Renumbering the live requirements was unavoidable: the delta's R9/R10
collided head-on with two REMOVED requirements that already occupy those numbers in this very file, and
a reader could not have disambiguated them. Renumbering the **REMOVED** entries instead was rejected —
they are the historical record, and the REMOVED rationale text already cross-references R8, so
rewriting their numbers would have broken a live cross-reference for no gain. R11/R12 is the next free
pair.

### Continuation (2026-10-02)

The `order-integrity` C4 delta needed **no renumbering and no cross-reference entry**, because every
number it used (R13–R18) was free of both live and REMOVED entries — R11/R12 having just consumed the
next free pair. R7, R9 and R10 keep their REMOVED numbers and are still unrelated to the live buyer-
gate family. Pipeline artifacts for that change (`sdd/order-integrity/*`) say **R13–R18** exactly as
published here, so no mapping table is needed.

## Carried forward (2026-09-30)

- **`OrderAuthGate` never reads `rateLimited`.** `OrderAuthGate.tsx:186` and `:367` read only
  `res.success`, so a throttled buyer sees the generic mismatch error and is never told the attempt was
  rate limited. `rateLimited` exists in the action's result and is read by nothing. Recorded LOW and
  out of scope at every phase; the UI widening is its own slice.
- **The `'unknown'` client segment is still shared across header-less callers** (LOW, accepted). With the
  composite key it is a per-`dni` bucket, which is the required behavior, but the **rollout
  precondition** is that the deployed edge injects `x-forwarded-for` on server-action POSTs. If it does
  not, `'unknown'` is the production client segment and the gate degrades to per-`dni` **global**
  buckets — still better than the old per-IP global bucket, but a different shape than intended. Worth
  one `curl` before merge.
- **No proxy-level per-IP backstop for this route.** See the R11 archived-state note. A proxy bucket for
  page routes would be the structural fix; out of scope here.
- **`resetRateLimit` is a new public export** on a shared module (LOW, mitigated): single call site,
  `checkRateLimit`'s signature, one key-composition site, and `Map.delete` cannot throw.
- **`rateLimit.ts:41-44`** (the `cleanup()` reaping loop) remains uncovered; it needs >60s elapsed plus
  an expired entry, and it is pre-existing, unmodified logic. Both **new** functions are fully covered.

## Carried forward (2026-10-02 — `order-integrity` / C4)

Recorded at SDD archive. **Nothing here was fixed in this change**; each item is either a deploy
precondition, a product decision, or a pre-existing hole that the slice surfaced but did not close.

### The allowlist is the ONLY control — there is no defense in depth

**This is the most important line in this section.** All 31 PII read sites in `page.tsx` are
conditional renders (`order.buyerPhone && (…)`, `order.shippingAddress || (…)`), which render when
the value is truthy and **never suppress**. Therefore an _unguarded_ `order.<pii>` read is
**observationally identical** to a guarded one under both possible row shapes: given a row carrying
the value, both put it in the tree; given a projected row, both are `undefined` and neither renders.
**No tree-walking test can distinguish them.** Empirically proven — injecting an unguarded
`{order.buyerPhone}` left the suite **8/8 green**.

Consequences:

- The SQL projection allowlist (R14) is the **sole** control. A future unguarded PII read compiles,
  renders `undefined`, and is **not detectable** by any behavioural test.
- Black-box PII tests only catch a column that has **no existing render site** (shipped as mutation
  probe (a′) — unguarded `{order.shippingUbigeo}` → detected; (a) `{order.buyerPhone}` → not
  detected). The suite's two walk tests pin the **projection**, not the reads.
- **Closing it properly means writing the guard explicitly.** ~31 sites would each need an
  `hasFullAccess &&` prefix. That is a production change and was **deliberately scoped out** of this
  change (it is ~31 edits in the same file R14 touches, with its own review slice). A lint rule is
  **not** a viable substitute — `eslint.config.mjs` has no `no-restricted-syntax`, and "not inside a
  truthiness test" is not expressible without type information.

### Deploy preconditions (block merge + release)

1. **`ORDER_ACCESS_COOKIE_SECRET` is a NEW required deploy var.** Unset or empty ⇒ verification always
   fails ⇒ order access degrades to **unauthenticated** _by design_ (R18). It must be set in **every**
   environment **and be stable per environment**: rotation invalidates all live cookies, and the only
   recovery is the 1 h TTL self-heal. Set it **before** #204/#205 merge, or buyers lose their own
   contact and address sections.
2. **The deployed edge must inject `x-forwarded-for` on server-action POSTs** — still UNVERIFIED.
   Carried forward unchanged from the 2026-09-30 archive and it **blocks merges generally**, not just
   this one. Without it, `'unknown'` is the production client segment and R11 degrades to per-`dni`
   **global** buckets.

### Product decisions (need an owner)

3. **The `?dni=` auto-auth path is dead.** Under R15 it can never succeed for a numbered order. The
   infinite-spinner regression was fixed in slice B-i (#204), but the flow itself should be **demoted
   to a DNI prefill or deleted**. Both options were recorded at apply; the decision was never taken.
4. **`courierName` and `trackingNumber` render on the public path.** They are **not** in R14's
   exclusion list and the allowlist keeps them, so this is **spec-compliant** — but it is a real
   address-disclosure vector via the carrier. A product call, not a defect.
5. **`getStep()` no longer sees `ticketImageUrl` on the public path.** A `disputed` / `not_delivered`
   order therefore resolves **step 0 instead of step 1**. Cosmetic and arguably desirable (do not tell
   an unverified viewer a ticket exists), but it is an **undocumented** behavior change — it appeared in
   neither the apply report nor the spec amendment until verify surfaced it.

### Pre-existing holes in the file this change audited (NOT regressions of it)

6. **`updateOrderStatus` treats `callerProof` as OPTIONAL.** Anyone holding `(paymentId,
trackingToken)` — both in the RSC payload — can flip an order's status (`DELIVERED`, `DISPUTE`,
   `ISSUE_REPORTED`). This is **W-A1, pre-existing and explicitly out of scope**; C4 does not create it
   and does not fix it. Flagged because it lives in the same `actions.ts` this slice rewrote.
7. **`syncChatSession` has no caller proof either** — an anonymous holder can still resolve an order's
   chat `sessionId`, because `id` is in the allowlist and is passed to the client as `paymentId`.
   **B-ii narrows it**: `dni` is now `null` on the public path, so an unverified visitor gets the
   `guest-${paymentId}` identity and can no longer be merged into the buyer's `dni-{dni}` thread.
   Narrowed, not closed.
8. **`verifyOrderAccess` fetches the FULL row** (`actions.ts:131-133`) with no `columns` projection.
   It returns only `{success}`, so nothing leaks, but it is an unnecessary full-row read in the exact
   file this slice exists to stop doing that. Smallest fix: `columns: { orderNumber: true }` (`where`
   is independent of `columns`).
9. **Per-token cookie names accumulate** across many visited orders (1 h expiry, ~30-byte value).
   Accepted and documented, not engineered around.

### Verification gaps recorded honestly

10. **"The page renders without the PII keys" is satisfied structurally, not by a render.** The
    projection suite **invokes** the async server component (`await OrderTrackingPage({params})`) rather
    than rendering it, deliberately — doing otherwise would require mocking ~15 child components
    (real DOM nodes, supabase clients, charts, the realtime channel). It therefore proves the fetch is
    projected and that the page function runs to completion, **not** that the rendered tree is
    throw-free. That risk is currently carried by the fact that **every** PII read point was verified
    to be truthiness-guarded or `??`-coerced.
11. **`metadata` is not selected on the public path**, which disables server-side Google pre-auth
    (`page.tsx:240` is already `if (user && order.metadata)`, so nothing crashes). A Google buyer makes
    one extra client-gate pass, which mints the cookie (R13), and the next request is fully projected.
    Accepted at design time; the rejected alternative was keeping `metadata.customerAuth.authId`, and
    **an `authId` is buyer identity**, so R14 forbids it.
12. **Slice B-i alone (PR #204) is not a security fix.** It ships a cookie that nothing reads yet. If
    #204 merges without #205, exposure is unchanged. **Merge #205 with it, or treat #204 as inert
    plumbing.**
