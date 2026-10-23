# Design: Observability Production

## Technical Approach

Integrate structured logging, Sentry context, PostHog funnel events, and a shared analytics taxonomy using the ACUPLAR pattern — new files + additive imports only. No existing files are deleted; only the 3 Sentry configs and the 5 instrumentation entry points receive minimal additive changes.

## Architecture Decisions

### Decision: Logger bridges Sentry Logs + console with PII scrubbing

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `console.*` replacement only | No Sentry integration, no structured data | Rejected |
| Sentry-only (no console) | Loses local dev visibility | Rejected |
| Dual-write (Sentry Logs + console) | Slight overhead, full visibility | **Chosen** |

**Rationale**: Sentry server config already has `enableLogs: true`. The logger calls `Sentry.logger.info/warn/error/debug` and mirrors to console. PII scrubbing regex strips emails/phones before any output. Level filtering: `debug` dropped in production.

### Decision: Sentry context via helper functions, not middleware

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `src/middleware.ts` (edge) | Edge runtime has limited Sentry SDK — context setters may not propagate | Rejected |
| Helper functions called from server actions/API routes | Each call site sets context explicitly — more imports, zero edge risk | **Chosen** |

**Rationale**: No `src/middleware.ts` exists in this project. Adding one just for Sentry context risks breaking the existing auth flow. Instead, `setSentryContext(user, business)` is called at the top of server actions and API routes that already have session access.

### Decision: PostHog capture via thin wrapper over existing `posthogServer.ts`

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Direct `posthog.capture()` calls | No context injection, easy to forget `distinct_id` | Rejected |
| Wrapper `captureEvent()` auto-injects `user_id`, `business_id`, `plan` | Single import, consistent context | **Chosen** |

**Rationale**: `getPostHogClient()` already handles server-side PostHog. The wrapper calls `client.capture({ distinct_id, event, properties })` with context from a `getAnalyticsContext()` helper that reads the current Supabase session.

### Decision: Taxonomy as `as const` objects, not enums

**Choice**: `AnalyticsEvents` and `AnalyticsTags` as `const` objects with TypeScript string literal types.
**Alternatives considered**: TypeScript enums (tree-shaking issues, extra runtime code).
**Rationale**: Follows modern TS patterns, zero runtime cost, full autocomplete.

## Data Flow

```
Server Action / API Route
  ├── getAnalyticsContext() ──→ { userId, businessId, plan }
  ├── captureEvent("event_name", { extra }) ──→ PostHog (server)
  └── logger.info("event", { ctx }) ──→ Sentry Logs + console
        │
        └── PII scrubber strips emails/phones before output

Sentry Error Capture (automatic)
  └── setSentryContext(user, business) ──→ Sentry tags: user_id, business_id, plan
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/logger.ts` | **Create** | Structured logger: wraps `Sentry.logger.*` + console. PII scrubbing. Level filter. |
| `src/lib/analytics/taxonomy.ts` | **Create** | `AnalyticsEvents`, `AnalyticsTags` const objects. Event property type definitions. |
| `src/lib/analytics/capture.ts` | **Create** | `captureEvent()` wrapper: auto-injects context, calls PostHog server client. |
| `src/lib/analytics/context.ts` | **Create** | `getAnalyticsContext()`: reads Supabase session, returns `{ userId, businessId, plan }`. |
| `src/lib/sentry-context.ts` | **Create** | `setSentryContext(user, business)`: calls `Sentry.setUser()`, `Sentry.setTag()`. |
| `src/lib/pii-scrubber.ts` | **Create** | `scrubPII(text, data)`: regex-based email/phone removal for logs and events. |
| `sentry.client.config.ts` | **Modify** | Add `release` and `environment` from `NEXT_SENTRY_DSN_RELEASE` env. |
| `sentry.server.config.ts` | **Modify** | Add `release` and `environment` from env. |
| `sentry.edge.config.ts` | **Modify** | Add `release` and `environment` from env. |
| `app/auth/callback/route.ts` | **Modify** | Add `captureEvent(AUTH_EVENTS.USER_SIGNED_UP)` after successful profile sync. |
| `src/features/business/actions/kybActions.ts` | **Modify** | Add `captureEvent(AUTH_EVENTS.BUSINESS_CREATED)` in `createVerifiedBusinessAction`. |
| `src/features/storage/actions/products.ts` | **Modify** | Add `captureEvent(AUTH_EVENTS.PRODUCT_CREATED)` in `createProduct` after insert. |
| `app/api/payment/create-order/route.ts` | **Modify** | Add `captureEvent(AUTH_EVENTS.CHECKOUT_STARTED)` after order creation. |
| `app/api/payment/charge/route.ts` | **Modify** | Add `captureEvent(AUTH_EVENTS.PAYMENT_COMPLETED)` after successful charge. |

## Interfaces / Contracts

```typescript
// src/lib/logger.ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}
export const logger: Logger;

// src/lib/analytics/taxonomy.ts
export const AnalyticsEvents = {
  USER_SIGNED_UP: 'user_signed_up',
  BUSINESS_CREATED: 'business_created',
  PRODUCT_CREATED: 'product_created',
  CHECKOUT_STARTED: 'checkout_started',
  PAYMENT_COMPLETED: 'payment_completed',
} as const;

export const AnalyticsTags = {
  USER_ID: 'user_id',
  BUSINESS_ID: 'business_id',
  PLAN: 'plan',
} as const;

// src/lib/analytics/context.ts
interface AnalyticsContext {
  userId: string | null;
  businessId: string | null;
  plan: string;
}
export async function getAnalyticsContext(): Promise<AnalyticsContext>;

// src/lib/analytics/capture.ts
export function captureEvent(
  event: (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents],
  properties?: Record<string, unknown>,
): void;

// src/lib/sentry-context.ts
export function setSentryContext(
  user: { id: string; email?: string },
  business?: { id: string; plan?: string },
): void;
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | PII scrubber regex patterns | Vitest: emails, phones, edge cases |
| Unit | Logger level filtering per env | Vitest: mock Sentry, assert console calls |
| Unit | Taxonomy constants compile-time safety | TypeScript: invalid key = compile error |
| Unit | `captureEvent` calls PostHog with correct shape | Vitest: mock PostHog client |
| Unit | `getAnalyticsContext` returns correct shape | Vitest: mock Supabase session |
| Integration | `setSentryContext` sets tags correctly | Vitest: mock Sentry, verify setUser/setTag |

## Migration / Rollout

No data migration. Deploy with existing Sentry/PostHog accounts. Release tracking starts working immediately after env var `NEXT_SENTRY_DSN_RELEASE` is set in Vercel. Logger replacement is opt-in per file — can migrate `console.*` calls incrementally.

## Open Questions

- [ ] Should `NEXT_SENTRY_DSN_RELEASE` be set automatically by Vercel build, or manually in dashboard?
- [ ] For the 5 instrumentation points, should capture calls be fire-and-forget (current design) or await PostHog flush?
