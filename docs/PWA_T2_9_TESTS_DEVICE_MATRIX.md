# T2.9 - P2 tests and device matrix (design)

**Status:** Proposed design for P2 (Web Push). Not implemented.  
**Task:** `T2.9 Add tests and execute the P2 device matrix` (`docs/PWA_RESEARCH.md`)  
**Depends on:** T2.1-T2.8 (subscription schema/RLS, subscription API, worker handlers, sender, fan-out/dedup, payloads/preferences, lifecycle, endpoint hardening). Gated by T0.1-T0.7 decisions and P2 launch gates (notably T0.6 legal approval/publication before push launch, T2.1 migration reviewed/applied, `web-push` dependency approval at implementation).  
**Gate:** Do not implement P2 runtime behavior before required approvals/gates are satisfied. Real Web Push delivery cannot be fully asserted in CI; physical-device/manual verification is required.

## Goals

- Define the **automated test coverage** to add at P2 implementation time (unit/integration/E2E where feasible) so behavior is verified before merge, following the repository test-first policy: observe a failing test before implementing each behavioral change.
- Define the **P2 physical-device matrix** and evidence to record for Android/iOS (and desktop if in scope), covering push delivery, click-through, revoke, and reinstall cases that cannot be proven in CI alone.
- Preserve existing guarantees: inbox/Reauth behavior intact, no tenant leakage, generic payloads, and push/provider failures never block payment/order/inbox flows.

## Automated test plan (implementation-time)

Run per task/change: `pnpm test:unit`, `pnpm type-check`, `pnpm lint`, `pnpm build`, and `pnpm test:e2e` for shell/offline/service-worker cases as applicable.

### Unit / integration (mocked boundaries)

| Area                        | Expected coverage                                                                                                                                                                                                                              | Notes                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| T2.1 schema/RLS assumptions | DB/query-layer tests or migration verification checks for owner-only access, `UNIQUE (user_id, endpoint)`, and cross-tenant isolation                                                                                                          | Follow `migrations/README.md` manual-operator process; prefer tests that prove no cross-user/cross-tenant subscription access. |
| T2.2 subscription API       | Auth required, server-derived user, CSRF/Origin/Sec-Fetch-Site protections, validation, idempotent subscribe/upsert/rotate and unsubscribe/revoke, minimal responses, no endpoint/key leakage                                                  | Mock Supabase/auth and DB; reject cross-site/missing-origin cases per T2.2.                                                    |
| T2.3 worker handlers        | `push` displays generic notification from safe payload; `notificationclick` navigates same-origin/auth route only and does not auto-mark shared inbox read (T0.4); `pushsubscriptionchange` triggers rotation flow with graceful auth handling | Use service-worker-capable test harness/mocks as feasible; avoid asserting real push receipt.                                  |
| T2.4 sender                 | VAPID config from env (server-only), bounded TTL/urgency, per-endpoint outcomes: 2xx success, 410/404 invalidation, 401/403 handling, 429/5xx/timeout bounded retry/failure accounting, send-time eligibility filtering                        | Mock `web-push` transport; assert no secrets/payloads logged.                                                                  |
| T2.5 fan-out/dedup          | Durable-notification-first trigger, dedupe key `notification + recipient + endpoint/subscription`, idempotent worker claims, bounded retries/backoff/terminal states, no fan-out on retries/replays                                            | Mock sender/DB; assert fan-out isolated from payment/order/inbox transaction paths.                                            |
| T2.6 payloads/preferences   | Payload builder outputs generic content only (no customer names/chat previews/amounts/sensitive `data`), maps categories/preferences to existing `notification_category` enum with MVP `pedidos` gating, inbox unchanged                       | Reject/omit sensitive fields by construction.                                                                                  |
| T2.7 lifecycle              | Logout/device revoke stops future delivery for that endpoint (best-effort), membership/authorization revocation excluded at send time, multi-device independence, idempotent revoke/rotate                                                     | Include sign-out hook behavior and send-time eligibility checks.                                                               |
| T2.8 endpoint hardening     | `POST /api/notifications` cannot trigger abusive/untrusted push fan-out; authz/validation/size/rate/idempotency expectations enforced per design                                                                                               | Preserve legitimate owner/admin behavior unless intentionally tightened with coordinated changes.                              |

