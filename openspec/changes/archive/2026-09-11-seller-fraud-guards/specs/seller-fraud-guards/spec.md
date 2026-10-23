# Seller Fraud Guards Specification

## Purpose

Server-side mutation guards that freeze buyer-facing identity and product title/price fields once a business or product has SUCCESSFUL (confirmed) or PENDING (in-progress) payment history, plus zod field validation for the canonical `updateBusinessData` action and a UI mirror of locked fields. Guards are authoritative server-side; UI disabling is a UX mirror only.

## Requirements

### Requirement: Locked state definition

A business or product is "locked" when it has at least one payment with status SUCCESSFUL (confirmed) or PENDING (in-progress, e.g. payment initiated but not finalized). Payments in failed or abandoned status MUST NOT count toward the locked state — a transaction that never materialized must not freeze anything.

#### Scenario: Business with confirmed or in-progress payment is locked

- GIVEN a business with at least one SUCCESSFUL or PENDING payment
- THEN the business is locked and identity fields are frozen

#### Scenario: Only failed or abandoned payments does not lock

- GIVEN a business (or product) with only failed or abandoned payments
- THEN the business (or product) is NOT locked and all fields remain editable

### Requirement: Business data validation (T1)

The canonical `updateBusinessData` action MUST validate every accepted field through a zod schema before any DB write. The schema MUST enforce field-level constraints, including taxId/RUC format (11-20 alphanumeric characters), and return clear errors when validation fails.

#### Scenario: Invalid taxId format rejected

- GIVEN an `updateBusinessData` call with a malformed taxId
- WHEN the action validates the payload
- THEN the action returns a clear validation error and performs no DB write

#### Scenario: Valid payload accepted

- GIVEN an `updateBusinessData` call with valid fields
- THEN the action performs the update

### Requirement: Business identity guard (T2)

When a business is locked, `updateBusinessData` MUST reject changes to identity fields: businessName, taxId (RUC), legalRep fields, address/city, and slug/URL. Cosmetic fields — logo, cover, description, and contact info — MUST remain editable regardless of locked state. The error MUST clearly indicate that the field is frozen due to payment history.

#### Scenario: Unlocked business edits identity

- GIVEN an unlocked business
- WHEN the owner changes businessName, taxId, legalRep, or address
- THEN the update succeeds

#### Scenario: Locked business identity edit rejected

- GIVEN a locked business
- WHEN the owner changes businessName (or taxId, legalRep, address/city)
- THEN the action rejects with a clear frozen-field error and performs no DB write

#### Scenario: Locked business cosmetic edit allowed

- GIVEN a locked business
- WHEN the owner changes logo, cover, description, or contact info only
- THEN the update succeeds

### Requirement: Slug guard (T2)

When a business is locked, `updateBusinessSlug` MUST reject slug changes and return the same clear frozen-field error.

#### Scenario: Unlocked slug change allowed

- GIVEN an unlocked business
- WHEN the owner submits a new slug
- THEN the slug update succeeds

#### Scenario: Locked slug change rejected

- GIVEN a locked business
- WHEN the owner submits a new slug
- THEN the action rejects with a clear error and keeps the current slug

### Requirement: Product guard (T3)

When a product is locked, `updateProduct` MUST reject changes to title and price (including second price). Stock, images, description, and availability MUST remain editable regardless of locked state.

#### Scenario: Unlocked product title/price edit allowed

- GIVEN a product with no SUCCESSFUL or PENDING payments
- WHEN the owner changes title or price
- THEN the update succeeds

#### Scenario: Locked product title/price rejected

- GIVEN a product with at least one SUCCESSFUL or PENDING payment
- WHEN the owner changes title or price
- THEN the action rejects with a clear frozen-field error

#### Scenario: Locked product operational edit allowed

- GIVEN a locked product
- WHEN the owner changes stock, images, description, or availability
- THEN the update succeeds

### Requirement: UI mirror (T4)

When a business or product is locked, the UI MUST disable the corresponding inputs (businessName, city, legalRepRole, slug, product title/price/secondPrice) and display a notice explaining the freeze. The UI mirror is not a security control: the server-side guards remain authoritative.

#### Scenario: Locked fields disabled with notice

- GIVEN a locked business or product
- THEN settings and product editor render the affected inputs disabled with a visible notice

#### Scenario: Crafted request bypass rejected

- GIVEN a locked business or product
- WHEN a client sends a direct request changing a frozen field, bypassing the disabled UI
- THEN the server action rejects the change