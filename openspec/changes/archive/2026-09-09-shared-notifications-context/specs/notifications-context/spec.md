# Notifications Context Specification

## Purpose

Shared React context provider for notifications. Eliminates duplicate Supabase realtime channels, polling intervals, and initial fetches caused by 6+ components independently mounting `useNotifications`. Follows the `PermissionsContext` pattern: one provider at layout level, thin consumer hooks.

## Non-Goals

- No Upstash/Redis caching layer
- No pagination or infinite scroll changes
- No CSS or visual redesign
- No backend API changes
- No multi-business simultaneous session support

## Requirements

### Requirement: Single Subscription Per BusinessId

The system MUST instantiate exactly one Supabase realtime channel, one 30s polling interval, and one initial fetch per `businessId`, regardless of how many consumer components are mounted.

#### Scenario: Multiple consumers share one channel

- GIVEN `NotificationsProvider` is mounted in `BusinessProviders` with `businessId` "b1"
- WHEN `NotificationBell`, `NotificationsPreview`, and `RealtimeToast` all mount and call `useNotificationsContext()`
- THEN only ONE realtime subscription exists for `businessId` "b1"
- AND only ONE polling interval runs
- AND only ONE initial fetch was executed

#### Scenario: Provider unmounts on navigation away

- GIVEN `NotificationsProvider` is mounted with `businessId` "b1"
- WHEN the user navigates away from the business layout (unmounts `BusinessProviders`)
- THEN the single realtime channel is removed and the polling interval is cleared

### Requirement: Public API Surface

The system MUST expose via context the identical public API as the current `useNotifications` hook: `notifications`, `unreadCount`, `unreadCountByCategory`, `isLoading`, `error`, `markAsRead`, `markAllAsRead`, `dismiss`, `refresh`.

#### Scenario: Consumer receives full API

- GIVEN `NotificationsProvider` is mounted and has fetched notifications
- WHEN a consumer calls `useNotificationsContext()`
- THEN the returned object contains all 9 fields/methods listed above
- AND each field/method behaves identically to the standalone hook

### Requirement: Subscriber Event Registry

The system SHOULD support a multi-consumer subscribe/unsubscribe registry for new-notification events, replacing the single `onNewNotification` callback. Consumers opt in via `subscribeToNewNotifications(fn)` and clean up via `unsubscribeFromNewNotifications(fn)`.

#### Scenario: Two consumers receive new notification event

- GIVEN `RealtimeToast` and `StorageHeader` both call `subscribeToNewNotifications(callback)`
- WHEN a new notification arrives via realtime for the subscribed `businessId`
- THEN both callbacks are invoked with the new `Notification` object

#### Scenario: Unsubscribe removes listener

- GIVEN `StorageHeader` has called `subscribeToNewNotifications(cb)`
- WHEN `StorageHeader` unmounts and calls `unsubscribeFromNewNotifications(cb)`
- THEN subsequent new notifications no longer invoke `cb`

### Requirement: Backwards Compatibility

The system MUST preserve backwards compatibility: existing `useNotifications` consumers MUST keep working during migration. The standalone hook remains the internal implementation detail used by the provider. All 6 component consumers migrate to `useNotificationsContext()`.

#### Scenario: Provider wraps existing hook

- GIVEN `useNotifications` still exists at `src/hooks/useNotifications.ts`
- WHEN `NotificationsProvider` mounts
- THEN it internally calls `useNotifications({ businessId })` exactly once
- AND the returned values are forwarded verbatim to all consumers via context

### Requirement: Provider Mount Point

The system MUST mount `NotificationsProvider` inside the `BusinessProviders` tree at app layout level so dashboard, `/notifications` page, and storage all share the same provider instance.

#### Scenario: All routes share one provider

- GIVEN `NotificationsProvider` is a child of `BusinessProviders`
- WHEN a user visits `/dashboard`, `/notifications`, or `/storage`
- THEN the same provider instance serves notifications for the current `businessId`

### Requirement: Realtime Dedup

The system SHOULD prevent duplicate notifications when a notification arrives via the realtime channel while a fetch is in flight. The provider MUST deduplicate by notification `id` before merging into state.

#### Scenario: Realtime arrives during fetch

- GIVEN a fetch is in progress for `businessId` "b1"
- WHEN a realtime INSERT event arrives with `id` "n1"
- AND the in-flight fetch response also contains `id` "n1"
- THEN the notification list contains `n1` exactly once

### Requirement: Provider Lifecycle vs Channel Lifecycle

The system MUST document that the provider lives for the entire app session (parented to `BusinessProviders`), while the realtime channel and polling interval follow the provider's mount lifecycle. A new `businessId` (different business) re-creates the channel; same `businessId` across re-mounts does not create duplicate channels.

#### Scenario: Business switch recreates channel

- GIVEN `NotificationsProvider` is mounted with `businessId` "b1"
- WHEN user switches to business "b2" (new mount)
- THEN channel for "b1" is removed and a new channel for "b2" is created
