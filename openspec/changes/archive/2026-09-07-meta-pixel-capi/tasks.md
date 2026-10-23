# Tasks: Meta Pixel + CAPI (meta-pixel-capi)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~950–1050 (impl ≈340, tests ≈330, banner/env/CSP ≈280) |
| 400-line budget risk | High (slice 3 ≈420–460; slices 1–2 Low–Med) |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 (feature-branch-chain) |
| Delivery strategy | auto-chain |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Base branch |
|------|------|-----------|-------------|
| 1 | Consent + env + CSP (analytics-consent) | PR 1 | feat/meta-pixel-capi |
| 2 | Pixel provider + PageView/ViewContent | PR 2 | feat/meta-pixel-capi/01-consent-env-csp |
| 3 | CAPI + InitiateCheckout/Purchase + tests | PR 3 | feat/meta-pixel-capi/02-pixel-provider |

## Slice 1 — Consent + Env + CSP (PR 1: `feat/meta-pixel-capi/01-consent-env-csp`)

MUST contain: consent modules, tenantGuard, banner, layout (banner only), env/CSP/.env.example + tests. MUST NOT contain: fbq, provider, CAPI, route/PricingCard (slices 2–3 depend on cookie+env+CSP+guard).

- [x] 1.1 RED — Write `src/lib/consent/__tests__/consent.test.ts`, `consentClient.test.ts`, `src/lib/meta/__tests__/tenantGuard.test.ts`: pending default, accepted/declined round-trip, reset deletion, invalid→pending, platform allow / tenant deny / `/auth/customer` deny. Run `pnpm test:unit` → fail.
- [x] 1.2 Create `src/lib/consent/consent.ts` — pure: `COOKIE_NAME='sl_consent_status'`, `ConsentState`, `resolveConsentState()` (absent/invalid→pending). AC: 1.1 green.
- [x] 1.3 Create `src/lib/consent/consentClient.ts` — `'use client'`; get/set/reset via `document.cookie` with SameSite=Lax, Path=/, Max-Age=31536000, Secure on https, host-only (no Domain). AC: jsdom round-trip green.
- [x] 1.4 Create `src/lib/consent/consentServer.ts` — `async getConsentState()` via `next/headers` `cookies()`. AC: returns cookie value or pending.
- [x] 1.5 Create `src/lib/meta/tenantGuard.ts` — pure: `PLATFORM_TRACKING_PREFIXES` mirroring proxy.ts (`/`,`/auth`,`/pricing`,`/created`,`/list-business`,`/onboarding`,`/devoluciones`,`/privacidad`,`/terminos`,`/libro-reclamaciones`), `isPlatformTrackingPath()`, `isPlatformTrackingPage()` via `isTenantHost`; excludes `/auth/customer`. AC: 1.1 green.
- [x] 1.6 Create `src/components/consent/ConsentBanner.tsx` — Spanish banner (pending, Accept/Decline) + reset chip (decided); internal tenantGuard; copy = Spanish draft pending DL 1729 review. Dep: 1.3, 1.5. AC: `__tests__/ConsentBanner.test.tsx` (RTL: shows when pending, hidden when decided, sets cookie, reset re-shows).
- [x] 1.7 Modify `src/config/env.ts` + `.env.example` — add `metaPixelId` (`NEXT_PUBLIC_META_PIXEL_ID`), `metaCapiAccessToken` (`META_CAPI_ACCESS_TOKEN`, server-only), `metaTestEventCode` (`META_TEST_EVENT_CODE`); warn-if-missing, never crash. AC: warnings emitted, app continues.
- [x] 1.8 Modify `next.config.ts` CSP — `script-src` += `https://connect.facebook.net https://*.facebook.net` (L37); `connect-src` += `https://www.facebook.com` (L42). AC: CSP permits pixel load.
- [x] 1.9 Modify `app/layout.tsx` — mount `ConsentBanner` in body (guarded internally). AC: banner renders on platform pages, never on tenant/`/auth/customer`.
- [x] 1.10 GREEN — `pnpm test:unit`, `pnpm type-check`, `pnpm lint` green; commit slice 1. Boundary: no fbq/provider/CAPI/route touches.

## Slice 2 — Pixel Provider (PR 2: `feat/meta-pixel-capi/02-pixel-provider`)

MUST contain: eventId, fbq, events, provider, layout (provider) + tests. MUST NOT contain: CAPI modules, purchase-plan, PricingCard (slice 3 depends on fbq/eventId).

