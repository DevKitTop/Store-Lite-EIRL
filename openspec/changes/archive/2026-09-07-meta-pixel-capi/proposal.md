# Proposal: Meta Pixel + Conversions API (CAPI)

## Intent

Enable Meta paid-acquisition tracking for Store-Lite's own SaaS funnel (landing, pricing, auth, legal): browser pixel + server CAPI, deduplicated via shared `event_id`, consent-gated, zero impact on tenant storefronts or purchase flows.

## Scope

### In Scope
- `sl_consent_status` cookie (resettable) + Spanish consent banner; gates pixel AND CAPI sends
- `MetaPixelProvider` in root layout, guarded by `isTenantHost` + platform-path allowlist; `/auth/customer` excluded
- CAPI module: SHA-256 PII hashing (lowercase/trim email, phone digits w/ country code), shared `event_id` (48h window), 10s timeout + retry, fire-and-forget, server-only origin
- Events: PageView (platform pages), ViewContent (/pricing), InitiateCheckout (PricingCard), Purchase (purchase-plan route, server `event_id` returned in JSON response)
- CSP update (script-src/connect-src), 3 new env vars + `.env.example` + env.ts warnings
- Strict-TDD unit tests (hashPii, capi, consent, banner, provider, purchase-plan route)

### Out of Scope
- Tenant storefront pixel/CAPI; public client→CAPI relay route; utm/fbclid persistence (`_fbc` synthesized from `fbclid` at event time only); privacy-policy copy rewrite; PostHog taxonomy changes

## Capabilities

### New Capabilities
- `meta-pixel-capi`: pixel loading, tenant guard, CAPI client, PII hashing, event dedup, 4 events
- `analytics-consent`: cookie consent infra + Spanish banner, reusable beyond Meta

### Modified Capabilities
- None

## Approach

Provider mounts in `app/layout.tsx`; client guard (hostname + path allowlist + consent cookie) decides `next/script` injection (afterInteractive). CAPI server-only: Purchase fired in `app/api/billing/purchase-plan/route.ts` (server `event_id` → JSON response → matching `fbq` from PricingCard); InitiateCheckout from PricingCard. Follows `captureEvent` fire-and-forget `.catch()` pattern; never blocks user flow.

## Affected Areas

| Area | Impact | Change |
|------|--------|--------|
| `app/layout.tsx` | Mod | provider mount (guarded) |
| `src/lib/meta/*` (new) | New | provider, capi, hashPii, consent, events, cookies |
| `src/components/consent/ConsentBanner.tsx` | New | Spanish banner + cookie |
| `app/api/billing/purchase-plan/route.ts` | Mod | event_id + Purchase CAPI |
| `app/pricing/components/PricingCard.tsx` | Mod | InitiateCheckout + Purchase fbq |
| `app/page.tsx`, `app/(main)/layout.tsx` | Mod | PageView/ViewContent wiring |
| `next.config.ts` | Mod | CSP: connect.facebook.net, www.facebook.com |
| `src/config/env.ts`, `.env.example` | Mod | env vars + warnings |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| CSP omission silently blocks pixel | Med | CSP updated in same change; e2e check |
| Tenant leakage | Med | client hostname+path guard; `/auth/customer` excluded |
| CAPI blocks purchase | Low | fire-and-forget + Promise.allSettled |
| Event duplication | Med | shared event_id both sides, 48h window |
| Consent bypass | Low | server cookie check gates CAPI too |

## Rollback Plan

Revert provider mount + 2 CAPI call sites, restore CSP lines, unset env vars. Pixel stops instantly; each slice commits independently for targeted revert.

## Dependencies

- Meta Pixel ID + CAPI access token (env); Graph API v21.0
- DL 1729-compliant consent wording review

## Success Criteria

- [ ] Purchase events dedupe in Meta Events Manager (pixel + CAPI match)
- [ ] Tenant pages load no pixel; purchase flow unblocked (tests)
- [ ] Consent denied → zero pixel/CAPI activity

## Size & PR Classification

- Estimated changed lines: ~950–1050 (impl ≈340, tests ≈330, banner/CSP/env ≈280)
- **recommended-chained** (>400 review budget): slices — (1) consent + env + CSP; (2) pixel provider + PageView/ViewContent; (3) CAPI + InitiateCheckout/Purchase + tests