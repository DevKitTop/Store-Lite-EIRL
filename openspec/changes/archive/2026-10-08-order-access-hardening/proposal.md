# Proposal: Order Access Hardening

**Change**: `order-access-hardening` · **Base**: `feat/order-integrity-b2` @ `63c09e6` · **Store**: openspec + engram
**Authority**: `AUDITORIA-PRODUCCION.md` (24/09/2026) — **partially stale**. Mode: Strict TDD (`pnpm test:unit`).

## Intent

The audit's anchors for two of the three items in scope **no longer exist**, but the vulnerability they
described did not disappear — it **migrated to two live surfaces, one of them materially worse than C11 while
filed two priority groups lower.**

- **C11 is stale.** `verifyOrderAccessByDniAndOrderNumber` was deleted 25/09 in `f0efd09` with its only
  caller. Nothing to rate-limit. Its residual class lives on in `POST /api/order/lookup` (slug check is a
  post-filter ⇒ cross-tenant 403-vs-404 oracle) and on `app/[slug]/(app)/order/verify/[orderNumber]/page.tsx`
  — **no credential at all, no rate limit, no cookie gate**, disclosing last-4 DNI, full cart, amount and a
  link containing `trackingToken`, printed on the ticket (`ticket/generate/route.ts:188`).
- **C10 is stale.** The server-side `session_id` filter landed 26/09 in `5ce5c1f7` (the audit quotes a
  comment that no longer exists). Residual exposure is **100% a function of RLS (C1)**, blocked on live
  Supabase access.
- **W-A1 escalated.** C4 pinned `id: true` into `PUBLIC_ORDER_COLUMNS` (`page.tsx:50`), so `paymentId` is
  now **permanent-by-design** in the unauthenticated payload — the audit assumed C4 would remove it.
  `confirmFinalization` has **no proof parameter at all** (`finalizationActions.ts:266-269`) — a fourth
  action the audit missed.

**This change is therefore not "remediate C11 and C10".** It closes the surfaces the class migrated to.

## Scope

### In Scope — three slices, three PRs

| Slice | Requirements | Content | Target | ~Lines |
|---|---|---|---|---|
| **A** — order-mutation authorization | **R19, R20** | Gate `updateOrderStatus` (`actions.ts:60-70`), `reportIssueV2` (`:349-359`), `confirmFinalization` (`finalizationActions.ts:266-290`) on `verifyOrderAccessCookie(trackingToken)` (HMAC-SHA256, httpOnly, JS-unreadable — `orderAccessCookie.ts:109`). `callerProof` stays as defense-in-depth, never as the primary gate. Refusal returns a typed `reason` the UI already knows how to render. | `order-access-control` | **150–190** |
| **B** — order-number surface | **R21, R22, R23** | (i) `api/order/lookup/route.ts:103` — move `businessSlug` into the SQL `where`; drop the post-filter at `:128-133`; one neutral 404. (ii) `order/verify/[orderNumber]/page.tsx:48-65` — narrow the SELECT (drop never-rendered `buyerEmail`/`ticketUrl`), keep the **public verdict** (valid/invalid + masked DNI + amount), gate `metadata.cartItems` (`:294-314`) + the `trackingToken` link (`:361-363`) behind the cookie. (iii) Rate limit the page keyed `(IP, orderNumber)` off `await headers()` (Server Component, no `NextRequest`) via the established primitive (`orderAccessRateLimit.ts:31-37`, `RATE_LIMITS.storefront` `rateLimit.ts:27`). | `order-access-control` | **150–220** |
| **C** — delete `?dni=` auto-auth | **R24, R25** | Delete `OrderAuthGate.tsx:180-211`. Not because it is dead — it still **leaks the DNI** (the `router.replace` cleanup lives inside the unreachable success branch, so W-A2 is live) and **burns the victim's own rate-limit budget**. A prefill demotion would inject an attacker-controlled value into a credential field. **R25 (new finding, absent from the audit):** an order with `orderNumber IS NULL` currently has **no working auth path at all** (R15 refuses `?dni=`; `OrderAuthGate.tsx:361-364` refuses the manual form) → the page MUST render an explicit non-submittable state instead of a form that cannot succeed. **UX consequence of R24: none** — the manual DNI + order-number form (`:352-388`) and the Google flow (`:288-343`) remain. | `order-access-control` | **70–100** |

