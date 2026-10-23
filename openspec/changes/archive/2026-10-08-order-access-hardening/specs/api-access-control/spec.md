# Delta for api-access-control

**Change**: `order-access-hardening` · **Base**: `feat/order-integrity-b2` @ `63c09e6`

## Numbering baseline (R19+)

`openspec/specs/api-access-control/spec.md` is **ABSENT on this branch** — tracked only on
`chore/openspec-spec-tracking` @ `a7cc761`, not an ancestor. Baseline is therefore
`openspec/changes/order-integrity/specs/api-access-control/spec.md`, which published **R13–R18**.
**R19 is the first free number; R13–R18 are not renumbered.**

All seven are **ADDED**. None of R13–R18 covers mutation authorization, typed refusals, tenant scoping on
lookup, or the verify page, so **no MODIFIED block is emitted** — a partial block would drop published
scenarios at archive. **R15 is preserved**: R24 removes only the *client* call path, never the
server-side bare-DNI denial.

## ADDED Requirements

### Requirement: R19 — Every customer order mutation MUST be gated on the signed access cookie

`updateOrderStatus` (`actions.ts:60-70`), `reportIssueV2` (`:349-363`) and `confirmFinalization`
(`finalizationActions.ts:266-290`) MUST require `verifyOrderAccessCookie(trackingToken)` to succeed
(`orderAccessCookie.ts:109`) before any write. `callerProof` MAY be additionally required, MUST NOT be
the primary gate, and its absence MUST NOT authorize.

**Blocking precondition.** `ORDER_ACCESS_COOKIE_SECRET` MUST be set and stable per environment. Unset or
empty fails closed (`orderAccessCookie.ts:112-113`, R18), so every legitimate buyer is denied — Slice A
is unusable in production without it.

#### Scenario: No cookie is refused and writes nothing

- GIVEN an order in a mutable state and no `order_access_{token}` cookie
- WHEN `updateOrderStatus(paymentId, trackingToken, 'delivered')` is invoked
- THEN it refuses, no status changes, no `version` bump, no row written

#### Scenario: A forged cookie is refused

- GIVEN a tampered, truncated or attacker-chosen-`expMs` cookie value
- WHEN a mutation is invoked
- THEN verification fails and the mutation is refused

#### Scenario: A valid cookie plus matching proof is allowed

- GIVEN a verifying cookie and a `callerProof` that validates
- WHEN the mutation is invoked
- THEN it proceeds normally

#### Scenario: A valid cookie without proof is allowed

- GIVEN a verifying cookie and no `callerProof`, as in a browser with no localStorage provenance
- WHEN the mutation is invoked
- THEN it proceeds — **the cookie is the authority**; a missing proof MUST NOT deny

#### Scenario: Another order's cookie does not authorize

- GIVEN a verifying cookie bound to order A's tracking token
- WHEN order B's mutation is invoked
- THEN it is refused, because the token is inside the signed value

### Requirement: R20 — A refusal MUST carry a machine-readable reason distinguishing re-authentication

A cookie refusal MUST return a machine-readable `reason`, never a bare boolean, and MUST write no state.
The vocabulary MUST reuse what the UI already renders for `verifyOrderAccess`'s refusal
(`OrderAuthGate.tsx:380-382`). It MUST distinguish recoverable **re-authentication** from generic denial,
so a buyer whose cookie lapsed mid-confirmation (TTL 3600 s, `orderAccessCookie.ts:47`) re-mints rather
than being stranded. No action may flip `WAITING_CUSTOMER_CONFIRMATION → CONFIRMED` on
`(paymentId, trackingToken)` alone.

#### Scenario: Every refusal carries a typed reason

- GIVEN a mutation refused for want of a verifying cookie
- WHEN the action returns
- THEN the result carries a machine-readable `reason` the UI already renders, and no state changed

#### Scenario: An expired cookie on `confirmFinalization` is re-authentication

- GIVEN a buyer mid-confirmation whose cookie has lapsed
- WHEN `confirmFinalization(paymentId, token)` is invoked
- THEN it refuses with the re-authentication reason, writes nothing, and the buyer can re-mint with
  DNI + order number to authorize the retry

#### Scenario: A non-authentication failure is not mislabelled

- GIVEN a verifying cookie but an order outside `CONFIRMABLE_STATUSES`
  (`finalizationActions.ts:284-290`)
- WHEN `confirmFinalization` is invoked
- THEN it refuses with a distinct reason that is **not** the re-authentication reason

