## Verification Report

**Change**: seller-fraud-guards
**Version**: spec.md (delta, openspec)
**Mode**: Strict TDD (vitest `pnpm test:unit`)

### Completeness

| Metric           | Value |
| ---------------- | ----- |
| Tasks total      | 16    |
| Tasks complete   | 16    |
| Tasks incomplete | 0     |

All 16 tasks marked `[x]` in `tasks.md`. 14 of 16 are implementation/test tasks; 5.1–5.3 are the verification gates (ran, passed).

### Build & Tests Execution

**Type check**: ✅ Passed

```text
$ pnpm type-check
$ tsc --noEmit
exit code: 0, no output
```

**Tests**: ✅ 1354 passed / 0 failed / 0 skipped (131 test files, vitest 4.1.9)

```text
$ pnpm test:unit
 Test Files  131 passed (131)
      Tests  1354 passed (1354)
   Duration  27.92s
```

New tests added by this change: 37 across 3 files (all unit layer):
- `paymentGuards.test.ts` — 8 tests
- `businessDataGuard.test.ts` — 16 tests (updateBusinessData) + 2 tests (updateBusinessSlug)
- `updateProductGuard.test.ts` — 11 tests

**Coverage**: ➖ Not available (no coverage tool configured for this change's gates). Informational only — not blocking.

### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
| ----------- | -------- | ---- | ------ |
| Locked state definition | Business with confirmed/in-progress payment is locked | `paymentGuards.test.ts > returns true when business has paid/pending payments` | ✅ COMPLIANT |
| Locked state definition | Only failed/abandoned payments does not lock | `paymentGuards.test.ts > returns false when business has only failed payments / count 0` | ✅ COMPLIANT |
| Business data validation (T1) | Invalid taxId rejected, no DB write | `businessDataGuard.test.ts > rejects malformed taxId and performs no DB write` | ✅ COMPLIANT |
| Business data validation (T1) | Valid payload accepted | `businessDataGuard.test.ts > accepts valid payload with all fields` | ✅ COMPLIANT |
| Business identity guard (T2) | Unlocked business edits identity | `businessDataGuard.test.ts > accepts identity field changes when unlocked` | ✅ COMPLIANT |
| Business identity guard (T2) | Locked business identity edit rejected | `businessDataGuard.test.ts > rejects name/taxId/legalRep*/address/city change when locked` (8 tests) | ✅ COMPLIANT |
| Business identity guard (T2) | Locked business cosmetic edit allowed | `businessDataGuard.test.ts > accepts description/storeType/whatsappNumber/email change when locked` (4 tests) | ✅ COMPLIANT |
| Slug guard (T2) | Unlocked slug change allowed | `businessDataGuard.test.ts > allows slug change when unlocked` | ✅ COMPLIANT |
| Slug guard (T2) | Locked slug change rejected | `businessDataGuard.test.ts > rejects slug change when locked` | ✅ COMPLIANT |
| Product guard (T3) | Unlocked product title/price edit allowed | `updateProductGuard.test.ts > accepts title/price change when unlocked` | ✅ COMPLIANT |
| Product guard (T3) | Locked product title/price rejected | `updateProductGuard.test.ts > rejects title/price/secondPrice change when locked` (4 tests) | ✅ COMPLIANT |
| Product guard (T3) | Locked product operational edit allowed | `updateProductGuard.test.ts > accepts stock/description/availability change when locked` (3 tests) | ✅ COMPLIANT |
| UI mirror (T4) | Locked fields disabled with notice | Static evidence only — no component test (integration tooling not installed for this change) | ⚠️ PARTIAL |
| UI mirror (T4) | Crafted request bypass rejected | Covered by all server-guard rejection tests above (name/taxId/price/slug/slug when locked) | ✅ COMPLIANT |

**Compliance summary**: 13/14 scenarios compliant, 1 partial (UI disable state — static evidence only; the server-side authority for that scenario is fully covered).

### TDD Compliance

| Check | Result | Details |
| ----- | ------ | ------- |
| TDD Evidence reported | ✅ | tasks.md contains RED/GREEN per task (1.1/1.2, 2.1/2.3, 3.1/3.2) |
| All tasks have tests | ✅ | 3/3 test files created; 37 tests cover all guard behaviors |
| RED confirmed (tests exist) | ✅ | `paymentGuards.test.ts`, `businessDataGuard.test.ts`, `updateProductGuard.test.ts` all exist and pass |
| GREEN confirmed (tests pass) | ✅ | 37/37 new tests pass within the 1354 full-suite run |
| Triangulation adequate | ✅ | Guard behaviors triangulated: locked vs unlocked, per-field (name/taxId/legalRep/address/city), hold-vs-change same-value cases (title/price unchanged allowed) |
| Safety Net for modified files | ✅ | `settingsActions.test.ts` (existing, modified) passes in full run; no N/A claims on modified files |

**TDD Compliance**: 6/6 checks passed

### Test Layer Distribution

| Layer | Tests | Files | Tools |
| ----- | ----- | ----- | ----- |
| Unit | 37 new (+1354 total) | 3 new | vitest |
| Integration | 0 | 0 | not installed for this change |
| E2E | 0 | 0 | not installed |
| **Total** | **1354** | **131** | |

### Changed File Coverage

Coverage analysis skipped — no coverage tool configured in this project's test setup (not a failure).

### Assertion Quality

✅ All assertions verify real behavior. No tautologies, no ghost loops, no empty-collection-only checks, no smoke tests. Rejection tests assert both the exact `FROZEN_FIELD_MESSAGE` AND that no DB write occurred (`mockDbUpdateWhere).not.toHaveBeenCalled()` / `mockUpdateWhere).not.toHaveBeenCalled()`), which is the strongest behavioral assertion available at unit layer. Mock-call existence checks in `paymentGuards.test.ts` are combined with value assertions — acceptable.

### Quality Metrics

**Linter**: ➖ Not run (not part of this change's declared gates)
**Type Checker**: ✅ No errors (`pnpm type-check` exit 0)

### Correctness (Static Evidence)

| Requirement | Status | Notes |
| ----------- | ------ | ----- |
| R/Locked state | ✅ Implemented | `LOCKING_PAYMENT_STATUSES` = pending, validando, paid, completed, delivered, en_reparto, not_delivered (paymentGuards.ts:19-27). failed/disputed/refunded excluded; `hasLockingPayments` filters via `inArray(..., status)` only. `count > 0` semantics. |
| T1 zod | ✅ Implemented | `updateBusinessDataSchema` in `src/features/business/schemas.ts:52-86` — optional fields, taxId 11–20 + `^[a-zA-Z0-9]+$` regex, Spanish messages. `updateBusinessData` runs `safeParse` after whatsapp normalize, before any write; returns first issue message. |
| R/Business identity guard | ✅ Implemented | Lock → diff 12 identity keys (name, taxId, legalRepName/Role/Phone/Email, address, departamento, provincia, distrito, city, country) against DB current from extended findFirst; change → `{ error: FROZEN_FIELD_MESSAGE }`, no write. Cosmetic (description, storeType, whatsappNumber, email) passes through. |
| R/Slug guard | ✅ Implemented | `updateBusinessSlug` (settings/actions.ts:51-53): after plan gate, before slug length/format/uniqueness checks. Returns `{ success: false, error: FROZEN_FIELD_MESSAGE }`. |
| R/Product guard | ✅ Implemented | `updateProduct` (products.ts:356-372): fetch extended with price/secondPrice; guard after requireAccess, before entitlement/plan checks and write; rejects title or price or secondPrice change with `{ success: false, productId: null, error }` per plan-check pattern; same-value submits allowed. |
| R/UI mirror | ✅ Implemented (static) | `getBusinessLockState` (business.ts:289-299), `getProductLockState` (products.ts:506-516). Disabled + notice: IdentitySection name, ContactSection city, LegalSection legalRepRole, slug editor (`canEditSlug = plan !== 'basico' && !businessLocked`, SettingsClient.tsx:89), BasicInfoSection name, StockPriceSection price/secondPrice. |

### Coherence (Design)

| Decision | Followed? | Notes |
| -------- | --------- | ----- |
| D1: Locked-status mapping | ✅ Yes | Exact match to spec → enum mapping table |
| D2: Shared helper | ✅ Yes | `src/core/orders/paymentGuards.ts`, indexed count query, `inArray`, exported const |
| D3: Canonical action + zod | ✅ Yes | Flow: auth → ownership (identity fields) → whatsapp normalize → zod safeParse → lock guard diff → write. Identity blocklist matches D3 exactly (12 keys). Error via `{ error }`, never throws. |
| D4: Slug guard | ✅ Yes | Inserted after plan gate, before uniqueness checks |
| D5: Product guard | ✅ Yes | `{ success: false, productId: null, error }`, no throw |
| D6: UI disable mechanism | ✅ Yes | All three surfaces wired (modal sections, slug editor, product sheet) |
| D7: Other flows untouched | ✅ Yes | No changes to entitlements, Culqi callback, or order state machine |

### Issues Found

**CRITICAL**: None

**WARNING**:
1. `app/(main)/home/components/ProductFiltersTopBar.module.css` appears in the working-tree diff (+30 lines: md-switch unselected/OFF-state theming). Constraint said this file "must NOT be in the change set". The modification is unrelated to fraud guards (last commit touching it was `2ddadda` 2026-09-09, pre-change). It is uncommitted WIP — exclude it from any commit for this change and confirm whether it is the user's own WIP. `app/[slug]/(app)/storefrontAbout.module.css` is clean (NOT in the diff) ✅.
2. `FROZEN_FIELD_MESSAGE` is duplicated as UI-local `LOCKED_NOTICE` constants in 5 components (IdentitySection, ContactSection, LegalSection, BasicInfoSection, StockPriceSection) instead of importing the shared const (UI components are client-side; importing from the server-db module is not currently wired). Drift risk if the message ever changes. Confirmed risk per instructions — not a failure of any spec scenario.

**SUGGESTION**:
1. `paymentGuards.test.ts` mocks the `db.select` chain, so the `inArray` status-filter SQL is never executed at runtime — per-status coverage of the 7 locking statuses is static-evidence only. A DB-level or non-mocked integration test would execute the filter.
2. UI mirror scenario has no runtime covering test (no component test infra in this change's scope). A render-level test asserting `disabled` + notice presence would close the PARTIAL.
3. Design.md named the business+slug test file `sellerFraudGuards.test.ts`; actual is `businessDataGuard.test.ts` (matches tasks.md). Cosmetic naming deviation only.

### Verdict

**PASS WITH WARNINGS** — all 14 spec scenarios satisfied at server layer (13 fully runtime-proven), all gates green (1354/1354 tests, type-check exit 0), 16/16 tasks complete, design D1-D7 followed. Two non-blocking warnings: unrelated uncommitted CSS in working tree (must not ship with this change) and UI-local duplicate of the frozen message string.