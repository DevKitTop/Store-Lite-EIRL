# T2.2 — Push subscription API (design)

**Status:** Proposed design for P2 (Web Push). Not implemented.  
**Task:** `T2.2 Build the subscription API` (`docs/PWA_RESEARCH.md`)  
**Depends on:** T2.1 schema/RLS (`docs/PWA_T2_1_PUSH_SUBSCRIPTIONS.md`), T0.1/T0.3/T0.4/T0.7.  
**Blocks / informs:** T2.3 (worker handlers/rotation), T2.4/T2.5 (sender/fan-out use stored subscriptions), T2.6 (preferences), T2.7 (lifecycle).  
**Gate:** Do not implement or expose before P2 is unblocked (T0.6 legal approval/publication before launch, approved/applied T2.1 migration, `web-push` dependency approval at implementation, and T2.8 hardening coordinated as applicable). No change to tenant routing, checkout, or payment/order success paths.

## Goals

- Provide authenticated, CSRF-protected, idempotent endpoints for a user to **subscribe/upsert**, **update/rotate**, and **unsubscribe/revoke** their own Web Push subscription(s).
- Persist only for the **current authenticated user** (server-derived identity; never trust client-supplied `user_id`).
- Validate authorization context: user must be authenticated; any client-supplied business/tenant context must be validated server-side and never grant authorization by itself. MVP subscription storage is user/device-scoped (T2.1); business eligibility is enforced at send time (T0.1/T2.4/T2.7).
- Keep endpoint/keys sensitive: do not log, do not expose to other users, return minimal data.

## Proposed route

`app/api/push/subscriptions/route.ts` (new, implementation time). JSON request/response; same-origin only.

