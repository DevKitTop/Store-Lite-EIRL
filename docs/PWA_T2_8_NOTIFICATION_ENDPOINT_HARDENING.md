# T2.8 - Notification creation endpoint hardening (design)

**Status:** Implemented for P2 (Web Push). The HTTP create path is inbox-record-only and never triggers push fan-out.  
**Task:** `T2.8 Harden the notification creation endpoint` (`docs/PWA_RESEARCH.md`)  
**Depends on:** T2.5 (fan-out/dedup design; hardening must prevent untrusted fan-out triggers). Coordinates with T2.1/T2.2 (subscription ownership), T2.4 (sender), T2.6 (payload/preferences), `POST /api/notifications` consumers.  
**Gate:** Do not wire push fan-out to an untrusted/public path. Any implementation changes must preserve existing authenticated business-member flows unless explicitly tightened with coordinated client/producer updates.

## Goals

- Ensure **untrusted callers cannot trigger push fan-out** (directly or indirectly) via `POST /api/notifications` or related surfaces.
- Define and document **limits, dedupe/idempotency expectations, and abuse controls** for notification creation in the context of future P2 fan-out.
- Keep durable inbox creation and push delivery decoupled: provider/fan-out failures must never affect notification/order/payment success paths (T2.5).
- Preserve tenant isolation and server-side authorization.

## Current state (repo)

- **`GET /api/notifications`** (`app/api/notifications/route.ts`): requires authenticated user, resolves `businessId`/slug, validates UUID, enforces business membership via `getMemberPermissions` (`role` required), supports filters/pagination, excludes dismissed.
- **`POST /api/notifications`**: requires authenticated user, enforces `role === 'owner' || role === 'admin'` for the target `businessId`, validates required fields and `type`/`category` enums, inserts into `notifications`, returns created row. File notes it “Debería restringirse a roles administrativos o llamadas internas.”
- **Server helpers** (`src/lib/notifications.ts`, e.g. `createBusinessNotification` and convenience helpers): insert notifications directly from trusted server-side contexts (API routes, webhooks, cron/jobs) without HTTP endpoint exposure.
- **Risk (P2):** if push fan-out is triggered on notification creation, a caller able to hit `POST /api/notifications` could induce expensive/abusive fan-out (spam, resource exhaustion, unwanted pushes) even if they are an authenticated owner/admin. T0/T2.5 require trusted-producer-only fan-out and bounded/deduped delivery.

## Hardening requirements (design)

### 1) Trusted-producer-only fan-out boundary

- **Never** invoke push sender/fan-out worker directly from `POST /api/notifications` request handling in a way that trusts the HTTP caller as a fan-out authority. Preferred model: fan-out is enqueued/processed only by trusted server-side producers/workers (internal module calls after durable insert in controlled contexts, cron/outbox reconciler) per T2.5.
- If `POST /api/notifications` remains available for owner/admin UI or integrations, treat it as **inbox-record creation only** (no synchronous push send). Any enqueue hook reachable from it must be idempotent, rate-limited, and safe (or disabled) so it cannot be abused to amplify fan-out; prefer excluding public HTTP-created rows from automatic fan-out unless an explicit, authenticated, non-forgeable trigger policy is defined and approved.
- **Internal creation path:** keep `src/lib/notifications.ts`/service-layer helpers as the canonical trusted insertion API for server producers (payment, order, cron, imports). Push fan-out integration (T2.5) should attach to trusted durable-create flows, not to arbitrary external requests.

### 2) Authentication and authorization

- Maintain **server-derived identity** and **server-side membership/role authorization** for the target business (current behavior: owner/admin for POST). Do not accept caller-supplied identity/role as authority.
- Re-evaluate minimum role for POST at implementation: owner/admin may be acceptable for manual/admin inbox events, but if kept, combine with strict limits/dedupe and no direct fan-out privilege. Consider internal/service-only POST (secret/CRON-style or same trusted boundary) for system-generated events if needed.
- GET/POST must continue to prevent cross-tenant access (membership validated against resolved `businessId`).

### 3) Request validation and CSRF/origin protections

- For state-changing POST, apply the project’s standard protections for cookie-authenticated routes (Origin/Sec-Fetch-Site baseline or equivalent) consistent with T2.2 guidance, to reduce cross-site abuse.
- Enforce strict schema validation: required fields, enum/type checks (already present), bounded lengths for `title`/`message`, bounded/validated `data` payload shape and size, and reject unexpected fields where practical. Prevent oversized or adversarial payloads from becoming durable records or fan-out inputs.
- Validate/normalize `businessId` (UUID) server-side; ignore or reject mismatched/unsafe inputs.

