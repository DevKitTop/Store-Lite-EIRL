# T2.5 - Fan-out and deduplication (design)

**Status:** Proposed design for P2 (Web Push). Not implemented.  
**Task:** `T2.5 Wire fan-out and deduplication` (`docs/PWA_RESEARCH.md`)  
**Depends on:** T2.4 (sender delivery primitive / per-endpoint outcomes). Coordinates with T2.1 (subscription targets/lifecycle), T2.3 (worker/click semantics), T2.6 (generic payloads/preferences), T2.7 (eligibility/lifecycle), T2.8 (`POST /api/notifications` hardening).  
**Gate:** Do not implement before P2 is unblocked and T2.4 sender behavior is aligned (T0.6 legal approval/publication before launch, T2.1 migration applied/available, `web-push` dependency explicitly approved at implementation, trusted-producer hardening per T2.8). This design must not introduce a push-provider dependency in payment/order/inbox-creation paths.

## Goals

- Deliver Web Push **only after the underlying business notification is durably created** (T0.3/T0.4: inbox is the durable record).
- **Deduplicate** deliveries so retries/replays do not fan out repeatedly: unique delivery unit by `notification + recipient + endpoint` (subscription/device).
- Run fan-out as a **retry-safe, server-side** process with **bounded retries/scheduling** and durable outcome recording.
- Keep delivery **best-effort and non-blocking**: provider failures must never fail or roll back payment, order, or notification-insert transactions.
- Trigger fan-out only from **trusted server-side producers/workers** (not untrusted client-callable surfaces); coordinate with T2.8.

## Current context (repo)

- `createBusinessNotification` / helpers in `src/lib/notifications.ts` insert a new `notifications` row on every call (no idempotency key today). `POST /api/notifications` (`app/api/notifications/route.ts`) is owner/admin-callable and explicitly noted for hardening/internal restriction; wiring push into it without controls would create a fan-out abuse path (T2.8).
- Producers include payment/order/import flows and cron jobs (e.g. `app/api/cron/check-plans` uses `CRON_SECRET`, idempotency checks via `alreadyNotified`, and best-effort per-item error handling). These patterns should be reused where suitable.
- T2.4 provides the per-endpoint send primitive (VAPID from env, bounded TTL/urgency, 410 cleanup, bounded retries within a job window) and returns outcomes; T2.5 owns when/who to send to and durable dedupe/outcome tracking.

## Delivery model (proposed)

### 1) Durable source of truth

- A `notifications` row (durable inbox record) is the unit that may be fanned out. Push is a delivery channel for that record, not the record itself.
- Fan-out eligibility at enqueue time: MVP category `pedidos` only (T0.3); future categories/preferences resolved in T2.6. Recipient set is derived from current business membership/authorization context (T0.1) but **must be revalidated at send time** (T2.4/T2.7).

### 2) Delivery tracking / dedupe store (T2.5 extension, implementation-time migration)

Add a durable delivery-attempt table (name TBD at implementation, e.g. `push_notification_deliveries` or `push_delivery_attempts`) as a manual-operator migration (verify next-free prefix at implementation; account for open PRs and existing prefix anomalies noted in `migrations/README.md`). Proposed fields/intent:

| Field / intent                                                                                  | Purpose                                                                                                          |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `id` (uuid PK)                                                                                  | Delivery row id                                                                                                  |
| `notification_id` (FK -> notifications)                                                         | Source durable notification                                                                                      |
| `recipient_user_id` (uuid)                                                                      | Intended eligible user                                                                                           |
| `push_subscription_id` (FK -> push_subscriptions) or stable endpoint reference                  | Target device/subscription (T2.1)                                                                                |
| `status`                                                                                        | e.g. `pending` / `processing` / `delivered` / `retryable_failed` / `terminal_failed` / `invalidated` / `skipped` |
| `attempt_count`, `next_attempt_at`, `last_attempt_at`                                           | Bounded scheduling/backoff                                                                                       |
| `provider_status` / `last_failure_code` (bounded), `last_error_class` (bounded, no secrets/PII) | Outcome recording                                                                                                |
| `created_at`, `updated_at`                                                                      | Audit/timestamps                                                                                                 |