### Out of Scope — and why

| Excluded | Reason |
|---|---|
| **C1 / RLS** (`payments`, `payment_orders`, `payment_idempotency_keys`, `chat_sessions`, `messages`, `businesses`) | Blocked on live Supabase access — migrations prove *intent* absent, not *live* state. ⚠️ **Second-order blocker:** Drizzle connects via `postgres(DATABASE_URL)` and **bypasses RLS** (`src/core/database/client.ts:14,46`), so every supabase-js read of `messages`/`chat_sessions` MUST be audited **before** policies land or order tracking and the dashboard break on arrival. |
| **C10 residual** | Code-complete (`5ce5c1f7`, test-pinned `orderChatSectionFilter.test.tsx:133`), DB-blocked by C1. Do not re-open the code work; do not tick the box. |
| **W-P4 root fix** — server-generated unique `orderNumber` | Highest-leverage follow-up in the whole audit (kills the base-36 enumeration space, removes client-controlled `metadata.orderNumber`, closes R25's data root). Deferred because it touches `charge/route.ts`, `useCulqiCallback.ts`, `create-order/route.ts` — the **money path shared with C2/W-P3**. |
| **W-I1** — Redis/Upstash | Cross-cutting store swap; audit §5.3 still open on cost. Use the established in-memory limiter; record the multi-instance caveat. |
| **C5 / C6 / W-D1 / W-D2** | Independent files, independent risk — own change. |
| `syncChatSession` having no caller proof | **By design** (R17): bound to the exact `paymentId` + `businessId`, else `guest-${paymentId}`. **Not a finding.** |

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `api-access-control`: **continue at R19** — R13–R18 are already published (see the
  `order-integrity` delta). **No renumbering.** ⚠️ `openspec/specs/api-access-control/spec.md` is **absent
  on this branch** (tracked only on `chore/openspec-spec-tracking` @ `a7cc761`); the numbering baseline for
  sdd-spec is `openspec/changes/order-integrity/specs/api-access-control/spec.md`.

| # | Requirement (MUST) | Target |
|---|---|---|
| **R19** | Every customer-initiated order mutation MUST be gated server-side on a verifying `order_access_{token}` cookie. `callerProof` MAY be additionally required but MUST NOT be the primary gate, and its absence MUST NOT authorize. | `actions.ts:60-70`, `:349-359`, `finalizationActions.ts:266-290` |
| **R20** | A cookie refusal MUST write **no** state and return a specific machine-readable `reason` the UI renders as re-auth. No action may flip `WAITING_CUSTOMER_CONFIRMATION → CONFIRMED` on `(paymentId, trackingToken)` alone. | `finalizationActions.ts:278-290`, `ConfirmationFlow.tsx:33` |
| **R21** | `POST /api/order/lookup` MUST scope by `businessSlug` **in the SQL predicate**. A row that exists under another tenant MUST be indistinguishable from one that does not exist: **one** neutral 404, no 403, no tenant-revealing wording. | `route.ts:103`, `:118-133` |
| **R22** | The verify page MUST split into a public verdict (valid/invalid + masked DNI + amount) and a cookie-gated surface (`metadata.cartItems`, the `trackingToken` link). Never-rendered columns MUST NOT be selected. | `verify/[orderNumber]/page.tsx:48-65`, `:294-314`, `:361-363` |
| **R23** | The verify page MUST apply the established in-memory limiter keyed `(IP, orderNumber)`, sourced from `await headers()`, before rendering the verdict. 429 MUST render a neutral state revealing nothing about the order. | `page.tsx` (new), `orderAccessRateLimit.ts:31-37`, `rateLimit.ts:27` |
| **R24** | No component may read `?dni=` as a credential. The auto-auth flow MUST NOT exist. | `OrderAuthGate.tsx:180-211` |
| **R25** | An order with `orderNumber IS NULL` MUST NOT present a submittable form. The page MUST name the working alternative (Google identity or seller contact) instead. | `OrderAuthGate.tsx:361-364` |

## Approach

Reuse what the parent change already built — `verifyOrderAccessCookie` is a strictly better gate than
`callerProof` (which is reconstructed from forgeable `localStorage`, the audit's own C4 criticism). No new
dependency, no migration, no new capability.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `app/[slug]/(app)/order/[token]/actions.ts` | Modified | Cookie gate on 2 actions (R19/R20) |
| `src/features/dashboard/actions/finalizationActions.ts` | Modified | Cookie gate on `confirmFinalization` (R19/R20) |
| `app/api/order/lookup/route.ts` | Modified | Slug-scoped query, one neutral 404 (R21) |
| `app/[slug]/(app)/order/verify/[orderNumber]/page.tsx` | Modified | Surface split + rate limit (R22/R23) |
| `src/lib/orderAccessRateLimit.ts` | Modified | New `(IP, orderNumber)` key builder (R23) |
| `app/[slug]/(app)/order/[token]/OrderAuthGate.tsx` | Modified | Delete `?dni=`; NULL-orderNumber state (R24/R25) |
| `tests/unit/**` | Modified | RED cases for R19–R25 |

## Chain & Delivery

Three PRs, children of `feat/order-integrity-b2` (`63c09e6`), each targeting the **previous slice's branch**
(`feature-branch-chain`) so **#205 stays the single merge point**: `#206` (A) → `#207` (B) → `#208` (C).
Severity order. Each slice is independently under the **400-line review budget**. Combined ≈ **370–510
lines**, straddling the budget — which is exactly why they must not ship as one PR. `Delivery: ask-on-risk`.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Cookie-gating the verify page breaks the **printed-ticket** UX for a buyer opening it months later | High | R22 **keeps the public verdict** (valid/invalid + masked DNI + amount). Gate only cart + tracking link. Never gate the whole page. |
| Gating `confirmFinalization` **strands buyers** whose cookie expired (TTL 3600) mid-confirmation | Med | R20 typed `reason` the UI already renders for `verifyOrderAccess` refusal (`OrderAuthGate.tsx:380-382`); re-mint via DNI + order number. |
| Collapsing lookup's 403→404 changes behavior for a seller hitting a legitimate cross-store collision (W-D3) | Low | `LookupOrderModal.tsx:219-221` already renders `data.error` with a neutral fallback ⇒ **message-only** change, no component edit. |
| Scope drift — absorbing W-A1 + W-P4 + `?dni=` into one ~500-line PR | **High** | Three slices, three PRs. Non-negotiable. |
| **`ORDER_ACCESS_COOKIE_SECRET` must be set and STABLE in every environment** or R19/R20 deny legitimate buyers (carried from the parent change) | High | R18 fails closed by design. This change is **unusable in production without it**. |

## Rollback Plan

Per slice, `git revert` on the PR branch — no migration, no schema change, no data rewrite, so rollback is
a pure code revert. Slice A's revert re-opens W-A1 (documented, pre-existing); Slice B's revert restores the
403/404 oracle and the public tracking link (the pre-change state, which is what the audit already describes);
Slice C's revert restores a flow that has been unreachable since `3544b7f`/`d23e7c5`. None require a
coordination window beyond the normal merge.

## Dependencies

- **Parent chain #203 → #204 → #205 must merge first.** Slice A alone is inert without #204's cookie mint;
  #205 is the C4 projection this change extends. **#205 is the single merge point.**
- `ORDER_ACCESS_COOKIE_SECRET` set and stable in every environment (pre-existing R18 obligation).

## Success Criteria

- [ ] `pnpm test:unit` green with 0 regressions over the 2262-test baseline; `pnpm type-check` 0 errors;
      `pnpm lint` at the exact pre-existing baseline.
- [ ] R19–R25 each pinned by ≥1 RED-first test naming its `file:line` target.
- [ ] A console caller with `(paymentId, trackingToken)` and **no** cookie cannot flip any order state.
- [ ] The verify page still renders a useful verdict with no cookie (printed-ticket UX intact).
- [ ] Every slice's diff is independently under 400 changed lines.

## Audit amendments — for the orchestrator (do NOT edit `AUDITORIA-PRODUCCION.md` here)

| # | Finding | Current wording | Proposed | Checklist line affected |
|---|---|---|---|---|
| 1 | **C11 stale, residual relocated** | "### C11. Recuperación de acceso por DNI+orderNumber sin rate limit y cross-tenant … **Evidencia:** `verifyOrderAccessByDniAndOrderNumber` (`actions.ts:197-215`) … `/api/order/track` (`route.ts:37-42`) …" | **Add**: "⚠️ STALE 02/10/2026 — the named function was **deleted 25/09 in `f0efd09`** with its only caller `TrackOrderModal.tsx`; `/api/order/track` never existed (`app/api/order/` holds only `lookup/`). Deletion was the correct remediation. The residual class migrated to `POST /api/order/lookup` (`route.ts:103` unslug-scoped query ⇒ 403-vs-404 cross-tenant oracle) and — **worse, and misfiled at Grupo 2** — to the public `order/verify/[orderNumber]/page.tsx` (no credential, no rate limit, no cookie gate). Change: `sdd/order-access-hardening`." | `- [ ] Rate limit en \`verifyOrderAccessByDniAndOrderNumber\` + scope slug (C11)` → replace with `- [ ] **STALE (fn deleted \`f0efd09\`)**: residual = slug-scoped \`/api/order/lookup\` + verify-page gate (C11 → \`sdd/order-access-hardening\`)`. Anexo A "**C11 — DNI+orderNumber sin rate limit**" steps (1) and (2) `track/route.ts` → mark `(1) N/A (fn deleted)`, `(2) apply to \`lookup/route.ts\` only`. |
| 2 | **C10 code-complete, DB-blocked** | "- **Fix:** agregar el filtro server-side de `session_id` (y RLS — C1 lo agrava)." | **Add**: "⚠️ **CODE-COMPLETE / DB-BLOCKED 02/10/2026** — filter landed 26/09 in `5ce5c1f7` (`OrderChatSection.tsx:118`), test-pinned at `orderChatSectionFilter.test.tsx:133`; the quoted comment 'sin server-side filter' no longer exists. The **exposure is unchanged** because it is 100% a function of RLS (C1) — the channel filter is cosmetic while RLS is off." | `- [ ] Filtro server-side de \`session_id\` en \`OrderChatSection\` realtime (C10)` → **DO NOT TICK**. Change to `- [ ] Filtro server-side de \`session_id\` (C10) — ✅ code done \`5ce5c1f7\`; ⛔ blocked by C1 RLS`. |
| 3 | **W-P4 escalate Grupo 2 → Grupo 1** | "- **W-P4** \`orderNumber\` client-controlled y predecible … Página verify consulta por \`businessId + orderNumber\` **sin gate de DNI** (\`order/verify/[orderNumber]/page.tsx:48-65\`)." | "**W-P4 (ESCALADO a CRITICAL — Grupo 1, 02/10/2026).** La página verify es una superficie **pública sin credencial, sin rate limit y sin cookie gate**: key = \`(businessId, orderNumber)\` — solo la mitad *predecible* del par. Disclose: \`maskDni(buyerDni)\` (last 4), estado, monto, **carrito completo** y un **link con \`trackingToken\`** (escalada directa a W-A1); impreso en el ticket (\`ticket/generate/route.ts:188\`). Mitigación inmediata en \`sdd/order-access-hardening\` (R22/R23). La raíz (orderNumber server-generated único) sigue diferida." | Move `- [ ] Corrección de \`orderNumber\` server-generated único + gate verify por DNI/token (W-P4)` from **Grupo 2** to **Grupo 1**; split: gate verify → this change; server-generated → follow-up. |
| 4 | **W-A1 escalate Grupo 2 → Grupo 1 + fourth action** | "- **W-A1** Transiciones de estado del cliente sin prueba: \`updateOrderStatus\`/\`reportIssueV2\` (\`actions.ts:100-154,401-445\`) — \`callerProof\` opcional …" | "**W-A1 (ESCALADO a Grupo 1, 02/10/2026).** El supuesto del audit (\"ambos en el payload RSC — C4\") **cambió de dirección**: C4 incluyó \`id: true\` en \`PUBLIC_ORDER_COLUMNS\` (\`page.tsx:50\`) deliberadamente y con test-pinned, así que \`paymentId\` es **permanente por diseño** en el payload no autenticado. \`callerProof\` es opcional (\`actions.ts:68-70\`, \`:357-363\`) ⇒ \`updateOrderStatus(paymentId, trackingToken, 'delivered')\` desde la consola funciona sin prueba ni sesión. **CUARTA acción que el audit omitió:** \`confirmFinalization(paymentId, token)\` (\`finalizationActions.ts:266-269\`) **no tiene parámetro de prueba alguno**. Gate con \`verifyOrderAccessCookie\` (R19/R20). \`syncChatSession\` sin prueba es **por diseño** (R17) — no es hallazgo." | Move `- [ ] \`callerProof\` obligatorio o acciones ligadas a sesión server-side (W-A1)` from **Grupo 2** to **Grupo 1**. |
| 5 | **W-A2 leak confirmed still live** | "- **W-A2** DNI como credencial en URL \`?dni=\` (leak por history/referrer) + \`guestId = 'dni-{dni}'\` vincula chats pre/post compra por DNI." | "**W-A2 PARCIALMENTE CONFIRMADO 02/10/2026.** El flujo es **inalcanzable** bajo R15 (\`actions.ts:145\`; pin \`verifyOrderAccess.test.ts:511-534\`) y la vinculación \`guestId = 'dni-{dni}'\` ya está **neutralizada** (público ⇒ \`buyerDni\` null ⇒ \`guest-\${paymentId}\`, R17). **Pero el leak sigue VIVO:** el cleanup \`router.replace\` (\`OrderAuthGate.tsx:195-198\`) está dentro del branch de éxito **inalcanzable**, así que el DNI queda en la barra de direcciones, el history y el \`Referer\` de toda la sesión; y el intento fallido **quema un token del rate limit \`(IP, dni)\` de la víctima** (\`actions.ts:121-122\`). Decisión: **borrar** el flujo (R24), no degradarlo a prefill." | No Grupo-N checkbox exists for W-A2 today. **Add** a Grupo 2: `- [ ] Borrar el flujo \`?dni=\` muerto (W-A2 — leak por history/referrer + quema de budget de la víctima)`. |
| 6 | **NEW — nullable \`orderNumber\` dead-end** | *(absent)* | "**W-N1 (NUEVO — 02/10/2026). \`payments.order_number\` es NULLABLE** (\`schema/orders.ts:85\`; \`charge/route.ts:545\` escribe \`?? null\`). Para esa fila **no existe hoy ninguna ruta de autenticación**: R15 rechaza \`?dni=\` y \`OrderAuthGate.tsx:361-364\` rechaza el form manual ('Por favor, ingresá el N° de orden.'). El comprador ve **un formulario que no puede funcionar**. Mitigación de UX en este change (R25); la raíz (orderNumber server-generated único, no-null) es follow-up de W-P4." | Add to **Grupo 2**: `- [ ] Orden con \`orderNumber\` NULL: estado explícito no-enviable (W-N1) — la raíz sigue en W-P4`. |

**Also amend** (not a finding, a provenance note): `> **Última actualización:** 24/09/2026` → `02/10/2026`, and append a `## Historial de cambios` row `| 02/10/2026 | Correcciones de vigencia post-\`order-integrity\`: C11 stale + residual reubicado, C10 code-complete/DB-blocked, W-P4 y W-A1 escalados a Grupo 1, W-A2 confirmado vivo, W-N1 nuevo |`.

**Cross-cutting note for the orchestrator**: Anexo A "**Batches sugeridos**" item 7 lists C11 in "Batch 1". C11 is stale ⇒ remove it from Batch 1 and note that its residual lands in the `order-access-hardening` chain instead. Anexo A "**W-I1**" — add: "usado ahora por el verify page vía el limiter in-memory (R23); el swap a Redis sigue diferido".

## Size-budget note

This artifact exceeds the skill's 450-word guidance. Deliberate: the orchestrator requires the itemized
audit-amendment table (§ above) to be produced by this phase, and that table alone is longer than the
budget. The technical sections above are table-dense and hold to the spirit of the budget.