| Method                    | Purpose                                                                  | Idempotency / behavior                                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`                    | Subscribe or upsert/update (including `pushsubscriptionchange` rotation) | Upsert by `(user_id, endpoint)` resolved from the authenticated session. Same payload re-sent is safe (updates keys/timestamps as needed, clears `revoked_at`/`invalidated_at` on explicit re-subscribe).                                                                                               |
| `DELETE`                  | Unsubscribe/revoke current device subscription                           | Soft-revoke by setting `revoked_at` (and `updated_at`) for the authenticated user's matching `endpoint` (or by subscription identifier if introduced). Idempotent: revoking an already-revoked/missing own subscription returns success/no-op per API contract (no information leak about other users). |
| `GET` (optional, minimal) | Client state check                                                       | Return only whether the current user has an active subscription record for the provided/known context if needed by UI; never return raw endpoint/keys. Can be deferred if UI can rely on browser `PushManager.getSubscription()` state.                                                                 |

(Alternative shapes, e.g. separate `/unsubscribe` path or PATCH, are acceptable if they preserve the same guarantees.)

## Authentication and authorization

- **Auth required:** resolve user via `createClient()` (`@/lib/supabase/server`) / session; reject unauthenticated with 401.
- **Ownership:** persist with `user_id = auth.uid()` only. Ignore/reject mismatched `user_id` in body. RLS (T2.1) enforces owner-only access when using user-context client; privileged operations, if any, must still scope to the authenticated user.
- **Tenant/business context:** do not require `businessId` for basic subscribe/unsubscribe of a user-scoped subscription. If a `businessId` (or slug) is accepted (e.g. for future preference scoping or eligibility hint), it must be validated with `getMemberPermissions`/membership checks for the current user and never treated as authorization by itself. Eligibility for receiving business notifications remains a send-time check (T0.1/T2.4).
- **Sensitive data:** treat `endpoint`, `p256dh`, `auth`, and subscription objects as secrets/capability data; never log values or include them in error details.

## CSRF protection (state-changing: POST/DELETE/PATCH)

Browser cookies authenticate the session, so state-changing endpoints must reject cross-site requests. Proposed baseline (implementation to align with repo conventions and platform behavior):

- Require `Content-Type: application/json` for JSON bodies and reject unsupported types.
- Validate same-origin intent using request headers: allow when `Sec-Fetch-Site` is `same-origin` (or `same-site` only if explicitly deemed safe for this deployment); otherwise, when `Origin` (or `Referer` fallback) matches the app's allowed origin(s) (`NEXT_PUBLIC_APP_URL` / configured primary origin, T0.2). Reject missing/untrusted cross-origin indicators with 403.
- Keep endpoints same-origin and cookie-authenticated; do not enable credentialed CORS for these routes.
- If the project adopts a dedicated CSRF token mechanism, integrate it; otherwise the Origin/Sec-Fetch-Site check above is the minimum required.

(Design note: current audited routes emphasize auth/role checks; T2.2/T2.8 must make CSRF protection explicit and tested.)

## Request/response shapes (proposed)

**POST (subscribe/upsert/rotate)** body:

```json
{
  "subscription": {
    "endpoint": "https://...",
    "expirationTime": null,
    "keys": { "p256dh": "...", "auth": "..." }
  }
}
```

- Validate presence/format of `endpoint`, `keys.p256dh`, `keys.auth` (non-empty strings, reasonable length limits). Store `expiration_time` if provided.
- Response: `{ "ok": true }` or `{ "ok": true, "status": "subscribed" | "updated" }` (no secrets echoed).

**DELETE (unsubscribe/revoke)** body or query:

```json
{ "endpoint": "https://..." }
```

- Identify the authenticated user's row by `endpoint` (or require browser to send current subscription). Perform soft revoke (`revoked_at=now()`, update timestamps); idempotent.

**Errors:** 400 invalid payload, 401 unauthenticated, 403 forbidden/CSRF/origin mismatch or unauthorized context, 429/5xx as applicable. Error messages must not reveal whether an endpoint belongs to another user.

## Data handling and lifecycle

- **Upsert/rotation:** on POST, if `(user_id, endpoint)` exists update keys/`expiration_time`/`updated_at`/`last_seen_at`, clear `revoked_at` and `invalidated_at` for an intentional re-subscribe; keep `failure_count` policy explicit (reset or retain per T2.4/T2.7 decision). `pushsubscriptionchange` in the worker triggers client re-subscribe calling this endpoint.
- **Multiple devices:** separate endpoints = separate rows (T2.1).
- **Logout/membership removal:** explicit unsubscribe/logout can call DELETE; send-time eligibility in T2.4/T2.7 prevents delivery to users without current membership even if a row remains (defense in depth).
- **No logging of secrets:** exclude endpoint/keys from structured logs and error payloads.

## Security and privacy notes

- `endpoint` is a capability URL (unguessable but bearer-like) — protect against CSRF and never expose cross-user.
- Generic push payloads only (T0.3/T2.6); this API stores subscriptions, not notification content.
- Align with T0.6 privacy notice scope (subscription data, consent/revocation) once approved/published.

## Acceptance mapping (T2.2)

- **Authenticated, tenant-authorized, CSRF-protected, idempotent:** session-required ownership, validated any optional business context, origin/CSRF checks on state changes, upsert/soft-revoke idempotency.
- **Works with T2.1:** respects `UNIQUE (user_id, endpoint)` and owner-only RLS; server-derived `user_id`.

## Open items / implementation notes

- Finalize route path/name (`/api/push/subscriptions` vs alternatives) consistent with app conventions.
- Confirm CSRF mechanism used across the repo (Origin/Sec-Fetch-Site baseline vs token) and add tests.
- Decide GET/state-check necessity based on P2 UI (T2.6) and browser PushManager usage.
- Coordinate with T2.3 (`pushsubscriptionchange` re-subscribe flow) and T2.7 (logout/membership revocation behavior).
- Rate limiting/abuse controls as appropriate for authenticated endpoints (follow existing `proxyPipeline`/edge patterns where applicable).
- Ensure T2.8 hardening of `POST /api/notifications` proceeds independently; subscription API must not create a fan-out trigger surface.
