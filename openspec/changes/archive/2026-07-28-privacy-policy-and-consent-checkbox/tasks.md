# Tasks: Privacy Policy & Consent Checkbox

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~325 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | All changes in one slice | PR 1 (single) | ~325 lines, under 400 budget |

## Phase 1: Static Legal Pages

- [x] 1.1 **RED** — Write test for `app/(main)/privacidad/page.tsx`: renders mandatory sections, has `<title>` with "Política de Privacidad"
- [x] 1.2 **GREEN** — Create `app/(main)/privacidad/page.tsx` — static server component, Ley 29733 content, `target="_blank" rel="noopener noreferrer"` on external links
- [x] 1.3 **RED** — Write test for `app/(main)/terminos/page.tsx`: renders SaaS terms, has metadata
- [x] 1.4 **GREEN** — Create `app/(main)/terminos/page.tsx` — static server component, SaaS terms of service

## Phase 2: ConsentCheckbox Component

- [x] 2.1 **RED** — Write test for `src/features/auth/ConsentCheckbox.tsx`: unchecked default, fires `onConsentChange(true/false)`, links point to `/privacidad` and `/terminos`, `storeName` appears in label
- [x] 2.2 **GREEN** — Create `src/features/auth/ConsentCheckbox.tsx` — native `<input type="checkbox">`, `onConsentChange` callback, `<Link>` components
- [x] 2.3 **GREEN** — Create `src/features/auth/ConsentCheckbox.module.css` — checkbox + label styles matching auth dark theme
- [x] 2.4 **REFACTOR** — Run `pnpm type-check` and `pnpm lint`, fix any issues

## Phase 3: Auth Page Integration

- [x] 3.1 **RED** — Write test for `app/auth/page.tsx`: Google button `disabled` when checkbox unchecked, enables when checked
- [x] 3.2 **GREEN** — Modify `app/auth/page.tsx` — import `ConsentCheckbox`, wire `consented` state, `disabled={!consented || isLoading}`, replace `<span>` links with `<Link>`
- [x] 3.3 **GREEN** — Modify `app/auth/page.module.css` — add `.checkboxWrapper` styles in `formArea`

## Phase 4: Customer Auth Integration

- [x] 4.1 **RED** — Write test for `app/auth/customer/page.tsx`: store name in consent label, button gates on consent
- [x] 4.2 **GREEN** — Modify `app/auth/customer/page.tsx` — import `ConsentCheckbox` with `storeName={storeName}`, gate Google button
- [x] 4.3 **GREEN** — Modify `app/auth/customer/page.module.css` — add checkbox styles for popup layout

## Phase 5: Footer & Final Verification

- [x] 5.1 **GREEN** — Update `app/(main)/home/FooterSection.tsx` — change 3 legal `href="#`" to `/terminos`, `/privacidad`, `/devoluciones`
- [x] 5.2 **VERIFY** — Run `pnpm test:unit`, `pnpm type-check`, `pnpm lint` — all passing (build skipped: pre-existing infra issues unrelated to this change)
- [ ] 5.3 **VERIFY** — Manual smoke: navigate `/privacidad`, `/terminos`, `/auth` — checkbox unchecked, button disabled, links work (manual, pending)
