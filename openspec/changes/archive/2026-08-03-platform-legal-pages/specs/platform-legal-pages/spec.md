# Platform Legal Pages Specification

## Purpose

Public legal compliance for the Store.Lite SaaS site: a `/devoluciones` refund policy page, footer contact/link updates, and Términos fixes stating the manual monthly billing model and the true legal identity (MAMANI TACORA ERNESTO ALONSO, RUC 10741399852, persona natural con negocio). Required for Culqi production validation. Page copy is neutral professional Spanish (Peru); identifiers in English. Seller-store legal pages are out of scope.

## Requirements

### Requirement: Refund policy page

The system MUST render a static page at `/devoluciones` stating the refund policy in neutral professional Spanish: a 7-calendar-day refund window per plan payment; no refund when the customer made sales or used any plan feature/service within the window (service consumed); refunds issued via the same payment method used (Culqi reversal); plans are paid manually each month with no auto-renewal; refund requests are manual via WhatsApp only (`wa.me/958119418`).

#### Scenario: Policy elements rendered

- GIVEN a visitor opens `/devoluciones`
- THEN the page states the 7-calendar-day window per plan payment, the no-refund-when-service-consumed exclusion, same-payment-method refund, manual monthly payment without auto-renewal, and the WhatsApp-only request channel

#### Scenario: WhatsApp-only contact

- GIVEN a visitor reads `/devoluciones`
- THEN the only refund channel shown is the WhatsApp link `wa.me/958119418`
- AND the page MUST NOT contain an email address, phone number, or refund request form

### Requirement: Refund page presentation

The system MUST render `/devoluciones` as a server-rendered page mirroring the structure of `/terminos` and `/privacidad`, with indexable metadata.

#### Scenario: Renders like sibling legal pages

- GIVEN a visitor navigates to `/devoluciones`
- THEN the page uses the same legal-page layout/styling as `/terminos`
- AND it is statically indexable with a descriptive title and description

### Requirement: Footer legal links

The platform footer MUST point "Política de reembolsos" to `/devoluciones` and MUST add a "Libro de Reclamaciones" link to `/libro-reclamaciones`.

#### Scenario: Refund link resolves

- GIVEN the footer renders
- THEN "Política de reembolsos" links to `/devoluciones` (not `#`)

#### Scenario: Complaint book link present

- GIVEN the footer renders
- THEN it includes "Libro de Reclamaciones" linking to `/libro-reclamaciones`

### Requirement: Footer contact details

The platform footer MUST display phone 958 119 418 and address "Arequipa, Arequipa, Ciudad de Dios"; the general-contact email devkittopsac@gmail.com MUST remain.

#### Scenario: Updated contact block

- GIVEN the footer renders
- THEN the phone shown is 958 119 418 and the address line reads "Arequipa, Arequipa, Ciudad de Dios"
- AND the email devkittopsac@gmail.com remains as general contact

### Requirement: Manual monthly payment terms

The Términos page MUST state that plans are paid manually each month and MUST NOT claim automatic renewal.

#### Scenario: No auto-renewal claim

- GIVEN a visitor reads the "Planes y pagos" section of `/terminos`
- THEN it states payments are made manually each month with no recurring charge
- AND the sentence "Las suscripciones se renuevan automáticamente salvo cancelación previa" is absent

### Requirement: Legal identity disclosure

Platform legal pages MUST identify the provider as MAMANI TACORA ERNESTO ALONSO, RUC 10741399852, persona natural con negocio; MUST NOT use the "SAC" form; the brand Devkittop MUST be retained.

#### Scenario: SAC references removed

- GIVEN a visitor reads `/terminos`
- THEN every "Devkittop SAC" reference is replaced with the legal identity name and RUC
- AND the page never claims a "SAC" legal form

## Out of Scope

- Seller-store legal pages (`/{slug}/terminos`, `/{slug}/devoluciones`).
- Recurring billing / auto-charge implementation.
