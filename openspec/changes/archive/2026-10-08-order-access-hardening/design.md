# Design: Order Access Hardening

**Change**: `order-access-hardening` · **Base**: `feat/order-integrity-b2` @ `63c09e6` · **Store**: openspec + engram
**Requirements**: R19–R25 (`sdd/order-access-hardening/spec` #1181) · **TDD**: `strict_tdd: true`

## Technical Approach

No new dependency, no migration, no new capability. Three slices stack on the parent chain, each a
`feature-branch-chain` child so **#205 stays the single merge point**.

- **Slice A** gates the three customer mutations on `verifyOrderAccessCookie(trackingToken)`
  (`orderAccessCookie.ts:109`), introducing one shared gate helper shaped like the repo's existing
  `requireOrderManager` (`finalizationActions.ts:67-69`), and a typed refusal vocabulary R20 mandates.
- **Slice B(i)** moves `businessSlug` into the lookup `WHERE` so the cross-tenant 403-vs-404 oracle
  collapses into one neutral 404. **Slice B(ii)** splits the verify page into a permanent public
  verdict and a cookie-gated surface, on two sequential reads, behind a `(IP, orderNumber)` throttle.
- **Slice C** deletes the `?dni=` auto-auth block and renders an explicit non-submittable state for
  `orderNumber IS NULL` orders.

## Architecture Decisions

### D1 — Gate mutations (a), do not remove `paymentId` from the payload

| Option | Δ lines (incl. tests) | Test impact | Verdict |
|---|---|---|---|
| **(a) Gate** — cookie check first in the 3 actions | **+170 / −20 ≈ 190**, 5 files | `orderPageProjection.test.ts` assertions byte-identical | **CHOSEN** |
| (b) Remove `id` from `PUBLIC_ORDER_COLUMNS` + narrow types | +95 / −15 ≈ 110, **9 files** | literal at `:36-53` loses `id`; ~55 new lines | Deferred |
| (b) without (a) | ~110 | — | **Rejected** |

**(a) is chosen.** Three reasons, in order of weight:

1. **`(b)` is not a one-line allowlist edit — it is a type-narrowing refactor.** The conditional spread
   at `page.tsx:132` makes drizzle infer the **full row type** for both branches (comment at
   `page.tsx:119-127`). Removing `id: true` therefore compiles unchanged and yields `undefined` at
   runtime. Doing `(b)` *safely* means threading `paymentId: string | undefined` through **seven**
   components and guarding nine call sites (`page.tsx:521,522,939,1316,1739,1745,1748` plus the
   `order.id.slice(0, 8)` fallbacks at `:810,:1414`). Shipping `(b)` *unsafely* ships
   `paymentId={undefined}` into an action — a worse failure mode than a clean typed refusal.
2. **A behavioural control beats a data control.** `(a)` holds even if `id` is disclosed anywhere else
   (logs, other endpoints, a future column). The allowlist is a one-entry edit that the very test we
   want to keep green pins — and that test is the tripwire: if any future slice touches
   `PUBLIC_ORDER_COLUMNS`, `orderPageProjection.test.ts:319` fails.
3. **Scope + budget.** R19 requires the gate, not the column removal. `(a)+(b)` ≈ 290 changed lines
   across 14 files and merges a refactor into the highest-severity slice.

**Answer to "does (b) break the seller/team UI path?" — no, and that is not the cost.** Sellers and
team members are already refused at `page.tsx:149-160`; they never reach this projection, and
`PUBLIC_ORDER_COLUMNS` is module-local to `page.tsx`. `(b)` touches **only** the anonymous path of one
page. The cost is the seven-component refactor, not the tenant paths.

**Is there a legitimate unauthenticated mutation? No.** Every mutation flips buyer-visible order state
and all three are only ever mounted inside `OrderAuthGate`'s authenticated branch
(`page.tsx:514-519` wraps `:522`, `:1739`, `:1745`, `:1748`).

**(b) is a named follow-up**, prerequisite: replace the conditional spread at `:132` with two
distinctly-typed queries so `paymentId` is `string | undefined` on the anonymous path. Recorded in
`Open Questions`.

### D2 — Verify page: fetch token → verify → render. Never redirect.

The cookie name embeds the tracking token, so it cannot be named before the row is read, and the
token must not reach an anonymous visitor. The only correct ordering is **two sequential reads**:

```
params → rate limit (R23) → Q_A (businessId, orderNumber)
       → Q_A returns trackingToken (server-local only)
       → verifyOrderAccessCookie(trackingToken)
       → hasFullAccess ? Q_B (metadata, productId) : skip
       → render: public verdict ALWAYS + gated surface iff hasFullAccess
```

Leak surfaces, each closed by construction:

| Surface | Status | Rule |
|---|---|---|
| `generateMetadata` | **Does not exist** in the verify page (verified: only `default` is exported) | **Do not add one.** A metadata read would need its own projection; adding one is out of scope. |
| Thrown error | Closed | `notFound()` fires only at `:44` for a missing business. No `console.error(payment)`, no token in any message. |
| `redirect()` | **Never called** | A redirect to `/{slug}/order/{token}` would put the token in `Location` and in the RSC flight. There is **zero** redirect in this page, before or after. Re-auth is reached via the store's lookup modal / Google popup, which return the token legitimately. |
| RSC payload | Closed | `trackingToken` is selected (needed for the cookie name) but is only *read* inside `payment.trackingToken &&` guarded JSX at `:361-363`; it is never passed to a component prop. |

### D3 — Rate-limit key: degrade the key, never fail open

Reuse `getClientIdentifierFromHeaders(await headers())` (`rateLimit.ts:106-113`), already used by the
server action at `actions.ts:121`. New key `${clientIp}:order:${orderNumber.slice(0, 64)}` via a new
`checkOrderVerifyRateLimitFor(clientId, orderNumber)` in `orderAccessRateLimit.ts` charging
`RATE_LIMITS.storefront` (`rateLimit.ts:27`, 60/min) through the existing `checkRateLimit`. **No second
counter store.** The 64-char cap mirrors `MAX_DNI_KEY_LENGTH` (`:24`) because `orderNumber` is
attacker-controlled from the URL.

**Missing / spoofable header.** When all three headers are absent the helper returns `'unknown'`, so
the key degrades to `unknown:order:<n>` — **one shared per-order-number bucket**. That is a *harsher*
cap, not a bypass, so **there is no fail-open branch and no fail-closed branch: the limiter always
charges and always 429s when exhausted.** Failing closed on a missing header would convert a throttle
into an availability dependency for the printed-ticket UX that R22 protects; failing open would switch
the limiter off exactly when the edge is broken.

**New finding (surfaced by this design).** `getClientIdentifierFromHeaders` takes
`x-forwarded-for.split(',')[0]` — the **leftmost, client-supplied** hop. `proxy.ts` never rewrites it
(only reads `x-forwarded-host` at `:104`). So the identity is **per-request spoofable**, which is the
direction that defeats this limiter. We therefore do **not** invent a trusted-IP mechanism: taking the
rightmost hop instead would let `X-Forwarded-For: victim, spoofed` throttle a victim. This is W-I1,
stated plainly, and Slice B **MUST NOT** be described as closing W-A3 or the verify-page enumeration
exposure. `RATE_LIMITS.storefront` at 60/min is a throttle, not a brute-force wall.

### D4 — Refusal vocabulary and re-auth (`reauth_required`)

Follow the repo's gate convention (`finalizationActions.ts:67-69`): a discriminated result plus a
module-level neutral error constant (`:24`).

| `reason` | Emitted when | UI |
|---|---|---|
| `reauth_required` | cookie absent / expired / tampered / bound to another token | **Recoverable** — re-mint |
| `order_not_found` | `(paymentId, trackingToken)` misses | generic |
| `order_not_actionable` | cookie valid, status outside `CONFIRMABLE_STATUSES` (`:284-290`) | generic |

Deliberately **not** added: a distinct reason for a present-but-failing `callerProof`. R20 requires
only the reauth/non-reauth split, and the existing `error` string already differs. Recorded as optional.

**`OrderAuthGate.tsx:380-382` cannot render the reauth reason — correction to the phase brief.**
`:380-382` is a fixed string for a *failed form submit* (`setError('El DNI o N° de orden no
coinciden…')`). It is not a reason renderer, and `OrderAuthGate` needs **zero** changes.

`ConfirmationFlow.tsx:33-45` therefore owns the handler: on `reason === 'reauth_required'`,
`localStorage.removeItem(\`order_session_${trackingToken}\`)` then `router.refresh()` — the gate's own
state machine re-mints (Google: `checkGoogleAuth`, `:107-142`; DNI: the form at `:352-388`). One
user-driven loop, no new route, no `?reauth=` param (rejected — it is the W-A2 pattern Slice C deletes).

**Why the buyer can be stranded at all.** The gate reads `localStorage` (`:163-178`, `SESSION_TTL` 1 h
at `:20`) while the cookie's `expMs` is computed on the **server** clock (`orderAccessCookie.ts:91`).
Clock skew, or a browser evicting the httpOnly cookie while keeping localStorage, yields
gate-passed + cookie-failed. Reachable, not theoretical.

**`serverPreAuth` is safe by construction — verified, and the reviewer should check it.**
`page.tsx:239-247` derives `serverPreAuth` from `order.metadata`, and `metadata` is **outside**
`PUBLIC_ORDER_COLUMNS` (`page.tsx:41-43`), so `serverPreAuth === true` is only reachable on a request
that already verified a cookie at `:113`. There is no Google-buyer path that passes the gate without
a cookie, and no cookie re-mint is needed on that branch.

## Data Flow — Slice A

```
browser ──▶ actions.ts :67 ─┐
                             ├─▶ requireOrderAccess(trackingToken)
                             │      └─▶ verifyOrderAccessCookie  ──┬─ ok ─▶ callerProof? ─▶ transition()
                             │                                    └─ no ─▶ { reason:'reauth_required' }  ✗ no write
browser ──▶ finalizationActions :270 ─▶ same gate ─▶ … ─▶ transition(COMPLETED)
                                                             │
                                                             └─▶ ConfirmationFlow :38 ─▶ clear session ─▶ refresh ─▶ re-mint
```

## File Changes

| Slice | File | Action | Description |
|---|---|---|---|
| A | `src/lib/orderAccessGate.ts` | **Create** | `requireOrderAccess(trackingToken)`, the refusal vocabulary, neutral error strings |
| A | `app/[slug]/(app)/order/[token]/actions.ts` | Modify | Gate `updateOrderStatus` (`:67`, before the proof block `:68-70`) and `reportIssueV2` (`:356`, before `:357-363`); add `reason?` to `ReportIssueV2Result` (`:339-342`) |
| A | `src/features/dashboard/actions/finalizationActions.ts` | Modify | Gate `confirmFinalization` (`:270`) before the payment read; add `reason?` to `FinalizationActionResult` (`:81-87`); `order_not_actionable` at `:284-290` |
| A | `app/[slug]/(app)/order/[token]/ConfirmationFlow.tsx` | Modify | `reauth_required` branch at `:38-39`: message + `removeItem` + `router.refresh()` |
| B(i) | `app/api/order/lookup/route.ts` | Modify | Resolve business by slug, add `eq(payments.businessId, …)` at `:103`, drop `with.business` (`:108-114`) and the 403 (`:128-133`); **one** neutral 404 constant, no echoed DNI/order number |
| B(ii) | `app/[slug]/(app)/order/verify/[orderNumber]/page.tsx` | Modify | Rate limit → Q_A (`:48-65`) → `verifyOrderAccessCookie` → Q_B; drop `buyerEmail` `:57`, `ticketUrl` `:62`, `id` `:52`; move `metadata` `:61` + `productId` `:63` to Q_B; gate cart `:279-316` and tracking link `:361-363`; neutral 429 state |
| B(ii) | `src/lib/orderAccessRateLimit.ts` | Modify | `buildOrderVerifyIdentifier` + `checkOrderVerifyRateLimitFor` |
| C | `app/[slug]/(app)/order/[token]/OrderAuthGate.tsx` | Modify | Delete `:180-211`; drop `useSearchParams`/`useRouter`/`usePathname` imports `:5,29-31` and deps `:217`; `orderNumber: string \| null` (`:12`) + non-submittable state before the spinner at `:390` |
| — | `tests/unit/orderPageProjection.test.ts` | **Unchanged** | Tripwire for D1. Every assertion stays byte-identical. |

## Interfaces / Contracts

```ts
// src/lib/orderAccessGate.ts
export type OrderAccessRefusalReason =
  | 'reauth_required' | 'order_not_found' | 'order_not_actionable';

export type OrderAccessDecision =
  | { ok: true }
  | { ok: false; reason: OrderAccessRefusalReason };

/** MUST be called at the top of the action, before the first DB read and
 *  outside any status-flow branch (mirrors requireOrderManager, design D4). */
export async function requireOrderAccess(trackingToken: string): Promise<OrderAccessDecision>;

// src/lib/orderAccessRateLimit.ts
export function buildOrderVerifyIdentifier(clientIp: string, orderNumber: string): string;
export function checkOrderVerifyRateLimitFor(
  clientId: string, orderNumber: string,
): OrderAccessRateLimitResult;
```

`ActionModals` behaviour is **unchanged** under D1(a): it keeps `paymentId: string`
(`ActionModals.tsx:24`) and its `getCallerProof` localStorage read (`:9-21`) is untouched, still
forgeable and still defense-in-depth only — the server no longer consults it as the primary gate.

## Testing Strategy

`strict_tdd: true` — **every scenario lands RED before its implementation**, per slice.

| Suite (new unless noted) | Covers | Approach |
|---|---|---|
| `orderMutationCookieGate.test.ts` | R19 ×5, R20 ×3 | Mock `@/lib/orderAccessGate` + `transition`; assert refusal writes nothing and `reason` is typed. Assert the gate is **called before** any `db` read (call-order assertion) |
| `confirmFinalizationCookieGate.test.ts` | R20 ×2 (expired→`reauth_required`, non-confirmable→not-`reauth_required`) | Extend the `requestFinalizationAuthz.test.ts` mock style |
| `orderLookupTenantScope.test.ts` | R21 ×4 | Assert the `WHERE` carries `businessId`; assert cross-tenant and non-existent return **byte-identical** status + body; assert no 403 |
| `orderVerificationPage.test.ts` (**modify**, exists) | R22 ×5, R23 ×3 | Reuse the proven pattern from `orderPageProjection.test.ts`: invoke the server component, walk the returned tree with a sentinel leaf-collector, and emulate drizzle `columns` |
| `OrderAuthGate.test.tsx` (**rewrite**, 1 test today) | R24 ×5, R25 ×3 | Keep the `useSearchParams` mock and assert `verifyOrderAccess` is **never** called with the DNI; assert no form for `orderNumber={null}` |
| `orderPageProjection.test.ts` | **regression tripwire** | Must stay green unmodified — proves D1 |
| `verifyOrderAccess.test.ts:511-534` | R15 | **Stays** — R24 removes the client path, not the server-side denial |
| `orderLogoutButton.test.tsx`, `orderAccessCookie.test.ts` | regression | Untouched |

Baseline: 2262 tests, `pnpm test:unit` green, `pnpm type-check` 0 errors, `pnpm lint` at the
pre-existing baseline.

## Migration / Rollout

No migration, no schema change, no feature flag. **Hard pre-deploy gate for Slice A:** set
`ORDER_ACCESS_COOKIE_SECRET` to a strong random value in **every** Vercel environment *before* #207
merges. Unset ⇒ `verifyOrderAccessCookie` returns `false` unconditionally
(`orderAccessCookie.ts:112-113`, `env.ts:56`) ⇒ **every legitimate buyer is denied** on all three
mutations. `env.ts:109-114` only logs `console.warn` — the failure is silent at boot. Sequence:
deploy #207 to **preview**, smoke-test a full `verifyOrderAccess` → mutate round trip, then promote.

## Chain & Branch Plan

`feature-branch-chain`, severity order. **#205 remains the single merge point.**

| PR | Branch | Target | Δ lines | Budget |
|---|---|---|---|---|
| **#207** | `feat/order-access-hardening-a-mutations` | `feat/order-integrity-b2` (63c09e6) | **≈190** (+28 helper, +30 actions, +14 finalization, +22 `ConfirmationFlow`, +96 tests) | ✔ |
| **#208** | `feat/order-access-hardening-b-order-number` | `…-a-mutations` | **≈330** (+22 lookup, +70 verify page, +22 limiter, +216 tests) | ✔ tight |
| **#209** | `feat/order-access-hardening-c-dni-autauth` | `…-b-order-number` | **≈75** (−32 dead block, +14 R25 state, ±29 tests) | ✔ |

#206 is the openspec spec-tracking PR and is unrelated. Combined ≈ 595 lines — comfortably over the
400-line review budget as one PR, which is the whole reason for the chain. Rollback is a pure
`git revert` per slice.

## Risks & Resolutions

| # | Risk | Resolution |
|---|---|---|
| 1 | **Printed-ticket UX** (`ticket/generate/route.ts:188`) | The verdict stays **public**: valid/invalid, masked DNI last-4, status, amount, date, store. Gate only cart line items + the `trackingToken` link. The page is **never** fully gated. |
| 2 | `confirmFinalization` strands an expired buyer (TTL 3600) | `reauth_required` + clear-session + refresh (D4). Self-heals via the Google auto-link or the DNI form. |
| 3 | In-memory limiter is a speed bump | Stated, not hidden. W-I1/W-A3 stay open. New finding: the client-supplied XFF hop-0 makes the identity per-request spoofable (D3) — recorded, deliberately not "fixed" with a worse scheme. |
| 4 | `ORDER_ACCESS_COOKIE_SECRET` unset ⇒ all buyers denied | Pre-deploy gate above; preview smoke test before promoting #207. Slice A is the only lethal-without-it slice. |
| 5 | `(b)`-style removal re-introduced later without the type narrowing | `orderPageProjection.test.ts:319` exact-`toEqual` fails on any allowlist change. Named in `Open Questions`. |
| 6 | `LookupOrderModal.tsx:219-221` | `setError(data.error \|\| fallback)` already renders a constant → **no component change**. A nonexistent slug now 404s where it previously 403'd; both are refusals. |
| 7 | Business-existence timing delta in lookup | The slug is public (it is in every storefront URL), so the slug pre-lookup discloses nothing about any **order**. R21's ordering guarantee — no cross-tenant row reaches response-deciding code — holds. |

## Open Questions

- [ ] **Follow-up D1(b):** narrow `page.tsx`'s conditional spread at `:132` into two distinctly-typed
      queries, then drop `id` from `PUBLIC_ORDER_COLUMNS` and thread `paymentId: string | undefined`
      through `ActionModals`, `ConfirmationFlow`, `ReportFlow`, `ReportV2Flow`, `OrderV2Timeline`,
      `OrderRealtimeHandler`, `OrderChatSection`. Own change; not required by R19.
- [ ] Optional `not_authorized` reason for a present-but-failing `callerProof` (D4). Deferred to keep
      Slice A inside budget.
- [ ] `LookupOrderModal.tsx` slug case sensitivity is inconsistent with the seller guard
      (`lookup/route.ts:69,88` use `.toLowerCase()`, the DB lookup does not). Pre-existing; unchanged here.