### Requirement: R21 — `POST /api/order/lookup` MUST scope the tenant in the SQL predicate

The tenant predicate MUST be part of the WHERE clause — `:103` today matches `(buyerDni, orderNumber)`
alone. The response-deciding code MUST NOT receive another tenant's row, and the route MUST NOT emit a
distinct status or body for a slug mismatch: the 403 post-filter (`:128-133`) and the 404 (`:118-126`)
collapse into **one neutral 404**. A pair belonging to another tenant MUST be indistinguishable from one
that does not exist — same status, same body, same timing shape — with no tenant-revealing wording.
Message-only for the UI: `LookupOrderModal.tsx:219-221` already renders `data.error || <fallback>`.

#### Scenario: A cross-tenant pair is indistinguishable from a non-existent pair

- GIVEN a valid `(dni, orderNumber)` pair owned by another tenant
- WHEN the lookup is posted
- THEN it returns the single neutral 404, with a body identical to the non-existent pair's body

#### Scenario: Both cases do the same work

- GIVEN the cross-tenant pair and a pair that does not exist
- WHEN each is posted
- THEN the query carries the tenant predicate, so no row comes back in either case and both follow the
  same path with the same timing shape

#### Scenario: A slug mismatch never produces a distinct response

- GIVEN a matching pair owned by another tenant
- WHEN the lookup is posted
- THEN the response is the neutral 404; no 403 and no tenant-revealing wording

#### Scenario: The success path is unchanged

- GIVEN a matching pair owned by the requesting store
- WHEN the lookup is posted
- THEN it returns `{ success: true, token }` as before

### Requirement: R22 — The verify page MUST split into a public verdict and a cookie-gated surface

`order/verify/[orderNumber]/page.tsx` MUST keep a **public verdict** — valid/invalid, masked DNI last-4
(`:352`), status, amount — and MUST gate the cart line items (`:294-314`) and the link carrying
`trackingToken` (`:361-363`) behind a verifying signed cookie for that order's token. Never-rendered
columns MUST NOT be selected: `buyerEmail` (`:57`) and `ticketUrl` (`:62`); `metadata` (`:61`) only where
the gated surface needs it.

**The page MUST NOT be gated in full.** `app/api/ticket/generate/route.ts:188` prints this URL on the
ticket, so an anonymous buyer holding that printed artifact MUST still reach a useful page.

#### Scenario: An anonymous buyer sees the verdict and nothing more

- GIVEN `/{slug}/order/verify/{orderNumber}` with no access cookie
- WHEN the page renders
- THEN it shows valid/invalid, masked DNI last-4, status and amount, and renders no cart items and no
  `trackingToken` link

#### Scenario: A verifying cookie unlocks the gated surface

- GIVEN a verifying `order_access_{trackingToken}` cookie for that order
- WHEN the page renders
- THEN the cart items and the `trackingToken` link render as today

#### Scenario: Never-rendered columns are not selected

- GIVEN the page's query in any state
- WHEN its column selection is inspected
- THEN `buyerEmail` and `ticketUrl` are absent, and `metadata` only on the gated path

#### Scenario: The printed-ticket UX survives

- GIVEN a buyer opening the printed URL months later with no session and no cookie
- WHEN the page loads
- THEN it renders a useful verdict; it MUST NOT be fully gated

#### Scenario: Another order's cookie does not unlock this page

- GIVEN a verifying cookie bound to a different order's token
- WHEN this page renders
- THEN the public verdict is served and the gated surface stays hidden

### Requirement: R23 — The verify page MUST apply the established limiter keyed `(IP, orderNumber)`

The page is a Server Component with no `NextRequest`, so the client identity MUST come from
`await headers()`. The key MUST be `(IP, orderNumber)` through the established primitive
(`orderAccessRateLimit.ts:31-37,56-61`, `RATE_LIMITS.storefront`, `rateLimit.ts:27`), and a second
counter store MUST NOT be introduced. An exhausted budget MUST render a neutral, **order-independent**
state disclosing nothing about whether the order exists.

**Strength ceiling — a speed bump, not a wall.** The store is an in-memory `Map` per Vercel instance
(`rateLimit.ts:30-32`): the budget is neither shared nor persistent across instances. This requirement
MUST NOT be specified, documented or cited as closing the verify-page enumeration exposure; audit W-I1 /
W-A3 remain open. No scenario below asserts a hard guarantee, because none can be delivered.

#### Scenario: The key comes from headers and is `(IP, orderNumber)`

