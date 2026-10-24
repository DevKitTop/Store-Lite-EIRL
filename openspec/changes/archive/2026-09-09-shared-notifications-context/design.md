# Design: Shared Notifications Context

## Technical Approach

A single `NotificationsProvider` runs the existing `useNotifications` hook once and exposes state + pub/sub registry via React context. All 6 consumers switch from `useNotifications({ businessId })` to `useNotificationsContext()`, eliminating duplicate Supabase channels, polling intervals, and fetches.

## Architecture Decisions

### Decision: File location

**Choice**: `app/[slug]/(app)/context/NotificationsContext.tsx` (next to `PermissionsContext.tsx`)
**Alternatives**: `src/features/notifications/` or a top-level `src/contexts/`
**Rationale**: Follows the established pattern — `PermissionsContext.tsx` lives here, consumers in `(app)/` already import from `@app/[slug]/(app)/context/`. No feature folder exists for notifications yet; creating one just for the provider adds path noise. Keep it adjacent to its sibling.

### Decision: `useNotifications` public API removal

**Choice**: Remove `onNewNotification` from `UseNotificationsOptions` export. Keep `useNotifications` as internal implementation detail (imported only by the provider). No compatibility wrapper.
**Alternatives**: Keep a thin wrapper that reads context if provider present, falls back to standalone
**Rationale**: The proposal says "remove from public consumer surface." Every consumer in the codebase has a migration path — no external API contract exists. A compatibility layer adds dead-code branches for a scenario that won't happen. Explicit beats defensive.

### Decision: Pub/sub subscriber registry

**Choice**: `Set<Function>` stored in `useRef` inside provider. `subscribe(fn)` adds to set and returns an unsubscribe cleanup. On realtime event, provider iterates the set and calls each. Zero-listeners → no-op (no iteration overhead).
**Alternatives**: EventEmitter class, useSyncExternalStore, callback prop
**Rationale**: `Set` gives O(1) add/remove and automatic dedup of the same reference. `useRef` avoids re-renders when subscribers change. Returning a cleanup function is idiomatic React (`useEffect` cleanup pattern). No external dependency needed.

## Data Flow

```
BusinessProviders (mount)
  └─ NotificationsProvider
       ├─ useNotifications({ businessId })  ← runs ONCE
       │    ├─ fetch /api/notifications
       │    ├─ supabase channel (realtime INSERT)
       │    └─ polling interval (30s)
       ├─ subscribers: Set<fn> (ref)
       │    ├─ StorageHeader.onNewNotification
       │    └─ RealtimeToast.onNewNotification
       └─ context value: { state + subscribe/unsubscribe }

Consumers (6 components):
  NotificationBell ──── useNotificationsContext() → { unreadCount, notifications, ... }
  NotificationsPreview ─→ useNotificationsContext() → { notifications, markAsRead, ... }
  NotificationsClient ──→ useNotificationsContext() → { notifications, markAllAsRead, ... }
  StorageHeader ──────── useNotificationsContext() → { unreadCount, notifications, subscribe }
  RealtimeToast ──────── useNotificationsContext() → { subscribe }
  NavbarNotificationsBadge → useNotificationsContext() → { unreadCount }
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `app/[slug]/(app)/context/NotificationsContext.tsx` | Create | Provider + `useNotificationsContext` + pub/sub registry |
| `app/[slug]/(app)/components/BusinessProviders.tsx` | Modify | Import + mount `NotificationsProvider`, pass `businessId` |
| `src/hooks/useNotifications.ts` | Modify | Remove `onNewNotification` from public interface (provider uses it internally via ref) |
| `app/[slug]/(app)/dashboard/components/NotificationBell.tsx` | Modify | `useNotifications(businessId)` → `useNotificationsContext()` |
| `app/[slug]/(app)/dashboard/components/NotificationsPreview.tsx` | Modify | `useNotifications(businessId)` → `useNotificationsContext()` |
| `app/[slug]/(app)/dashboard/components/RealtimeToast.tsx` | Modify | Remove `useNotifications` call; use `useNotificationsContext().subscribe` in `useEffect` |
| `app/[slug]/(app)/notifications/NotificationsClient.tsx` | Modify | `useNotifications(businessId)` → `useNotificationsContext()` |
| `src/shared/components/navigation/NavbarNotificationsBadge.tsx` | Modify | `useNotifications(businessId, ...)` → `useNotificationsContext()` |
| `src/features/storage/components/StorageHeader.tsx` | Modify | Remove `useNotifications` call + `onNewNotification` prop; use `useNotificationsContext().subscribe` in `useEffect` for toast |

## Interfaces / Contracts

```typescript
// NotificationsContext.tsx — public API

interface NotificationsContextValue {
  // State (from useNotifications)
  notifications: NotificationWithMeta[];
  unreadCount: number;
  unreadCountByCategory: Record<NotificationCategory, number>;
  isLoading: boolean;
  error: string | null;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  refresh: () => Promise<void>;

