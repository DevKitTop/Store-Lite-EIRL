# Sentry Context Specification

## Purpose

Attach user identification, business context, and release tracking to Sentry events for multi-tenant error tracing.

## Requirements

### Requirement: User Identification

The system MUST attach user_id to Sentry events when a user session exists.

#### Scenario: Authenticated user error

- GIVEN a user is logged in with session containing user_id
- WHEN an error occurs and is captured by Sentry
- THEN the Sentry event includes user_id in the user context

#### Scenario: Unauthenticated error

- GIVEN no user session exists
- WHEN an error occurs and is captured by Sentry
- THEN the Sentry event does not include user context
- AND no error is thrown

### Requirement: Business Context

The system MUST attach business_id and plan tags to Sentry events when business context is available.

#### Scenario: Business error with plan

- GIVEN a user belongs to business "biz_123" on plan "pro"
- WHEN an error occurs and is captured by Sentry
- THEN the Sentry event includes tag business_id=biz_123
- AND includes tag plan=pro

#### Scenario: Business error without plan

- GIVEN a user belongs to business "biz_456" with no plan assigned
- WHEN an error occurs and is captured by Sentry
- THEN the Sentry event includes tag business_id=biz_456
- AND tag plan is omitted or set to "none"

### Requirement: Release Tracking

The system MUST include release version (commit SHA) in Sentry events.

#### Scenario: Deploy with release

- GIVEN environment variable NEXT_SENTRY_DSN_RELEASE is set to commit SHA
- WHEN Sentry initializes
- THEN all subsequent events include release tag with the commit SHA

#### Scenario: Missing release env

- GIVEN environment variable NEXT_SENTRY_DSN_RELEASE is not set
- WHEN Sentry initializes
- THEN events are captured without release tag
- AND a warning is logged to console

### Requirement: Alert Configuration

The system SHOULD support Slack alert rules for error thresholds.

#### Scenario: Alert rule exists

- GIVEN Sentry workspace has a Slack alert rule for error threshold
- WHEN error count exceeds threshold in 1 hour
- THEN a Slack notification is sent to configured channel

#### Scenario: No alert rule

- GIVEN Sentry workspace has no Slack alert rules
- WHEN errors occur
- THEN events are captured normally without notifications
