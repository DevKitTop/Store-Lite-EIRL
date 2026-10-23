# Design: Meta Pixel + Conversions API (CAPI)

## Technical Approach

Consent-gated Meta tracking for platform pages only, in three independent layers that map to the PR slices: (1) consent infra + env + CSP, (2) client pixel provider (PageView/ViewContent), (3) server CAPI for Purchase with shared `event_id`. Zero changes to tenant storefronts; CAPI never on the purchase critical path.

## Architecture Decisions

### D1: Mounting strategy — root-layout provider + client guard
| Option | Tradeoff | Decision |
|---|---|---|
| Root-layout client provider + guard | One mount point, reuses `isTenantHost` | ✅ Chosen (proposal approach #1) |
| Per-page mounting | Zero tenant risk, duplicated wiring, easy to miss pages | Rejected |
| proxy.ts header flag | Clean, couples pixel to proxy | Rejected |

`MetaPixelProvider` (client) computes `shouldMount = consent === 'accepted' && !isTenantHost(hostname) && isPlatformTrackingPath(pathname)`. `tenantGuard.ts` (pure, shared by banner + provider) mirrors `PLATFORM_ONLY_PREFIXES` (proxy.ts L114) plus legal/landing pages: `/`, `/auth`, `/pricing`, `/created`, `/list-business`, `/onboarding`, `/devoluciones`, `/privacidad`, `/terminos`, `/libro-reclamaciones`; **excludes** `/auth/customer` (platform-hosted but storefront-customer traffic).

### D2: Consent cookie — `sl_consent_status`, NOT httpOnly
| Option | Tradeoff | Decision |
|---|---|---|
| Plain cookie (no httpOnly) | Client banner/pixel gate must read+write it; contains only a marketing flag, no session/PII | ✅ Chosen |
| httpOnly + server round-trips | Safer token, forces every gate decision through the server | Rejected |

`SameSite=Lax`, `Path=/`, `Max-Age=31536000`, `Secure` when `https:`, **host-only** (no `Domain`) — consent is platform-scoped; never shared to tenant subdomains via `SHARED_COOKIE_DOMAIN`. Absence resolves to `pending`; `reset` deletes the cookie (absence → pending). Values: `accepted | declined | pending` (pending never written).

### D3: CAPI scope — Purchase only
| Event | Browser (`fbq`) | Server CAPI |
|---|---|---|
| PageView | ✅ provider | — |
| ViewContent (/pricing) | ✅ provider (pathname check) | — |
| InitiateCheckout (PricingCard dialog open) | ✅ | — |
| Purchase (purchase-plan success) | ✅ with server `eventId` | ✅ authoritative |

CAPI carries the only PII (email/name) + revenue; adding server sends for the other three adds latency/noise with no dedup benefit, and InitiateCheckout can't reach a server "at plan select" without a round-trip on the critical path. No public client→CAPI relay exists.

### D4: CAPI dispatch — fire-and-forget, NOT `after()`
| Option | Tradeoff | Decision |
|---|---|---|
| `void sendEvent(...).catch(noop)` | Matches `captureEvent` pattern (create-order L260); lambda may freeze before send completes on Vercel | ✅ Chosen |
| `after()` (next/server) | Survives response flush; **throws "outside a request scope"** (after.js L16) → breaks existing `purchasePlan.test.ts` direct-import pattern | Rejected now; contained follow-up if delivery loss observed |

### D5: Server-only guard — no `server-only` package
Project convention (culqiReadiness.ts L2): modules stay importable for unit tests. Guards: (a) `hashPii.ts` imports `node:crypto` → any client import fails at build; (b) `capi.ts` module-top runtime throw if `typeof window !== 'undefined'`. Callers: only route handlers.

### D6: Purchase `event_id` contract — optional response field
Current success shape: `{ success, planPaymentId, ticketNumber, planActivatedUntil, amountTotal, issuer }`. Add **optional** `eventId?: string`, present only when CAPI fired. Client casts `purchaseJson as PurchasePlanResult` (usePurchasePlan L82) — unknown fields are ignored; add `eventId?: string` to `PurchasePlanResult`. `usePurchasePlan.purchase` returns it; PricingCard fires `fbq('track','Purchase',{ value: totalSoles, currency:'PEN', eventID: eventId })`. Meta dedups on (event_name, event_id) within 48h. Non-breaking; no existing consumer validates allowed keys.

### D7: Pixel events & SPA navigation
PageView fires on mount **and** on `usePathname()` change (skip first render) so App Router client nav is tracked; ViewContent fires when pathname starts with `/pricing` (`content_type:'product'`, `content_name:'Plan'`). Scripts: Next `<Script>` `afterInteractive` — inline Meta base-code snippet (defines `fbq`) + `src="https://connect.facebook.net/en_US/fbevents.js"`; `init` in onLoad; noscript img fallback (img-src already `https:`).

### D8: CAPI client behavior
POST `https://graph.facebook.com/v21.0/{pixelId}/events` (version pinned `v21.0`); body `{ data:[event], access_token, test_event_code? }`. AbortController 10s per attempt; **one retry** on network error/HTTP 5xx (250ms backoff), never on 4xx; final failure swallowed. `test_event_code` added when `META_TEST_EVENT_CODE` set.

## Data Flow

```
PricingCard ──(init dialog)──▶ fbq('track','InitiateCheckout',{eventID})      [D3]
PricingCard ──POST /api/billing/purchase-plan──▶ route handler
    route: Culqi charge → DB tx (unchanged) → consentServer check
        ├─ accepted: eventId=generateEventId(); void fireEvent(Purchase,{eventId})  [D4]
        └─ response { …, eventId? }
PricingCard ◀── result.eventId ──▶ fbq('track','Purchase',{eventID})           [D6]
MetaPixelProvider: guard → Script → initFbq → PageView / ViewContent           [D1/D7]
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/lib/consent/consent.ts` | Create | Pure: `COOKIE_NAME`, `ConsentState`, `resolveConsentState(string\|undefined)` → pending default |
| `src/lib/consent/consentClient.ts` | Create | `'use client'`: get/set/reset via `document.cookie` (D2 attributes) |
| `src/lib/consent/consentServer.ts` | Create | `async getConsentState()` via `next/headers` `cookies()` |
| `src/components/consent/ConsentBanner.tsx` | Create | Spanish banner (pending) + reset chip (decided); guarded by `tenantGuard` |
| `src/lib/meta/tenantGuard.ts` | Create | Pure: `PLATFORM_TRACKING_PREFIXES`, `isPlatformTrackingPath`, `isPlatformTrackingPage` (uses `isTenantHost`) |
| `src/lib/meta/eventId.ts` | Create | `generateEventId()` → `crypto.randomUUID()` (universal) |
| `src/lib/meta/fbq.ts` | Create | `'use client'`: typed `window.fbq` wrapper; `initFbq`, `trackEvent(name, data?, eventID?)` no-op when absent |
| `src/lib/meta/events.ts` | Create | Event name constants + typed custom_data for the 4 events |
| `src/lib/meta/hashPii.ts` | Create | `node:crypto` sha256 lowercase hex; `normalizeEmail` (trim+lowercase), `normalizePhone` (strip non-digits → `519876543210`), `hashEmail/hashPhone/hashName` |
| `src/lib/meta/payload.ts` | Create | `buildEventPayload`: `event_time` (unix s), `action_source:'website'`, hashed `em/fn/ln` via `splitFullName`, `client_ip_address` (x-forwarded-for), `client_user_agent`, `fbp`/`_fbc` cookies, `fbc = fb.1.<ts>.<fbclid>` synthesized from query param, `custom_data` |
| `src/lib/meta/capi.ts` | Create | `sendEvent` (D8) + `fireEvent` (fire-and-forget) + env config + runtime window guard (D5) |
| `src/components/meta/MetaPixelProvider.tsx` | Create | `'use client'`: guard → Scripts → init → PageView/ViewContent (D1/D7) |
| `src/config/env.ts` | Modify | +`metaPixelId` (`NEXT_PUBLIC_META_PIXEL_ID` \|\| ''), `metaCapiAccessToken` (`META_CAPI_ACCESS_TOKEN` \|\| ''), `metaTestEventCode` (`META_TEST_EVENT_CODE` \|\| ''); warn-if-missing (never crash) |
| `.env.example` | Modify | +3 vars with comments |
| `next.config.ts` | Modify | CSP: `script-src` += `https://connect.facebook.net https://*.facebook.net`; `connect-src` += `https://www.facebook.com` (L37, L42) |
| `app/layout.tsx` | Modify | Mount `ConsentBanner` + `MetaPixelProvider` in body (guarded internally) |
| `app/api/billing/purchase-plan/route.ts` | Modify | After tx success: consent gate → `eventId` → `fireEvent(Purchase)` with hashed `buyerEmail`, `splitFullName(buyerFullName)`, `totalSoles`, `currency:'PEN'`, `planType`, `period`, `paymentMethod`, `culqiChargeId`; `event_source_url` = referer ‖ `/pricing`; return `eventId?` |
| `src/features/billing/hooks/usePurchasePlan.ts` | Modify | `PurchasePlanResult` += `eventId?: string` |
| `app/pricing/components/PricingCard.tsx` | Modify | `handleOpenDialog` → `trackEvent('InitiateCheckout',…,generateEventId())`; success (`res`) → `trackEvent('Purchase',{value:totalSoles,currency:'PEN'},res.eventId)` |

## Interfaces / Contracts

```ts
// src/lib/meta/payload.ts
interface MetaEventPayload {
  event_name: string;
  event_time: number;                 // unix seconds
  event_id: string;
  action_source: 'website';
  event_source_url: string;
  user_data: {
    em?: string[];                    // sha256 hex, lowercased
    fn?: string[]; ln?: string[];
    client_ip_address?: string; client_user_agent?: string;
    fbp?: string; fbc?: string;
  };
  custom_data: Record<string, unknown>;
}
// purchase-plan JSON success response (non-breaking addition)
{ success: true; planPaymentId; ticketNumber; planActivatedUntil; amountTotal; issuer; eventId?: string }
```

## Testing Strategy (strict TDD — RED first)

| Layer | File | Approach |
|---|---|---|
| Unit | `src/lib/consent/__tests__/consent.test.ts` | pending default, accepted/declined round-trip, reset deletion, invalid → pending |
| Unit | `src/lib/consent/__tests__/consentClient.test.ts` | jsdom `document.cookie` get/set/reset + attributes |
| Unit | `src/lib/meta/__tests__/tenantGuard.test.ts` | platform allow, tenant host deny, `/auth/customer` deny, prefix boundaries |
| Unit | `src/lib/meta/__tests__/eventId.test.ts` | uuid shape, uniqueness |
| Unit | `src/lib/meta/__tests__/hashPii.test.ts` | `' User@Example.COM '` → hash(`user@example.com`); `'+51 (987) 654-3210'` → hash(`519876543210`); deterministic, lowercased |
| Unit | `src/lib/meta/__tests__/payload.test.ts` | action_source/url/ip/ua, fbp/_fbc passthrough, fbc synth from fbclid, hashed-only PII, no raw PII |
| Unit | `src/lib/meta/__tests__/capi.test.ts` | vi.mock fetch: URL/version/token/test_event_code; 10s abort; retry on 5xx only; never rejects; no env → no-op |
| Integr. | `src/components/consent/__tests__/ConsentBanner.test.tsx` | RTL: renders when pending (Spanish), hidden when decided, accept/decline set cookie, reset re-shows |
| Integr. | `src/components/meta/__tests__/MetaPixelProvider.test.tsx` | RTL: script only when accepted+platform; none when declined/tenant; PageView on mount |
| Unit | `tests/unit/purchasePlanCapi.test.ts` | dynamic-import route (pattern of `purchasePlan.test.ts`); vi.mock `@/lib/meta/capi` + next/headers: eventId present+send fired when accepted; neither when declined/pending; CAPI mock rejection doesn't alter response |

## Migration / Rollout

None — all paths are additive and gated by env presence (no `META_CAPI_ACCESS_TOKEN` → warnings only, CAPI no-op, pixel still works via `NEXT_PUBLIC_META_PIXEL_ID`). Rollback: revert provider/banner mounts + route call site + CSP lines + env vars.

## PR Slicing (3 chained, feature-branch-chain on tracker `feat/meta-pixel-capi`)

| Slice | Branch (from previous) | Files | MUST NOT contain |
|---|---|---|---|
| 1 — consent+env+CSP | `feat/meta-pixel-capi/01-consent-env-csp` (from tracker) | consent.ts/client/server, tenantGuard.ts, ConsentBanner + tests, app/layout.tsx (banner only), env.ts, .env.example, next.config.ts | fbq, provider, CAPI, route/PricingCard changes — slices 2/3 depend on cookie+env+CSP+guard |
| 2 — pixel provider | `feat/meta-pixel-capi/02-pixel-provider` (from 01) | eventId.ts, fbq.ts, events.ts, MetaPixelProvider + tests, app/layout.tsx (provider) | CAPI modules, purchase-plan, PricingCard — slice 3 depends on fbq/eventId |
| 3 — CAPI+Purchase | `feat/meta-pixel-capi/03-capi-purchase` (from 02) | hashPii.ts, payload.ts, capi.ts + tests, purchase-plan route, usePurchasePlan.ts, PricingCard.tsx, purchasePlanCapi.test.ts | consent/env/CSP/provider changes — depends on slices 1+2 |

Each slice keeps `pnpm test:unit` green standalone. Note: slice 3 is the largest (~420–460 est. lines); keep PricingCard diff minimal and split commits within the PR by concern if the 400-line review budget is exceeded (chained-pr guidance applies at merge time).

## Open Questions

- [ ] DL 1729-compliant consent banner copy review (Spanish) — copy drafts in banner component pending legal sign-off.
- [ ] Confirm Meta Pixel ID + CAPI token ownership (which Meta Business) before enabling in prod; `test_event_code` should be used for first validation in Events Manager.