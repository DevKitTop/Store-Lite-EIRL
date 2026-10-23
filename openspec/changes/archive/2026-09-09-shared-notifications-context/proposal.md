# Proposal: shared-notifications-context

## Intent

6 components independently call `useNotifications`, creating 4+ duplicate Supabase realtime channels, 4+ 30s polling intervals, and 4+ initial fetches for the same `businessId`. On the dashboard alone, 3 full subscriptions mount simultaneously. This wastes network resources, causes redundant state updates, and makes the `onNewNotification` callback unusable for multi-consumer scenarios (StorageHeader + RealtimeToast both need it).

## Scope

### In Scope
- Single `NotificationsProvider` mounted inside `BusinessProviders` (app layout level) — one realtime channel, one polling interval, one fetch per `businessId`
- `useNotificationsContext` consumer hook exposing the full public API: `markAsRead`, `markAllAsRead`, `dismiss`, `refresh`, `unreadCount`, `unreadCountByCategory`, `isLoading`, `error`, `notifications`
- Subscriber registry (pub/sub) replacing the single `onNewNotification` callback — `subscribeToNewNotifications(fn)` / `unsubscribeFromNewNotifications(fn)` so multiple consumers (StorageHeader, RealtimeToast) receive events without duplicate subscriptions
- Migrate all 6 consumers to use the context hook, removing direct `useNotifications` calls from components
- Preserve `useNotifications` as internal implementation detail (used by the provider), remove from public consumer surface
- Unit tests for provider context and dedup behavior

### Out of Scope
- Upstash/Redis caching layer (future optimization — record as follow-up)
- Infinite scroll / pagination changes for notification lists
- Notification CSS or visual redesign
- Backend API changes
- Multi-business simultaneous sessions

## Capabilities

### New Capabilities
- `notifications-context`: Shared React context provider for notifications — single subscription per businessId, pub/sub event registry, consumer hook

### Modified Capabilities
- None. No existing spec covers notifications.

## Approach

Follow the `PermissionsContext` pattern (app/[slug]/(app)/context/PermissionsContext.tsx):

1. Create `NotificationsContext.tsx` in the same context directory
2. Provider internally calls the existing `useNotifications` hook once, managing all lifecycle (fetch, realtime, polling)
3. Expose `subscribeToNewNotifications` / `unsubscribeFromNewNotifications` via context — provider maintains a `Set<callback>` registry, iterates on each realtime event
4. Mount `NotificationsProvider` inside `BusinessProviders.tsx` (sibling to PermissionsProvider)
5. Each consumer replaces `useNotifications({ businessId })` → `useNotificationsContext()` (no `businessId` prop needed)
6. RealtimeToast and StorageHeader switch from `onNewNotification` prop to the subscribe/unsubscribe registry
7. Remove `onNewNotification` option from the public `useNotifications` hook API (provider consumes it internally)

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/[slug]/(app)/context/NotificationsContext.tsx` | New | Provider + consumer hook + pub/sub registry |
| `app/[slug]/(app)/components/BusinessProviders.tsx` | Modified | Add NotificationsProvider to tree |
| `src/hooks/useNotifications.ts` | Modified | Remove `onNewNotification` from public API, keep as internal impl |
| `app/[slug]/(app)/dashboard/components/NotificationBell.tsx` | Modified | Migrate to context |
| `app/[slug]/(app)/dashboard/components/NotificationsPreview.tsx` | Modified | Migrate to context |
| `app/[slug]/(app)/dashboard/components/RealtimeToast.tsx` | Modified | Migrate to context + subscribe to registry |
| `app/[slug]/(app)/notifications/NotificationsClient.tsx` | Modified | Migrate to context |
| `src/shared/components/navigation/NavbarNotificationsBadge.tsx` | Modified | Migrate to context |
| `src/features/storage/components/StorageHeader.tsx` | Modified | Migrate to context + subscribe to registry |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Consumer migration breaks existing behavior (missed API surface) | Med | Strict TDD: unit tests for provider shape + consumer migration tests before refactoring |
| `onNewNotification` removal from public hook breaks external consumers | Low | Audit all 6 consumers first; provider replaces it internally |
| Single-business assumption limits future multi-business tabs | Low | Document as constraint; provider is naturally scoped per BusinessProviders mount |

## Rollback Plan

Remove `NotificationsProvider` from `BusinessProviders.tsx`, revert all consumer files to direct `useNotifications` imports. No database or API changes to revert. The `NotificationsContext.tsx` file can be deleted.

## Dependencies

- Existing `useNotifications` hook (src/hooks/useNotifications.ts) — preserved as internal implementation
- `PermissionsContext` pattern (app/[slug]/(app)/context/) — template for provider structure

## Success Criteria

- [ ] Dashboard renders with 1 realtime channel instead of 3+ (verify via Supabase dashboard or network tab)
- [ ] All 6 consumers receive identical data as before (no behavioral regression)
- [ ] StorageHeader and RealtimeToast both receive `onNewNotification` events via subscriber registry
- [ ] Unit tests pass: provider context value shape, dedup behavior, subscriber registry add/remove
- [ ] No direct `useNotifications` imports remain in any component file (only in the provider)

## Testing Strategy

Strict TDD mode is active. Test runner: `pnpm test:unit`.

1. **RED**: Write unit tests for `NotificationsContext` — provider renders children, exposes expected API surface, subscriber registry registers/unregisters callbacks
2. **GREEN**: Implement provider + consumer hook to pass tests
3. **REFACTOR**: Migrate consumers one by one, verifying each with existing snapshot/behavior tests
4. **Integration**: Test that a single mount produces one fetch (mock Supabase client assertion)
