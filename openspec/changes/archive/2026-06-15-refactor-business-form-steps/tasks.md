# Tasks: Refactor BusinessFormSteps.tsx

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2800 (1480 additions + 1320 deletions) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Foundation → Hooks → Steps (slice 1) → Steps (slice 2) + Cutover |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Base | Notes |
|------|------|-----------|------|-------|
| 1 | Foundation: validators + types + domElements | PR 1 | main | ~40 lines, pure additions, no deletion from original |
| 2 | Hooks: useRucVerification + usePhoneOtpVerification | PR 2 | main (or PR 1 if stacked) | ~260 lines, pure additions |
| 3 | Step components (1+2) + partial orchestrator re-export | PR 3 | main (or PR 2 if stacked) | ~564 additions, ~564 deletions from original; orchestrator keeps Step3/Step4 inline |
| 4 | Step components (3+4) + final orchestrator cleanup | PR 4 | PR 3 branch (feature chain) | ~599 additions, ~756 deletions remaining |
| 5 | Type-check + import audit | bundled with PR 4 | — | Verification only |

## Phase 1: Foundation

- [x] 1.1 Create `src/shared/validators/business.ts` — extract `normalizeName()` (L15-23) + `validateNameMatch()` (L31-40) unchanged
- [x] 1.2 Add `StepProps` interface to `app/created/types.ts` — extracted from L42-50, add below `FormErrors`
- [x] 1.3 Add `getFieldValue` export to `src/shared/utils/domElements.ts` — extracted from L52-53

## Phase 2: Hooks

- [x] 2.1 Create `app/created/hooks/useRucVerification.ts` — extract `handleVerifyRuc` (L88-170) + all associated state variables (L65-86) + `UseRucVerificationOptions` interface. Accepts `formData`, `onChange`, `onVerificationChange`. Returns all state + `handleVerifyRuc`, `setVerifyError`, `setShowValidationModal`, `setDniData`, `setPjRepData`, `setIsRucVerified`
- [x] 2.2 Create `app/created/hooks/usePhoneOtpVerification.ts` — extract `OTP_LENGTH`, `EMPTY_OTP_DIGITS`, `getErrorMessage`, `PhoneOtpVerificationOptions`, and `usePhoneOtpVerification` hook (L567-721) unchanged. Import `requestOtpAction`, `verifyOtpAction` from `@app/actions/kyb`

## Phase 3: Step Components — Slice 1

- [x] 3.1 Create `app/created/components/Step1General.tsx` — extract L55-527 with default export. Import `useRucVerification` from hooks, `normalizeName`+`validateNameMatch` from validators, `StepProps` from types, `getFieldValue` from domElements. Inline validation modal JSX stays inside this file
- [x] 3.2 Create `app/created/components/Step2Economic.tsx` — extract L528-565 with default export. Import `StepProps` from types, `getFieldValue` from domElements, `BUSINESS_SECTORS` from constants, UI components
- [x] 3.3 Update `BusinessFormSteps.tsx` — replaced all inline code with barrel re-exports of all 4 step components

## Phase 4: Step Components — Slice 2 + Orchestrator Cutover

- [x] 4.1 Create `app/created/components/Step3Contact.tsx` — extract L723-1030 with default export. Import `usePhoneOtpVerification` from hooks, `StepProps` from types, `getFieldValue` from domElements. OTP modal JSX stays inside this file
- [x] 4.2 Create `app/created/components/Step4Legal.tsx` — extract L1032-1321 with default export. Import `usePhoneOtpVerification` from hooks, `StepProps` from types, `getFieldValue` from domElements, `CARGO_OPTIONS` from constants. OTP modal JSX stays inside this file
- [x] 4.3 Rewrite `BusinessFormSteps.tsx` — replaced all inline code with barrel re-exports of all 4 step components. Removed unused imports. Kept `'use client'` directive.

## Phase 5: Verification

- [x] 5.1 Run `pnpm type-check` — fix any type errors in new files (import paths, missing exports)
- [x] 5.2 Run `pnpm test:unit` — verify all existing tests pass. No behavioral change expected
- [x] 5.3 Import audit — confirm `app/created/components/BusinessForm.tsx` import `from './BusinessFormSteps'` resolves all 4 step components correctly
- [x] 5.4 Confirm `BusinessFormSteps.tsx` is under 150 lines (success criterion from proposal)
