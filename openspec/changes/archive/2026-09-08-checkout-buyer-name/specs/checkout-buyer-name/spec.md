# Checkout Buyer Name Specification

## Purpose

Ensure every Culqi charge/order receives a buyer `last_name` (fixing the "first_last_name" placeholder in the Culqi panel) through three independent layers: Google full-name prefill, a two-word buyer-name validation with an inline Spanish error, and single-token normalization in the shared `splitFullName` helper.

## Requirements

### R1: Google Full Name Prefill

When a Google customer session exists, the checkout MUST prefill the "Nombre completo" input with the user's full name (`user_metadata.full_name`) when the field is empty. The buyer MUST be able to edit the prefilled value.

#### Scenario: Authed checkout prefills full name

- GIVEN a Google customer session with `full_name: "Ernesto Pérez"` and an empty name field
- WHEN the checkout renders
- THEN "Nombre completo" MUST show "Ernesto Pérez"
- AND the buyer MUST be able to edit it

#### Scenario: Session without full name

- GIVEN a Google customer session with no `full_name`
- WHEN the checkout renders
- THEN the name field MUST remain empty
- AND no error MUST be shown

### R2: Two-Word Buyer Name Validation

The "Nombre completo" input MUST be valid only when the trimmed value contains at least two whitespace-separated words composed of Spanish letters (`a-zA-ZáéíóúÁÉÍÓÚñÑüÜ`). When the input is non-empty and invalid, the system MUST show the inline Spanish error "Ingresá tu nombre y apellido" and MUST NOT open Culqi. The shared payment guard (`useCheckoutPayment`) MUST enforce the same rule before opening Culqi.

#### Scenario: Valid two-word name

- GIVEN the input "Juan Perez"
- WHEN the buyer submits payment
- THEN no inline name error MUST be shown
- AND Culqi MAY open

#### Scenario: Single-token name blocked

- GIVEN the input "Ernesto"
- WHEN the buyer submits payment
- THEN the inline error "Ingresá tu nombre y apellido" MUST be shown
- AND Culqi MUST NOT open

#### Scenario: Empty input behavior

- GIVEN the input is empty
- WHEN the buyer submits payment
- THEN the two-word inline error MUST NOT be shown
- AND the existing empty-field handling MUST apply unchanged

### R3: Server-Side Validation

Both `chargeRequestSchema` and `createOrderRequestSchema` MUST refine the optional `customerName` so that, when present, it contains at least two words matching the Spanish-letters pattern. The field MUST remain optional: an absent `customerName` MUST validate successfully.

#### Scenario: Two-word name accepted

- GIVEN `customerName: "Juan Perez"` in the request body
- WHEN the route schema validates
- THEN the request MUST validate successfully

#### Scenario: Single-token name rejected

- GIVEN `customerName: "Ernesto"` in the request body
- WHEN the route schema validates
- THEN the request MUST be rejected with a Zod validation error (HTTP 400)

#### Scenario: Absent name accepted

- GIVEN a request without `customerName`
- WHEN the route schema validates
- THEN the request MUST validate successfully

### R4: Single-Token Normalization

`splitFullName` MUST return `{ first_name: name, last_name: name }` for a single-token non-empty name, MUST return `{}` for empty/null/undefined input, and MUST keep multi-token behavior unchanged (first token → `first_name`, remainder → `last_name`).

#### Scenario: Single token duplicated

- GIVEN `splitFullName("ernesto")`
- THEN it MUST return `{ first_name: "ernesto", last_name: "ernesto" }`

#### Scenario: Empty name preserved

- GIVEN `splitFullName("")`, `splitFullName(null)`, or `splitFullName(undefined)`
- THEN it MUST return `{}`

#### Scenario: Multi-token name unchanged

- GIVEN `splitFullName("Juan Carlos Perez")`
- THEN it MUST return `{ first_name: "Juan", last_name: "Carlos Perez" }`

### R5: Test Expectations (Strict TDD — RED First)

The unit suite MUST first express the new behavior as failing tests (RED), then implement. `tests/unit/fullName.test.ts` MUST update the single-token expectation to the duplication behavior. `tests/unit/chargeRoute.test.ts` MUST preserve the empty-name `{}` case and MUST remain green. New unit tests MUST cover the two-word validation rule and the prefill logic, following the conventions of `tests/unit/Checkout.test.tsx` and `tests/unit/fullName.test.ts`.

#### Scenario: fullName single-token RED

- GIVEN `fullName.test.ts` currently asserts `{ first_name: "Juan" }` for a single token
- WHEN the suite runs before implementation
- THEN the single-token case MUST fail (RED)
- AND after implementation it MUST pass with the duplication assertion

#### Scenario: chargeRoute empty-name stays green

- GIVEN a charge request without `customerName`
- WHEN `antifraud_details` is built
- THEN `first_name`/`last_name` keys MUST be omitted
- AND the existing `chargeRoute.test.ts` case MUST remain green

## Rollback Plan

Each layer is independently revertible: (1) remove the `setCustomerName` prefill call; (2) relax the two-word validator; (3) remove the zod refine; (4) revert the single-token branch in `fullName.ts`. No data migration involved.