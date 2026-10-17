# Pre-Production Readiness — Verification Round 2 (2026-10-13)

**Repo**: Store Lite (`DevKitTop/Store-Lite-EIRL`)
**Date**: 2026-10-13
**Companion doc**: `docs/PREPRODUCTION_READINESS_2026-10.md` (Round 1 — kept intact as historical record)
**Verification tip**: `origin/develop` = HEAD = `a19783fa799a90a9250fb5f9ab830a411c800a0e` (merge of PR #227)

## Why a Round 2

Round 1 contained one confirmed method error: finding **W-I4** used a literal `Test-Path "app/[slug]/terminos/page.tsx"`, which fails on Next.js route groups (`(public)`/`(app)` are not part of the URL). The page actually exists. That raised the question: _if one test was wrong, others might be too._ Round 2 re-tests every deliverable claim with a corrected method (glob/rg, never literal `Test-Path` over route groups), and adds an **adversarial** pass whose job is to _refute_ the "FIXED" verdicts rather than confirm them.

**Method rules applied to every check**:

- Evidence is `file:line` + exact quoted content, or a reproducible command.
- Read-only. No secrets printed (masked).
- Prefer "partial + residual" over a binary verdict when the truth is nuanced.
- Never trust a literal path check across route groups.

---

## 0) CI & repository state — VERIFIED GREEN

| Field           | Value                                                                            |
| --------------- | -------------------------------------------------------------------------------- |
| Workflow        | `Continuous Integration` (`.github/workflows/ci.yml`)                            |
| Jobs            | `quality` → `build` → `commitlint` · `test` (coverage + Playwright e2e)          |
| Tip             | `origin/develop` = `a19783f` — single workflow, e2e nested inside the `test` job |
| Last run on tip | SHA `a19783f`, push, **success** (2026-10-13T01:15:10Z) → **GREEN**              |

CI green on the current tip: quality, build, commitlint, tests + coverage + e2e all pass. No drift between local and `origin/develop`.

---

## 1) Adversarial re-check of Round-1 "FIXED" verdicts

This is the highest-value table. Every item was re-tested trying to break the "FIXED" claim.

| #         | Round-1 verdict | Round-2 verdict                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------- | --------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| C2        | FIXED           | ✅ **CONFIRMED-FIXED**                  | Paid-path gated: `isCulqiOrderPaid(...)` → 402 `ORDER_NOT_PAID` (`app/api/payment/charge/route.ts:432-448`); paid insert `:544` reachable only via gated flows; the "neither token nor order" bypass is closed by schema `refine(token \|\| culqiOrderId)` (`src/features/billing/schemas.ts:55-57`). Webhook writer gated by timing-safe `verifyBasicAuth`/`verifyCulqiSignature` (`app/api/webhooks/culqi/route.ts:34-56,75-115`). |
| C3        | FIXED           | ✅ **CONFIRMED-FIXED**                  | Fail-closed allowlist `isAllowedAuthReturnOrigin` (`src/shared/utils/url.ts:243-259`); computed once (`auth/customer/page.tsx:45`); early-close guards `:66-70,111-115,150-154`; all 3 `postMessage` calls target the validated `returnOrigin`. Raw `storeOrigin` never reaches `postMessage`.                                                                                                                                       |
| C5        | FIXED           | ✅ **CONFIRMED-FIXED**                  | Owner gate `requireOwnedBusinessById` (`app/api/ticket/generate/route.ts:105`); buyer branch requires constant-time `safeTokenEqual` (SHA-256 + `timingSafeEqual`, `src/lib/tokenCompare.ts:32-33`) with blank-token rejection. No unauthenticated path.                                                                                                                                                                             |
| **C6**    | FIXED           | ⚠️ **PARTIAL — NEW HOLE**               | Specific actions are gated (`ticketActions.ts:98,228,308,356,408`; `finalizationActions.ts:119,280,439`), **but `autoFinalizeExpiredPayments` (`finalizationActions.ts:572`) is an exported `'use server'` action with NO auth/permission guard.** Anyone can invoke it: flips expired `not_delivered` rows to `completed` and fires notifications. See **NEW-1**.                                                                   |
| **W-A1**  | FIXED           | ⚠️ **PARTIAL — NEW HOLE**               | `updateOrderStatus` (`actions.ts:76-79`) and `reportIssueV2` (`:391-394`) are cookie-gated and the optional `callerProof` is consulted only after the gate. **But `syncChatSession` (`actions.ts:203`) is a mutation (insert/update `chatSessions`+`messages`) with no cookie gate and no proof.** See **NEW-2**.                                                                                                                    |
| C11       | FIXED           | ✅ **CONFIRMED-FIXED** (minor residual) | Both paths gated + tenant-scoped, neutral 404; verify page rate-limits before DB and cookie-gates. Residual (legacy path only): seller self-confirm 403 guard is not slug-scoped (`route.ts:191` filters by `ownerId` only) and team-membership check is nested under `if (ownedBusiness)` (`:208`). Leaks nothing about order existence.                                                                                            |
| W-P4/W-N1 | FIXED           | ⚠️ **PARTIAL — schema drift**           | DB is correct (migration `0048_payments_order_number_integrity.sql`: `SET NOT NULL` `:62`, UNIQUE index `:65`, immutability trigger `:79-83`), **but the Drizzle schema drifted**: `orderNumber: text('order_number')` (`src/core/database/schema/orders.ts:85`) has **no `.notNull()`/`.unique()`**, and the table index callback `:116-122` has no order-number unique index. DB enforces it; the TS types lie.                    |
| W-P5      | FIXED           | ⚠️ **PARTIAL**                          | `update-ticket` is **not PK-scoped**: lookup by `orderNumber` (`route.ts:30-34`), update `.where(eq(payments.orderNumber, orderNumber))` (`:58-62`). Ownership gate present (`:44`). Safe _only because_ `order_number` is UNIQUE; if the constraint were dropped the update hits multiple rows. (`billing/update-plan-ticket` IS PK-scoped — correct pattern.)                                                                      |
| W-I3      | FIXED           | ✅ **CONFIRMED-FIXED**                  | `.gitignore:58` `*.log`; `git ls-files                                                                                                                                                                                                                                                                                                                                                                                               | rg '\.log$'` → 0 tracked logs. |
| W-I4      | FALSE POSITIVE  | ✅ **CONFIRMED FALSE POSITIVE**         | Legal pages exist (`app/[slug]/(public)/{terminos,devoluciones,libro-reclamaciones}/page.tsx`). Residual MINOR: Settings copy says empty = hide, but page shows placeholder (no `notFound()`); Footer uses absolute `/{slug}/terminos` (would double the slug if `FEATURE_SUBDOMAIN_REWRITE` is on).                                                                                                                                 |

---

## 2) NEW findings surfaced by Round 2

| ID        | Sev                            | Finding                                                                                                                                                                                                                  | Evidence                                                    |
| --------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| **NEW-1** | **HIGH (borderline CRITICAL)** | **Unguarded exported server action** `autoFinalizeExpiredPayments` — no `checkPermission`/auth. Publicly callable; mutates payments to `completed` and emits notifications. A cross-tenant / unauthenticated write path. | `src/features/dashboard/actions/finalizationActions.ts:572` |
| **NEW-2** | **HIGH**                       | **Unguarded mutation** `syncChatSession` — inserts/updates `chatSessions`+`messages` with no order-access cookie gate and no proof.                                                                                      | `app/[slug]/(app)/order/[token]/actions.ts:203`             |
| NEW-3     | MEDIUM                         | Drizzle↔DB schema drift: `orderNumber` not `notNull/unique` in TS schema while DB enforces it.                                                                                                                           | `src/core/database/schema/orders.ts:85,116-122`             |
| NEW-4     | LOW/MEDIUM                     | `update-ticket` keyed by `orderNumber` (not PK) — correctness depends entirely on the UNIQUE constraint.                                                                                                                 | `app/api/payment/update-ticket/route.ts:30-62`              |

NEW-1 and NEW-2 are the most important results of this round: they are newly discovered and were **not** present in Round 1.

---

## 3) Still-open findings — re-confirmed with hard evidence

| #      | Sev                                  | Finding                                                                                                                            | Round-2 evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | **CRITICAL (real, not theoretical)** | **No RLS** on `payments` / `payment_orders` / `chat_sessions` / `messages` / `businesses`. The anon key is shipped to the browser. | Zero `ENABLE ROW LEVEL SECURITY` for any of the 5 tables across all migrations. RLS/policies exist only for storage (`0005`,`0006`), `profiles` (`0007`,`0011`,`0040`), `team_collaboration` (`0014`,`0015`), `notifications` (`0019`), `feedback` (`0034`). The public key is used client-side (`src/lib/supabase/client.ts:10` — `createBrowserClient`) and `src/lib/supabase/proxy.ts:144` reads `.from('businesses')` with `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`:24`). With RLS off, those tables are reachable via PostgREST using the public key. ⚠️ Requires a **live DB** confirmation of default grants before/with the fix. |
| W-I1   | HIGH                                 | Rate limits in-memory (`Map`), per-instance; trusts `x-forwarded-for`.                                                             | `src/lib/rateLimit.ts:50` (`new Map<...>()`); `:124-131` takes first XFF IP directly; no Upstash/Redis in deps. On multi-instance Vercel the caps are per-instance → bypassable.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| W-I2   | MEDIUM                               | CSP allows `unsafe-inline` + `unsafe-eval`.                                                                                        | `next.config.ts:37` `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.culqi.com …`; `:39` `style-src 'self' 'unsafe-inline' …`. Confirmed present in the built config.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| C9     | MEDIUM                               | Migrations not reproducible from the journal.                                                                                      | `migrations/meta/_journal.json` ends at idx 24 (`0024_messy_nehzno`); **76** `migrations/*.sql` on disk; **0025–0048 are not in the journal**; there are **two `0048_*` files** (`0048_payments_order_number_integrity.sql`, `0048_whatsapp_connection_status.sql`) and the tag `0021` is absent. Replaying from the journal alone cannot reproduce the schema.                                                                                                                                                                                                                                                                    |
| Cron   | MEDIUM                               | Timeout cron not configured in `vercel.json`.                                                                                      | `vercel.json` has **no `crons` key**; the route `app/api/cron/order-timeouts/route.ts` exists and checks `CRON_SECRET`. Trigger mechanism is external/undocumented.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### C8 — downgraded (likely disproven)

Round 1 flagged a committed Supabase credential as UNVERIFIED. Round 2 inspected the current `.env.example`: all sensitive values are **placeholders** — `NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-ke…`, `SUPABASE_SERVICE_ROLE_KEY=your-service…`, `DATABASE_URL=postgresql:/…`, `CULQI_SK=sk_test_xxx…`, `SASS_API_KEY=your-sass-ap…`. Only `.env.example` is tracked (no real `.env`). **Verdict: no live secret committed in the current tree.** Residual: a full history scrub is only warranted if you want to be exhaustive; no evidence of a real value.

---

## 4) Feature gaps — re-confirmed

| Area                 | Verdict                                         | Evidence                                                                                                                                       |
| -------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Pickup expiration    | OPEN — no persisted deadline                    | No `pickupExpiresAt/pickupExpiredAt/readyForPickupAt/deadlineAt` columns in `orders.ts`; expiry is cron-relative only.                         |
| Disputes             | OPEN — `DISPUTE` terminal, no admin arbitration | `src/core/orders/orderStateMachine.ts:169-172` → `DISPUTE.to: []`, `allowedActors: []`.                                                        |
| Penalties            | OPEN — percentage-only, no floor                | `src/core/penalties/penaltyTypes.ts` = 5%/10% percentages; no `Math.max(min, …)` floor anywhere.                                               |
| Notifications wiring | OPEN — not fired in transition/timeout flow     | No `createBusinessNotification` calls in `orderService.ts`/`orderTimeouts.ts`.                                                                 |
| `ORDER_FLOW_V2`      | PARTIAL                                         | Read at `src/config/env.ts:70`; present as `ORDER_FLOW_V2=true` in `.env.example:277`. Confirm the **production** env value (reportedly true). |
| Vercel cron          | PARTIAL                                         | Route exists; no `crons` key in `vercel.json` (see §3).                                                                                        |

---

## 5) Housekeeping — re-confirmed

| Item                          | Verdict                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Issue #66 (17 suites)         | ✅ Fixed, **stale-open**        | 4 named files run green (102 tests); full suite green in CI on `a19783f`. Issue never closed.                                                                                                                                                                                                                                                                                                                                                                            |
| Issue #103 (Culqi readiness)  | ✅ Implemented, **stale-open**  | `src/features/settings/lib/culqiReadiness.ts` + UI.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Issue #134 (300KB compress)   | ✅ Implemented, **stale-open**  | `src/shared/utils/image.ts:49-51`.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Issue #135 (ImageCropModal)   | ✅ Implemented, **stale-open**  | `src/shared/components/ui/inputs/ImageCropModal.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Issue #225 (commitlint sweep) | ✅ Implemented, **stale-open**  | `6cf510e` on `origin/develop`.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| OpenSpec specs                | ⚠️ **23 untracked / 3 tracked** | `git ls-files openspec/specs` → only `api-access-control`, `payment-orders`, `storefront-public-info`. `git status` → 23 `??` dirs. `.gitignore:109` un-ignores `openspec/specs/**/*.md` but the 23 were never `git add`ed → **a fresh clone silently misses 23 capability specs**. Also: some untracked files (`order-flow/spec.md`) are **delta format** (`# Delta for …`, `## ADDED/MODIFIED Requirements`) copied verbatim instead of consolidated capability specs. |
| Env drift                     | CONFIRMED                       | `YCLOUD_API_KEY`, `YCLOUD_WABA_ID`, `YCLOUD_WEBHOOK_SECRET`, `JSON_WSP_INSTANCE` are read by code (`src/config/env.ts`) but **absent from `.env.example`**.                                                                                                                                                                                                                                                                                                              |

---

## 6) Ordered action plan (Round 2)

### P0 — before inviting any beta user

1. **C1 — enable RLS + policies** on `businesses`, `payments`, `payment_orders`, `chat_sessions`, `messages` (live DB). Confirm anon-key exposure while doing it.
2. **NEW-1 — gate `autoFinalizeExpiredPayments`** with the same `requireOrderManager`/`checkPermission` pattern used by the other finalization actions (or move it out of `'use server'`).
3. **NEW-2 — gate `syncChatSession`** behind the order-access cookie gate (or an explicit proof) like its sibling mutations.

### P1 — hardening

4. **W-I1** — move rate limits to a shared store (Upstash Redis) or document single-instance assumption; stop blindly trusting XFF (only behind a trusted proxy).
5. **NEW-3** — align Drizzle schema with the DB (`orderNumber` `.notNull().unique()` + unique index) to stop the type drift.
6. **C9** — reconcile `migrations/meta/_journal.json` with 0025–0048; resolve the duplicate `0048_*` pair and add the missing `0021` tag.
7. **Vercel cron** — decide and document the trigger for `/api/cron/order-timeouts` (add `crons` to `vercel.json` or document the external trigger).
8. **C1 follow-up / C10** — verify chat realtime isolation once RLS lands.

### P2 — hygiene & product gaps

9. Close stale issues #66/#103/#134/#135/#225 (all implemented).
10. Commit the 23 untracked OpenSpec specs; normalize delta-format specs into capability specs.
11. Add the missing YCloud/JSON_WSP env vars to `.env.example`.
12. Feature gaps (pickup deadline, DISPUTE arbitration, penalty floor, notification wiring, shipping policy, sidebar-v2 cleanup).
13. C8 — optional history-only scrub if you want zero doubt.

---

## 7) Go / No-Go

**NO-GO for public production.** **Conditional GO for a closed beta** only after P0:

- P0-1 (C1 RLS) is a real data-exposure path given the public anon key.
- P0-2 (NEW-1) and P0-3 (NEW-2) are unauthenticated write paths — no product value justifies shipping them.

Everything in P1/P2 is hardening or hygiene; none of it has to block a small, invited beta, but it should be scheduled.

### Verification coverage summary

| Area                                                                       | Slice                         | Status                                 |
| -------------------------------------------------------------------------- | ----------------------------- | -------------------------------------- |
| Adversarial re-check of "FIXED" (C2,C3,C5,C6,C11,W-A1,W-P4,W-P5,W-I3,W-I4) | D (`sparkling-blue-giraffe`)  | ✅ complete                            |
| Runtime/infra (W-I1, W-I2, features, cron, env)                            | B (`classic-brown-reindeer`)  | ✅ complete                            |
| Tests/CI/issues/openspec                                                   | C (`payable-apricot-octopus`) | ✅ complete                            |
| RLS/DB/migrations/credential (C1, C8, C9)                                  | A (`classical-coffee-limpet`) | ⏱ timeout → **done inline** (this doc) |

---

## 8) Post-P0 residual decisions (2026-10-14)

Terse record of what was hardened in the P1 batch and what stays open, with the trigger to close each item.

- **W-I1** — Rate limiting remains in-memory/per-instance; a shared store is a follow-up. The XFF derivation now uses the trusted (rightmost) hop via `getClientIp` (`src/lib/rateLimit.ts`), so a spoofed leftmost entry is ignored. True global limits require a shared store (Upstash Redis) — follow-up.
- **W-I2** — `'unsafe-eval'` removed from `script-src` in `next.config.ts`. `'unsafe-inline'` retained pending a nonce strategy + prod smoke test — follow-up.
- **W-P5** — `update-ticket` lookups by `order_number` are safe because `payments.order_number` is UNIQUE (migration `0048`) and the row update is PK-scoped; no API contract change.
- **C9** — Migration journal (ends at idx 24, 76 `.sql` files, two `0048` files, missing `0021` tag) is NOT reconciled — document-only until prod applied-state is known.
- **Cron** — `/api/cron/order-timeouts` has no `crons` entry in `vercel.json`; trigger is external/undocumented — documented only.
- **NEW-3** — Drizzle `payments.orderNumber` aligned to the DB (`.notNull()` + named unique index `payments_order_number_unique`).
