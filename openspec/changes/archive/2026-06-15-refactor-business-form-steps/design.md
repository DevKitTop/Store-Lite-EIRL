# Design: Refactor BusinessFormSteps.tsx

## Technical Approach

Pure extraction — zero behavioral changes. Split the 1321-line monolith into 8 files organized by concern: validators → hooks → step components → thin orchestrator. Each extraction preserves the original export name, interface shape, and import paths via re-exports.

## Architecture Decisions

### Decision: Validator Location

| Option | Tradeoff |
|--------|----------|
| `src/shared/validators/business.ts` | New path but clean domain boundary; follows `src/shared/utils/` pattern |
| `app/created/utils/validation.ts` | Closer to usage, but less reusable |
| Inline in each step | No extraction at all — violates goal |

**Choice**: `src/shared/validators/business.ts` — these are pure business-domain functions (RUC/name validation) that belong in shared.

### Decision: `StepProps` Interface Location

| Option | Tradeoff |
|--------|----------|
| Move to `app/created/types.ts` | Single source of truth, but couples all steps to one type |
| Define per-step interfaces | More precise, but drifts from current single interface |
| Keep in orchestrator | Works but unusual for a barrel file |

**Choice**: Define `StepProps` in shared `types.ts` and each step imports it. Minimum diff from current code — interface stays identical.

### Decision: `getFieldValue` Extraction

| Option | Tradeoff |
|--------|----------|
| Move to `src/shared/utils/domElements.ts` | Follows existing pattern, one extra export |
| Duplicate in each step file | No dependency, but violates DRY |
| Inline the one-liner | Minimizes extraction surface |

**Choice**: Add to `src/shared/utils/domElements.ts` — it's already a DOM utility barrel. Used by all 4 steps.

### Decision: OTP Constants Inside Hook vs. Separate

| Option | Tradeoff |
|--------|----------|
| Move `OTP_LENGTH` / `EMPTY_OTP_DIGITS` / `getErrorMessage` inside hook file | Self-contained, only used there |
| Extract to shared constants file | Over-engineering for 3 lines |

**Choice**: Keep inside `usePhoneOtpVerification.ts` — they're implementation details.

## Data Flow

```
BusinessForm.tsx (parent)
  │
  ├── Step1General.tsx ── useRucVerification() ── verifyIdentityAction()
  │                                    │
  │                                    └── normalizeName() / validateNameMatch()
  │
  ├── Step2Economic.tsx  (stateless, pure render)
  │
  ├── Step3Contact.tsx ── usePhoneOtpVerification() ── requestOtpAction() / verifyOtpAction()
  │
  └── Step4Legal.tsx  ── usePhoneOtpVerification() ── requestOtpAction() / verifyOtpAction()
```

Parent passes `isRucVerified`, `verifiedPhone` down as props. Verification state lives in `BusinessForm` (or above).

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/shared/validators/business.ts` | Create | `normalizeName()` + `validateNameMatch()` (moved from L15-40) |
| `src/shared/utils/domElements.ts` | Modify | Add `getFieldValue()` export (moved from L52-53) |
| `app/created/types.ts` | Modify | Add `StepProps` interface (moved from L42-50) |
| `app/created/hooks/usePhoneOtpVerification.ts` | Create | Full hook: `OTP_LENGTH`, `EMPTY_OTP_DIGITS`, `getErrorMessage`, `usePhoneOtpVerification` + `PhoneOtpVerificationOptions` (L567-721) |
| `app/created/hooks/useRucVerification.ts` | Create | RUC verification state + `handleVerifyRuc` + modal/setter exports (extracted from L64-170, L86-170) |
| `app/created/components/Step1General.tsx` | Create | Step1General with inline validation modal JSX. Imports `useRucVerification` + validators |
| `app/created/components/Step2Economic.tsx` | Create | Step2Economic — stateless, pure render |
| `app/created/components/Step3Contact.tsx` | Create | Step3Contact with OTP modal via `usePhoneOtpVerification` |
| `app/created/components/Step4Legal.tsx` | Create | Step4Legal with OTP modal via `usePhoneOtpVerification` |
| `app/created/components/BusinessFormSteps.tsx` | Modify | Thin orchestrator: imports + re-exports all 4 steps (~15 lines) |

## Interfaces / Contracts

```typescript
// 👇 app/created/types.ts (NEW — moved from BusinessFormSteps.tsx)
export interface StepProps {
  formData: BusinessData;
  onChange: (field: keyof BusinessData, value: string) => void;
  errors: FormErrors;
  onVerificationChange?: (isVerified: boolean) => void;
  isRucVerified?: boolean;
  verifiedPhone?: string | null;
  onPhoneVerificationChange?: (phone: string | null) => void;
}

// 👇 src/shared/validators/business.ts
export function normalizeName(name: string): string;
export function validateNameMatch(input: string, sunatName: string | undefined): boolean;

// 👇 app/created/hooks/usePhoneOtpVerification.ts
interface PhoneOtpVerificationOptions { /* same as L573-578 */ }
export function usePhoneOtpVerification(opts: PhoneOtpVerificationOptions): {
  closeOtpModal, handleOtpInput, handleOtpKeyDown, handleOtpPaste,
  handlePhoneChange, handleRequestOtp, handleVerifyOtp,
  isOtpSending, isOtpVerifying, isVerified, otpDigits, otpError,
  otpInputRefs, resendOtp, showOtpModal
};

// 👇 app/created/hooks/useRucVerification.ts
interface UseRucVerificationOptions {
  formData: BusinessData;
  onChange: (field: keyof BusinessData, value: string) => void;
  onVerificationChange?: (isVerified: boolean) => void;
}
export function useRucVerification(opts: UseRucVerificationOptions): {
  isRucVerified, isVerifying, verifyError, showValidationModal,
  verificationResult, dniData, pjRepData, isValidatingRep,
  handleVerifyRuc, setVerifyError, setShowValidationModal,
  setDniData, setPjRepData, setIsRucVerified
};
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `normalizeName`, `validateNameMatch` | Pure function tests: accent stripping, punctuation, edge cases (empty, null) |
| Unit | `usePhoneOtpVerification` | Render hook test — verify state transitions: request OTP → verify OTP → success/error |
| Unit | `useRucVerification` | Render hook test — mock `verifyIdentityAction`, verify state after success/error |
| Integration | Each step component | Render with mock props, verify DOM output matches original snapshots |
| E2E | Full wizard flow | Smoke test — ensure no crash on step transitions (can reuse existing Playwright tests) |

## Migration / Rollout

No migration required. Single atomic commit: new files are created, original file is rewritten as thin orchestrator. Parent imports (`from './BusinessFormSteps'`) remain unchanged because the orchestrator re-exports the same named symbols.

## Open Questions

None — all extraction boundaries are clearly mapped from line ranges in the source file.
