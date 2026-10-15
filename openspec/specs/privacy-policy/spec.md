# Privacy Policy Specification

## Purpose

Define the global Privacy Policy page at `/(main)/privacidad` — a static server component that fulfills Peruvian Ley 29733 disclosure requirements. This is a SaaS-level page accessible without authentication. No per-store customization is included.

## Requirements

### R1: Static Server Rendering

The privacy policy page MUST be a Next.js server component that renders at build time. It MUST NOT require database queries, API calls, or authentication tokens.

#### Scenario: Page loads without auth

- GIVEN an unauthenticated user navigates to `/privacidad`
- WHEN the page renders
- THEN the full privacy policy content is displayed
- AND no redirect to `/auth` occurs

#### Scenario: No data dependencies

- GIVEN the page component
- WHEN it is rendered
- THEN no `useEffect`, `useState`, or Supabase client calls execute
- AND no server-side data fetching functions (e.g. `getServerSideProps`) are invoked

### R2: Legal Content per Ley 29733

The page content MUST disclose all mandatory items under Peruvian Ley 29733 (Personal Data Protection Law) and its regulations (DS 003-2013-JUS).

The page MUST include sections covering:

| Section             | Content                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| Data Controller     | Devkittop SAC, contact details                                          |
| Collected Data      | Account info (name, email, avatar), store data, payment records         |
| Purpose             | Platform operation, authentication, payment processing, support         |
| Legal Basis         | Consent (Art. 13), contract execution, legal obligation                 |
| Data Retention      | Duration aligned with legal minimums + service necessity                |
| ARCO-PD Rights      | Access, Rectification, Cancellation, Opposition — procedure to exercise |
| DPO Contact         | Email address for data protection inquiries                             |
| Third-Party Sharing | Supabase (hosting), Google (auth), Culqi (payments), Resend (email)     |
| Cookies & Analytics | List of cookies used, their purpose, and retention                      |
| Security Measures   | Technical and organizational measures (encryption, access control)      |

#### Scenario: All mandatory sections render

- GIVEN a user views the privacy policy page
- WHEN the page content is inspected
- THEN all ten mandatory sections from the table above are present and rendered

#### Scenario: Links are functional

- GIVEN the page renders with external references (third-party privacy policies)
- WHEN a user clicks any link
- THEN the link navigates to a valid URL
- AND links open with `target="_blank" rel="noopener noreferrer"`

### R3: Page Accessibility

The page MUST be reachable from the footer without authentication. It MUST render a valid HTML document with a descriptive `<title>` and `<meta name="description">`.

#### Scenario: Footer link navigates to privacy page

- GIVEN a user views any page containing the global footer
- WHEN the user clicks "Política de privacidad"
- THEN the browser navigates to `/(main)/privacidad`

#### Scenario: Search engine metadata is present

- GIVEN a search engine crawler requests `/privacidad`
- WHEN the HTML `<head>` is inspected
- THEN a `<title>` tag containing "Política de Privacidad" is present
- AND a `<meta name="description">` tag is present
