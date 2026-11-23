# T2.7 - Push subscription lifecycle (design)

**Status:** Proposed design for P2 (Web Push). Not implemented.  
**Task:** `T2.7 Handle the subscription lifecycle` (`docs/PWA_RESEARCH.md`)  
**Depends on:** T0.4 (shared inbox read-state; per-user/device push receipt/delivery separate). Coordinates with T2.1 (subscription storage/RLS/revocation fields), T2.2 (subscribe/unsubscribe/revoke API, idempotent CSRF-protected), T2.3 (worker `pushsubscriptionchange` re-subscribe/rotation), T2.4 (send-time eligibility and 410/invalid-endpoint handling), T2.5 (fan-out bounded/retry-safe, no delivery to ineligible users), T2.6 (preferences remain push-only).  
**Gate:** Do not implement before P2 is unblocked (T0.6 legal approval/publication before launch, T2.1 migration applied/available, `web-push` dependency approved at implementation). No changes to shared inbox read-state or to payment/order/checkout flows.

## Goals

- **Stop delivery on logout and membership/authorization revocation:** a user/device must not receive business push alerts after they sign out (for that device session context) or lose current membership/authorization for the target business.
- **Track devices separately:** each browser/device endpoint is an independent subscription record (T2.1) with its own lifecycle, revocation, and failure state.
- Rely on **defense in depth:** prompt revocation where feasible plus mandatory **send-time eligibility validation** (T2.4/T2.5/T2.7) so stale rows never authorize delivery.

## Lifecycle states (conceptual, aligned with T2.1)

| State                 | Meaning                                                                                                  | Delivery                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Active                | `revoked_at IS NULL AND invalidated_at IS NULL` and user currently eligible for target business/category | Eligible candidate (subject to send-time checks/preferences) |
| User-revoked          | `revoked_at` set (explicit unsubscribe, in-app opt-out, or logout-driven device revoke)                  | Never delivered                                              |
| Invalidated           | `invalidated_at` set (e.g. provider 410/404 per T2.4)                                                    | Never delivered; cleanup/ignore                              |
| Membership-ineligible | Row may exist but user lacks current membership/authorization/dashboard access for business (T0.1)       | Never delivered (filtered at send time)                      |

Multiple active rows per user across devices are expected and must be handled independently.

## Triggers and required behavior

### 1) Explicit unsubscribe / in-app opt-out (user action)

- Client obtains current device subscription (PushManager) and calls T2.2 `DELETE`/revoke for that endpoint (authenticated, CSRF-protected, idempotent). Also unsubscribe locally via `PushSubscription.unsubscribe()` as appropriate.
- Server sets `revoked_at` (and timestamps) for the authenticated user's matching row only; idempotent no-op if already revoked/missing.
- Preference updates (T2.6) may disable push categories without removing the endpoint record, but MVP `pedidos` opt-out/revocation must stop push delivery promptly.

### 2) Logout / sign-out (device)

- **Client responsibility:** on explicit sign-out (`supabase.auth.signOut()` / app logout flows), best-effort: revoke/unsubscribe the current device's push subscription via T2.2 and/or local `unsubscribe()` before/alongside session teardown. This is promptness/UX hardening; it must not block logout on failure.
- **Server responsibility:** authenticated revoke endpoint (T2.2) scopes to `auth.uid()` and only affects the provided endpoint for that user. Do not attempt to revoke other users/devices from client context.
- **Fallback:** if client-side revoke is missed (crash, cleared storage, network failure), send-time eligibility checks (session/membership no longer valid for protected delivery context as applicable) and/or subsequent explicit unsubscribe prevent continued delivery; rows may be cleaned up by invalidation/maintenance policies (T2.4/T2.5).

### 3) Membership/authorization revocation or loss

- When a user is removed from a business/team, loses dashboard access, or is otherwise no longer T0.1-eligible for that business, **future push delivery for that business must stop**.
- **Primary enforcement:** T2.4/T2.5 must validate current membership/authorization at send time (and when expanding recipients) using trusted server data; ineligible recipients/subscriptions are excluded regardless of stored active rows.
- **Optional prompt cleanup:** server-side hooks on membership removal may soft-revoke or mark subscriptions ineligible for affected business context if preference scoping requires it (implementation-time decision aligned with T2.1/T2.6 schema). Not required if global user-device subscriptions are filtered strictly by per-business send-time eligibility.
- Applies equally to owner/admin/member role changes that remove required access.

### 4) Endpoint rotation / `pushsubscriptionchange` (T2.3)

- Worker handles `pushsubscriptionchange` by re-subscribing/resubscribing and calling T2.2 upsert/rotate for the current authenticated user/device. Old endpoint may be invalidated by provider (410) or superseded; T2.4/T2.1 record invalidation/rotation accordingly.
- Rotation must not transfer ownership across users; server binds to `auth.uid()`.

### 5) Provider invalidation and failures (T2.4/T2.5)

- 410/404 (and other terminal invalid responses as defined) mark subscription invalidated/not deliverable; bounded retries for transient failures per T2.4/T2.5. Failure counters/timestamps maintained per T2.1.

## Send-time eligibility (mandatory, defense in depth)

For every delivery attempt/fan-out unit (T2.5 -> T2.4):

- Resolve active, non-revoked, non-invalidated subscription for the **current** eligible recipient.
- Verify user has **current** membership/authorization and dashboard access for the target `business_id` (T0.1); verify category/push preference eligibility (MVP `pedidos`, T2.6).
- Never trust client-supplied business/user identifiers for authorization; never deliver based solely on stored subscription existence.
- Skip ineligible targets idempotently and record bounded outcomes as appropriate (no secrets/PII in logs).

## Device tracking

- One row per `(user_id, endpoint)` (T2.1) represents one device/browser/app-install subscription context; lifecycle actions target the specific endpoint/device unless explicitly defined otherwise.
- Users may have multiple devices; revoking one must not revoke others except explicit per-device/user actions as designed.
- Stored metadata (e.g. `user_agent`, timestamps) is for management/debugging per privacy constraints (T0.6) and must not be logged routinely.

## Security and privacy

- No endpoint/keys/VAPID secrets in logs or client exposure beyond what browser APIs require. CSRF-protected, authenticated APIs only (T2.2).
- Generic payloads only (T2.6/T0.3); click navigation enforces authz (T2.3). Shared inbox read-state unchanged (T0.4).
- Comply with T0.6-approved notice for consent/revocation/retention before launch.

## Acceptance mapping (T2.7)

- **Logout and membership revocation stop delivery:** explicit device revoke on logout (best-effort) plus mandatory send-time membership/authorization checks prevent further delivery.
- **Devices tracked separately:** per-endpoint subscription rows and lifecycle operations.

## Open items / implementation notes

- Decide exact logout hook placement (client `signOut` flow and/or server/session invalidation signals) and error-handling UX (non-blocking).
- Decide whether membership-removal events trigger proactive revocation/cleanup for affected subscriptions or rely solely on send-time filtering (with optional async cleanup job).
- Align revocation vs re-subscribe semantics for `failure_count`/timestamps (T2.1/T2.4).
- Tests at implementation: sign-out revokes current endpoint (mocked API), removed member excluded at send-time, multi-device independence, idempotent revoke, and no delivery after invalidation.
