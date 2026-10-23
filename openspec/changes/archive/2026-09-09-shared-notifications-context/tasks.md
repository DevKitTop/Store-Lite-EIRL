# Tasks: Shared Notifications Context

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~280 (new provider ~90, 6 consumer edits ~15 each, hook cleanup ~20, tests ~100) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Provider + context + hook refactor + all consumer migrations + tests | PR 1 | All changes are tightly coupled; provider is useless without consumers, consumers break without provider. Single PR is cleanest. |

## Phase 1: Provider + Context (Foundation)

- [x] 1.1 **RED**: Create `tests/unit/NotificationsContext.test.tsx` — write tests for provider context shape (all 9 fields present), dedup (2 consumers → 1 fetch), subscriber add/remove, subscriber dispatch (2 subscribers both called). Mock `useNotifications`.
- [x] 1.2 **GREEN**: Create `app/[slug]/(app)/context/NotificationsContext.tsx` — provider mounts `useNotifications({ businessId })` once, exposes `NotificationsContextValue` (9 fields + `subscribeToNewNotifications`), pub/sub registry via `useRef(Set)`. Export `useNotificationsContext()` hook.
- [x] 1.3 **REFACTOR**: Run `pnpm test:unit` — verify `NotificationsContext.test.tsx` passes.

## Phase 2: Mount Provider

- [x] 2.1 Modify `app/[slug]/(app)/components/BusinessProviders.tsx` — import `NotificationsProvider`, wrap inside `BusinessEntitlementsProvider` (before `CurrencyProvider`), pass `businessId`.
- [x] 2.2 Run `pnpm test:unit` — verify existing tests still pass (no regressions).

## Phase 3: Hook Cleanup

- [x] 3.1 Modify `src/hooks/useNotifications.ts` — remove `onNewNotification` from `UseNotificationsOptions` interface and destructuring. The provider will pass it internally via ref (already uses `onNewNotificationRef`).
- [x] 3.2 Update `tests/unit/NotificationsClient.test.tsx` — remove `onNewNotification` from any mock setup if present (verify; currently not used in test).
- [x] 3.3 Run `pnpm test:unit` — verify hook tests and NotificationsClient tests pass.

## Phase 4: Consumer Migrations

- [x] 4.1 Migrate `NotificationBell.tsx` — replace `useNotifications({ businessId })` → `useNotificationsContext()`, remove `businessId` prop dependency. Run `pnpm test:unit`.
- [x] 4.2 Migrate `NotificationsPreview.tsx` — replace `useNotifications({ businessId })` → `useNotificationsContext()`. Run `pnpm test:unit`.
- [x] 4.3 Migrate `NotificationsClient.tsx` — replace `useNotifications({ businessId })` → `useNotificationsContext()`, remove `businessId` prop from component signature (read from context). Update `NotificationsClient.test.tsx` to mock `useNotificationsContext` instead of `useNotifications`. Run `pnpm test:unit`.
- [x] 4.4 Migrate `RealtimeToast.tsx` — remove `useNotifications` call entirely, use `useNotificationsContext().subscribeToNewNotifications` in `useEffect`. Remove `businessId` prop. Run `pnpm test:unit`.
- [x] 4.5 Migrate `StorageHeader.tsx` — remove `useNotifications` call + `onNewNotification` callback, use `useNotificationsContext()` for state + `subscribeToNewNotifications` in `useEffect`. Run `pnpm test:unit`.
- [x] 4.6 Migrate `NavbarNotificationsBadge.tsx` — replace `useNotifications({ businessId, autoFetch: false, enableRealtime: true })` → `useNotificationsContext()`. Note: loses `autoFetch: false` / `enableRealtime: true` — verify provider defaults cover this. Run `pnpm test:unit`.

## Phase 5: Verification

- [x] 5.1 Grep for remaining `useNotifications` imports in component files — confirmed clean (only provider imports directly). Full suite: 1314 tests pass.
- [x] 5.2 Run `pnpm type-check` — clean, no type errors from removed `businessId` props or changed interfaces.
- [ ] 5.3 Run `pnpm build` — NOT run yet. Type-check clean, low risk (pure refactor, no new deps). Run before PR creation.
