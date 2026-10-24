# Email-Password Login Specification

## Purpose

Add email+password sign-in as a first-class auth method on the platform admin page at `/auth`, alongside the existing Google OAuth. Login-only scope: no public signup, no password reset, no email confirmation flows. Post-login navigation is an explicit `router.push('/onboarding')` (no OAuth callback redirect). A service-role provisioning script creates isolated test users (e.g., the Culqi validation account) via `auth.admin.createUser` with `email_confirm: true` and inserts the `profiles` row directly — password login bypasses the OAuth callback that normally syncs profiles.

## Requirements

### Requirement: Email+Password Sign-In Method

The AuthProvider MUST expose a `signInWithEmail(email, password)` method that authenticates the user with Supabase and, on success, MUST navigate to `/onboarding` via an explicit `router.push('/onboarding')`.

#### Scenario: Valid credentials sign in and navigate

- GIVEN a user on `/auth` with email+password credentials
- WHEN they submit valid email and password
- THEN the user is signed in
- AND the client navigates to `/onboarding` via `router.push`

#### Scenario: Post-login destination is explicit

- GIVEN the sign-in succeeds
- WHEN the client-side navigation runs
- THEN the destination is exactly `/onboarding`
- AND no OAuth callback redirect is involved

### Requirement: Invalid Credentials Inline Error

When authentication fails, the form MUST NOT navigate. It MUST display an inline error message and keep the user on `/auth`.

#### Scenario: Wrong password

- GIVEN a user submits an email with an incorrect password
- WHEN the sign-in attempt returns an error
- THEN an inline error message is shown on the form
- AND the URL remains `/auth`

#### Scenario: Unknown email

- GIVEN a user submits an email with no existing account
- WHEN the sign-in attempt returns an error
- THEN an inline error message is shown
- AND no navigation occurs

### Requirement: Login-Only Form Fields

The auth page MUST render an email input and a password input (MD3 `TextField`, password input `type="password"`) plus a submit button, and MUST NOT render signup or password-reset links.

#### Scenario: Form renders email and password inputs

- GIVEN a user opens `/auth`
- WHEN the password form section renders
- THEN an email `TextField` and a password `TextField` with `type="password"` are displayed
- AND a submit button is displayed

#### Scenario: No signup or reset links

- GIVEN the password form is rendered
- THEN the form MUST NOT contain a "sign up" link
- AND MUST NOT contain a "forgot password"/reset link

### Requirement: Consent Gates Email/Password Submit

The email/password form submit control MUST be disabled (or the form hidden) until the consent checkbox is checked, matching the Google button gating (see `auth-consent` delta).

#### Scenario: Submit disabled until consent

- GIVEN the consent checkbox is unchecked
- WHEN the user inspects the email/password submit button
- THEN the button is `disabled`
- AND submitting the form does not trigger `signInWithEmail`

#### Scenario: Submit enabled after consent

- GIVEN the consent checkbox is checked
- WHEN the user inspects the email/password submit button
- THEN the button is enabled
- AND submitting the form triggers `signInWithEmail`

### Requirement: Google Button Regression Guard

The existing Google OAuth button MUST continue to work unchanged when the email/password form is added.

#### Scenario: Google sign-in still available

- GIVEN the consent checkbox is checked
- WHEN the user clicks the Google OAuth button
- THEN `signInWithGoogle()` is triggered as before

### Requirement: Loading State Prevents Double Submit

While a sign-in request is in flight, the form MUST prevent duplicate submissions.

#### Scenario: Double-click during request

- GIVEN a user submits valid credentials
- WHEN the sign-in request is pending
- THEN the submit button is disabled and further submissions are ignored
- AND exactly one sign-in request is in flight

### Requirement: Provisioning Script Creates Confirmed User

A script in `scripts/` MUST create a test user via the Supabase service-role `auth.admin.createUser` with `email_confirm: true`, and MUST insert the matching `profiles` row with `provider_id: 'email'`.

#### Scenario: Script provisions user and profile

- GIVEN the script is invoked with a new email and password
- WHEN the script runs
- THEN a user is created via `auth.admin.createUser` with `email_confirm: true`
- AND a `profiles` row is inserted with `provider_id: 'email'`
- AND the user can sign in at `/auth`

### Requirement: Idempotent or Clear Error on Existing User

If the target user already exists, the script MUST either exit successfully without duplicating data or fail with a clear error message.

#### Scenario: Re-run against existing user

- GIVEN a user with the target email already exists
- WHEN the script runs again
- THEN it exits without creating a duplicate user
- AND it reports either an idempotent success or a clear "user already exists" error

### Requirement: Credentials via CLI Args or Env

The script MUST accept email and password via CLI arguments or environment variables, and MUST NOT hardcode credentials in the repository.

#### Scenario: Credentials supplied externally

- GIVEN the script is invoked with credentials via environment variables or CLI arguments
- WHEN it runs
- THEN no credential literal exists in the repository source