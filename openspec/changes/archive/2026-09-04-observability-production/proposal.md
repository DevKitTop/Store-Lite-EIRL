# Proposal: Observability Production

## Intent

Store Lite ships to production without structured logging, error context, release tracking, or complete analytics events. When things break in multi-tenant production, there's no way to trace errors to a user, business, or deploy. This closes that gap by integrating Sentry context, structured logging, and completing PostHog event coverage — without breaking existing code.

## Scope

### In Scope
- Centralized logger abstraction bridging `console.*` to Sentry Logs (structured)
- Sentry user/business context: `user_id`, `business_id`, `plan` tags
- Sentry release tracking tied to Vercel deploys (commit SHA)
- Sentry alerting rules (Slack channel integration)
- Complete PostHog event taxonomy: signup, business creation, product creation, checkout funnel
- Shared analytics constants module (single source of truth for event names and tags)

### Out of Scope
- PostHog Experiments / A/B testing (insufficient user base)
- Sentry Profiling (no CPU issues observed)
- Sentry AI/Seer (plan-dependent, future)
- Uptime/cron monitoring (no crons detected in codebase)
- Custom dashboards beyond Sentry/PostHog defaults

## Capabilities

### New Capabilities
- `structured-logging`: Logger abstraction with level filtering, Sentry Log bridge, environment-aware formatting
- `sentry-context`: User identification, business context, release tracking, and alert configuration
- `posthog-events`: Complete event capture for signup → business → product → checkout funnel
- `analytics-taxonomy`: Shared constants for event names, tag keys, and property schemas

### Modified Capabilities
None — no existing specs cover observability.

## Approach

ACUPLAR pattern (integrate, don't rewrite):

1. Create `lib/logger.ts` wrapping Sentry `logger.info/debug/warn/error` + console fallback
2. Add Sentry context setters in auth middleware (`setUser`, `setTag`) — zero import changes in pages
3. Wire release tracking via `sentry.client.config.ts` + `NEXT_SENTRY_DSN_RELEASE` env
4. Define PostHog events in `lib/analytics/events.ts` as typed constants; add `capture()` wrappers
5. Instrument 5 key events: `user_signed_up`, `business_created`, `product_created`, `checkout_started`, `payment_completed`
6. Configure Sentry alert rules (Slack) — manual step in Sentry dashboard, documented in proposal

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `sentry.client.config.ts` | Modified | Add release, environment tags |
| `sentry.server.config.ts` | Modified | Add release, context hooks |
| `lib/logger.ts` | New | Structured logger abstraction |
| `lib/analytics/events.ts` | New | Shared event constants |
| `lib/analytics/capture.ts` | New | PostHog capture wrappers with context |
| `src/middleware.ts` | Modified | Inject Sentry user context from session |
| Key page/action files | Modified | Replace `console.*` with logger; add PostHog capture calls |
| `.env.prod` | Modified | Add `NEXT_SENTRY_DSN_RELEASE` variable |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Logger wrapper adds perf overhead | Low | Sentry Logs are async; console fallback is negligible |
| PostHog events leak PII | Low | Audit each event schema; no email/phone in properties |
| Sentry context not set on edge | Medium | Edge runtime has limited Sentry SDK — document gap, handle gracefully |

## Rollback Plan

- Logger: delete `lib/logger.ts`, revert imports to `console.*` (git revert)
- Sentry context: remove context setters in middleware, revert config changes
- PostHog events: remove capture calls, delete event constants file
- All changes are additive — no existing logic is rewritten, full git revert is safe

## Dependencies

- Sentry v10.58.0 (already installed)
- PostHog JS + Node (already installed)
- Sentry workspace access for alert rule configuration (manual step)

## Success Criteria

- [ ] All `console.error`/`console.warn` replaced with structured logger
- [ ] Sentry issues show `user_id`, `business_id`, `plan` on every error
- [ ] Releases visible in Sentry release list after each deploy
- [ ] PostHog funnels show: signup → business → product → checkout → payment
- [ ] Zero PII leakage in PostHog event properties (audited)
