# Auth Consent Specification

## Purpose

Define the consent checkbox requirement for authentication flows. An unchecked-by-default checkbox gates the Google OAuth button. Working links to Terms of Service (`/terminos`) and Privacy Policy (`/privacidad`) replace the current non-functional `<span>` elements. The footer legal links also point to real pages.

**Terms of Service page**: A static server component at `/(main)/terminos` (new) provides SaaS-level generic terms. Store-specific terms are out of scope.

## Requirements

### R1: Consent Checkbox — Unchecked Default

The consent checkbox MUST render unchecked on initial page load. The checkbox MUST be required before the Google OAuth button becomes enabled. Pre-checked state MUST NOT occur under any condition (per anti-dark-pattern rules of Peruvian DL 1729).

#### Scenario: Checkbox is unchecked on load

- GIVEN a user navigates to `/auth`
- WHEN the auth page finishes rendering
- THEN a consent checkbox is displayed
- AND the checkbox is unchecked

#### Scenario: Google button disabled when unchecked

- GIVEN the consent checkbox is unchecked
- WHEN the user inspects the Google OAuth button
- THEN the button has `disabled` attribute
- AND clicking the button does not trigger `signInWithGoogle()`

#### Scenario: Google button enables after check

- GIVEN the consent checkbox is unchecked
- WHEN the user checks the checkbox
- THEN the Google OAuth button becomes enabled
- AND clicking the button triggers `signInWithGoogle()`

### R2: Working Legal Links

The consent label MUST contain `<Link>` components pointing to valid routes: `/privacidad` and `/terminos`. These MUST replace the current `<span>` elements.

#### Scenario: Links navigate to real pages

- GIVEN the auth page is rendered
- WHEN the user clicks "Privacy Policy" in the consent label
- THEN the browser navigates to `/privacidad`
- WHEN the user clicks "Terms of Service"
- THEN the browser navigates to `/terminos`

### R3: Customer Auth Popup — Store-Specific Wording

The consent checkbox on `/auth/customer` MUST use wording that includes the store name from the `name` query parameter. The Google OAuth button MUST remain disabled until the checkbox is checked.

#### Scenario: Store name in consent label

- GIVEN a user opens `/auth/customer?name=MiTienda`
- WHEN the consent checkbox renders
- THEN the label text includes "MiTienda"
- AND the Google button is disabled

#### Scenario: Google button enables after check in customer popup

- GIVEN the customer popup shows consent checkbox unchecked
- WHEN the user checks the checkbox
- THEN the Google OAuth button becomes enabled

### R4: Footer Legal Links

The `FooterSection.tsx` MUST update its legal column links from `#` to real routes.

| Label | Current | Target |
|-------|---------|--------|
| Términos de servicio | `#` | `/terminos` |
| Política de privacidad | `#` | `/privacidad` |
| Política de reembolsos | `#` | `/devoluciones` |

#### Scenario: Footer links point to real pages

- GIVEN a page with the global footer renders
- WHEN the user inspects the legal column links
- THEN each link href points to its target route (not `#`)
- AND clicking each link navigates to the expected page
