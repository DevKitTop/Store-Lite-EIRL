# T2.4 — Web Push sender (design)

**Status:** Proposed design for P2 (Web Push). Not implemented.  
**Task:** `T2.4 Implement the sender` (`docs/PWA_RESEARCH.md`)  
**Depends on:** T0.7 (sender `web-push`/VAPID, owner decided), T2.1 (subscription schema/RLS, delivery targets/lifecycle fields). Coordinates with T2.3 (worker payload handling), T2.5 (fan-out/dedup/outbox), T2.6 (generic payloads/preferences), T2.7 (eligibility/lifecycle).  
**Gate:** Do not implement before P2 is unblocked (T0.6 legal approval/publication before launch, T2.1 migration applied/available, `web-push` dependency explicitly approved at implementation, T2.5/T2.8 hardening aligned). **Do not** add VAPID secrets to the repo or to `NEXT_PUBLIC_*`; keys are generated/stored by the project owner in Vercel server env vars at implementation time.

## Goals

- Provide a server-only sender module that delivers **generic, privacy-safe** Web Push payloads (T0.3, `pedidos` MVP) to eligible, active subscriptions using the standards-based `web-push` library with VAPID.
- Enforce **send-time eligibility** (T0.1/T0.4/T2.7): only users with current membership/authorization and dashboard access for the target business; never trust stored state or client input alone.
- Be **best-effort and bounded**: handle provider responses, clean up invalid subscriptions (e.g. 410 Gone), bound retries, and never fail or roll back order/payment/inbox-creation paths.
- Keep endpoints/keys and payload contents out of logs and client exposure.

## Configuration (server-only)

- **Env vars (Vercel, server-only):** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (project contact, e.g. `mailto:`/URL as required). Read via server config (extend `src/config/env` at implementation); never `NEXT_PUBLIC_` and never committed. Document in `.env.example` as placeholders only when implementing (no real values).
- **Public key to clients:** exposed via a safe server-provided config/endpoint or build-safe public mechanism as needed for subscription (T2.2/T2.3); must be the public key only.
- **Dependency:** `web-push` (npm) — requires explicit approval before adding (`AGENTS.md`).

## Sender responsibilities

Proposed server module (e.g. `src/lib/push/webPushSender.ts` or equivalent, implementation-time path): accepts a delivery intent for a **durable** business notification/recipient context and returns bounded per-endpoint outcomes.

1. **Load candidates:** query active subscriptions (`revoked_at IS NULL AND invalidated_at IS NULL`) for users eligible for the target `business_id` and enabled category (MVP `pedidos`, T0.3). Eligibility must be validated at send time against current membership/authorization (T0.1/T2.7) using privileged server DB access; do not deliver to removed/unauthorized members.
2. **Build payload:** generic JSON only (no customer names, chat previews, amounts, or private order details), e.g. `{ title, body, tag?, data: { url, category, notificationId } }` consistent with T2.3/T2.6. `data.url` must be a safe same-origin/internal path hint; click auth is enforced by the app.
3. **Send:** call `webPush.sendNotification(subscription, payload, options)` with VAPID details set once per process/configuration.
   - **Options:** bounded `TTL` (seconds) and `urgency` (`high`/`normal`/`low`/`very-low`) chosen per category (orders likely `high`/`normal` with sensible TTL); avoid unbounded retention at provider.
   - **Concurrency/rate:** bound parallelism and per-run volume to protect the runtime (especially in serverless/cron contexts).
4. **Handle responses per endpoint:**
   - **Success (2xx):** record success outcome (T2.5), update `last_seen_at`/clear transient failure state as appropriate.
   - **410 Gone / 404 Not Found (invalid/unsubscribed endpoint):** mark subscription `invalidated_at` (and/or revocation flag per policy), do not retry; T2.5 records terminal outcome.
   - **401/403 (auth/config issues):** treat as operational/config error (VAPID/keys), surface via logging/monitoring without secrets; do not invalidate user subscriptions blindly except where response semantics are definitive.
   - **429/5xx/timeout/network:** retryable within **bounded** limits (e.g. small fixed attempts or backoff within the same job window) per T2.5 policy; increment `failure_count`, set `last_failure_at`/bounded `last_failure_code`. Do not loop indefinitely.
5. **No side effects on source flows:** sender/fan-out runs after the underlying business notification is durably created (T2.5). Errors must be captured and recorded; never thrown in a way that fails/rolls back payment, order, or notification-insert transactions.

## Integration with T2.5 (fan-out/outbox)

- T2.4 provides the **delivery primitive**; T2.5 owns triggering, deduplication (`notification + recipient + endpoint`), retry scheduling/outbox or cron reuse (pattern similar to `app/api/cron/check-plans`), and durable outcome recording.
- Invoke sender only from trusted server-side producers/fan-out workers (not from untrusted client-triggerable paths). Coordinate with T2.8 hardening of `POST /api/notifications`.
- Dedup must prevent repeated fan-out on retries/replays; sender may be called per unique delivery unit determined by T2.5.

## Security and privacy

- Never log `endpoint`, `p256dh`, `auth`, VAPID private key, or notification payload details; log only bounded metadata (counts, status classes, non-sensitive IDs/hashes if needed).
- Payloads generic only; details shown after authenticated navigation/authorization checks (T2.3).
- Subscriptions/keys treated as sensitive (T2.1); use privileged DB access only where required and minimize exposure.
- `user_agent`/failure fields stored per T2.1 must not contain secrets/PII beyond what is necessary and must not be logged routinely.

## Acceptance mapping (T2.4)

- **VAPID from env:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` server-only env (owner-managed in Vercel).
- **Bounded TTL/urgency:** passed to `web-push` send options with category-appropriate, bounded values.
- **410 cleanup:** invalidated/removed from active delivery on 410 Gone (and 404 where appropriate).
- **Bounded retries:** finite retry attempts/backoff and failure accounting; no infinite retries, no blocking of source operations.

## Open items / implementation notes

- Finalize exact TTL/urgency values and retry/backoff policy with T2.5.
- Finalize failure-state reset semantics on success/re-subscribe (with T2.1/T2.2/T2.7).
- Decide cron vs outbox vs inline background job mechanism in T2.5 (Vercel/Next runtime constraints); reuse existing cron/route patterns where suitable.
- Add `web-push` types/dependency only at implementation with approval; extend env validation/tests (`tests/unit/envProdGuards.test.ts` baselines if public env exposure changes — note: VAPID private key must remain non-public).
- Tests at implementation: unit-test sender with mocked `web-push` transport for 2xx/410/429/5xx paths and eligibility filtering; real delivery remains physical-device/manual verification.
