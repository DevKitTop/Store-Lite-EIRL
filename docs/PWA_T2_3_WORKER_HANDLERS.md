# T2.3 — Service worker event handlers (design)

**Status:** Implemented for P2 (Web Push). Not launched; P2 gates still apply.  
**Task:** `T2.3 Implement worker event handlers` (`docs/PWA_RESEARCH.md`)  
**Depends on:** T1.1 (manifest/scope `/`, installed shell), T2.1/T2.2 (subscription storage/API, for `pushsubscriptionchange` rotation). Coordinates with T2.4–T2.7 (sender payloads, preferences, lifecycle).  
**Gate:** Do not implement before P2 is unblocked as applicable (T0.6 legal approval/publication before launch for push, T2.1 migration/API available for rotation flows). No app-content/static-asset offline caching (T0.5). No change to tenant routing, checkout, or payment/order success paths.

## Goals

- Provide a same-origin service worker (`public/sw.js`, static, not bundled by Next) registered at scope `/` (aligned with T0.2 manifest `scope`/`start_url`) to support Web Push (P2).
- Handle `push`, `notificationclick`, and `pushsubscriptionchange` with privacy-safe, generic notifications and authenticated navigation.
- Keep the worker minimal: no broad fetch/caching/offline behavior in P1/P2 (T0.5/T3 deferred).

## Registration (client, implementation time)

- Feature-detect `serviceWorker` and `PushManager` in a secure context (HTTPS). Treat unsupported/denied states as non-blocking fallbacks to the existing in-app inbox (T2.6 UX).
- Register `/sw.js` with `{ scope: '/' }` from an appropriate client surface (seller/authenticated context per T0.1). Do not require permission or registration to use the app.
- Permission must be requested only from an explicit user action (subscribe flow, T2.2/T2.6), not on load.
- **Updates:** rely on browser update checks; avoid aggressive takeover. Basic `install`/`activate` should not introduce caching side effects. Safe update/refresh UX is detailed in T3.2 if/when offline work is in scope; T2.3 should still avoid breaking open clients (e.g. prefer controlled activation over unintended cache behavior; no `fetch` handler required).

## Worker events

### `install` / `activate`

- Keep minimal (e.g. `self.skipWaiting()` / `clients.claim()` policy chosen to be safe and predictable; finalize at implementation to balance prompt activation vs controlled rollout). No precache or runtime caching in P2.
- Do not claim behavior beyond push handling.

### `push`

- **Show a notification immediately** when a push arrives (required for reliable UX; Safari does not support invisible/silent push for this use case). Use `event.waitUntil(self.registration.showNotification(...))`.
- **Payload:** expect a small, **generic** JSON payload from the server (T2.4/T2.6), e.g. `{ title, body, tag?, data: { url?, category?, notificationId? } }`. Do not include customer names, chat previews, order amounts, or other sensitive/private details in the payload (T0.3/privacy baseline).
- Provide safe defaults if payload is missing/malformed (generic title/body) so a push is still visible.
- Suggested options: `tag`/`renotify` strategy to avoid noisy duplicates where appropriate (aligned with T2.5 dedupe semantics), `data.url` as a **same-origin, app-internal path hint** only (validated on click). Do not treat payload as authorization.
- Push delivery/receipt must **not** mark the shared inbox notification as read (T0.4).

### `notificationclick`

- Close the notification and focus/open an appropriate client window via `clients.matchAll({ type: 'window', includeUncontrolled: true })` and `clients.openWindow`/`client.focus` as needed.
- **Navigation target:** open only a **same-origin** URL/path. Prefer an allowlisted/default authenticated seller route (e.g. notifications/orders area) and only honor `notification.data.url` when it is a safe relative/same-origin path; reject/ignore absolute external URLs or unsafe values. Final route allowlist/default finalized at implementation consistent with app routes.
- **Authorization:** navigation lands on authenticated routes that recheck membership/permissions server-side (and middleware/session behavior). Do not assume click grants access; expired session/removed membership must follow normal app auth/authorization flows.
- Do not auto-mark shared inbox read state on click unless explicitly defined later (T0.4: receipt/click must not automatically mark shared inbox read in MVP design).

### `pushsubscriptionchange`

- Re-obtain subscription via `self.registration.pushManager.subscribe(...)` (using the VAPID public application server key provided by app configuration) and **upsert/rotate** it through the authenticated subscription API (T2.2, `POST`, same-origin, `credentials: 'include'` as appropriate).
- **Auth/CSRF considerations:** the worker fetch runs in service-worker context; cookies may be sent for same-origin requests, but rotation can occur when the user is not actively signed in. If the API returns unauthenticated/forbidden, the worker must handle gracefully (no secret logging, no crash loop); the client app should reconcile subscription state on next authenticated session (T2.7). Do not persist or rotate on behalf of a different user.
- Idempotent handling: safe to retry with backoff limits if appropriate; avoid unbounded retries.

## Serving, scope, and headers

- File: `public/sw.js` at root scope `/` (matches manifest `id`/`start_url`/`scope` `/`, T0.2). No tenant-specific worker path in MVP.
- **Proxy/bypass:** `/sw.js` contains a dot, so `shouldBypassProxy` returns true and it skips the proxy pipeline (`src/lib/middleware/proxyBypass.ts`) by design for root-level assets. Confirm in deployed environment:
  - correct JS content type,
  - `Cache-Control: no-cache` or `must-revalidate` (or equivalent) to avoid stale worker updates,
  - `Service-Worker-Allowed: /` only if scope ever exceeds the worker script location (not expected for root `/sw.js` at scope `/`, but verify).
    Because it bypasses proxy, any required headers may need platform/Next header configuration; validate per T1.4/deployment checks.
- CSP: `worker-src 'self' blob:` already allowed (see `docs/PWA_RESEARCH.md`); no relaxation expected.

## Security and privacy

- No sensitive data in push payloads or notifications (generic only, T0.3).
- Treat subscription/endpoint/keys as sensitive (handled via T2.2/API, not logged by worker).
- Open only validated same-origin/authenticated routes on click; no open redirects to untrusted origins.
- Do not introduce fetch interception/caching that could serve stale or private/tenant data (T0.5, cross-cutting risks).

## Acceptance mapping (T2.3)

- **`push`, `notificationclick`, `pushsubscriptionchange` handled:** show generic notification on push; click focuses/opens a safe authorized same-origin route; subscription change triggers rotation/upsert via T2.2-compatible flow with graceful failure handling.
- **Click opens an authorized route:** navigation target constrained/validated and protected by normal authenticated authorization checks.

## Open items / implementation notes

- Finalize notification copy/defaults and allowed click URL patterns/default route in line with T2.6 UI and existing seller routes.
- Confirm VAPID public key delivery to client/worker (public config) at implementation.
- Confirm header behavior for `/sw.js` on Vercel/production (cache-control/content-type) given proxy bypass.
- Coordinate payload schema with T2.4 sender and dedupe/tag behavior with T2.5.
- Add/update tests per repo policy at implementation (worker behavior/unit or e2e as feasible; real push delivery remains physical-device QA per plan).
