# Analytics Consent Specification

## Purpose

Consent infrastructure for Store-Lite's own platform pages: a resettable consent cookie and a Spanish banner that gate all advertising tracking (Meta Pixel and CAPI sends). Reusable beyond Meta, isolated from tenant storefronts and customer auth flows.

## Requirements

### Requirement: Consent State Cookie

The system SHALL persist consent in the `sl_consent_status` cookie with exactly one of `accepted`, `declined`, or `pending`. Absence of the cookie SHALL resolve to `pending`. The cookie SHALL be readable from both client and server code.

#### Scenario: First visit

- GIVEN a visitor with no `sl_consent_status` cookie
- WHEN a platform page is loaded
- THEN consent state resolves to `pending`

#### Scenario: Persisted choice

- GIVEN a visitor who accepted consent
- WHEN a later request reads consent
- THEN the state is `accepted` and the cookie persists across requests

### Requirement: Spanish Consent Banner

The system SHALL render a Spanish-language banner on platform pages when consent is `pending`, offering explicit Accept and Decline actions that set the cookie accordingly. The banner SHALL NOT render for `accepted` or `declined` states.

#### Scenario: Pending shows banner

- GIVEN consent state is `pending` on a platform page
- WHEN the page renders
- THEN the banner appears with Spanish copy and both actions

#### Scenario: Decided hides banner

- GIVEN consent state is `accepted` or `declined`
- WHEN the page renders
- THEN no banner is rendered

### Requirement: Consent Gates Tracking

Tracking SHALL run only when consent is `accepted`. For `declined` or `pending`, the system SHALL NOT load the Meta Pixel nor send CAPI events. The CAPI gate SHALL re-check the cookie server-side; client state alone SHALL NOT authorize sends.

#### Scenario: Accepted allows tracking

- GIVEN consent is `accepted`
- WHEN a platform page loads or a server event fires
- THEN the pixel loads and CAPI sends are permitted

#### Scenario: Declined blocks tracking

- GIVEN consent is `declined`
- WHEN a platform page loads or a server event fires
- THEN no pixel loads and no CAPI event is sent

### Requirement: Resettable Consent

The system SHALL provide a reset control on platform pages that clears the consent cookie to `pending` and re-shows the banner.

#### Scenario: Reset from accepted

- GIVEN a visitor with `accepted` consent
- WHEN they trigger the reset control
- THEN the cookie is cleared, state returns to `pending`, and the banner re-appears

### Requirement: Tenant and Customer Isolation

The banner MUST NOT render on tenant storefront pages (tenant hostnames) or on `/auth/customer`. Consent handling SHALL NOT block, redirect, or alter any user flow or page render.

#### Scenario: Tenant page

- GIVEN a request on a tenant hostname
- WHEN the page renders
- THEN no banner renders and no consent cookie is written

#### Scenario: Customer auth page

- GIVEN a request on `/auth/customer`
- WHEN the page renders
- THEN no banner renders

### Requirement: Consent Unit Tests

The system SHALL include unit tests covering consent cookie logic: read, write, reset, and default-to-pending.

#### Scenario: Cookie logic coverage

- GIVEN the consent cookie module
- WHEN its public functions are exercised
- THEN tests prove `pending` default, accepted/declined round-trip, and reset deletion