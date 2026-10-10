# storefront-public-info Specification

New capability — full spec.

## Purpose

The NOSOTROS view and downloadable `BusinessPreviewCard` expose only a sparse subset of a business's public profile (address, WhatsApp, decorative always-green check). This spec adds presentational display, at the UI layer only, of data already on the full `business` row: real verification state, person/company type, contact methods, social networks.

## Requirements

### R1: Storefront About section renders the full public profile

When the corresponding `business` fields are present, the NOSOTROS view MUST display description, `personType`/`storeType`, email as `mailto:` link, phone as `wa.me` link, social links, and a verification status badge. Missing optional fields MUST NOT render placeholders or empty rows; address/WhatsApp rows MUST keep rendering.

#### Scenario: Fully populated business

- GIVEN a business with description, personType, storeType, email, whatsappNumber, socialLinks and verificationStatus
- WHEN the NOSOTROS view renders
- THEN description, entity type, email link, phone link, social links and status badge appear

#### Scenario: Sparse business

- GIVEN a business missing email, phone and socialLinks
- WHEN the NOSOTROS view renders
- THEN only available fields render, no empty placeholders

### R2: Verification badge reflects the real status

The badge MUST derive from `verificationStatus` (`verified` | `pending` | `unverified` | `rejected`) and MUST NOT show a verified style for any other value.

#### Scenario: Each enum status

- GIVEN statuses "verified", "pending", "unverified", "rejected"
- WHEN the badge renders
- THEN the matching label and style for that status appear

#### Scenario: Unknown status

- GIVEN `verificationStatus` is null/undefined/unknown
- WHEN the badge renders
- THEN it behaves as "unverified"

### R3: Contact and social links open safely in a new tab

Email, phone and social anchors MUST set `target="_blank"` + `rel="noopener noreferrer"`, carry a descriptive `aria-label`, and use inline SVG in the card (no Material ligatures).

#### Scenario: Social link

- GIVEN `socialLinks.instagram = "https://instagram.com/store"`
- WHEN the social row renders
- THEN an anchor to that URL with noopener/noreferrer and a descriptive aria-label renders

#### Scenario: Phone link

- GIVEN a `whatsappNumber` or `legalRepPhone`
- WHEN the phone row renders
- THEN a `wa.me` anchor built from phone digits renders

### R4: Card optional props keep existing callers intact

`BusinessPreviewCard` MUST accept `socialLinks?`, `whatsappNumber?`, `legalRepPhone?`, `verificationStatus?`, `coverImageUrl?` and `storeType?` as optional props. When absent, the card MUST render exactly as today.

#### Scenario: New props supplied

- GIVEN the storefront passes the new optional props
- WHEN the card renders
- THEN a truthful status badge and social row appear

#### Scenario: No new props

- GIVEN settings or create-business callers pass no new props
- WHEN the card renders
- THEN rendering is unchanged (no badge, no social row)

### R5: Dark mode and capture safety

New rows and badges MUST use dark-mode-aware tokens (`isDark` + `var(--md-sys-*)` / `var(--storefront-*)`) per `AboutSection.module.css`, and MUST NOT introduce Material ligature icons in the captured card area.

#### Scenario: Dark scheme

- GIVEN a dark storefront color scheme
- WHEN badge and social rows render
- THEN colors come from dark-safe tokens and remain readable

### R6: Unit test coverage (strict TDD)

Card tests MUST render with mocked `@/core/storefront` and `md-icon` modules and MUST cover the new optional props; the About section's data-derivation logic MUST have business-logic unit tests (jsdom).

#### Scenario: Card with new props

- GIVEN a jsdom test rendering the card with `verificationStatus` and `socialLinks`
- WHEN the test runs
- THEN badge label, anchor attributes and social links are asserted

#### Scenario: Section derivation

- GIVEN business fixtures with and without optional fields
- WHEN the section's derivation logic runs in a unit test
- THEN missing fields yield no rows and present fields yield the expected links

### R7: Owner can download the card PNG from the NOSOTROS section

The NOSOTROS section MUST thread a strict `isOwner` boolean from the page into the embedded `BusinessPreviewCard`, passing it as `showDownloadButton={isOwner}`. The download button MUST be visible ONLY when `isOwner` is true — staff with permissions (`isStaff`) or anonymous visitors MUST NOT see it. The download button MUST carry a descriptive `aria-label`. The capture logic MUST reuse `BusinessPreviewCard`'s existing `handleDownload` (no new capture code).

#### Scenario: Owner views NOSOTROS

- GIVEN `isOwner` is true for the current viewer
- WHEN the NOSOTROS card renders
- THEN the download button appears with a descriptive `aria-label`

#### Scenario: Non-owner staff member views NOSOTROS

- GIVEN a staff member with `isStaff` true but `isOwner` false
- WHEN the NOSOTROS card renders
- THEN the download button MUST NOT appear

#### Scenario: Anonymous customer views NOSOTROS

- GIVEN a non-owner customer with `isOwner` false and no staff membership
- WHEN the NOSOTROS card renders
- THEN the download button MUST NOT appear

### R8: "Cómo llegar?" deep link to Google Maps when a location exists

The NOSOTROS section MUST render an anchor to Google Maps ONLY when `buildGoogleMapsUrl` returns a non-empty string. The pure helper `buildGoogleMapsUrl` MUST join present location parts (`address`, `city`, `departamento`, `provincia`, `distrito`, `country`) and encode them with `encodeURIComponent` into `https://www.google.com/maps/search/?api=1&query=<encoded>`. The anchor MUST open in a new tab (`target="_blank"`, `rel="noopener noreferrer"`). If NO location part exists, the helper MUST return an empty string and the section MUST render no Maps link. No lat/lng, coordinates, API key, or new DB field is used.

#### Scenario: Full location present

- GIVEN a business with `address`, `city`, and `country`
- WHEN the NOSOTROS section renders
- THEN a "Cómo llegar?" anchor to the encoded Google Maps search URL appears in a new tab

#### Scenario: Sparse business (no location)

- GIVEN a business with all location parts null/empty
- WHEN `buildGoogleMapsUrl` runs
- THEN it returns an empty string and the section renders no Maps link

#### Scenario: buildGoogleMapsUrl with partial location

- GIVEN a business with only `city` and `provincia` present
- WHEN `buildGoogleMapsUrl` runs
- THEN it returns a URL containing those parts URL-encoded

#### Scenario: buildGoogleMapsUrl with no parts

- GIVEN a business with all location parts missing
- WHEN `buildGoogleMapsUrl` runs
- THEN it returns an empty string

## Out of Scope

- Schema, migrations, queries or server actions (the business row already provides all fields)
- `StorefrontProductGridSection` (product grid/search)
- Reactivating orphaned `AboutSection.tsx` (CSS patterns copied only)
- Changing the settings or create-business `BusinessPreview.tsx` callers
- `LocationMap.tsx` iframe embed (not the deep-link anchor)
- Changing the `isStaff`-gated `showDownloadButton` used by other storefront sections (only the NOSOTROS card is re-gated to strict `isOwner`)