### E2E / browser automation (feasible subset)

- Manifest/installability shell behavior and service-worker registration/update basics (Playwright `serviceWorkers` support where applicable) for P1/P2 shell aspects that do not require real push delivery.
- Authenticated navigation from notification-click target routes (simulated) enforces access control and does not leak tenant data.
- **Not CI-assertable:** real OS/browser push receipt, background delivery timing, iOS Home Screen push behavior, and provider network behavior - covered by device matrix.

## P2 physical-device matrix (manual)

Record results per device/build/date/tester with: OS/browser/app-install state, account/tenant, steps, expected vs actual, screenshots/log references (no secrets/endpoints/keys).

| Platform                                            | Preconditions                                                                                                                                                    | Cases to execute                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android (supported Chrome, physical device)         | HTTPS origin, eligible seller/team account (T0.1), app installable, P2 enabled                                                                                   | Install/add flow as applicable; explicit opt-in permission grant and **deny** handling; receive generic `pedidos` push in foreground and background; **click-through** opens authorized in-app route (rechecks auth/membership; shared inbox read-state not auto-marked on receipt/click, T0.4); **revoke** permission/unsubscribe in-app and in browser settings stops delivery; **reinstall**/re-subscribe issues new/updated endpoint and receives again; multi-device independence; logout stops device delivery; membership removal stops business delivery. |
| iPhone/iPad (supported iOS/iPadOS, physical device) | **Added to Home Screen** (required for web push), eligible account, P2 enabled, T0.6 approved/published before launch testing that constitutes production launch | Same core cases as Android within iOS constraints: Home Screen install, opt-in from direct user action, foreground/background push receipt, click-through to authorized route, revoke/unsubscribe and permission changes, reinstall/remove+re-add, logout and membership revocation stop delivery. Record iOS version/browser and any platform limitations.                                                                                                                                                                                                       |
| Desktop (supported Chromium; Safari if in scope)    | If desktop install/push included in T0.1-T0.3 scope                                                                                                              | Install/launch as applicable, permission grant/deny, push receipt, click-through, revoke/unsubscribe, update behavior.                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Cross-cutting scenarios (all applicable platforms)

- **Generic payload/privacy:** lock-screen/banner content contains no customer names, chat previews, amounts, or sensitive order details (T0.3/T2.6).
- **Authorization/tenant safety:** click-through and subsequent data fetch require valid session/membership; no cross-tenant leakage; expired session routes safely (T1.3/T2.3).
- **Inbox fallback:** in-app inbox/Reauth/polling continues to work when push unavailable, denied, unsupported, or unsubscribed (T0.4).
- **Resilience:** provider/send failures do not break order/payment/inbox flows (observational/manual fault-injection where safe); duplicate events do not cause duplicate push fan-out per dedupe rules (T2.5).
- **Lifecycle:** sign-out and business membership removal stop delivery (T2.7); endpoint rotation/`pushsubscriptionchange` recovers (T2.3/T2.4) where testable.

## Evidence and reporting

- For each P2 PR/implementation slice, record commands run and outcomes; attach or link device-matrix results (date, device/OS, tester, pass/fail, notes).
- Known CI limitation: real Web Push delivery excluded from automated pass criteria; device matrix is the acceptance evidence for delivery/click/revoke/reinstall.

## Acceptance mapping (T2.9)

- **Planned coverage passes:** unit/integration/E2E tests added per areas above pass in CI/local verification for implemented slices.
- **Android/iOS push, click-through, revoke, reinstall recorded:** physical-device matrix executed and documented with outcomes (including iOS Home Screen constraints).

## Open items

- Expand/adjust matrix if desktop scope is explicitly included/excluded by product decision.
- Define exact test file locations/naming at implementation time consistent with repo conventions (`tests/unit`, `tests/e2e`).
- Coordinate fault-injection/observability checks with T2.4/T2.5 implementation (without impacting production data).
