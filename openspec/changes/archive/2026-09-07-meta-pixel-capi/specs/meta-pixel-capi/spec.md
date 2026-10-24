# Meta Pixel + CAPI Specification

## Purpose

Client-side Meta Pixel and server-side Conversions API (CAPI) tracking for platform-owned pages only, deduplicated via a shared `event_id`, consent-gated, with hashed PII and zero impact on tenant storefronts or purchase flows.

## Requirements

### Requirement: Platform-Only Mounting

The tracking mount SHALL render only on platform-owned pages: hostname MUST match the platform allowlist AND path MUST match the path allowlist. Tenant hostnames and `/auth/customer` SHALL be excluded.

#### Scenario: Allowed platform page

- GIVEN a platform hostname on an allowed path
- WHEN the layout renders
- THEN tracking infrastructure mounts

#### Scenario: Tenant hostname excluded

- GIVEN a tenant hostname
- WHEN the layout renders
- THEN no tracking mounts

#### Scenario: Customer auth excluded

- GIVEN a platform hostname with path `/auth/customer`
- WHEN the layout renders
- THEN no tracking mounts

### Requirement: Pixel Loading

When consent is `accepted`, the system SHALL load the Meta Pixel via `next/script` with `afterInteractive` strategy, initialized with `NEXT_PUBLIC_META_PIXEL_ID`. When consent is not `accepted`, the pixel SHALL NOT load.

#### Scenario: Consent accepted

- GIVEN consent `accepted` on a platform page
- WHEN the page loads
- THEN the pixel script loads after interactive with the configured Pixel ID

#### Scenario: Consent declined

- GIVEN consent `declined`
- WHEN the page loads
- THEN no pixel script is injected

### Requirement: Server-Only CAPI Client

The system SHALL send CAPI events from server code only via `fetch` to `graph.facebook.com/{version}/{pixel_id}/events`, fire-and-forget with `Promise.allSettled`, ~10s timeout, and best-effort retry. The system MUST NOT expose a public client-to-CAPI relay route, and CAPI SHALL never block, redirect, or delay the originating request.

#### Scenario: Send is non-blocking

- GIVEN a server event fires (e.g., Purchase)
- WHEN the CAPI request is dispatched
- THEN the originating request continues without awaiting the send

#### Scenario: CAPI failure tolerated

- GIVEN the Graph API times out or returns an error
- WHEN the CAPI send resolves
- THEN the failure is swallowed and the user flow is unaffected

#### Scenario: No relay route

- GIVEN a client-side caller attempting to trigger CAPI
- WHEN the application routes are enumerated
- THEN no public endpoint exists for CAPI

### Requirement: PII Normalization and Hashing

The system SHALL hash PII with SHA-256. Emails SHALL be lowercased and trimmed before hashing; phones SHALL be reduced to digits plus country code before hashing. Only hashes SHALL be sent to Meta — never raw PII.

#### Scenario: Email normalization

- GIVEN the email `" User@Example.COM "`
- WHEN preparing the event payload
- THEN `user@example.com` is hashed and the hash is sent

#### Scenario: Phone normalization

- GIVEN the phone `+51 (987) 654-3210`
- WHEN preparing the event payload
- THEN `519876543210` is hashed and the hash is sent

### Requirement: Event Payload and Deduplication

Every CAPI payload SHALL include `action_source: 'website'`, `event_source_url`, `client_ip_address` and `client_user_agent` from the request headers, and `fbp`/`_fbc` cookies when present. When `_fbc` is absent but `fbclid` is present, `fbc` SHALL be synthesized from `fbclid`. Client pixel and server CAPI SHALL share the same `event_id`; for Purchase the server SHALL generate the `event_id` and return it in the JSON response for the client to reuse (Meta dedup window: 48h).

#### Scenario: Request-derived fields

- GIVEN a request with headers and `fbp`/`_fbc` cookies
- WHEN a CAPI event is built
- THEN the payload carries website action source, event URL, client IP/UA, and both cookies

#### Scenario: fbc synthesized from fbclid

- GIVEN no `_fbc` cookie but a `fbclid` query parameter
- WHEN the event payload is built
- THEN `fbc` is synthesized as `fb.1.<timestamp>.<fbclid>`

#### Scenario: Purchase dedup

- GIVEN a purchase completes
- WHEN the server sends Purchase via CAPI and the client fires `fbq` Purchase
- THEN both use the identical `event_id` returned in the purchase response

### Requirement: Event Catalog

The system SHALL fire exactly: `PageView` on platform pages; `ViewContent` on `/pricing`; `InitiateCheckout` when a plan is selected; `Purchase` from the purchase-plan route with `email`, `totalSoles`, `currency: PEN`, and `planType`.

#### Scenario: Purchase properties

- GIVEN a purchase-plan request with email, total in soles, PEN currency, and plan type
- WHEN the Purchase event fires
- THEN those properties are included in the CAPI payload

#### Scenario: Funnel events

- GIVEN a visitor browsing platform pages and pricing
- WHEN pages render and a plan is selected
- THEN PageView, ViewContent, and InitiateCheckout fire on their respective triggers only

### Requirement: CSP and Environment Configuration

The system SHALL allow `connect.facebook.net` in `script-src` and `www.facebook.com` in `connect-src` of the CSP in `next.config.ts`. Configuration SHALL use `NEXT_PUBLIC_META_PIXEL_ID`, server-only `META_CAPI_ACCESS_TOKEN`, and optional `META_TEST_EVENT_CODE`, following `src/config/env.ts` validation (warn, never crash).

#### Scenario: Missing env warnings

- GIVEN the token or pixel ID is not configured
- WHEN the app initializes
- THEN a console warning is emitted and the app continues

#### Scenario: CSP directives present

- GIVEN the production CSP
- WHEN a platform page loads the pixel
- THEN `connect.facebook.net` and `www.facebook.com` are permitted

### Requirement: Required Unit Tests

The system SHALL include unit tests for PII hashing/normalization, the event payload builder, the tenant-guard allowlist, and shareable `event_id` generation, following existing patterns (`src/lib/analytics/__tests__`, `tests/unit` with `vi.mock` and dynamic route import).

#### Scenario: Test coverage

- GIVEN the tracking modules under test
- WHEN the unit suite runs
- THEN hash, payload, allowlist, and `event_id` tests pass