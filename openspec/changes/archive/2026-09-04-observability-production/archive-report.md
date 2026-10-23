# Archive Report: observability-production

**Archived**: 2026-09-04
**Commits**: `4cdb039` (feat(observability)), `9a2e4f8` (fix(observability))
**Verdict**: PASS (verified twice — re-verification after CRITICAL fixes)
**Type**: Production observability integration (Sentry + PostHog, additive only)

## Summary

Closed the production observability gap: structured logging, Sentry error context (user/business/plan/release), and complete PostHog funnel event coverage — all additive, no existing logic rewritten.

- **Logger**: `src/lib/logger.ts` dual-writes to Sentry Logs + console with level filtering and PII scrubbing
- **PII safety**: `src/lib/piiScrubber.ts` strips emails/phones from all logs and event properties
- **Sentry context**: `src/lib/sentryContext.ts` attaches `user_id`, `business_id`, `plan` tags; release tracking wired via `NEXT_SENTRY_DSN_RELEASE` in all 3 Sentry configs
- **Analytics**: `src/lib/analytics/` (taxonomy, context, capture) — typed constants + `captureEvent()` wrapper auto-injecting context
- **Funnel**: 5 events instrumented — `user_signed_up`, `business_created`, `product_created`, `checkout_started`, `payment_completed`

## Results

| Metric | Value |
|--------|-------|
| Tasks total | 23 (14 implementation + 9 test/verification) |
| Tasks complete | 23 |
| CRITICAL fixes applied | 2 (both in `9a2e4f8`) |
| New files created | 6 (`logger.ts`, `piiScrubber.ts`, `sentryContext.ts`, `analytics/{taxonomy,context,capture}.ts`) |
| Files modified | 8 (3 Sentry configs + 5 instrumentation entry points) |
| Tests added | 38 (6 new test files) |
| Unit tests passing | 1153 (107 files) |
| E2E tests passing | 7 |
| Type-check | ✅ Clean (`tsc --noEmit` exit 0) |

## Critical Fixes (commit `9a2e4f8`)

1. **CRITICAL 1 — wrong table/column in analytics context**: `context.ts` queried the wrong tables. Fixed to query `business_team_members` (not `business_members`) and resolve plan from `business_subscriptions.plan_type` with `plan_status='active'` order by `created_at desc`. Confirmed against generated DB types (`database.types.ts` lines 177-189, 233).
2. **CRITICAL 2 — missing Sentry context wiring**: all 5 instrumented entry points now call `setSentryContext()` (callback: user only; kybActions: user only, business intentionally skipped for placeholder 'temp-id'; products: user+business with `entitlements.plan`; create-order: user+business; charge: user+business, guarded by `authUser?.id` for guest checkouts). No dead imports remain.

## Spec Sync

| Domain | Action | Requirements |
|--------|--------|--------------|
| `structured-logging` | Created (new domain) | 4 requirements, 8 scenarios |
| `sentry-context` | Created (new domain) | 4 requirements, 8 scenarios |
| `posthog-events` | Created (new domain) | 4 requirements, 10 scenarios |
| `analytics-taxonomy` | Created (new domain) | 4 requirements, 8 scenarios |

New main specs created in `openspec/specs/` (no prior specs covered observability).

## Decisions Made

- **Logger**: dual-write (Sentry Logs + console) with PII scrubbing and env-based level filtering — rejected console-only and Sentry-only options
- **Sentry context**: helper functions called at entry points, NOT middleware — no `src/middleware.ts` exists; avoids edge-runtime Sentry SDK limitations
- **Capture**: thin wrapper over existing `posthogServer.ts` auto-injecting `user_id`/`business_id`/`plan`
- **Taxonomy**: `as const` objects (not TS enums) — zero runtime cost, full autocomplete
- **Scope**: Sentry Profiling, AI/Seer, Experiments, uptime monitoring explicitly out of scope

## Verdict

✅ PASS — verified twice. No CRITICAL/WARNING issues remaining. Minor pre-existing SUGGESTIONS only (mid-file import + leftover comment in `app/auth/callback/route.ts`, deliberate scope on `setSentryContext` coverage).

## Artifacts (Engram traceability)

| Artifact | Engram Observation |
|----------|-------------------|
| Proposal | see `sdd/observability-production/proposal` |
| Design | see `sdd/observability-production/design` |
| Tasks | see `sdd/observability-production/tasks` |
| Verify Report | #731 (topic `sdd/observability-production/verify-report`, revisions 2) |
| Archive Report | topic `sdd/observability-production/archive-report` (this file) |

## SDD Cycle Complete

This change has been fully planned, implemented, verified, and archived.