- [x] 2.1 RED — Write `src/lib/meta/__tests__/eventId.test.ts` (uuid shape, uniqueness) + `src/components/meta/__tests__/MetaPixelProvider.test.tsx` (RTL: script only when accepted+platform; none when declined/tenant; PageView on mount). Run test → fail.
- [x] 2.2 Create `src/lib/meta/eventId.ts` — `generateEventId()` → `crypto.randomUUID()`. Dep: none (universal). AC: 2.1 green.
- [x] 2.3 Create `src/lib/meta/fbq.ts` — `'use client'`; typed `window.fbq` wrapper: `initFbq()`, `trackEvent(name, data?, eventID?)` no-op when absent. AC: events fire only after init.
- [x] 2.4 Create `src/lib/meta/events.ts` — event-name constants + typed custom_data for PageView, ViewContent, InitiateCheckout, Purchase.
- [x] 2.5 Create `src/components/meta/MetaPixelProvider.tsx` — `'use client'`; guard (`consent==='accepted' && !isTenantHost && isPlatformTrackingPath`) → `<Script>` afterInteractive (inline base-code + `https://connect.facebook.net/en_US/fbevents.js`), init in onLoad → PageView on mount + `usePathname()` change (skip first); ViewContent when path starts `/pricing`. Dep: 1.2–1.5, 2.2–2.4. AC: 2.1 RTL green.
- [x] 2.6 Modify `app/layout.tsx` — mount `MetaPixelProvider` next to banner. AC: provider mounts platform-only.
- [x] 2.7 GREEN — `pnpm test:unit` + `pnpm type-check` green; commit slice 2. Boundary: no CAPI/route/PricingCard touches.

## Slice 3 — CAPI + Purchase (PR 3: `feat/meta-pixel-capi/03-capi-purchase`)

MUST contain: hashPii, payload, capi, purchase-plan route, usePurchasePlan, PricingCard + tests. MUST NOT contain: consent/env/CSP/provider changes. Depends on slices 1+2.

- [x] 3.1 RED — Write `src/lib/meta/__tests__/hashPii.test.ts` (`' User@Example.COM '`→sha256(`user@example.com`); `'+51 (987) 654-3210'`→sha256(`519876543210`); deterministic), `payload.test.ts` (action_source/url/ip/ua, fbp/_fbc passthrough, fbc synth from fbclid, hashed-only), `capi.test.ts` (vi.mock fetch: URL v21.0/token/test_event_code, 10s abort, retry 5xx-only, never rejects, no-env no-op), `tests/unit/purchasePlanCapi.test.ts` (dynamic route import + vi.mock capi + next/headers). Run → fail.
- [x] 3.2 Create `src/lib/meta/hashPii.ts` — `node:crypto` sha256 hex; `normalizeEmail` (trim+lowercase), `normalizePhone` (digits+country code), `splitFullName`, `hashEmail/hashPhone/hashName`. AC: 3.1 hash tests green; client import fails at build (D5).
- [x] 3.3 Create `src/lib/meta/payload.ts` — `buildEventPayload`: unix `event_time`, `action_source:'website'`, hashed `em/fn/ln`, `client_ip_address`, `client_user_agent`, `fbp`/`_fbc` cookies, `fbc=fb.1.<ts>.<fbclid>` synth, `custom_data`. AC: 3.1 payload tests green; no raw PII.
- [x] 3.4 Create `src/lib/meta/capi.ts` — POST `graph.facebook.com/v21.0/{pixel}/events`; 10s AbortController; 1 retry on network/5xx (250ms), never 4xx; `test_event_code` when set; `fireEvent` fire-and-forget `.catch(noop)`; module-top `window` throw (D5); no token → no-op. AC: 3.1 capi tests green; never blocks caller.
- [x] 3.5 Modify `app/api/billing/purchase-plan/route.ts` — after tx success (Culqi+DB unchanged): `consentServer` gate → `eventId=generateEventId()` → `fireEvent('Purchase',{hashEmail(buyerEmail),splitFullName(buyerFullName),totalSoles,currency:'PEN',planType,period,paymentMethod,culqiChargeId})`; `event_source_url` = referer ‖ `/pricing`; add `eventId?` to success JSON. Dep: 3.2–3.4. AC: 3.1 route test — eventId present + send fired when accepted; neither when declined/pending; mock rejection doesn't alter response.
- [x] 3.6 Modify `src/features/billing/hooks/usePurchasePlan.ts` — `PurchasePlanResult` += `eventId?: string`; surface from `purchase()`. AC: existing consumers type-check.
- [x] 3.7 Modify `app/pricing/components/PricingCard.tsx` — `handleOpenDialog` → `trackEvent('InitiateCheckout',…,generateEventId())`; on success → `trackEvent('Purchase',{value:totalSoles,currency:'PEN'},res.eventId)` (minimal diff). Dep: 2.3, 3.6. AC: dedup eventId used by both sides.
- [x] 3.8 GREEN — `pnpm test:unit` + `pnpm type-check` + `pnpm lint` green; commit slice 3 split by concern (route/provider/pricing) if diff >400 lines.

## Definition of Done (all slices)

- [ ] 4.1 Full `pnpm test:unit` green on tracker `feat/meta-pixel-capi` after 3 chained merges; 10 test files present.
- [ ] 4.2 Env-gated rollout verified: no token → warnings + CAPI no-op; pixel works via `NEXT_PUBLIC_META_PIXEL_ID`.
- [ ] 4.3 `next.config.ts` CSP permits `connect.facebook.net` + `www.facebook.com`; tenant hosts and `/auth/customer` show no pixel/banner (manual smoke + tests).