  // Pub/sub
  subscribeToNewNotifications: (fn: (notification: Notification) => void) => () => void;
}
```

**subscribeToNewNotifications**: Returns an unsubscribe function. Consumer calls it in `useEffect` cleanup:

```typescript
useEffect(() => {
  return subscribeToNewNotifications((notif) => {
    // handle real-time event
  });
}, [subscribeToNewNotifications]);
```

### Provider internals (pseudocode)

```typescript
const subscribers = useRef(new Set<Function>());

const subscribeToNewNotifications = useCallback((fn) => {
  subscribers.current.add(fn);
  return () => { subscribers.current.delete(fn); };
}, []);

// Internal onNewNotification passed to useNotifications:
const onNewNotification = useCallback((notif) => {
  for (const fn of subscribers.current) fn(notif);
}, []);
```

`useNotifications` is called with `{ businessId, onNewNotification }` internally. The `onNewNotification` ref pattern already in the hook (line 177-180 of current code) means the provider's `onNewNotification` callback doesn't need to be stable across re-renders — it updates via ref.

### BusinessProviders tree placement

```
PermissionsProvider
  └─ BusinessEntitlementsProvider
       └─ NotificationsProvider        ← NEW (inside entitlements, before storage)
            └─ CurrencyProvider
                 └─ CartProvider
                      └─ StorageProvider
                           └─ {children}
```

**Placement**: Inside `BusinessEntitlementsProvider`, wrapping `CurrencyProvider`. Notifications have no dependency on currency/cart/storage. Position after entitlements ensures permissions + entitlements are available if needed. Before storage because StorageHeader consumes notifications.

## Testing Strategy

**Strict TDD** — RED-GREEN-REFACTOR. Runner: `pnpm test:unit` (vitest + jsdom).

| Test | File | What | How |
|------|------|------|-----|
| Provider context shape | `tests/unit/NotificationsContext.test.tsx` | Provider exposes all expected fields | Render `<NotificationsProvider businessId="b1">` with mock `useNotifications`, assert context value has `notifications`, `unreadCount`, `markAsRead`, `subscribeToNewNotifications` |
| Dedup: single fetch | `tests/unit/NotificationsContext.test.tsx` | Two consumers in same provider → 1 fetch | Render provider wrapping 2 `<ConsumerStub>` children, assert `fetch` called once |
| Subscriber add/remove | `tests/unit/NotificationsContext.test.tsx` | Subscribe adds fn, unsubscribe removes it | Subscribe a mock fn, call it, assert called; unsubscribe, call realtime event, assert not called |
| Subscriber dispatch | `tests/unit/NotificationsContext.test.tsx` | Realtime event calls all subscribers | Subscribe 2 fns, trigger realtime, assert both called with same notification |
| Consumer migration: NotificationBell | `tests/unit/NotificationBell.test.tsx` | Works with context | Mock context value, render bell, assert unread badge |
| Consumer migration: RealtimeToast | `tests/unit/RealtimeToast.test.tsx` | Uses subscribe, not hook option | Mock context with subscribe, trigger callback, assert toast appears |

**Mocking pattern** (matches existing `NotificationsClient.test.tsx`):
```typescript
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: vi.fn(),
}));
```

For context tests, render `<NotificationsProvider>` with mocked `useNotifications` return value, then assert via `useContext` or consumer stubs.

## Migration / Rollout

No data migration required. No feature flags. This is a pure code refactor:

1. Create `NotificationsContext.tsx` with tests (RED → GREEN)
2. Mount provider in `BusinessProviders.tsx`
3. Migrate consumers one by one: each migration is a single-file edit (swap import + remove `businessId` prop). Verify with existing tests after each.
4. Remove `onNewNotification` from `useNotifications` public interface after all consumers migrated
5. Run full test suite + `pnpm build` before PR

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Hydration mismatch** | Med | `useNotifications` already `'use client'`. Provider is inside `BusinessProviders` which is already a client boundary. No SSR concern. |
| **Multiple businesses** | Low | Provider is scoped per `BusinessProviders` mount (one per business). No cross-business conflict in current architecture. Document: if multi-business tabs are added later, provider is naturally keyed by mount. |
| **SSR / server components** | Low | Provider is `'use client'` inside a client component tree. No server-side rendering risk. |
| **Memory leak (unsubscribe)** | Med | All subscribers MUST call unsubscribe in `useEffect` cleanup. Enforce in code review + tests. Provider's `Set` removes refs on unsubscribe so GC works. |
| **`onNewNotification` removal from hook** | Low | Audit: only provider and StorageHeader/RealtimeToast use it. All migrate to pub/sub. No external consumers. |
| **Consumer receives stale subscribe fn** | Low | `subscribeToNewNotifications` is wrapped in `useCallback` with `[]` deps (stable ref). Safe for `useEffect` deps. |

## Open Questions

None — all decisions resolved. Design is ready for task breakdown.
