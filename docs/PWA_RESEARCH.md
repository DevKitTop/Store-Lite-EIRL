# Store Lite PWA, Web Push, and Offline Research

**Status:** Research, implementation planning, and task breakdown; no product behavior has been changed.  
**Reviewed:** 2026-11-18  
**Recommended first audience:** Authenticated sellers and their team members.  
**Implementation gate:** Code work starts only after the Phase 0 decisions are approved. See [Implementation task breakdown](#implementation-task-breakdown).

## Executive recommendation

Store Lite can add an installable, app-like seller experience without building a native app. The existing business notification inbox is a useful source for mobile push, but it does not currently deliver operating-system notifications. PWA installation, push delivery, and offline behavior are separate capabilities and should be implemented and released separately.

Recommended order:

1. Make the seller experience installable from the platform's primary origin.
2. Add opt-in web push for a small set of useful seller alerts, while retaining the existing inbox as the reliable in-app history.
3. Add offline behavior only for explicitly selected, low-risk read-only content. Keep payments, orders, stock changes, and other authoritative actions online-only.

Do not begin with customer push or offline writes. The current notification model is business-scoped, while a push subscription is associated with a specific user, browser, device, and origin. That mismatch requires product and data-model decisions before implementation.

## Quick path

| Phase                               | Deliverable                                                                             | Exit condition                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 0. Product decisions                | Audience, origin, alert recipients, privacy, and offline scope agreed                   | No unresolved decision below blocks the selected scope                                                     |
| 1. Installable seller app           | Manifest, production icons, standalone launch metadata, and mobile install guidance     | Install and authenticated entry work on supported Android and iOS devices                                  |
| 2. Seller web push                  | User/device subscriptions, explicit opt-in, server delivery, and unsubscribe/revocation | Authorized recipients get generic alerts; unsupported/denied users still use the inbox                     |
| 3. Carefully scoped offline support | Static asset caching and optionally public read-only shell                              | No private or stale authoritative data is presented as current; no offline write is reported as successful |

## Rough implementation effort

These are planning ranges for one engineer, not a commitment or a full project estimate. They assume the current notification table and server runtime remain usable and exclude waiting for product decisions, legal review, provider setup, and access to physical test devices. Ranges include unit and integration tests; physical-device QA is planned in the task breakdown and estimated separately.

| Scope                         | Rough range | Main uncertainty                                                                   |
| ----------------------------- | ----------: | ---------------------------------------------------------------------------------- |
| Installable seller shell      |    2–4 days | Icon preparation, multi-business launch behavior, and deployed-origin verification |
| Push MVP                      |   6–10 days | Subscription schema/RLS, retry-safe delivery, recipient preferences, and device QA |
| Static/public offline support |    2–5 days | Safe cache rules, worker update behavior, and stale-data UX                        |

The per-task estimates in [Implementation task breakdown](#implementation-task-breakdown) are the working numbers; this table is the planning envelope.

These phases should be estimated and approved separately. A broad offline mode, customer push, or custom-domain support is not included.

## What the repository does today

| Area                   | Current behavior and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App shell              | Next.js App Router with root metadata and a single `/img/icon.png`; no PWA manifest or service-worker flow was found. See [`app/layout.tsx`](../app/layout.tsx), [`public/`](../public/), and [`package.json`](../package.json).                                                                                                                                                                                                                                                                                                                       |
| Tenant routing         | Seller pages are nested under `app/[slug]/(app)`. The business is resolved server-side and membership/role context is passed to the app providers. See [`app/[slug]/(app)/layout.tsx`](<../app/%5Bslug%5D/(app)/layout.tsx>) and [`app/[slug]/(app)/dashboard/layout.tsx`](<../app/%5Bslug%5D/(app)/dashboard/layout.tsx>).                                                                                                                                                                                                                            |
| Notification inbox     | `useNotifications` fetches persisted notifications, subscribes to Supabase Realtime inserts filtered by `business_id`, and polls every 30 seconds as a fallback. This updates an open page; it is not OS-level push. See [`src/hooks/useNotifications.ts`](../src/hooks/useNotifications.ts) and [`app/[slug]/(app)/context/NotificationsContext.tsx`](<../app/%5Bslug%5D/(app)/context/NotificationsContext.tsx>).                                                                                                                                    |
| Notification access    | The API requires authentication and business membership for reads; the create endpoint limits creation to owner/admin. Notification records are business-scoped. See [`app/api/notifications/route.ts`](../app/api/notifications/route.ts), [`app/api/notifications/[id]/route.ts`](../app/api/notifications/%5Bid%5D/route.ts), and [`src/lib/permissions/checkPermission.ts`](../src/lib/permissions/checkPermission.ts).                                                                                                                            |
| Read state             | `is_read` and `is_dismissed` live on the business notification row. As currently modeled, marking a notification read/dismissed is shared across team members, not an independent per-user inbox state. See [`migrations/0019_notifications_table.sql`](../migrations/0019_notifications_table.sql) and [`migrations/0020_fix_notifications_realtime.sql`](../migrations/0020_fix_notifications_realtime.sql).                                                                                                                                         |
| Notification producers | The common helper creates business notifications for events including new orders, chat, inventory/import changes, and plan checks. Some existing notification content includes customer names, message previews, or order amounts. See [`src/lib/notifications.ts`](../src/lib/notifications.ts), [`app/api/payment/charge/route.ts`](../app/api/payment/charge/route.ts), [`src/features/chat/actions/chatActions.ts`](../src/features/chat/actions/chatActions.ts), and [`app/api/cron/check-plans/route.ts`](../app/api/cron/check-plans/route.ts). |
| Offline-related state  | The cart persists to `localStorage` and some preferences use browser storage, but cart validation and checkout rely on the server. No service worker, Cache Storage offline workflow, or IndexedDB-based offline workflow was found. See [`src/features/storage/context/CartContext.tsx`](../src/features/storage/context/CartContext.tsx), [`app/[slug]/(app)/components/CartShell.tsx`](<../app/%5Bslug%5D/(app)/components/CartShell.tsx>), and [`app/[slug]/(app)/components/Checkout.tsx`](<../app/%5Bslug%5D/(app)/components/Checkout.tsx>).    |
| Web security headers   | `buildCsp` already emits `default-src 'self'` and `worker-src 'self' blob:`, so service-worker registration is not blocked by CSP today. `next.config.ts` applies its headers to `/:path*`, while CSP/nonce headers come from the proxy pipeline. See [`src/lib/middleware/securityHeaders.ts`](../src/lib/middleware/securityHeaders.ts) and [`next.config.ts`](../next.config.ts).                                                                                                                                                                   |
| Icon assets            | `public/img/icon.png` is 1024×1024 and no 192×192 or 512×512 variants exist. The current file is a valid source for generated sizes but cannot be the only manifest icon.                                                                                                                                                                                                                                                                                                                                                                              |
| Environment            | `.env.example` has no Web Push/VAPID settings. Push keys and any provider credentials would be new server configuration; private keys must not use a `NEXT_PUBLIC_` prefix.                                                                                                                                                                                                                                                                                                                                                                            |

The file and symbol references above are entry points, not a complete implementation spec. Recheck them against the branch being implemented, especially notification producers and authorization rules.

## Implementation approach in this repository (Next.js 16)

The repository runs Next.js 16 App Router on Turbopack and has no PWA dependency. Prefer native capabilities before adding packages:

| Capability                      | Recommended mechanism                                                 | Impact                                                                                              |
| ------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Web App Manifest                | `app/manifest.ts` exporting `MetadataRoute.Manifest`                  | No dependency and no `next.config.ts` change; served at `/manifest.webmanifest`.                    |
| Service worker                  | Hand-written `public/sw.js`, registered from a small client component | Next.js does not bundle `public/`; the worker owns its version string. No build change.             |
| Bundled worker (only if needed) | `@serwist/next`                                                       | Maintained; modifies `next.config.ts`. Adopt only if manual caching/versioning becomes error-prone. |
| `next-pwa`                      | Not adopted                                                           | Webpack-only and unmaintained; incompatible with Next 16 / Turbopack.                               |
| Push sender                     | `web-push` on the server                                              | Standards-based VAPID Web Push; new dependency, approval required by `AGENTS.md`.                   |

Repository-specific consequences:

- `/manifest.webmanifest` and `/sw.js` contain a dot, so [`shouldBypassProxy`](../src/lib/middleware/proxyBypass.ts) returns `true` and both skip the proxy. That is acceptable for root-level assets, but it must be deliberate: a tenant-specific manifest or a worker that needs tenant rewriting will not work through that path.
- `next.config.ts` applies its headers to `/:path*` even when the proxy bypasses, but CSP and nonce headers are applied by the proxy pipeline. Verify the deployed headers for both assets instead of assuming either behavior.
- The current CSP already permits workers (`worker-src 'self' blob:`) and the manifest falls back to `default-src 'self'`. Do not relax CSP preemptively for PWA work.

## Development impact guardrails

The constraint is that PWA support must not change existing development or product behavior. Keep these boundaries:

| Phase | New dependencies               | Files touched                                                                                                      | Explicitly unchanged                                                   |
| ----- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| P1    | None                           | `app/manifest.ts`, icon assets, optionally one client component and `app/layout.tsx` metadata                      | Auth, tenant routing, middleware, checkout, database, existing scripts |
| P2    | `web-push` (approval required) | One manual-operator migration, one API route group, one settings surface, `public/sw.js`, a server producer module | Payment/order success paths, inbox behavior, tenant authorization      |
| P3    | None                           | `public/sw.js`, one registration/update component                                                                  | Authenticated APIs, personalized seller pages, private caches          |

Rules for every task:

- Additive environment variables only (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`); never a `NEXT_PUBLIC_` prefix for the private key.
- No changes to the `pnpm dev`, `pnpm build`, `pnpm test:unit`, `pnpm lint`, or `pnpm type-check` workflows. The service worker is a static file, not a build step.
- Database changes follow the manual-operator chain documented in [`migrations/README.md`](../migrations/README.md) and must be tested for cross-tenant access.
- Every task keeps the website fully usable when installation or push is unavailable.

## Recommended product boundary

### Seller PWA first

The existing inbox and event producers primarily address business operators. A first release should target an authenticated seller or team member who wants to reopen the dashboard quickly and receive a small number of timely alerts.

The seller PWA should be a progressive enhancement:

- The normal responsive website remains fully usable if installation or notifications are unavailable.
- Installation is offered as guidance or a browser-supported action; do not make it a prerequisite for login or core workflows.
- Ask for notification permission only after a clear user action explaining the value. Do not trigger the browser prompt on first page load.
- Keep the existing inbox as the source of notification history and a fallback for users who decline or cannot receive push.

### Customer push is a separate feature

Customer order updates would need a separate recipient identity, consent flow, subscription lifecycle, and privacy policy. Do not infer customer subscriptions from seller memberships or attach them to a business-wide notification record without a separate design.

## Proposed implementation boundaries

### Phase 0 — Decide audience, origin, and recipients

Confirm these before schema or UI work:

- Is the installed app for business owners/team members, shoppers, or both? Recommendation: sellers first.
- Which origin is the supported app origin? Today, path-based tenant URLs share an origin. Feature-flagged subdomain rewrites are present, and custom domains are described as future work. A subdomain or custom domain is a different origin and therefore has separate installation, service-worker scope, permissions, and push subscriptions.
- How does a user with multiple businesses choose the post-login destination? A global seller app needs a stable launch route that can select or remember an authorized business; a manifest should not assume an arbitrary tenant slug.
- Which roles receive which alert categories? Do all team members receive orders/messages, or only selected users?
- Is notification read/dismiss state intentionally shared across the team? Push delivery is per user/device. The current shared read state can cause one person's action to affect everyone.
- Should an explicit logout revoke that device's subscription? Recommended default: stop delivery to that user/device on logout or when business membership is revoked. Decide how to handle expired sessions and shared devices.
- Which OS/browser versions are in scope, and which notification categories may appear on a lock screen?
- Does the privacy notice need to explain push purposes, categories, retention, and how to revoke consent? Browser permission is separate from the product's explanation and settings.
- Is offline support required for a specific workflow, or is installability plus push sufficient for the first release?

#### Recorded decisions (Phase 0)

| Task | Decision                              | Status         | Date (UTC) | Recorded choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ------------------------------------- | -------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T0.1 | Audience and eligible roles           | Decided        | 2026-11-18 | Sellers and authenticated team members only (no customer push in MVP). Eligible recipients for enabled push categories: all users with current membership/authorization and dashboard access for that business. Delivery is per user/device; membership/authorization must be validated at subscribe and send time. Per-category recipient selection is defined in T0.3.                                                                                                                                  |
| T0.2 | Supported origin and manifest scope   | Decided        | 2026-11-18 | Supported origin: platform primary HTTPS origin (current domains, shared origin). Manifest `id`/`start_url`/`scope`: `/` (root launch resolved by proxy to remembered business/onboarding for authenticated sellers, or landing for anonymous visitors), consistent with path-based tenants and multi-business accounts. Tenant subdomains/custom domains are out of scope for now and a later decision (separate origin => separate install, service-worker scope, permissions, and push subscriptions). |
| T0.3 | Push alert categories                 | Decided        | 2026-11-18 | Push-enabled categories (MVP): `pedidos` only. Categories `chat`, `almacen`, `plan`, `sistema` remain in-app inbox only for now. Recipients: all T0.1-eligible users for that business for enabled categories; per-category preferences/opt-in handled in P2. Push payloads remain generic (no sensitive details) per plan.                                                                                                                                                                               |
| T0.4 | Read-state model (shared vs per-user) | Decided        | 2026-11-18 | Shared (option A), keep current behavior: `is_read`/`is_dismissed` remain on the business notification row and one member’s action affects all. Push receipt/delivery is tracked per user/device separately and must not automatically mark the shared inbox notification as read on receipt/click (click opens an authenticated route; read-state behavior defined in P2). No per-user inbox read-state migration required for MVP; T2.1 focuses on per-user/device subscriptions.                       |
| T0.5 | Offline scope                         | Decided        | 2026-11-18 | None for now (option A). P1/P2 only; no app-content or static-asset offline caching and P3 not opened (T3.1-T3.4 dropped for now). Web Push (P2) can deliver OS notifications via service worker when the device has connectivity without offline content caching. Can be revisited later if needed.                                                                                                                                                                                                      |
| T0.6 | Privacy notice changes                | Draft prepared | 2026-11-18 | Draft prepared (scope baseline, option A) — pending legal review/approval/publication before P2 launch; responsible and timeline TBD. See "T0.6 privacy notice draft" below. Not published in `/privacidad` and current privacy spec unchanged until approved.                                                                                                                                                                                                                                            |
| T0.7 | Sender and key ownership              | Decided        | 2026-11-18 | Approved sender: `web-push` (VAPID). Keys generated at P2 implementation time and stored as server-only env vars in Vercel (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` = project contact); never `NEXT_PUBLIC_` and never committed. Key owner/custodian: project owner (admin access in Vercel), responsible to generate/store/rotate/revoke VAPID keys.                                                                                                                                   |

#### T0.6 privacy notice draft (pending legal review/approval)

> **Status:** Draft for legal review/approval and publication. Not yet reflected in `/privacidad` (`app/(main)/privacidad/page.tsx`) or in `openspec/specs/privacy-policy/spec.md`; must be reviewed, approved, and published before P2 (web push) launch. Responsible/timeline TBD.

- **Purpose:** Send operational web push alerts for **new orders** (`pedidos`) to authenticated, authorized sellers/team members with dashboard access for the relevant business, to support timely order management. No customer push in MVP.
- **Scope/categories:** Push-enabled category in MVP: `pedidos` only. `chat`, `almacen`, `plan`, `sistema` remain in-app inbox only. Eligible recipients are users with current membership/authorization and dashboard access for that business (T0.1/T0.3).
- **Data processed:** Browser/device push subscription (endpoint and public encryption keys `p256dh`/`auth`), association of user-device-eligible business, subscription/preference status, timestamps, and technical delivery/failure records (e.g. provider responses, invalid endpoints). Notification content is **generic** (no sensitive customer/order details in the message); details are shown only after opening the relevant authenticated route.
- **Consent and revocation (opt-in):** Subscription is requested only after an explicit user action in the app and can be revoked from in-app notification settings and/or browser/device permission settings. Browser/OS permission is separate from the product notice and controls.
- **Retention:** Kept while the subscription is active and valid for an eligible user/business; removed or invalidated on unsubscribe, permission/session revocation or loss of membership (policy to be finalized in P2), and when the endpoint becomes invalid. Technical delivery/failure records retained for the minimum time necessary for operations, security, and troubleshooting (specific period to be defined/approved before P2). Not used for purposes beyond those stated.
- **Transfers/third parties (delivery):** Delivered via the Web Push/VAPID standard (`web-push`, T0.7) through the browser/device push service provider; app/platform infrastructure (e.g. Supabase/Vercel) as applicable. VAPID keys and subscription data are handled server-side with restricted access.
- **Security:** Encrypted in transit; subscriptions treated as sensitive (not exposed to other users); access and operations authenticated/authorized.

### Phase 1 — Installable seller app

Expected work:

- Add `app/manifest.ts` exporting a Web App Manifest with a stable app `id`, `name`/`short_name`, `start_url`, `scope`, `display: "standalone"` plus `display_override`, `theme_color`, `background_color`, and correctly sized icons. This is a metadata route: no dependency and no `next.config.ts` change.
- Provide production-ready 192×192 and 512×512 icons (at least one with `purpose: "maskable"`) generated from the existing 1024×1024 [`public/img/icon.png`](../public/img/icon.png), plus a 180×180 `apple-touch-icon` for iOS. Do not use the 1024×1024 file as the only manifest icon.
- Choose a launch URL that works for an authenticated seller, expired session, and multi-business account. Keep public storefront routes and seller routes intentional within the manifest scope; never derive `start_url` from an arbitrary tenant slug.
- Add an install explanation/control only where the platform supports it; otherwise provide concise “Add to Home Screen” instructions. Installation must never be a prerequisite for login or core workflows.
- Add iOS standalone metadata through Next metadata (`apple-mobile-web-app-capable`, status bar style) and verify the installed app opens the seller area rather than the storefront.
- Verify the deployed manifest response: `/manifest.webmanifest` contains a dot and bypasses the proxy. Confirm content type, cache headers, and that the manifest is reachable in production.
- Verify the final deployed app over HTTPS. Localhost is suitable for development but does not validate production origins, cookies, service-worker asset headers, or OAuth redirect behavior.
- Verify authentication inside the installed app on iOS: Supabase session refresh, Google OAuth redirect, logout, and expired-session recovery must not strand the user in Safari or a blank standalone window.

An offline service worker is not required merely to provide a manifest-based installable experience in supporting browsers. A service worker is required for Web Push and is commonly used for offline caching; do not introduce broad caching solely to make the app installable. The current CSP already allows workers, so registration does not require a CSP change; any relaxation must be justified by a feature, not added preemptively.

### Phase 2 — User/device-scoped web push

Expected building blocks:

1. **Client opt-in:** feature-detect the required APIs, explain the notification purpose, and request permission immediately from the user's explicit subscribe action. Generate the subscription with `applicationServerKey` set to the VAPID public key (public by design; the private key stays server-side). Gracefully handle unsupported browsers, denied permission, and iOS users who have not added the web app to the Home Screen.
2. **Service worker:** register a same-origin worker and handle `push`, `notificationclick`, and `pushsubscriptionchange`. Show a useful notification immediately when a push arrives; Safari does not support invisible push.
3. **Subscription API:** authenticate the caller, validate current business membership/permissions, protect state-changing endpoints against CSRF, and support subscribe, update, and unsubscribe. Persist the serialized subscription (`toJSON()`: `endpoint`, `keys.p256dh`, `keys.auth`). A client-supplied `businessId` or endpoint must never grant authorization by itself.
4. **Subscription storage:** store each endpoint/device separately and associate it with the authenticated user and eligible business(es). Track creation/update/revocation and delivery failures. Push endpoints and encryption keys are sensitive; do not expose them in logs or client-readable tables.
5. **Server sender:** generate and keep VAPID credentials server-side, send encrypted Web Push payloads with bounded `TTL` and `urgency`, handle provider responses, expire invalid subscriptions (for example, `410 Gone`), and bound retries. Reuse the existing cron/route pattern (`app/api/cron/check-plans`) or an outbox instead of introducing new queue infrastructure.
6. **Event fan-out:** deliver only after the underlying business notification is durably created. A queue/outbox or another retry-safe mechanism is preferable to making a payment/order operation depend on a push-provider call. Deduplicate delivery by notification, recipient, and endpoint so retries do not fan out repeatedly. Trigger fan-out only from trusted server producers: `POST /api/notifications` currently accepts owner/admin callers and would otherwise become a push-triggering surface.
7. **Privacy-safe payload:** do not send the existing notification `message` or `data` verbatim. Current producers may include customer names, chat previews, and order amounts. Prefer generic text such as “New order received”; on click, open an authenticated route that rechecks membership and permissions.
8. **Preferences and fallback:** map category-level opt-in/out to the existing notification `category` enum (`pedidos`, `chat`, `almacen`, `plan`, `sistema`) instead of inventing a new taxonomy; retain the in-app inbox. Do not interpret push delivery as read/seen. Define whether click-through changes the current business-shared read state or whether read state should become user-scoped.
9. **Lifecycle:** handle multiple devices, duplicate subscriptions, logout, account changes, business switching, team-member removal, expired permissions, and browser-side unsubscribe. Validate eligibility at send time, not only when the subscription was first recorded.

Do not send full private order details in a push payload and do not treat an unguessable subscription endpoint as an authorization credential. MDN specifically describes the endpoint as a capability URL and warns that push subscription operations need CSRF protection.

Verify the deployed worker response: `/sw.js` also bypasses the proxy because it contains a dot. Confirm content type, `Cache-Control: no-cache` (or `must-revalidate`), and `Service-Worker-Allowed` if the scope exceeds `/`.

Phase 2 adds one server dependency (`web-push`, approval required), one manual-operator migration for subscriptions, one API route group, and one client settings surface. It must not change tenant routing, checkout, or any payment/order success path.

### Phase 3 — Explicitly scoped offline behavior

Safe initial candidate:

- Cache versioned, immutable static assets (icons, fonts, and suitable build assets) with an explicit update/expiry strategy.
- Consider a public, read-only storefront shell only after deciding how stale products, availability, and prices are labeled.

Keep these online-only:

- Product/inventory mutations, price or stock validation, order creation/status changes, checkout, payment, chat sending, and authenticated APIs.
- Do not queue or replay payment/order/inventory writes in the background in the first version.
- Do not cache personalized seller pages, customer/order details, auth responses, or private API responses by default.
- Do not display an offline mutation as successful until the server confirms it.

The cart already persists locally, but server validation is still required. Offline support must not bypass the existing authoritative validation for price, inventory, order, or payment flows. A service worker can intercept requests and serve stale responses; broad or cache-first rules can therefore create both data-integrity and tenant-privacy incidents.

## Cross-cutting risks and mitigations

| Risk                                     | Why it matters here                                                                                                                                                                                                                   | Planning requirement                                                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant or account leakage                | One origin serves multiple businesses; push endpoints are per browser/device, while inbox records are business-scoped                                                                                                                 | Authorize subscription ownership and business eligibility on every write/send; do not trust a submitted tenant identifier                                                                                     |
| Lock-screen privacy                      | Existing notification text may contain customer names, chat previews, or amounts                                                                                                                                                      | Use generic payloads; route users to authenticated pages for details                                                                                                                                          |
| Shared inbox state                       | Read/dismiss flags currently live on shared business records                                                                                                                                                                          | Decide whether to retain shared behavior or introduce per-user state; do not let push receipt mark a message read                                                                                             |
| Origin/scope mistakes                    | Path tenants currently share an origin; future subdomains/custom domains will not                                                                                                                                                     | Pick a primary supported origin first; document manifest start URL and service-worker scope                                                                                                                   |
| Service-worker response/security headers | The proxy bypass logic skips dotted paths, so `/sw.js` and `/manifest.webmanifest` skip proxy processing; the current CSP already allows workers (`worker-src 'self' blob:`), but CSP/nonce headers are applied by the proxy pipeline | Verify deployed content type, `Cache-Control` for `/sw.js`, `Service-Worker-Allowed` if scope exceeds `/`, HTTPS, and headers for worker/manifest assets; adjust routing/header rules intentionally if needed |
| Push delivery failures                   | Permission can be denied/revoked; devices go offline; endpoints expire; providers may reject requests                                                                                                                                 | Keep delivery best-effort and separate from checkout/order success; record bounded outcomes and remove dead endpoints                                                                                         |
| Stale or unsafe offline data             | Inventory, price, checkout, and payment depend on current server state                                                                                                                                                                | Cache only deliberate static/public content; keep mutations and private data online-only                                                                                                                      |
| Permission fatigue                       | OS notification permission is difficult to regain after denial and should be user-controlled                                                                                                                                          | Explain value before a direct user action; offer settings and an in-app fallback                                                                                                                              |
| Consent and retention                    | Browser permission alone does not explain the application's purpose or retention practices                                                                                                                                            | Document purposes/categories, provide unsubscribe controls, and review the privacy notice before launch                                                                                                       |
| Service-worker upgrades                  | An old worker may continue controlling open tabs while a new version waits                                                                                                                                                            | Test updates with multiple open tabs and a stale installed client before broad rollout                                                                                                                        |
| Installed-mode authentication            | On iOS a standalone web app can open OAuth and redirect flows in Safari, losing the in-app session context; Supabase refresh and Google OAuth must be verified in installed mode                                                      | Test login, refresh, logout, and expired-session recovery inside the installed app on iOS before release; keep the browser flow as the fallback                                                               |
| Notification creation as a push trigger  | `POST /api/notifications` accepts owner/admin callers and already carries a note that it should be restricted or internal; wiring push into notification creation would expose a fan-out abuse path                                   | Trigger push only from trusted server-side producers (or gate the endpoint); authenticate, rate-limit, and deduplicate before any provider call                                                               |

The proxy and security-related entry points are [`src/lib/middleware/proxyBypass.ts`](../src/lib/middleware/proxyBypass.ts), [`src/lib/middleware/securityHeaders.ts`](../src/lib/middleware/securityHeaders.ts), [`src/lib/middleware/proxyPipeline.ts`](../src/lib/middleware/proxyPipeline.ts), [`proxy.ts`](../proxy.ts), and [`next.config.ts`](../next.config.ts). Confirm actual production responses; do not assume a proxy bypass implies a vulnerability or that all required headers are absent.

## Platform expectations

| Platform                    | Planning expectation                                                                                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android / Chromium browsers | A manifest and HTTPS are needed for install promotion in supporting browsers. Include `name` or `short_name`, 192×192 and 512×512 icons, `start_url`, and `display`/`display_override`. Install UI and behavior vary.                        |
| iOS / iPadOS                | Web Push is supported for Home Screen web apps on iOS/iPadOS 16.4 and later. Users must add the app to the Home Screen and grant permission from a direct user interaction. Validate the actual browser/OS combinations Store Lite supports. |
| Desktop browsers            | Push and install support differ by browser and OS; feature-detect APIs rather than branching only on user-agent strings. Desktop support is not a substitute for testing the mobile experience.                                              |
| Unsupported/denied/expired  | The responsive website and in-app notification inbox remain usable; explain how to enable notifications without blocking workflows.                                                                                                          |

Do not promise identical installation prompts, badge behavior, background timing, or notification settings across operating systems. Web Push delivery is asynchronous and is not a real-time or guaranteed-delivery channel.

## Acceptance and verification checklist

### Installability

- [ ] Manifest is linked on the intended seller routes and has a stable, deliberate `id`, `start_url`, `scope`, and standalone display mode.
- [ ] Icons are verified at required sizes and remain legible on device launchers.
- [ ] HTTPS production URL installs from supported Android and iOS flows.
- [ ] Launch handles logged-out, expired-session, and multi-business accounts without exposing a tenant or private data.
- [ ] Existing storefront, seller dashboard, login redirects, and tenant switching continue working in a normal browser.
- [ ] Manifest returns the correct content type and cache-safe headers in production.
- [ ] The installed iOS app survives Google OAuth redirects, session refresh, logout, and expired-session recovery without stranding the user in Safari.

### Web Push

- [ ] Permission is requested only after an explicit user action and is not required to use the app.
- [ ] Unsupported, denied, revoked, and Home-Screen-not-installed states have a clear fallback.
- [ ] Subscription creation/removal is authenticated, tenant-authorized, CSRF-protected, and safe to repeat.
- [ ] Stored subscriptions include `endpoint`, `keys.p256dh`, and `keys.auth`, are never readable by other users, and rotate on `pushsubscriptionchange` without duplicate delivery.
- [ ] Multiple devices are represented separately; logging out or losing business membership stops future delivery according to the agreed policy.
- [ ] Push goes only to eligible users, contains no customer/chat/payment details, and opens an authenticated route that rechecks authorization.
- [ ] Provider failure cannot fail or roll back an order/payment; retries are bounded and deduplicated.
- [ ] Existing inbox history and Realtime/polling behavior continue to work when push is unavailable.
- [ ] `/sw.js` is served with the correct content type, `no-cache`/`must-revalidate`, and `Service-Worker-Allowed` when the scope exceeds `/`.

### Offline and integrity

- [ ] Cold launch offline and repeat launch after a successful visit are tested separately.
- [ ] Cached public content is clearly distinguished from current server state.
- [ ] Price/stock validation and checkout cannot appear successful while offline.
- [ ] Reconnection does not replay duplicate orders, payments, chat messages, or stock changes.
- [ ] No private seller/customer response is available from a shared browser cache after logout or tenant switch.
- [ ] A new worker version updates safely while old app tabs are open.

### Device matrix

Run on physical devices, not only emulators:

- [ ] Android: current supported Chrome; install, launch, permission grant/deny, push, click-through, update, and offline launch.
- [ ] iPhone/iPad: supported iOS/iPadOS version; Add to Home Screen, installed-mode Google OAuth login and session refresh, opt-in action, push in foreground/background, click-through, revoke permission, and reinstall.
- [ ] Desktop: supported Chromium and Safari behavior, if desktop installation/push is included in scope.
- [ ] Tenant paths, business switching, multiple signed-in users on shared devices, sign-out, and membership removal.

## Existing validation and implementation gaps

Existing tests cover notification context/UI, proxy bypass, security headers, permissions, and checkout; they do not cover PWA installability, service-worker lifecycle, push subscriptions/delivery, or offline behavior. Relevant entry points include `tests/unit/NotificationsContext.test.tsx`, `tests/unit/NotificationsClient.test.tsx`, `tests/unit/proxyBypass.test.ts`, `tests/unit/securityHeaders.test.ts`, and `tests/unit/Checkout.test.tsx`.

Planned coverage for this plan: the manifest/metadata route shape, subscription route authorization/CSRF/idempotency, fan-out deduplication with a mocked sender, and installable-shell/offline behavior with Playwright's `serviceWorkers` support. Real Web Push delivery cannot be asserted in CI; keep it in the physical-device matrix. Verification commands per task: `pnpm test:unit`, `pnpm type-check`, `pnpm lint`, `pnpm build`, and `pnpm test:e2e` for the shell/offline cases. Follow the repository test-first policy: observe a failing test before implementing each behavioral change.

Database changes should follow the repository's migration conventions. Security-related database objects have a manual-operator migration process documented in [`migrations/README.md`](../migrations/README.md); any subscription table, RLS policy, or index needs to follow that process and be tested for cross-tenant access.

## Decisions required before implementation

| Decision               | Recommended default                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Initial audience       | Sellers and eligible team members only                                                                                  |
| Initial origin         | Platform's primary HTTPS origin; treat tenant subdomains/custom domains as a later decision                             |
| Push scope             | Small set of high-value seller events (for example, new order), not every inbox event                                   |
| Notification content   | Generic title/body; fetch details only after authenticated navigation                                                   |
| Delivery model         | Persist event first; retry-safe server-side fan-out with deduplication                                                  |
| Offline scope          | Static assets only initially; no payment/order/inventory/chat writes                                                    |
| Read state             | Keep push receipt separate; explicitly decide if inbox read state remains shared or becomes per-user                    |
| Permission handling    | Voluntary opt-in, requested from a direct action, with an in-app fallback                                               |
| Customer notifications | Separate design and consent flow; excluded from the seller PWA MVP                                                      |
| Provider/keys          | Choose standards-based Web Push sender and operational ownership before adding secrets or dependencies                  |
| Privacy/legal          | Update the privacy notice for push purposes, categories, retention, and revocation under Peru's Ley 29733 before launch |

## Implementation task breakdown

Every task below is gated by the decisions above and must preserve the existing website as the fallback. Estimates are planning ranges for one engineer and include tests.

### Process and subprocess map

| Process                         | Subprocesses                                                                                                                                                                                        | Tasks     | Release gate                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------ |
| **P0** Decide                   | P0.1 Audience and roles · P0.2 Origin and scope · P0.3 Recipients and categories · P0.4 Read-state model · P0.5 Offline scope · P0.6 Privacy/legal · P0.7 Provider and key ownership                | T0.1–T0.7 | All blocking decisions recorded in this document             |
| **P1** Installable seller shell | P1.1 Manifest · P1.2 Icon set · P1.3 Launch/auth routes · P1.4 Deployed asset headers · P1.5 Install guidance · P1.6 Device verification                                                            | T1.1–T1.6 | Install and authenticated entry work on Android and iOS      |
| **P2** Seller web push          | P2.1 Schema/RLS · P2.2 Subscription API · P2.3 Worker handlers · P2.4 Sender · P2.5 Fan-out/outbox · P2.6 Payload/preferences · P2.7 Lifecycle · P2.8 Endpoint hardening · P2.9 Tests and device QA | T2.1–T2.9 | Eligible users receive generic alerts; inbox fallback intact |
| **P3** Scoped offline           | P3.1 Static cache policy · P3.2 Update UX · P3.3 Public shell (decision-gated) · P3.4 Integrity verification                                                                                        | T3.1–T3.4 | No private or stale authoritative data presented as current  |

### Tasks

| ID   | Task                                           | Role                | Surfaces                                                                                                                                                                          | Depends on | Est.    | Acceptance                                                                                                              | Status      |
| ---- | ---------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------- | ----------------------------------------------------------------------------------------------------------------------- | ----------- |
| T0.1 | Record audience and eligible roles             | Product             | This document                                                                                                                                                                     | —          | 0.5 d   | Decision row updated; recipients per alert category listed                                                              | Done        |
| T0.2 | Choose the supported origin and manifest scope | Product + Frontend  | This document                                                                                                                                                                     | T0.1       | 0.5 d   | `start_url`/`scope` decided; subdomain/custom-domain impact documented                                                  | Done        |
| T0.3 | Select push alert categories                   | Product             | This document                                                                                                                                                                     | T0.1       | 0.5 d   | Categories chosen from the existing enum                                                                                | Done        |
| T0.4 | Decide read-state model (shared vs per-user)   | Product + Backend   | This document                                                                                                                                                                     | T0.1       | 0.5 d   | Model recorded; impact on T2.1 identified                                                                               | Done        |
| T0.5 | Decide offline scope                           | Product             | This document                                                                                                                                                                     | —          | 0.5 d   | Static-only or none recorded; T3.3 opened or dropped                                                                    | Done        |
| T0.6 | Approve privacy notice changes                 | Product + Legal     | Privacy notice                                                                                                                                                                    | T0.3       | —       | Purposes, retention, and revocation covered under Ley 29733                                                             | Blocked     |
| T0.7 | Choose sender and key ownership                | Backend             | This document                                                                                                                                                                     | —          | 0.5 d   | `web-push` approved; VAPID key owner named                                                                              | Done        |
| T1.1 | Add the manifest metadata route                | Frontend            | `app/manifest.ts` (new)                                                                                                                                                           | T0.2       | 0.5 d   | `/manifest.webmanifest` returns `application/manifest+json` with id, name, start_url, scope, display, colors, icons     | Done        |
| T1.2 | Generate the icon set                          | Frontend + Design   | `public/img/`, `app/manifest.ts`, root metadata                                                                                                                                   | T1.1       | 0.5–1 d | 192/512 icons, one maskable, 180 apple-touch-icon; legible on launchers                                                 | Done        |
| T1.3 | Define launch and auth routing                 | Frontend            | `app/manifest.ts`; `proxy.ts` only with an approved exception                                                                                                                     | T0.2, T0.3 | 0.5 d   | Logged-out, expired, and multi-business users land safely without tenant leakage                                        | Done        |
| T1.4 | Verify and fix deployed asset headers          | Frontend + Platform | `next.config.ts` or proxy header rules only if a gap is proven                                                                                                                    | T1.1       | 0.5 d   | Manifest returns `application/manifest+json` with cache-safe headers                                                    | Done        |
| T1.5 | Add install guidance                           | Frontend            | Seller layout, feature-flagged client component                                                                                                                                   | T1.1, T1.3 | 0.5 d   | Guidance only on supported browsers; never blocks login or core flows                                                   | Done        |
| T1.6 | Execute the P1 device matrix                   | QA                  | —                                                                                                                                                                                 | T1.1–T1.5  | 1 d     | Android and iOS install, launch, OAuth, refresh, logout, tenant switch recorded                                         | Not started |
| T2.1 | Add subscription schema and RLS                | Backend             | New manual-operator migration, `src/core/database/schema.ts` if mirrored, `migrations/README.md`; design: [`docs/PWA_T2_1_PUSH_SUBSCRIPTIONS.md`](PWA_T2_1_PUSH_SUBSCRIPTIONS.md) | T0.4, T0.7 | 1 d     | Endpoint unique per device/user; RLS limits rows to the owning user; cross-tenant test passes                           | Done        |
| T2.2 | Build the subscription API                     | Backend             | New route under `app/api/`; design: [`docs/PWA_T2_2_SUBSCRIPTION_API.md`](PWA_T2_2_SUBSCRIPTION_API.md)                                                                           | T2.1       | 1 d     | Subscribe/update/unsubscribe authenticated, tenant-authorized, CSRF-protected, idempotent                               | Done        |
| T2.3 | Implement worker event handlers                | Frontend            | `public/sw.js` (or generated worker); design: [`docs/PWA_T2_3_WORKER_HANDLERS.md`](PWA_T2_3_WORKER_HANDLERS.md)                                                                   | T1.1       | 0.5–1 d | `push`, `notificationclick`, `pushsubscriptionchange` handled; click opens an authorized route                          | Done        |
| T2.4 | Implement the sender                           | Backend             | Server module, `web-push`; design: [`docs/PWA_T2_4_WEB_PUSH_SENDER.md`](PWA_T2_4_WEB_PUSH_SENDER.md)                                                                              | T0.7, T2.1 | 1–2 d   | VAPID from env; bounded TTL/urgency; `410` cleanup; bounded retries                                                     | Not started |
| T2.5 | Wire fan-out and deduplication                 | Backend             | Existing cron pattern or outbox table; design: [`docs/PWA_T2_5_FANOUT_DEDUP.md`](PWA_T2_5_FANOUT_DEDUP.md)                                                                        | T2.4       | 1–2 d   | Delivery only after the notification is durable; dedupe by notification+recipient+endpoint; payment never waits on push | Not started |
| T2.6 | Implement generic payloads and preferences     | Frontend + Backend  | Producer call sites, settings surface; design: [`docs/PWA_T2_6_PAYLOADS_PREFERENCES.md`](PWA_T2_6_PAYLOADS_PREFERENCES.md)                                                        | T0.3, T2.5 | 0.5–1 d | Payload is generic; preferences map to the existing category enum; inbox unchanged                                      | Not started |
| T2.7 | Handle the subscription lifecycle              | Backend             | Subscription API, sign-out hook; design: [`docs/PWA_T2_7_SUBSCRIPTION_LIFECYCLE.md`](PWA_T2_7_SUBSCRIPTION_LIFECYCLE.md)                                                          | T0.4       | 0.5–1 d | Logout and membership revocation stop delivery; devices tracked separately                                              | Not started |
| T2.8 | Harden the notification creation endpoint      | Backend             | `app/api/notifications/route.ts`; design: [`docs/PWA_T2_8_NOTIFICATION_ENDPOINT_HARDENING.md`](PWA_T2_8_NOTIFICATION_ENDPOINT_HARDENING.md)                                       | T2.5       | 0.5 d   | Untrusted callers cannot trigger fan-out; limits and dedupe documented                                                  | Not started |
| T2.9 | Add tests and execute the P2 device matrix     | QA + Backend        | `tests/unit`, `tests/e2e`                                                                                                                                                         | T2.1–T2.8  | 1–1.5 d | Planned coverage passes; Android/iOS push, click-through, revoke, reinstall recorded                                    | Not started |
| T3.1 | Define the static cache policy                 | Frontend            | `public/sw.js`                                                                                                                                                                    | T2.3       | 1 d     | Only versioned static assets cached; versioning and expiry documented                                                   | Not started |
| T3.2 | Add worker update UX                           | Frontend            | Registration/update component                                                                                                                                                     | T3.1       | 0.5–1 d | New worker activates safely with old tabs open                                                                          | Not started |
| T3.3 | Evaluate a public read-only shell              | Product + Frontend  | Decision-gated                                                                                                                                                                    | T0.5       | 1–2 d   | Stale content clearly labeled; no private data; dropped if T0.5 says no                                                 | Not started |
| T3.4 | Verify offline integrity                       | QA                  | Tests and checklist                                                                                                                                                               | T3.1–T3.3  | 1 d     | No offline success for price/stock/checkout, no replay, cache cleared on logout/tenant switch                           | Not started |

Tracking: add a `Status` column (Not started / In progress / Blocked / Done) when implementation begins. A task counts as done only when its acceptance row and the listed verification commands pass; update the status in the same commit as the work.

### Release gates

- **P1** can ship alone and is the only phase with zero new dependencies.
- **P2** cannot start before T0.4 and T2.1 are closed; push is best-effort and must never block payment or order success.
- **P3** is optional and cannot start before T0.5; it must not cache personalized or authenticated content.

### Out of scope for this plan

Customer push, custom-domain installation, offline writes or background sync, native wrappers, and any change to payment, checkout, inventory, or chat delivery semantics.

## References

### Repository

- [`app/layout.tsx`](../app/layout.tsx) — root metadata and icon.
- [`app/[slug]/(app)/layout.tsx`](<../app/%5Bslug%5D/(app)/layout.tsx>) — tenant resolution and seller providers.
- [`src/hooks/useNotifications.ts`](../src/hooks/useNotifications.ts) — notification fetch, Realtime, and polling.
- [`src/lib/notifications.ts`](../src/lib/notifications.ts) — business notification producers.
- [`app/api/notifications/route.ts`](../app/api/notifications/route.ts) — notification API and access checks.
- [`src/features/auth/index.tsx`](../src/features/auth/index.tsx) — auth lifecycle and sign-out.
- [`docs/SUBDOMAIN_STOREFRONT_MIGRATION_PLAN.md`](../docs/SUBDOMAIN_STOREFRONT_MIGRATION_PLAN.md) — subdomain routing context.
- [`docs/RESPONSIVE_LAYOUT.md`](../docs/RESPONSIVE_LAYOUT.md) — existing responsive design context.

### Platform documentation

- [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) — manifest, icon, HTTPS, and browser installability.
- [MDN: Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) — service-worker requirement, subscription handling, and endpoint sensitivity.
- [Next.js: manifest file convention](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest) — native `app/manifest.ts` metadata route.
- [Serwist](https://serwist.pages.dev/) — maintained service-worker tooling for Next.js, only if the hand-written worker becomes insufficient.
- [MDN: Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API) — secure contexts, request interception, caching, and worker lifecycle.
- [Apple Developer: Sending web push notifications in web apps and browsers](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) — subscription flow, VAPID, server sending, and iOS/macOS behavior.
- [WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) — Home Screen requirement and direct user interaction for permission on iOS/iPadOS.
