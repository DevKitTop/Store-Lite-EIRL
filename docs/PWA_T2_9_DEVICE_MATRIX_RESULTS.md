# T2.9 — P2 device matrix results

**Status:** Pending physical-device execution. Do not treat this document as launch evidence until every applicable row is executed and recorded.

**Scope:** Web Push P2 only. Real OS/browser push receipt, background delivery timing, iOS Home Screen behavior and provider network behavior are not CI-assertable.

**Prerequisites:** T0.6 legal approval/publication, migration `0057` applied, real VAPID keys configured server-side by the project owner, an eligible seller/team account, HTTPS origin, and implemented T2.5/T2.6/T2.7 runtime behavior.

**Evidence rules:** Record date, device/OS, browser/build, app-install state, account/tenant alias, steps, expected vs actual, and sanitized screenshot/log references. Never record endpoints, subscription keys, VAPID keys, tokens, customer names, chat previews, amounts or other sensitive data.

## Automated coverage index

| Area                                                     | Evidence                                                                                                     | Status                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| PWA shell installability and service-worker registration | `tests/e2e/pwaShell.spec.ts`                                                                                 | Passing locally after Playwright Chromium install |
| P1 manifest/icon unit coverage                           | `tests/unit/pwaManifest.test.ts`                                                                             | Passing in the full suite                         |
| T2.1 schema/RLS                                          | `migrations/0057_push_subscriptions.sql` and manual-operator process                                         | SQL reviewed; DB application pending              |
| T2.2 subscription API                                    | `tests/unit/pushSubscriptionsRoute.test.ts`                                                                  | Passing in the full suite                         |
| T2.3 worker handlers                                     | `tests/unit/pwaWorker.test.ts`                                                                               | Passing in the full suite                         |
| T2.4 sender                                              | `tests/unit/webPushSender.test.ts`, `tests/unit/pushConfigRoute.test.ts`, `tests/unit/envProdGuards.test.ts` | Passing in the full suite                         |
| T2.5 fan-out/dedup                                       | Planned per design                                                                                           | Not implemented, no evidence                      |
| T2.6 payloads/preferences                                | Planned per design                                                                                           | Not implemented, no evidence                      |
| T2.7 lifecycle                                           | Planned per design                                                                                           | Not implemented, no evidence                      |
| T2.8 endpoint hardening                                  | `tests/unit/notificationsRouteHardening.test.ts`                                                             | Passing in the full suite                         |

## Android — supported Chromium, physical device

| Date    | Device/OS | Browser/build | Install state | Account/tenant alias | Case                                       | Expected                                                                  | Actual  | Result  | Evidence |
| ------- | --------- | ------------- | ------------- | -------------------- | ------------------------------------------ | ------------------------------------------------------------------------- | ------- | ------- | -------- |
| Pending | Pending   | Pending       | Pending       | Pending              | Install/add flow                           | App is installable from HTTPS origin                                      | Pending | Not run | Pending  |
| Pending | Pending   | Pending       | Pending       | Pending              | Opt-in permission grant and deny           | Grant enables subscription; deny leaves inbox fallback intact             | Pending | Not run | Pending  |
| Pending | Pending   | Pending       | Pending       | Pending              | Foreground and background `pedidos` push   | Generic notification received in both states                              | Pending | Not run | Pending  |
| Pending | Pending   | Pending       | Pending       | Pending              | Click-through                              | Opens authorized in-app route; shared inbox read-state is not auto-marked | Pending | Not run | Pending  |
| Pending | Pending   | Pending       | Pending       | Pending              | Revoke                                     | In-app unsubscribe and browser permission change stop delivery            | Pending | Not run | Pending  |
| Pending | Pending   | Pending       | Pending       | Pending              | Reinstall/re-subscribe                     | New or updated endpoint receives again                                    | Pending | Not run | Pending  |
| Pending | Pending   | Pending       | Pending       | Pending              | Multi-device and logout/membership removal | Devices are independent; logout and membership removal stop delivery      | Pending | Not run | Pending  |

## iOS/iPadOS — physical device, Added to Home Screen

| Date    | Device/OS | Browser/build | Install state | Account/tenant alias | Case                           | Expected                                                               | Actual  | Result  | Evidence |
| ------- | --------- | ------------- | ------------- | -------------------- | ------------------------------ | ---------------------------------------------------------------------- | ------- | ------- | -------- |
| Pending | Pending   | Pending       | Pending       | Pending              | Home Screen install            | Web app added to Home Screen from HTTPS origin                         | Pending | Not run | Pending  |
| Pending | Pending   | Pending       | Pending       | Pending              | Opt-in from direct user action | Permission prompt appears only on explicit user action                 | Pending | Not run | Pending  |
| Pending | Pending   | Pending       | Pending       | Pending              | Foreground/background delivery | Generic `pedidos` notification received under iOS constraints          | Pending | Not run | Pending  |
| Pending | Pending   | Pending       | Pending       | Pending              | Click-through                  | Opens authorized in-app route; no tenant leakage                       | Pending | Not run | Pending  |
| Pending | Pending   | Pending       | Pending       | Pending              | Revoke/reinstall               | Permission change or remove+re-add stops/restarts delivery as expected | Pending | Not run | Pending  |
| Pending | Pending   | Pending       | Pending       | Pending              | Logout/membership removal      | Delivery stops for that device/business                                | Pending | Not run | Pending  |

## Desktop — only if explicitly in T0.1–T0.3 scope

| Date    | Device/OS | Browser/build | Install state | Account/tenant alias | Case                                                                | Expected                                     | Actual  | Result  | Evidence |
| ------- | --------- | ------------- | ------------- | -------------------- | ------------------------------------------------------------------- | -------------------------------------------- | ------- | ------- | -------- |
| Pending | Pending   | Pending       | Pending       | Pending              | Install/launch, permission, delivery, click-through, revoke, update | Behavior matches the supported browser scope | Pending | Not run | Pending  |

## Cross-cutting checks

| Check                       | Expected                                                                                       | Result  | Evidence |
| --------------------------- | ---------------------------------------------------------------------------------------------- | ------- | -------- |
| Generic payload/privacy     | No customer names, chat previews, amounts or sensitive order details in banners or lock screen | Not run | Pending  |
| Authorization/tenant safety | Click-through and data fetch require valid session/membership                                  | Not run | Pending  |
| Inbox fallback              | In-app inbox/Reauth/polling works when push is denied, unsupported or unsubscribed             | Not run | Pending  |
| Resilience                  | Provider/send failures do not break order/payment/inbox flows                                  | Not run | Pending  |
| Dedupe                      | Duplicate events do not cause duplicate push fan-out under T2.5 rules                          | Not run | Pending  |
| Lifecycle                   | Sign-out and membership removal stop delivery; endpoint rotation recovers                      | Not run | Pending  |

## Acceptance

- **Automated coverage:** feasible P2 shell/service-worker coverage added and passing locally; full CI verification recorded on the PR.
- **Physical matrix:** not executed. T2.9 cannot be marked complete until Android/iOS delivery, click-through, revoke and reinstall are recorded with sanitized evidence.