### 4) Rate limiting and abuse controls

- Add **rate limits** for `POST /api/notifications` (per user and/or per business/IP as appropriate) to bound spam and resource use. Limits must be documented and tuned to legitimate use; return clear retryable/non-retryable errors without leaking internals.
- Consider operational caps (e.g. max creates per time window per business) aligned with T2.5 bounded worker volume.
- Log only bounded, non-sensitive metadata for monitoring (counts, business/user identifiers as appropriate, status classes); never log payload contents that may include sensitive data.

### 5) Dedupe and idempotency (documented)

- **Current:** `createBusinessNotification` inserts a new row per call; callers needing replay safety must add explicit idempotency (note already present in helper). Cron producers like `app/api/cron/check-plans` already avoid duplicates via `alreadyNotified` checks.
- **T2.5 requirement:** push delivery dedupe is `notification + recipient + endpoint/subscription` in the delivery store/worker. This does not replace the need to avoid creating duplicate **source notifications** for the same business event on retries/replays.
- **Design guidance:** for P2 fan-out safety, trusted producers of fan-out-eligible events should supply or derive a stable idempotency/dedupe key (e.g. event type + business + external id/order id + time bucket as applicable) so retries do not create duplicate inbox records and thus duplicate fan-out units. Implementation may add optional idempotency support (column/unique constraint or lookup) in the notifications/delivery design; exact mechanism finalized with T2.5/T2.6 implementation.
- `POST /api/notifications` should document/require idempotent usage for automated callers if retained; reject or safely handle duplicates per policy when idempotency is provided.

### 6) Payload and privacy constraints

- Notification content stored/returned must comply with existing privacy/product rules. For push-enabled categories (MVP `pedidos`, T0.3), **push payloads remain generic** (T2.3/T2.4/T2.6); do not copy sensitive inbox fields into push data. Endpoint hardening must not expand exposure of notification data across tenants.

## Acceptance mapping (T2.8)

- **Untrusted callers cannot trigger fan-out:** fan-out only from trusted server-side producers/workers; public/authenticated HTTP create path cannot be used to drive push sends/abusive fan-out.
- **Limits and dedupe documented:** rate/size/capacity limits and source-notification idempotency expectations defined here and enforced at implementation; delivery-level dedupe owned by T2.5.

## Open items / implementation notes

- Decide final posture for `POST /api/notifications`: keep owner/admin with hardening, restrict to internal/service callers, or split manual vs system paths.
- Choose rate-limit mechanism consistent with existing app patterns/infrastructure.
- Finalize idempotency mechanism for source notifications (if any) and align with T2.5 delivery dedupe/outbox.
- Add/update tests at implementation (authz, CSRF/origin as applicable, validation/size limits, rate limiting behavior, and “no push fan-out from public POST” invariant where wired).

## Implementation notes (T2.8)

- `POST /api/notifications` now reuses `isSameOriginRequest` and `isJsonRequest` from `src/lib/security/csrf.ts`, matching the T2.2 subscription route.
- Body validation lives in `src/lib/notifications/createValidation.ts`: UUID `businessId`, enum `type`/`category`, trimmed `title` (1–120 chars), trimmed `message` (1–500 chars), no unexpected top-level fields, and a bounded `data` object (4 KiB JSON, depth 3, 100 nodes, 40 keys/object, 50 items/array, 500 chars/string, 64 chars/key, primitive/nested object/array values only, `__proto__`/`constructor`/`prototype` rejected).
- Rate limiting uses `RATE_LIMITS.notificationCreate` (10 requests per 60 s per `userId:businessId`) via `checkRateLimitAsync`; the edge `api` bucket remains a separate coarse IP ceiling. Exhaustion returns `429` with `Retry-After` and no internal detail.
- Authorization is unchanged: authenticated owner/admin membership for the resolved `businessId` is still required, and cross-tenant access remains denied.
- The route has no sender/fan-out import. Push fan-out remains owned by trusted server-side producers under T2.5; HTTP-created inbox rows do not automatically send push notifications.
- Source-notification idempotency is still a producer responsibility: `src/lib/notifications.ts` inserts one row per call and trusted producers must derive a stable key. Delivery-level dedupe stays in T2.5.
- Coverage: `tests/unit/notificationsRouteHardening.test.ts` exercises CSRF/origin, content type, UUID, length/data bounds, unexpected fields, rate limiting, owner happy path, cross-tenant denial, no fan-out and unchanged GET auth.
