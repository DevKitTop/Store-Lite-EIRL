# T2.1 — Push subscription schema and RLS (design)

**Status:** Proposed design for P2 (Web Push). Not implemented/migrated.  
**Task:** `T2.1 Add subscription schema and RLS` (`docs/PWA_RESEARCH.md`)  
**Depends on:** T0.4 (shared inbox read-state, per-user/device push receipt/delivery separate), T0.7 (sender `web-push`/VAPID, owner decided), T0.1/T0.2/T0.3 (audience/origin/categories).  
**Blocks / informs:** T2.2 (subscription API), T2.4 (sender), T2.5 (fan-out/dedup), T2.6 (preferences/payloads), T2.7 (lifecycle).  
**Gate:** Do not apply migration or start implementation before P2 is unblocked (T0.6 legal approval/publication before launch, `web-push` dependency approval at implementation, T2.8 hardening plan, and this design reviewed). Migration is manual-operator per `migrations/README.md` (merging does not apply).

## Goals

- Store Web Push subscriptions **per authenticated user and device/browser endpoint** on the supported primary origin (`/`, T0.2).
- Allow the **owning user** to create, read, update, and revoke their own subscriptions (client subscribe/update/unsubscribe flows, T2.2/T2.3/T2.7).
- Enable **server-side delivery** to eligible recipients per business (T0.1/T0.3) while validating membership/authorization at send time (T2.4/T2.5/T2.7). Server delivery uses a privileged/admin DB client (bypasses RLS) and must never trust client-supplied `businessId` or endpoint for authorization.
- Keep push receipt/delivery **separate from shared inbox read-state** (T0.4): no auto-mark read on receipt/click.
- Treat endpoints and keys as **sensitive**: not exposed in logs or to other users; only owning user may access own rows via RLS.

## Non-goals (MVP / T2.1)

- No per-user inbox read-state migration (T0.4).
- No customer push, no tenant subdomains/custom domains (T0.1/T0.2).
- No offline/app-content caching (T0.5).
- No change to tenant routing, checkout, or payment/order success paths.
- Delivery/outbox/dedup tables are specified as T2.5 extension points; T2.1 migration focuses on subscription storage + RLS (can be extended in T2.5 if needed).

## Proposed schema

### Table: `push_subscriptions`

One row per **(user, device endpoint)** subscription. The push endpoint is a capability URL tied to a browser/device + origin + service-worker registration; keys (`p256dh`, `auth`) are the subscription encryption keys returned by `PushSubscription.toJSON()`.

| Column              | Type          | Null | Default / notes                                                                                 |
| ------------------- | ------------- | ---- | ----------------------------------------------------------------------------------------------- |
| `id`                | `uuid`        | NO   | PK, `gen_random_uuid()`                                                                         |
| `user_id`           | `uuid`        | NO   | FK → `profiles(id)` ON DELETE CASCADE (owning authenticated user)                               |
| `endpoint`          | `text`        | NO   | Push service endpoint URL (sensitive capability URL)                                            |
| `p256dh`            | `text`        | NO   | Client public encryption key (base64url)                                                        |
| `auth`              | `text`        | NO   | Auth secret (base64url)                                                                         |
| `expiration_time`   | `timestamptz` | YES  | Browser-provided expiration, if any (nullable)                                                  |
| `user_agent`        | `text`        | YES  | Optional client hint for device management/debugging (do not log routinely; treat as user data) |
| `created_at`        | `timestamptz` | NO   | `now()`                                                                                         |
| `updated_at`        | `timestamptz` | NO   | `now()` (set on subscribe/update/rotate)                                                        |
| `last_seen_at`      | `timestamptz` | YES  | Last successful authenticated subscribe/update/heartbeat (optional)                             |
| `revoked_at`        | `timestamptz` | YES  | Set on explicit unsubscribe/logout revocation (soft revoke; allows audit/cleanup)               |
| `invalidated_at`    | `timestamptz` | YES  | Set when provider indicates endpoint invalid/expired (e.g. 410 Gone, T2.4)                      |
| `failure_count`     | `integer`     | NO   | `0`; bounded send-failure counter for diagnostics/cleanup policy                                |
| `last_failure_at`   | `timestamptz` | YES  | Last send failure timestamp                                                                     |
| `last_failure_code` | `text`        | YES  | Last provider/status code or bounded reason (no payload/PII)                                    |

**Constraints / indexes (proposed):**

- **Uniqueness:** `UNIQUE (user_id, endpoint)` — satisfies "endpoint unique per device/user" and prevents duplicate rows for the same user+endpoint; one endpoint represents one device subscription for that user. (Endpoint is expected to be globally unique in practice; the per-user unique constraint is the acceptance target. T2.2 must upsert/update on resubscribe/`pushsubscriptionchange` rather than creating duplicates.)
- **Lookup:** index on `(user_id)` for owner queries; index/partial index for active send candidates, e.g. `(user_id) WHERE revoked_at IS NULL AND invalidated_at IS NULL` (exact shape finalized with query patterns in T2.4/T2.5).
- **Ownership:** `user_id` is required and immutable for a row except controlled reassociation is **not** allowed (re-subscribe as different user must create/update under that authenticated user; stale rows for removed/other users must not become deliverable).

**Preferences (extensibility, T2.6):** MVP enables `pedidos` only for all T0.1-eligible recipients (T0.3). To support per-category opt-in/out later without breaking schema, T2.6 may add either:

- columns/JSON on `push_subscriptions` for global device preferences, and/or
- a `push_subscription_business_preferences` table keyed by (`push_subscription_id`, `business_id`, `category`) with `enabled` and timestamps, validated against membership at write/send time.

