# Tasks: Order Access Hardening

**Change**: `order-access-hardening` · **Base**: `feat/order-integrity-b2` @ `63c09e6`
**Inputs**: proposal #1179, spec #1181 (R19–R25, 28 scenarios), design #1182
**TDD**: `strict_tdd: true` (`pnpm test:unit`) — every task below is RED then GREEN.
**Budget metric**: `additions + deletions` (churn), against `review_budget_lines: 400`.

Every `file:line` below was re-read from source at `63c09e6` in this phase, not copied from the design.

## Review Workload Forecast

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: Medium
```

| PR | Work unit | Reqs | Est. churn | Slack vs 400 | Risk |
|---|---|---|---|---|---|
| **#207** | Slice A — mutation cookie gate | R19, R20 | **≈230** (210–250) | ≈170 | Low |
| **#208a** | Slice B-i — lookup tenant scoping | R21 | **≈140** (120–160) | ≈260 | Low |
| **#208b** | Slice B-j — verify page split + throttle | R22, R23 | **≈285** (260–310) | ≈115 | Medium |
| **#209** | Slice C — delete `?dni=` auto-auth | R24, R25 | **≈175** (150–200) | ≈225 | Low |
| | **Total** | R19–R25 | **≈827** | | |

The design (#1182) forecast 190 / 330 / 75 ≈ 595 total. This phase's verified forecast is **≈827** — 39% higher.
Four PRs, not three. Delivery strategy `ask-on-risk` ⇒ the orchestrator must surface the B split + the
#208b de-scope lever (B-j.7) before `sdd-apply`.

### Corrections to the design's line estimates

| # | Design said | Verified | Why the design under-counted |
|---|---|---|---|
| 1 | B = ≈330 | **B = ≈422** | The design counted only additions for `lookup/route.ts` (+22). `:117-133` collapses 17 lines into ~9 (`+9/−17` = 26 churn, not 8), and the slug resolution is +13, not folded in. |
| 2 | A tests +96 | **A tests +142** | Two new suites (R19×5 + R20×3 with the call-order assertion, then R20×2), not one. |
| 3 | C ≈75, "net negative" | **C ≈175, net +11** | Production code *is* net negative (−20), but rewriting an 81-line 1-test suite into 8 tests costs ~123 churn. |

**B at 422 is already 22 lines OVER the budget undivided** — before any TDD drift. 330 was an undercount,
not a tight fit. Do not attempt to hold B in one PR.

---

## Slice B split decision — FOUR PRs (#208a + #208b)

The brief asks whether B becomes a fourth PR or two commits inside #208, with the math. It is a fourth PR.

| Option | Layout | Churn | Verdict |
|---|---|---|---|
| **1** | **#208a (B-i, R21) + #208b (B-j, R22+R23)** | 140 + 285 | **CHOSEN** |
| 2 | Two commits inside one #208 | 422 in a single diff | **Rejected** |
| 3 | #208a = R23 limiter only, #208b = R22 split | ~90 + ~330 | **Rejected** |

**Why option 2 fails.** A commit is not a review unit — a PR diff is reviewed as a whole. 422 churn in one
PR needs a `size:exception`, which is exactly the guard the `feature-branch-chain` exists to avoid. The
design's own words: the chain exists *because* the total is over budget. Two commits do not move that
number; they only hide it behind a green history.

**Why option 3 fails.** Shipping the limiter alone throttles a page that still discloses the full cart and
the `trackingToken` link — it forces the expensive test-harness rewrite for zero security payoff, and leaves
#208b carrying the harness *plus* the surface split. Option 1 splits along the design's own B(i)/B(ii)
seam: two requirement groups, two independently shippable units, two independent reverts.

**Chain (unchanged shape, one extra link):**

| PR | Branch | Target |
|---|---|---|
| #207 | `feat/order-access-hardening-a-mutations` | `feat/order-integrity-b2` @ `63c09e6` |
| #208a | `feat/order-access-hardening-b-i-lookup-tenant` | `…-a-mutations` |
| #208b | `feat/order-access-hardening-b-j-verify-page` | `…-b-i-lookup-tenant` |
| #209 | `feat/order-access-hardening-c-dni-autauth` | `…-b-j-verify-page` |

`#205` stays the single merge point. Never merge to `develop` or `main`.

---

## Work Unit A — PR #207 — Mutation authorization on the signed access cookie (R19, R20)