**Dedupe key:** `UNIQUE (notification_id, recipient_user_id, push_subscription_id)` (or equivalent including endpoint identity) so retries/replays cannot create duplicate fan-out for the same notification to the same recipient device. A resend policy (if ever needed) must be explicit and separate, not accidental.

Indexes should support polling pending/ready rows and lookups by notification/subscription (exact shape finalized at implementation).

### 3) Enqueue after durable insert (trusted producer path)

- After a notification is durably inserted/committed, a trusted server-side path enqueues delivery rows for eligible active subscriptions/recipients (or marks the notification eligible for fan-out) **without** calling the push provider in the same transaction as payment/order success.
- Producers must not depend on enqueue/fan-out success: catch/log bounded errors and continue the business flow. If enqueue fails, a reconciler/worker can discover unfanned durable notifications (by join/marker) and backfill idempotently.
- **T2.8 coordination:** do not let untrusted callers trigger fan-out. `POST /api/notifications` must be hardened/internalized/rate-limited/deduped before any fan-out hook; prefer internal server helpers invoked from already-trusted code paths/cron/workers over public fan-out surfaces.

### 4) Worker / scheduler (cron or outbox processor)

- Process pending deliveries in a server-side worker (reuse existing cron/route pattern such as `app/api/cron/check-plans`, protected by `CRON_SECRET`, or an equivalent outbox processor suited to Vercel/Next runtime constraints). Bounded batch size and runtime.
- For each ready delivery unit: revalidate send-time eligibility and active subscription state (T2.4/T2.7), resolve generic payload (T2.6), call T2.4 sender, and persist outcome:
  - **Delivered (2xx):** mark delivered; no retry.
  - **Invalid endpoint (410/404):** mark delivery invalidated/terminal; ensure subscription invalidation handled per T2.4.
  - **Retryable (429/5xx/timeout/network):** increment attempts, schedule `next_attempt_at` with bounded backoff until max attempts, then terminal-fail.
  - **Config/auth errors (401/403 as applicable):** record as operational outcome; do not blindly invalidate subscriptions; alert/monitor without secrets.
- Idempotent processing: claim/transition rows safely (e.g. conditional update/lease) so concurrent runs do not double-send beyond the dedupe guarantee.

### 5) Bounded retries and failure policy

- Finite max attempts and max retry window (values finalized at implementation with T2.4 TTL/urgency).
- Bounded backoff (e.g. exponential with cap) to avoid provider/runtime overload.
- Terminal states stop processing; no infinite retries. All failures recorded with bounded, non-sensitive metadata.

## Privacy, security, and safety

- Never log or persist endpoint URLs, encryption keys, VAPID secrets, or sensitive payload contents; payloads remain generic (T0.3/T2.3/T2.6).
- Delivery runs with privileged server DB access only where required; RLS/ownership from T2.1 remains authoritative for user/client access.
- **No blocking:** fan-out/sender errors must not be thrown across payment, order, or inbox-write boundaries. Order/payment success is independent of push delivery.
- Rate/volume bounds protect provider and app runtime; T2.8 prevents abuse-triggered fan-out.

## Acceptance mapping (T2.5)

- **Delivery only after the notification is durable:** enqueue/process only for durably stored notifications; never before commit of the inbox record.
- **Dedupe by notification+recipient+endpoint:** unique delivery key `(notification_id, recipient_user_id, push_subscription_id/endpoint identity)` and idempotent worker claims.
- **Payment never waits on push:** asynchronous/best-effort fan-out, errors isolated from payment/order/inbox flows.
- **Bounded retries:** finite attempts/backoff/window and durable terminal outcomes.

## Open items / implementation notes

- Finalize mechanism: cron polling vs outbox worker vs event-driven job (Vercel runtime constraints) and exact migration name/number (next-free, collision-aware).
- Decide enqueue strategy: inline best-effort enqueue after commit vs reconciler-only discovery vs both (idempotent).
- Finalize max attempts/backoff/window and alignment with T2.4 per-send retry limits and provider TTL.
- Define how "recipient" is expanded for a business notification (all eligible members vs targeted recipients) consistent with T0.1/T2.6/T2.7.
- Tests at implementation: unit-test dedupe key enforcement, state transitions, bounded retry scheduling, and "durable notification required" behavior with mocked sender/DB; assert no push call in payment/order success paths where applicable. Real delivery remains physical-device/manual.
