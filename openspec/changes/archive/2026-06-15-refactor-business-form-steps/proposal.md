# Proposal: Refactor BusinessFormSteps.tsx

## Intent

`BusinessFormSteps.tsx` (~1321 lines) mixes UI rendering, form validation, OTP/RUC/Sunat API calls, and utility functions in one file. Extract each concern into its own file with clear boundaries.

## Scope

### In Scope
- Extract `normalizeName` + `validateNameMatch` to a dedicated validators file
- Extract `usePhoneOtpVerification` hook into its own file
- Extract RUC verification logic from `Step1General` into `useRucVerification` hook
- Split each step export into its own component file
- Reduce `BusinessFormSteps.tsx` to a thin orchestrator that imports all steps

### Out of Scope
- Behavioral changes, UI redesign, new fields/validations/API calls
- Refactoring parent `BusinessForm.tsx` or sibling `KybWizard` components
- Adding new tests

## Capabilities

### New Capabilities
None — pure refactor.

### Modified Capabilities
None — no spec-level changes.

## Approach

Pure extraction. No logic, props, or return values change:

1. **Validators**: Move `normalizeName` and `validateNameMatch` to `src/shared/validators/business.ts`
2. **RUC Verification**: Extract `handleVerifyRuc`, modal state, and verification state from `Step1General` into `app/created/hooks/useRucVerification.ts`
3. **Phone OTP**: Move `usePhoneOtpVerification` to `app/created/hooks/usePhoneOtpVerification.ts`
4. **Step components**: Each named export becomes a default-export file under `app/created/components/`
5. **Orchestrator**: Original file re-imports and re-exports all steps + wizard layout

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/shared/validators/business.ts` | New | `normalizeName`, `validateNameMatch` |
| `app/created/hooks/useRucVerification.ts` | New | RUC verification + modal state |
| `app/created/hooks/usePhoneOtpVerification.ts` | New | OTP flow hook |
| `app/created/components/Step[1-4]*.tsx` | New | Each step in own file |
| `app/created/components/BusinessFormSteps.tsx` | Modified | Thin orchestrator |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Renamed exports break parent imports | Low | Re-export all from orchestrator; parent imports unchanged |
| Hook extraction misses state dependency | Med | Extract incrementally, verify TypeScript after each file |
| OTP modal state split across hooks | Low | `usePhoneOtpVerification` stays self-contained |

## Rollback Plan

Single `git revert HEAD`. All extraction is additive (new files) + one modified file.

## Dependencies

None.

## Success Criteria

- [ ] `BusinessFormSteps.tsx` reduced from ~1321 to under 150 lines
- [ ] All 6 new files type-check clean (`pnpm type-check`)
- [ ] All existing tests pass (`pnpm test:unit`)
- [ ] Zero behavioral changes — all render paths identical
