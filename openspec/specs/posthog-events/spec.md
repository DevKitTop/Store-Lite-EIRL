# PostHog Events Specification

## Purpose

Complete event capture for signup → business → product → checkout → payment funnel with typed constants.

## Requirements

### Requirement: Event Taxonomy

The system SHALL define typed event constants for key user actions.

#### Scenario: Event constant defined

- GIVEN a new event type "business_created" is needed
- WHEN the event constant is added to the taxonomy module
- THEN it is exported as a typed constant with name and property schema

#### Scenario: Duplicate event prevention

- GIVEN an event constant "user_signed_up" already exists
- WHEN attempting to add another constant with same name
- THEN a TypeScript compile error is raised

### Requirement: Capture Wrappers

The system SHALL provide capture functions that attach common context (user_id, business_id, plan) to events.

#### Scenario: Capture with context

- GIVEN a user is logged in with business context
- WHEN captureEvent("product_created", { productName: "Shirt" }) is called
- THEN PostHog receives event with properties: user_id, business_id, plan, productName

#### Scenario: Capture without context

- GIVEN no user session exists
- WHEN captureEvent("checkout_started") is called
- THEN PostHog receives event with properties: timestamp only
- AND no user_id or business_id properties are sent

### Requirement: Funnel Events

The system MUST capture the following events in sequence: user_signed_up, business_created, product_created, checkout_started, payment_completed.

#### Scenario: Signup event

- GIVEN a new user completes registration
- WHEN the signup action is processed
- THEN PostHog receives event "user_signed_up" with user_id property

#### Scenario: Business creation event

- GIVEN a user creates a new business
- WHEN the business creation action is processed
- THEN PostHog receives event "business_created" with business_id property

#### Scenario: Product creation event

- GIVEN a business owner adds a product
- WHEN the product creation action is processed
- THEN PostHog receives event "product_created" with product_id property

#### Scenario: Checkout start event

- GIVEN a customer initiates checkout
- WHEN the checkout process begins
- THEN PostHog receives event "checkout_started" with cart_total property

#### Scenario: Payment completion event

- GIVEN a customer completes payment
- WHEN the payment is confirmed
- THEN PostHog receives event "payment_completed" with order_id and amount property

### Requirement: PII Prevention

The system MUST NOT include PII in event properties.

#### Scenario: Email in event

- GIVEN a captureEvent call includes email property
- WHEN the event is sent to PostHog
- THEN the email property is omitted or hashed

#### Scenario: Phone in event

- GIVEN a captureEvent call includes phone property
- WHEN the event is sent to PostHog
- THEN the phone property is omitted or masked