Design decision D1 (gate, do not remove `paymentId`). New `src/lib/orderAccessGate.ts` shaped like the
repo's own `requireOrderManager` (`finalizationActions.ts:67-69`): discriminated result + module-level
neutral error constants. Called at the top of each action, **before the first DB read**.

- **A.1 — R19 ×5, R20 ×3 — RED.** Create `tests/unit/orderMutationCookieGate.test.ts` (new file). Mock
  `@/lib/orderAccessGate` + `OrderService.transition`. Assert: no cookie refuses and writes nothing; forged
  / truncated / attacker-chosen-`expMs` refused; valid cookie + valid `callerProof` proceeds; valid cookie
  **without** proof proceeds (the cookie is the authority — a missing proof MUST NOT deny); order A's cookie
  does not authorize order B. Plus a **call-order assertion**: record the gate invocation and the first
  `db` read into one ordered array and assert the gate index precedes the first `db` index for
  `updateOrderStatus`, `reportIssueV2` and `confirmFinalization`. Red: the gate module does not exist.
  `test(order-access): assert R19 cookie gate precedes any db read on mutations`
- **A.2 — GREEN.** Create `src/lib/orderAccessGate.ts`: `OrderAccessRefusalReason` (`reauth_required` |
  `order_not_found` | `order_not_actionable`), `OrderAccessDecision`, `requireOrderAccess(trackingToken)`
  delegating to `verifyOrderAccessCookie` (`orderAccessCookie.ts:109`), plus neutral `GATE_ERROR` constants.
  `feat(order-access): add requireOrderAccess cookie gate helper`
- **A.3 — GREEN.** `app/[slug]/(app)/order/[token]/actions.ts` — insert the gate at **`:67`**, before the
  `options?.callerProof` block `:68-70` and before the first DB read at `:72`. `callerProof` stays as
  defense-in-depth, unchanged. `feat(order-access): gate updateOrderStatus on the signed access cookie`
- **A.4 — GREEN.** `actions.ts:339-342` — add `reason?: OrderAccessRefusalReason` to `ReportIssueV2Result`.
  Same commit as A.3.
- **A.5 — GREEN.** `actions.ts` — insert the gate at **`:356`**, before the `callerProof` block `:357-363`.
  `feat(order-access): gate reportIssueV2 and type ReportIssueV2Result reason`
- **A.6 — GREEN.** `src/features/dashboard/actions/finalizationActions.ts` — add `reason?` to
  `FinalizationActionResult` (`:81-87`); insert the gate at **`:270-271`**, before the payment read `:272`;
  set `order_not_found` on `:278-281` and `order_not_actionable` on the `CONFIRMABLE_STATUSES` return
  `:284-290` (verified: the action has **no** proof parameter today).
  `feat(order-access): gate confirmFinalization with typed refusal reasons`
- **A.7 — R20 ×2 — RED.** Create `tests/unit/confirmFinalizationCookieGate.test.ts` (new file), extending
  the `requestFinalizationAuthz.test.ts` mock style. (1) A lapsed cookie on `confirmFinalization` refuses with
  `reauth_required`, writes nothing, and the buyer can re-mint with DNI + order number. (2) A valid cookie on
  an order outside `CONFIRMABLE_STATUSES` refuses with a reason that is **not** `reauth_required`.
  `test(order-access): cover R20 reauth vs order_not_actionable on confirmFinalization`
- **A.8 — GREEN.** `app/[slug]/(app)/order/[token]/ConfirmationFlow.tsx:37-40` — on
  `result.reason === 'reauth_required'`: set the re-auth message, `localStorage.removeItem(\`order_session_${trackingToken}\`)`
  (mirrors `OrderAuthGate.tsx:172`), then `router.refresh()`. **R20 owner correction: this is
  `ConfirmationFlow`, not `OrderAuthGate`.** `OrderAuthGate.tsx:380-382` is a fixed string for a failed form
  submit, not a reason renderer — `OrderAuthGate` takes **zero** changes for R20.
  `feat(order-access): clear session and refresh on reauth_required`
- **A.9 — Regression gate.** `orderPageProjection.test.ts` green with **every assertion byte-identical**
  (its `:319` `toEqual(PUBLIC_ORDER_COLUMNS)` is the D1 tripwire). `verifyOrderAccess.test.ts:511-534` (R15)
  green, untouched. `orderAccessCookie.test.ts`, `orderLogoutButton.test.tsx` untouched. `pnpm test:unit`
  ≥ 2262 passing, `pnpm type-check` 0 errors, `pnpm lint` at the pre-existing baseline.
