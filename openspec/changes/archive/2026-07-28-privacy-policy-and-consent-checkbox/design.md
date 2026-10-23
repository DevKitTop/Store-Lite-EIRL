# Design: Privacy Policy & Consent Checkbox

## Technical Approach

Static server components for legal pages (no DB, no 'use client'), a reusable ConsentCheckbox client component gating Google OAuth via local state, and CSS Modules for styling — matching all existing project patterns.

## Architecture Decisions

### Decision: ConsentCheckbox Location

| Option | Tradeoff |
|--------|----------|
| `src/shared/components/` | Reusable across features, but auth-specific semantics leak into shared |
| `src/features/auth/` | Co-located with consumer; no shared barrel pollution |
| Inline in each auth page | Duplicated markup, no reuse |

**Choice**: `src/features/auth/ConsentCheckbox.tsx` (+ CSS module)
**Rationale**: The component encodes consent + legal-link semantics specific to auth. Shared components are for generic UI (buttons, cards). This belongs in the auth feature boundary.

### Decision: Legal Page Content Source

| Option | Tradeoff |
|--------|----------|
| Hardcoded TSX | Simple, no infra, but harder to update |
| Markdown + `fs` read | Requires server-only runtime, overkill for static content |
| CMS / DB query | Violates spec R1 (no data dependencies) |

**Choice**: Content hardcoded as JSX strings/arrays in each page component.
**Rationale**: Spec requires zero data dependencies. Content changes infrequently (legal). DRY is unnecessary here — each page is a single file.

### Decision: Checkbox Primitive

| Option | Tradeoff |
|--------|----------|
| Native `<input type="checkbox">` | Full control, simplest |
| `<md-checkbox>` (existing component) | Consistent with M3 design system, but doesn't expose `onChange` like a controlled input |
| Custom div-based | Over-engineered |

**Choice**: Native `<input type="checkbox">` styled via CSS module.
**Rationale**: `<md-checkbox>` (M3 web component) is uncontrolled with event-based output, making controlled state (checkbox gates button) harder to manage correctly. A native checkbox is trivial, accessible, and the consent gate pattern doesn't need M3 theming — it's a small label row at the bottom of the auth card.

### Decision: Refund Policy Link (`/devoluciones`)

| Option | Tradeoff |
|--------|----------|
| Link to `/devoluciones` | Follows spec, but page doesn't exist (404 until built) |
| Leave as `#` | Misaligned with spec, sends mixed signal |
| Link to `/terminos` with refund section | Wrong target; refunds ≠ terms |

**Choice**: Link to `/devoluciones` per spec. Mark as known-gap — the page is out of scope for this change.
**Rationale**: The spec explicitly maps this link. A 404 is correct UX (resource not found) rather than a dead `#`.

## Data Flow

```
┌─────────────────────────────────────────────────────┐
│ ConsentCheckbox (client component)                   │
│  state: checked (boolean, default false)             │
│  onConsentChange(checked) ───────────────────────┐   │
└──────────────────────────────────────────────────┘   │
                                                       │
┌──────────────────────────────────────────────────┐   │
│ AuthPage / CustomerAuthContent                    │◄──┘
│  const [consented, setConsented] = useState(false)│
│  <GoogleButton disabled={!consented || isLoading}/>│
└──────────────────────────────────────────────────┘
                │
                ▼
          signInWithGoogle()
```

No backend or store involved — consent is session-local UI state. Legal pages are static HTML at build time.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `app/(main)/privacidad/page.tsx` | Create | Static server page — Ley 29733 privacy policy |
| `app/(main)/terminos/page.tsx` | Create | Static server page — SaaS terms of service |
| `src/features/auth/ConsentCheckbox.tsx` | Create | Checkbox + legal links, `onConsentChange` callback |
| `src/features/auth/ConsentCheckbox.module.css` | Create | Checkbox + label styles matching auth page dark theme |
| `app/auth/page.tsx` | Modify | Import ConsentCheckbox, wire `consented` state, disable button, replace `<span>` with `<Link>` |
| `app/auth/page.module.css` | Modify | Add styles for checkbox wrapper in form area |
| `app/auth/customer/page.tsx` | Modify | Import ConsentCheckbox with `storeName` prop, gate Google button |
| `app/auth/customer/page.module.css` | Modify | Add checkbox+label styles for customer popup |
| `app/(main)/home/FooterSection.tsx` | Modify | Update 3 legal links from `#` to real paths |

## Interfaces / Contracts

```typescript
// src/features/auth/ConsentCheckbox.tsx
interface ConsentCheckboxProps {
  onConsentChange: (checked: boolean) => void;
  storeName?: string;  // Customer popup variant: "Acepto los términos de {storeName}"
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Static page rendering | Pages render without errors, contain expected sections | `pnpm build` / smoke test |
| ConsentCheckbox | Unchecked default, fires callback on change, links render | Manual + potentially unit test |
| Auth page integration | Button disabled when unchecked, enabled when checked | Manual |
| Customer popup | Store name appears in label, same gating behavior | Manual |
| Footer links | `href` values updated to real paths | Visual inspection |

No E2E required — consent is UI-only state with no backend side effects.

## Open Questions

- None. All decisions resolved.
