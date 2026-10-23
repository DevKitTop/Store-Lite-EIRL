# Tasks: Observability Production

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 350–450 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Foundation + Core Modules | PR 1 | All new files, tests, sentry configs — additive only |
| 2 | Instrumentation | PR 1 | 5 capture calls in existing routes — minimal edits |

## Phase 1: Foundation (PII Scrubber + Taxonomy)

- [x] 1.1 Create `src/lib/pii-scrubber.ts` — regex-based email/phone scrubber for strings and objects (TDD)
- [x] 1.2 Write tests for `pii-scrubber` — emails, phones, edge cases, nested objects (spec: structured-logging PII Scrubbing)
- [x] 1.3 Create `src/lib/analytics/taxonomy.ts` — `AnalyticsEvents` and `AnalyticsTags` as `const` objects with typed schemas (TDD)
- [x] 1.4 Write tests for `taxonomy` — compile-time safety, constant values, cross-tool consistency (spec: analytics-taxonomy)

## Phase 2: Core Modules (Logger + Sentry Context + Capture)

- [x] 2.1 Create `src/lib/logger.ts` — dual-write logger wrapping `Sentry.logger.*` + console, PII scrubbing, level filter (TDD)
- [x] 2.2 Write tests for `logger` — dual-write, production debug filtering, dev formatting, PII scrubbing integration (spec: structured-logging)
- [x] 2.3 Create `src/lib/sentry-context.ts` — `setSentryContext(user, business)` helper calling `Sentry.setUser()` + `Sentry.setTag()` (TDD)
- [x] 2.4 Write tests for `sentry-context` — authenticated user, unauthenticated, business with/without plan (spec: sentry-context)
- [x] 2.5 Create `src/lib/analytics/context.ts` — `getAnalyticsContext()` reads Supabase session, returns `{ userId, businessId, plan }` (TDD)
- [x] 2.6 Write tests for `analytics/context` — session present, session absent, shape correctness (spec: posthog-events)
- [x] 2.7 Create `src/lib/analytics/capture.ts` — `captureEvent()` wrapper: auto-injects context, PII scrubbing, calls PostHog (TDD)
- [x] 2.8 Write tests for `capture` — with context, without context, PII prevention (spec: posthog-events PII Prevention)

## Phase 3: Sentry Config Updates

- [x] 3.1 Modify `sentry.client.config.ts` — add `release` + `environment` from `NEXT_SENTRY_DSN_RELEASE` env (spec: sentry-context Release Tracking)
- [x] 3.2 Modify `sentry.server.config.ts` — add `release` + `environment` from env
- [x] 3.3 Modify `sentry.edge.config.ts` — add `release` + `environment` from env

## Phase 4: Instrumentation (Funnel Events)

- [x] 4.1 Modify `app/auth/callback/route.ts` — add `captureEvent(AUTH_EVENTS.USER_SIGNED_UP)` after profile sync
- [x] 4.2 Modify `src/features/business/actions/kybActions.ts` — add `captureEvent(AUTH_EVENTS.BUSINESS_CREATED)` in `createVerifiedBusinessAction`
- [x] 4.3 Modify `src/features/storage/actions/products.ts` — add `captureEvent(AUTH_EVENTS.PRODUCT_CREATED)` after insert
- [x] 4.4 Modify `app/api/payment/create-order/route.ts` — add `captureEvent(AUTH_EVENTS.CHECKOUT_STARTED)` after order creation
- [x] 4.5 Modify `app/api/payment/charge/route.ts` — add `captureEvent(AUTH_EVENTS.PAYMENT_COMPLETED)` after successful charge

## Phase 5: Integration Verification

- [x] 5.1 Run full test suite — verify no regressions, all new tests pass
- [x] 5.2 Verify TypeScript compilation — `tsc --noEmit` passes with no new errors
- [x] 5.3 Audit PII safety — grep for `email`, `phone`, `password` in event properties to confirm no leakage