- GIVEN a request to the verify page with no `NextRequest` in scope
- WHEN the limit is checked
- THEN the identity is derived from `await headers()` and the key contains both the client IP and the
  order number

#### Scenario: The established primitive is reused

- GIVEN the verify page's limit check
- WHEN it is inspected
- THEN it charges `RATE_LIMITS.storefront` via the shared `checkRateLimit`, and no second counter store
  is added

#### Scenario: An exhausted budget reveals nothing about the order

- GIVEN an exhausted budget, and requests for an existing and a non-existent order number
- WHEN both pages render
- THEN each shows the same neutral state, and neither discloses whether the order exists

### Requirement: R24 — No component may read `?dni=` as a credential

The auto-auth block (`OrderAuthGate.tsx:180-211`) MUST NOT exist, and **no request path may consume a
rate-limit token because of the parameter**. The rationale is live harm, not dead code: the URL cleanup
(`router.replace`, `:195-198`) sits inside the success branch R15 made unreachable, so the DNI persists
in the address bar, history and every `Referer` — and the failed attempt burns **the victim's own**
`(IP, dni)` budget (`actions.ts:121-122`).

**Rejected alternative, forbidden.** The parameter MUST NOT be demoted to a prefill of the DNI
credential field: anyone can send `?dni=<value>`, so a prefill injects an attacker-controlled value into a
credential input and keeps the credential in the URL, which is the defect itself.

#### Scenario: No component reads the parameter as a credential

- GIVEN the order page, with a session and without one
- WHEN it renders and its auth check runs
- THEN it never reads `?dni=` and issues no auto-auth call

#### Scenario: A `?dni=` request burns no rate-limit budget

- GIVEN a link `/{slug}/order/{token}?dni=87654321` delivered to a victim
- WHEN the victim opens it
- THEN the limiter records no consumption from that parameter and the victim's own budget is untouched

#### Scenario: No DNI is left in the URL

- GIVEN any request carrying `?dni=`
- WHEN the page loads and makes outbound requests
- THEN the DNI is absent from the address bar, the history entry and every `Referer` — because the flow
  does not exist, not because a cleanup branch ran

#### Scenario: Prefilling a credential field is forbidden

- GIVEN a request carrying `?dni=<attacker-chosen value>`
- WHEN the gate renders
- THEN that value MUST NOT populate the DNI credential input

#### Scenario: R15's server-side denial is unchanged

- GIVEN the auto-auth client flow is gone
- WHEN `verifyOrderAccess(TOKEN, dni)` is invoked with no order number
- THEN it is still refused per R15 — server actions remain directly callable, so R15 is preserved, not
  weakened

### Requirement: R25 — An order with no `orderNumber` MUST get an explicit non-submittable state

`payments.order_number` is nullable (`schema/orders.ts:85`); `charge/route.ts:545` writes `null`. Such an
order has **no working auth path at all**: R15 refuses the auto-auth (`actions.ts:145`) and the manual
form refuses too (`OrderAuthGate.tsx:361-364`), so the buyer sees a form that cannot succeed. The page
MUST render an explicit state naming the working alternative — Google identity or seller contact — and
MUST NOT render a submittable form for such an order.

**Deferred root.** The data-level fix (a server-generated, non-null `orderNumber`) is deferred to **W-P4**
and out of scope. This requirement MUST NOT introduce it; it is a UI-state requirement only.

#### Scenario: A NULL-order-number order renders an explicit state

- GIVEN an order whose `orderNumber` is NULL
- WHEN its gate renders
- THEN it shows an explicit non-submittable state naming the working alternative

#### Scenario: No form that always fails is rendered

- GIVEN an order whose `orderNumber` is NULL
- WHEN its gate renders
- THEN no DNI credential form is rendered, because submitting it can only fail

#### Scenario: Numbered orders keep the working form

- GIVEN an order that has an `orderNumber`
- WHEN its gate renders
- THEN the existing manual DNI + order-number form and the Google flow are unchanged

## Out of Scope

C1/RLS · C10 residual · the W-P4 non-null `orderNumber` root · Redis/Upstash (W-I1) · C5/C6/W-D1/W-D2 ·
`syncChatSession`'s absence of a caller proof, which is **by design** under R17 and is not a finding.

## Size-budget note

Exceeds the skill's 650-word guidance. Deliberate: R19–R25 carry orchestrator-mandated content that
cannot be compressed away — the R19 deploy precondition, R22's printed-ticket UX constraint, R23's
strength ceiling, R24's forbidden prefill alternative, R25's W-P4 deferral. Prose is otherwise held to
the minimum that stays testable.