- **A.10 — Pre-deploy gate (blocking, before #207 merges).** `ORDER_ACCESS_COOKIE_SECRET` must exist and be
  STABLE in **every** Vercel environment. `src/config/env.ts:56` defaults it to `''` and `:109-114` only
  `console.warn`s, so the failure is **silent at boot**; an unset secret makes `verifyOrderAccessCookie`
  return `false` unconditionally (`orderAccessCookie.ts:112-113`) and **every legitimate buyer fails R19**.
  Sequence: set the env → deploy #207 to **preview** → smoke-test a full `verifyOrderAccess` → mutate round
  trip → promote. Slice A is the only lethal-without-it slice in this change.

**Rollback A**: `git revert` the merge commit on `…-a-mutations`. No migration, no schema change, no data
rewrite. The revert re-opens W-A1 (documented, pre-existing). If the secret itself is the problem, rolling
back does **not** restore access — unset/deploy `ORDER_ACCESS_COOKIE_SECRET` first.

---

## Work Unit B-i — PR #208a — `POST /api/order/lookup` tenant scoping (R21)

**B-i.1 — RED.** Create `tests/unit/orderLookupTenantScope.test.ts` (new file), R21 ×4. Invoke `POST()`
twice — once with a pair owned by another tenant, once with a pair that does not exist — and assert the
status **and the serialized body are byte-identical**. Also assert the captured drizzle `where` carries
`payments.businessId`, that no 403 status is reachable, and that the success path still returns
`{ success: true, token }`. `test(order-access): assert cross-tenant lookup is indistinguishable from 404`
**B-i.2 — GREEN.** `app/api/order/lookup/route.ts` — resolve the business by slug
(`db.query.businesses.findFirst({ columns: { id: true } })`) before the payment query; add
`eq(payments.businessId, business.id)` to the predicate at `:103`; **delete** `with.business` `:108-114`.
`feat(order-access): scope order lookup by business in the sql predicate`
**B-i.3 — GREEN.** `lookup/route.ts:117-133` — **collapse** the two refusals into **one** neutral 404
returned from a module-level constant that does **not** echo the DNI or the order number (today `:122`
interpolates both). Delete the `payment.business?.slug !== businessSlug` 403. The seller/team 403s at
`:69-77` and `:86-98` stay — they gate by *authenticated identity*, not by tenant existence, so they reveal
nothing about an order. `refactor(order-access): collapse lookup refusals into one neutral 404`
**B-i.4 — Regression gate.** `LookupOrderModal.tsx` needs **no** edit — `:219-221` already renders
`data.error || <neutral fallback>`, so this is message-only. Full `pnpm test:unit` + type-check + lint.

**Rollback B-i**: `git revert` — restores the 403-vs-404 oracle (the pre-change state the audit already
describes). No schema, no data, no coordination window.

---

## Work Unit B-j — PR #208b — Verify page: public verdict + gated surface + throttle (R22, R23)

Design decision D2: `params → limiter → Q_A → verifyOrderAccessCookie → Q_B (only if gated) → render`.
Two sequential reads. **Never** `redirect()` (it would put the token in `Location` and the RSC flight) and
**never** gate the page in full — `app/api/ticket/generate/route.ts:188` prints this URL on the ticket.

**B-j.1 — R22 ×5, R23 ×3 — RED.** **Modify** `tests/unit/orderVerificationPage.test.ts` (exists, 92 lines,
3 shallow `toBeDefined()` tests). Do **not** create a parallel harness: reuse `collectLeafStrings` (249),
`surfacedSentinels` (276), `applyProjection` (206), `isElementLike` (229) and `invokePage` (292) from
`orderPageProjection.test.ts`. Add a `next/headers` mock and a drizzle `columns` emulator. Scenarios:
anonymous sees verdict only, no cart items, no `trackingToken` link; a verifying cookie unlocks both;
`buyerEmail` and `ticketUrl` absent from the selection and `metadata` only on the gated path; the
printed-ticket URL still renders a useful verdict; another order's cookie does not unlock; the limiter key
is `(IP, orderNumber)` sourced from `headers()`; it charges `RATE_LIMITS.storefront` through the shared
`checkRateLimit` with no second counter store; an exhausted budget renders one neutral **order-independent**
state for both existing and non-existent order numbers.
`test(order-access): cover R22 surface split and R23 throttle on the verify page`
**B-j.2 — GREEN.** `src/lib/orderAccessRateLimit.ts` — append `buildOrderVerifyIdentifier(clientIp, orderNumber)`
(mirroring `buildOrderAccessIdentifier` at `:31-37`; 64-char cap mirroring `MAX_DNI_KEY_LENGTH` `:24`,
because `orderNumber` is attacker-controlled from the URL) and `checkOrderVerifyRateLimitFor` charging
`RATE_LIMITS.storefront` (`rateLimit.ts:27`, 60/min) via the existing `checkRateLimit`. **No second
counter store.** `feat(order-access): add (IP, orderNumber) limiter for the verify page`
**B-j.3 — GREEN.** `app/[slug]/(app)/order/verify/[orderNumber]/page.tsx` — after `cleanOrderNumber`
(`:28`), derive the identity with `getClientIdentifierFromHeaders(await headers())` (`rateLimit.ts:106`)
and charge the limiter; on exhaustion render a neutral, order-independent state. Always charge, always 429
when exhausted — there is **no** fail-open and **no** fail-closed branch.
`feat(order-access): throttle the verify page keyed by IP and order number`
**B-j.4 — GREEN.** `page.tsx:48-65` — split the 13-column allowlist into Q_A + Q_B. **Delete** the unused
`id` (`:52`), `buyerEmail` (`:57`) and `ticketUrl` (`:62`). Move `metadata` (`:61`) and `productId` (`:63`)
into Q_B. Call `verifyOrderAccessCookie(payment.trackingToken)` **server-locally** → `hasFullAccess`. The
token is read for the cookie name only and is never passed to a component prop.
`feat(order-access): split the verify page into a public verdict and a gated read`
**B-j.5 — GREEN.** `page.tsx` — gate the cart block `:279-316` and the `trackingToken` link `:361-363` on
`hasFullAccess`; guard the `metadata`-derived `rawCartItems` `:69-77` and the products query `:92-102` so an
anonymous visitor never triggers the second read. Public verdict stays unconditional: masked DNI `:352`,
status, amount, date, store. `feat(order-access): gate cart items and tracking link behind the access cookie`
**B-j.6 — Regression gate.** Load the printed-ticket URL with no session and no cookie — the page renders a
useful verdict (risk 1 resolved). No `redirect()` and no `generateMetadata` added (D2 leak table).
**B-j.7 — De-scope lever (authorised, apply only if the diff trends past 340).** If the harness in B-j.1
runs long, drop the leaf-walk assertions for the two 429 scenarios and assert
`JSON.stringify(tree)` `toContain` / `not.toContain` instead. Do **not** drop a scenario — R22 ×5 and R23 ×3
all ship.

**R23 must NOT be documented as closing the enumeration exposure.** Two findings stand on the record:
1. The limiter is an in-memory `Map` per Vercel instance (`rateLimit.ts:30-32`) — neither shared nor
   persistent. `RATE_LIMITS.storefront` at 60/min is a **throttle, not a brute-force wall**.
2. `getClientIdentifierFromHeaders` reads `x-forwarded-for.split(',')[0]` — the **leftmost, client-supplied**
   hop, and `proxy.ts` never rewrites it. The identity is therefore **per-request spoofable**. The design
   deliberately did **not** switch to the rightmost hop: `X-Forwarded-For: victim, spoofed` would let an
   attacker throttle a victim. Audit **W-I1 / W-A3 stay open**.

**Rollback B-j**: `git revert` — restores the public cart and the public `trackingToken` link (the pre-change
state). If the 429 state causes a false-positive lockout, revert this slice only; #207 and #208a are unaffected.

---

## Work Unit C — PR #209 — Delete the `?dni=` auto-auth flow (R24, R25)

**Mostly deletions.** Production code is net **−20 lines**; the PR is net +11 only because the 1-test
suite becomes 8 tests.

**C.1 — R24 ×5, R25 ×3 — RED.** **Rewrite** `tests/unit/OrderAuthGate.test.tsx` (81 lines, 1 test today).
Keep the `useSearchParams` mock and invert it into the **negative** assertion: with
`mockSearchParams.set('dni', '87654321')`, `verifyOrderAccess` is **never** called with that value, the DNI
input is never prefilled, and `router.replace` is never called. Plus: no auto-auth call with or without a
session; no rate-limit token consumed by the parameter; nothing left in the URL; R15's server-side denial
still holds; and for `orderNumber={null}` an explicit non-submittable state with **no** form.
`test(order-access): cover R24 dni deletion and R25 null order number state`
**C.2 — DELETION.** `app/[slug]/(app)/order/[token]/OrderAuthGate.tsx:180-211` — **delete** the whole
`?dni=` auto-auth block (−32), including the `router.replace` cleanup at `:195-198` that R15 made
unreachable. The leak dies because the flow ceases to exist, not because a cleanup branch ran.
`refactor(order-access): delete the unreachable dni auto-auth block`
**C.3 — DELETION.** Same file — drop `useSearchParams` / `useRouter` / `usePathname` from the import at
**`:5`**, delete the hook calls at **`:29-31`**, and remove them from the effect deps at **`:217`** (−5).
Verified safe: `searchParams`, `router.` and `pathname` have **no** other reference in the file
(`popupUrl.searchParams` at `:266-268` is an unrelated `URL` object).
`refactor(order-auth-gate): drop now-unused next/navigation hooks`
**C.4 — GREEN.** `OrderAuthGate.tsx:12` — widen `orderNumber: string` to `string | null`, and render the
**non-submittable state before the spinner at `:390`**, naming **seller contact** as the alternative.
**Not Google**: `handleGoogleOrderVerify:289-290` also requires an order number, so pointing a NULL-order
buyer at Google would send them into the same dead end.
`app/[slug]/(app)/order/[token]/page.tsx:517` — pass `order.orderNumber` raw, dropping the lossy `|| ''`
(1 line). **This is a gap in the design's file-changes table, which lists only `OrderAuthGate.tsx`** —
without it the component never sees `null`, only `''`. `:522` already passes the raw value.
`feat(order-auth-gate): render non-submittable state for orders with no order number`
**C.5 — Regression gate.** `tests/unit/verifyOrderAccess.test.ts:511-534` (R15) stays **green and
untouched** — server actions remain directly callable, so the bare-DNI denial is still load-bearing.
The numbered-order form `:352-388` and the Google flow `:288-343` are unchanged.

**Rollback C**: `git revert` — restores a flow that has been unreachable since `3544b7f` / `d23e7c5`. The
R25 state is a pure addition; reverting loses only the explicit dead-end message. Lowest-risk slice in the
chain.

---

## Out of scope — do NOT attempt in these PRs

| Item | Why |
|---|---|
| `lookup/route.ts` slug case-sensitivity vs the seller guard's `.toLowerCase()` (`:69`, `:88`) | Pre-existing. Unchanged here. |
| `x-forwarded-for` leftmost-hop spoofability (W-I1 / W-A3) | Fixing it with the rightmost hop trades one hole for a victim-throttling hole. Recorded, not fixed. |
| C1 / RLS on `payments`, `payment_orders`, `payment_idempotency_keys`, `chat_sessions`, `messages`, `businesses` | Blocked on live Supabase access. Note the second-order blocker: Drizzle connects via `postgres(DATABASE_URL)` and **bypasses RLS** (`src/core/database/client.ts:14,46`), so every supabase-js read of `messages` / `chat_sessions` must be audited before policies land. |
| W-P4 — server-generated, non-null `orderNumber` | The data-level root of R25 and of the enumeration space. Touches the money path shared with C2 / W-P3. Own change. |
| D1(b) — drop `id` from `PUBLIC_ORDER_COLUMNS` | Requires threading `paymentId: string \| undefined` through seven components and guarding nine call sites. Named follow-up; `orderPageProjection.test.ts:319` is the tripwire. |
| `not_authorized` reason for a present-but-failing `callerProof` (D4) | R20 needs only the reauth / non-reauth split. Optional. |
| C5 / C6 / W-D1 / W-D2, Redis / Upstash | Independent risk or independent change. |

## Execution rules for `sdd-apply`

1. Ship in chain order: #207 → #208a → #208b → #209. Each merges only after the prior is green.
2. Do not batch across PR boundaries. If a task cannot fit its PR's budget, apply the named de-scope lever
   (B-j.7) — never merge a split boundary to save a round trip.
3. **`ORDER_ACCESS_COOKIE_SECRET` must be present in every Vercel env before #207 merges** (A.10).
   Deploy #207 to preview and smoke-test the `verifyOrderAccess` → mutate round trip before promoting.
4. Never commit, push, merge, or open a PR from this change set without explicit instruction.
   **Never merge to `develop` or `main`.** `tasks.md` is gitignored (`.gitignore:98` → `*.md`) — disk only,
   never `git add -f`.
5. Do not touch `openspec/specs/**` or `AUDITORIA-PRODUCCION.md` (the proposal's six audit amendments are
   for the orchestrator to apply, not for this change).

## Size-budget note

Exceeds the skill's 530-word guidance (~2,400 words). Deliberate: the orchestrator mandated a requirement
ID, an exact `file:line`, RED-first steps, a conventional commit, an acceptance check and a rollback note
for **every** task, across 21 tasks, plus an explicit line-math decision for the Slice B split. Tables hold
the density; prose is held to the minimum that stays verifiable. Consistent with the proposal (#1179),
spec (#1181) and design (#1182) precedent.

## Phase notes — verification performed by sdd-tasks

Every `file:line` target was **re-read from source at `63c09e6`**, not copied from #1179/#1181/#1182:
`lookup/route.ts:103,108-114,117-133` (146 lines); `verify/[orderNumber]/page.tsx:28,48-65` (`buyerEmail:57`,
`metadata:61`, `ticketUrl:62`), `:69-77`, `:92-102`, `:279-316`, `:352`, `:361-363` (428 lines);
`actions.ts:60-72,339-363` (393 lines); `finalizationActions.ts:67-75,81-88,266-290` (621 lines);
`ConfirmationFlow.tsx:30-45` (164 lines); `OrderAuthGate.tsx:5,12,29-31,180-211,217,289-290,352-388,380-382,390`
(1000 lines); `orderAccessRateLimit.ts:21-24,31-37,56-61` (82 lines); `rateLimit.ts:27,32,106`;
`orderAccessCookie.ts:109`; `src/config/env.ts:56,109-114`; `order/[token]/page.tsx:517,522`;
`orderPageProjection.test.ts:249,276,292,319` (438 lines); `OrderAuthGate.test.tsx` (81 lines);
`orderVerificationPage.test.ts` (92 lines).

**Path corrections vs upstream phases**: `actions.ts` is 393 lines, not 340 (the earlier figure came from
`Measure-Object -Line`, which skips blank lines — the same error made `OrderAuthGate.tsx` look like 935
rather than 1000). `OrderAuthGate.tsx` therefore has **zero** other consumers of `searchParams` / `router` /
`pathname`, which is what makes C.3's deletions safe.

**Confirmed and recorded**: `env.ts:109-114` is a bare `console.warn` behind `env.ts:56`'s `''` default,
so the R19 secret failure is silent at boot. `getClientIdentifierFromHeaders` (`rateLimit.ts:106`) takes
`x-forwarded-for.split(',')[0]`, the client-supplied hop. `RATE_LIMITS.storefront` is `{ windowMs: 60_000,
maxRequests: 60 }` (`:27`) over a per-instance `new Map` (`:32`). `orderPageProjection.test.ts:319` asserts
`toEqual(PUBLIC_ORDER_COLUMNS)` and is the D1 tripwire.

**Found — design gap.** `OrderAuthGate.tsx:12` types `orderNumber: string`, and
`order/[token]/page.tsx:517` collapses a NULL to `''` via `|| ''`. So the component can never currently
observe `null`. R25 as written in the design is **not implementable** without also touching
`page.tsx:517`. Added as task C.4 (1 line). The design's Slice C file-changes table lists only
`OrderAuthGate.tsx`.

**Found — design gap.** `OrderAuthGate.tsx:550` renders `placeholder={orderNumber || 'Ej: ORD-001234'}`;
with the widened type this still resolves, but a reviewer should confirm it stays correct rather than
silently substituting the example number for a NULL-order buyer.

**Corrected line forecast.** 190 / 330 / 75 (≈595, three PRs) → **230 / 140 / 285 / 175 (≈827, four
PRs)**. The decisive change is Slice B: verified at **≈422 undivided it already exceeds the 400-line
budget**, so the split is required rather than precautionary. See the Slice B split decision section for
the per-option math.