# Proposal: Privacy Policy & Consent Checkbox

## Intent

Store Lite lacks a Privacy Policy required by Peruvian Ley 29733. Auth page shows Terms/Privacy as non-functional `<span>` elements with no consent mechanism. Footer legal links point to `#`. Add Privacy Policy, consent checkbox gating Google OAuth, and working links.

## Scope

### In Scope
- Global Privacy Policy at `/(main)/privacidad` (SaaS-level, not per-store)
- Consent checkbox on `app/auth/page.tsx` — unchecked default, button disabled until checked
- Replace `<span>` links with `<Link>` on auth page
- Footer links from `#` to real paths
- Consent checkbox on `app/auth/customer/page.tsx` — store-specific wording

### Out of Scope
- Per-store Privacy Policy, consent audit trail, cookie banner

## Capabilities

### New Capabilities
- `privacy-policy`: Global Privacy Policy page — static server component, Ley 29733 content
- `auth-consent`: Consent checkbox — unchecked default, gates Google OAuth, live links

### Modified Capabilities
None

## Approach

1. Create `app/(main)/privacidad/page.tsx` — static server component
2. Build `ConsentCheckbox` client component (checked state + link rendering)
3. Integrate into `app/auth/page.tsx` — button `disabled={!consented}`, replace `<span>` with `<Link>`
4. Update `FooterSection.tsx` links to `/privacidad`, `/terminos`, `/devoluciones`
5. Add checkbox to `app/auth/customer/page.tsx` — store-specific wording

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/(main)/privacidad/page.tsx` | New | Privacy Policy page |
| `app/auth/page.tsx` | Modified | Checkbox + links |
| `app/auth/page.module.css` | Modified | Checkbox styles |
| `app/auth/customer/page.tsx` | Modified | Consent checkbox |
| `app/auth/customer/page.module.css` | Modified | Checkbox styles |
| `app/(main)/home/FooterSection.tsx` | Modified | Legal link paths |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `/terminos` has no global page (only per-store) | High | Create static page or redirect — decided in spec phase |
| Dark pattern if pre-checked | Low | Unchecked default |

## Rollback Plan

1. Remove `app/(main)/privacidad/` — App Router 404s
2. Revert `app/auth/page.tsx`, `app/auth/customer/page.tsx` to pre-checkbox state
3. Revert `FooterSection.tsx` links to `#`
4. Revert CSS changes

## Dependencies

- **Global `/terminos` page**: auth Terms link needs a target. Create static page or redirect to platform owner's store. Decision deferred to spec phase.

## Success Criteria

- [ ] `/(main)/privacidad` renders Privacy Policy per Ley 29733
- [ ] Auth page shows unchecked checkbox with working links
- [ ] Auth Google button disabled until checked
- [ ] Footer links point to real pages
- [ ] Customer auth popup shows checkbox with store wording
- [ ] Passes `pnpm type-check` and `pnpm lint`
