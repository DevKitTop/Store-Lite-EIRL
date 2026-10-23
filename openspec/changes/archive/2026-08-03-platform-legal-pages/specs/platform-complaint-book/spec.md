# Platform Complaint Book Specification

## Purpose

Platform-level Libro de Reclamaciones at `/libro-reclamaciones` complying with DS 011-2011-PCM / Ley 29571 for the Devkittop platform operator. Reuses the existing ComplaintForm pattern and `complaint_book_records` storage. Copy is neutral professional Spanish (Peru); identifiers in English. Per-store complaint books are out of scope.

## Requirements

### Requirement: Public platform page

The system MUST render `/libro-reclamaciones` as a public, unauthenticated page with an internal complaint form. The page MUST NOT embed or link external forms, Google Drive, or third-party complaint services.

#### Scenario: Public access

- GIVEN any visitor (authenticated or not)
- WHEN they open `/libro-reclamaciones`
- THEN the complaint form renders fully without auth checks

#### Scenario: No external resources

- GIVEN the page loads
- THEN it contains no external form, link, or embed (e.g., Google Drive, third-party forms)

### Requirement: Platform complaint form

The platform form MUST reuse the ComplaintForm pattern without any store-slug dependency and MUST collect the Anexo I fields: consumer names, document type/id, address, phone, email, minor-age guardian data, contract description, optional claimed amount, claim description, and requested action.

#### Scenario: Slug-free form

- GIVEN a visitor opens `/libro-reclamaciones`
- THEN the form renders without requiring or referencing a store slug

#### Scenario: Anexo I fields present

- GIVEN the form renders
- THEN it includes consumer identity, address, contact, contract description, claim description (min 20 chars), and requested-action fields

### Requirement: Platform complaint persistence

Submitted complaints MUST be stored in `complaint_book_records` and remain retrievable for Devkittop. The storage mechanism (seeded platform business row vs. nullable `business_id`/platform flag) is an open design question; this requirement MUST NOT constrain the choice beyond durability and retrievability.

#### Scenario: Complaint saved and retrievable

- GIVEN a visitor submits a valid complaint
- THEN a `complaint_book_records` row is created for the platform business scope
- AND Devkittop can retrieve the record with its ticket number

#### Scenario: Storage-design independence

- GIVEN the design phase picks a storage target
- THEN either approach satisfies this requirement as long as records persist and are retrievable for Devkittop

### Requirement: Validation and abuse protection

The platform form MUST apply the same validation and abuse protections as the per-store form: required-field checks, valid email, claim description 20-2000 characters, guardian required when minor, one complaint per email per 24h, honeypot suppression, and a unique ticket number per record.

#### Scenario: Invalid submission rejected

- GIVEN a visitor submits with missing required fields or an invalid email
- THEN the submission is rejected with field-level messages
- AND no record is created

#### Scenario: Duplicate blocked

- GIVEN the same email already submitted a complaint in the last 24 hours
- WHEN they submit again
- THEN the submission is rejected with a rate-limit message

### Requirement: Submission feedback

On success, the form MUST show the ticket number and the 15-business-day SLA response note with the INDECOPI escalation path; a confirmation-email failure MUST NOT fail the submission.

#### Scenario: Success with ticket

- GIVEN a valid submission succeeds
- THEN the form shows a success state with the ticket number and SLA note
- AND the record is stored even if the confirmation email fails

## Error States

| Error | Behavior |
|-------|----------|
| Submission rejected (validation/rate-limit) | Field-level or message feedback, no record created |
| Store-not-found equivalent (platform scope) | Submission fails with a generic error; no partial record |
| Confirmation email failure | Record persists; success state notes email failure |
