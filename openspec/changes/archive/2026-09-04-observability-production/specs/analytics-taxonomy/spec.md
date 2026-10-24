# Analytics Taxonomy Specification

## Purpose

Provide a single source of truth for event names, tag keys, and property schemas across Sentry and PostHog.

## Requirements

### Requirement: Centralized Constants

The system SHALL export all event names and tag keys from a single module.

#### Scenario: Event name access

- GIVEN a developer needs to use the event "checkout_started"
- WHEN importing from the analytics taxonomy module
- THEN the constant is available as AnalyticsEvents.CHECKOUT_STARTED

#### Scenario: Tag key access

- GIVEN a developer needs to set the tag "business_id"
- WHEN importing from the analytics taxonomy module
- THEN the constant is available as AnalyticsTags.BUSINESS_ID

### Requirement: Type Safety

The system SHALL use TypeScript enums or const objects for compile-time safety.

#### Scenario: Invalid event name

- GIVEN a developer tries to use a non-existent event name
- WHEN TypeScript compiles the code
- THEN a compile-time error is raised

#### Scenario: Valid event usage

- GIVEN a developer uses a valid event constant
- WHEN TypeScript compiles the code
- THEN no errors are raised and the constant resolves to the correct string

### Requirement: Schema Documentation

The system SHALL document property schemas for each event.

#### Scenario: Event with properties

- GIVEN the event "payment_completed" requires order_id and amount
- WHEN a developer reads the taxonomy documentation
- THEN the required properties and their types are clearly documented

#### Scenario: Event without properties

- GIVEN the event "checkout_started" has no required properties
- WHEN a developer reads the taxonomy documentation
- THEN it is documented that no properties are required (optional ones listed)

### Requirement: Cross-Tool Consistency

The system SHALL ensure event names and tag keys are consistent between Sentry and PostHog.

#### Scenario: Same event name

- GIVEN the event "user_signed_up" is defined in taxonomy
- WHEN used in Sentry context and PostHog capture
- THEN the same constant is referenced in both tools

#### Scenario: Tag key reuse

- GIVEN the tag "business_id" is defined in taxonomy
- WHEN used in Sentry tags and PostHog properties
- THEN the same constant is referenced in both contexts