T2.1 keeps the base table simple; preference storage is finalized in T2.6 design/implementation consistent with T0.3.

### Delivery / dedup (T2.5 extension point)

T2.5 requires "dedupe by notification + recipient + endpoint" and retry-safe fan-out after durable notification creation. T2.1 does **not** require a delivery table, but the design anticipates one, e.g. `push_delivery_attempts`/`push_notification_deliveries` with at least: `notification_id`, `recipient_user_id`, `push_subscription_id` (or endpoint hash/id), status, provider response code, attempt count, timestamps, unique dedupe key `(notification_id, recipient_user_id, push_subscription_id)`. This must be designed/added in T2.5 to avoid fan-out on retries and to record bounded outcomes (no sensitive payloads).

## RLS (Row Level Security)

`ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;`

**Owner policies (authenticated user):**

- **SELECT:** `USING (user_id = auth.uid())`
- **INSERT:** `WITH CHECK (user_id = auth.uid())`
- **UPDATE:** `USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())`
- **DELETE:** `USING (user_id = auth.uid())` (if hard-delete exposed; unsubscribe may prefer soft revoke via UPDATE)

Policies mirror the ownership principle used elsewhere (user-scoped access) while keeping rows limited to the owning user. No policy grants access based on `business_id` or endpoint alone.

**Server-side delivery/admin:** fan-out/sender (T2.4/T2.5) and maintenance jobs run with a privileged server/admin DB client as appropriate and **must**:

- select only active, non-revoked, non-invalidated subscriptions for users who are currently eligible members of the target business (validate membership/authorization at send time, T0.1/T2.7);
- never expose subscription rows/endpoints/keys to clients or logs;
- bound retries and invalidate on terminal provider responses (e.g. 410/404 as applicable).

**Cross-tenant / security acceptance:** a user cannot read/modify another user's subscriptions; endpoint/keys are not readable by other users; send-time eligibility prevents delivery to users without current business membership/authorization.

## Drizzle schema (if mirrored)

If/when mirrored in `src/core/database/schema/*` (and exported via `schema/index.ts` / `src/core/database/schema.ts`), add a `pushSubscriptions` table definition matching the migration (snake_case DB columns, camelCase TS fields), relations to `profiles`, and types. Keep server-only usage; do not expose to client bundles. Follow existing patterns in `notifications.ts` / `businesses.ts`.

## Migration (manual-operator)

- **Proposed file:** `migrations/0057_push_subscriptions.sql` (verify next-free numeric prefix across all pending/open PRs before creating/applying; highest numbered manual-style prefix present at design time includes `0056`, and note existing `0048_*` duplicate-prefix anomaly per `migrations/README.md`).
- **Style:** idempotent where practical (`CREATE TABLE IF NOT EXISTS`, guarded constraints/indexes/policies), header comment with intent, `--> statement-breakpoint` if needed.
- **Operations:** create table, indexes, enable RLS, create policies. No destructive statements.
- **Apply:** manual operator step (e.g. `node scripts/apply-migration.mjs migrations/0057_push_subscriptions.sql` or Supabase SQL editor) after review/pre-validation; **do not** use `drizzle-kit push` (`db:push`) against any environment.
- **Rollback note:** dropping the table/policies removes stored subscriptions (users must re-subscribe). Prefer soft revoke/disable flows in production over destructive rollback.

## API implications (T2.2, design input)

- Endpoints (shape TBD in T2.2): authenticated subscribe/upsert, update/rotate (`pushsubscriptionchange`), unsubscribe/revoke; CSRF-protected for state-changing operations; idempotent.
- Validate current user from session (`auth.uid()` context / server auth), persist only for that user; never accept `user_id` from client for ownership.
- Upsert key: `(user_id, endpoint)` (or resolve existing by endpoint for same user) to satisfy uniqueness and rotation.
- Do not log endpoint/keys/payloads; return minimal client-needed data.

## Sender / lifecycle implications (T2.4, T2.7)

- T2.4: load active subscriptions for eligible business members (membership/authorization validated at send time), send generic payloads (T2.6/T0.3), handle 2xx/4xx/5xx with bounded retries, mark `invalidated_at` (and/or revoke) on 410 Gone/invalid endpoint, increment failure counters safely.
- T2.7: on logout/account changes/membership removal, stop future delivery per agreed policy (revoke or rely on send-time eligibility checks; revocation on explicit unsubscribe/logout is preferred for promptness). Multiple devices tracked as separate rows.

## Acceptance mapping (T2.1)

- **Endpoint unique per device/user:** `UNIQUE (user_id, endpoint)` (+ upsert semantics in T2.2).
- **RLS limits rows to the owning user:** owner-only SELECT/INSERT/UPDATE/DELETE policies on `user_id = auth.uid()`.
- **Cross-tenant test passes:** owning-user isolation via RLS and send-time membership/authorization validation; no cross-user/cross-tenant subscription access.

## Open items / follow-ups

- Confirm migration number is still next-free at implementation time (scan `migrations/` and open PRs; `0048_*` prefix collision exists).
- Finalize preference storage shape in T2.6 (`pedidos` MVP now; future categories opt-in/out).
- Finalize delivery/dedup table and outbox/cron integration in T2.5 (and whether included in 0057 or a later migration).
- Coordinate with T2.8 hardening of `POST /api/notifications` before wiring fan-out.
- Decide soft-delete vs hard-delete on unsubscribe (recommend soft revoke via `revoked_at` for audit/idempotency).
