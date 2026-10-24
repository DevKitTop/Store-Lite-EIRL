# Design: Platform legal compliance pages (devoluciones + Libro de Reclamaciones)

## Technical Approach

Two static server pages in `app/(main)` mirroring the `terminos` pattern; the platform complaint book adapts the existing slug-driven `ComplaintForm` into a slug-free variant backed by a new `submitPlatformComplaint` server action. Storage reuses `complaint_book_records` via a seeded platform business row (Option A — zero schema change). Footer + Términos copy updated per spec. Strict TDD (vitest) per `openspec/config.yaml`.

## Architecture Decisions

| # | Decision | Choice | Alternatives | Rationale |
|---|----------|--------|--------------|-----------|
| D1 | Storage target for platform complaints | **Option A**: seed a fixed platform business row (`isActive=false`, owner = Devkittop admin) | Option B: nullable `business_id` + platform flag (migration, RLS, form/action changes) | `business_id` stays NOT NULL → no schema/migration/RLS work. Reuses `submitComplaint` core (validation, rate-limit, ticket, email) and the existing `ComplaintsPanel` (admin owns the row → `requireAccessOnId` passes). App DB client is `postgres-js` direct (bypasses RLS); `scripts/rls-policies.sql` has **no** `complaint_book_records` policies, so a migration would force RLS work for zero gain. Phantom-in-listing risk neutralized by `isActive=false`: excluded by `businesses_select_public` policy AND `sitemap.ts` (`is_active = true`). Residual leak is direct URL to `/{platform-slug}` showing an empty storefront — harmless, no products. |
| D2 | Slug-free platform submission | New `submitPlatformComplaint(formData)` delegating to a shared internal `createComplaintRecord(business, data)` helper extracted from `submitComplaint` | Duplicate action body; parameterized `submitComplaint` with a platform flag | Single source of truth for validation/rate-limit/ticket/email. `submitComplaint(slug, data)` keeps its signature (per-store unchanged); platform action resolves the platform business by constant slug. |
| D3 | Route collision `/libro-reclamaciones` | Static route in `app/(main)` wins over `[slug]` dynamic; platform owns the path | — | App Router resolves static segments before dynamic at the same depth. `proxy.ts` already whitelists the path (1-segment → `isStorefrontBase` allows anon). Guard: reserve the slug "libro-reclamaciones" in slug generation so no future seller claims it; verify no business row uses it today. |
| D4 | Complaints visibility | Reuse existing seller `ComplaintsPanel` via the seeded platform business (admin = owner → sees complaints at `/{platform-slug}/settings/libro-reclamaciones`). No new admin UI | New platform admin surface | Proposal explicitly defers platform admin UI. Option A makes the existing panel work with zero new code. |

## Data Flow

```
Visitor ── GET /libro-reclamaciones ──> (main)/libro-reclamaciones/page.tsx (server, static)
   └─> ComplaintForm (client, no slug) ── submitPlatformComplaint(formData) [server action]
         ├─ resolve platform business (constant slug) → {id, name}
         ├─ complaintFormSchema.safeParse → honeypot (fax) → rate-limit (email/24h)
         ├─ ticket LR-{year}-{businessIdShort}-{seq} → INSERT complaint_book_records
         └─ try send confirmation email (non-blocking) → { ticketNumber, emailFailed }
Devkittop admin ── existing /{platform-slug}/settings/libro-reclamaciones ──> ComplaintsPanel (reused)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `app/(main)/devoluciones/page.tsx` | Create | Static refund-policy page, `terminos` structure + `.legal-page` styles; metadata; WhatsApp-only channel; no email/phone/form. |
| `app/(main)/libro-reclamaciones/page.tsx` | Create | Static LR page: metadata, intro copy (15 días hábiles, DS 011-2011-PCM), renders `ComplaintForm`. No external embeds. |
| `app/(main)/libro-reclamaciones/ComplaintForm.tsx` | Create | Adapted from `[slug]/(public)/libro-reclamaciones/ComplaintForm.tsx`: drop `slug` prop, call `submitPlatformComplaint`; keep Anexo I fields, honeypot, client validation, success/ticket state. |
| `app/(main)/home/FooterSection.tsx` | Modify | "Política de reembolsos" → `/devoluciones`; add "Libro de Reclamaciones" → `/libro-reclamaciones`; phone → `tel:+51958119418`; add address line "Arequipa, Arequipa, Ciudad de Dios"; keep email. |
| `app/(main)/terminos/page.tsx` | Modify | Replace auto-renewal bullet with manual monthly payment; replace "Devkittop SAC" with legal identity (MAMANI TACORA ERNESTO ALONSO / RUC); update contact phone. |
| `src/features/legal/actions.ts` | Modify | Extract shared `createComplaintRecord`; add `submitPlatformComplaint`; keep `submitComplaint` signature. |
| `migrations/0032_platform_business.sql` | Create | Seed platform business: `INSERT … SELECT` from profiles where email = devkittopsac@gmail.com; slug `devkittop`, `is_active=false`, name "Devkittop". Idempotent (`ON CONFLICT (slug) DO NOTHING`). |
| `src/core/business/slug.ts` | Modify | Add "libro-reclamaciones" (+ platform slug) to reserved slugs in `isBusinessSlugTaken`/`generateAvailableBusinessSlug`. |
| Tests (extend/new) | Modify/Create | See Testing Strategy. |

## Interfaces / Contracts

```ts
// src/features/legal/actions.ts — new export (public contract)
export async function submitPlatformComplaint(
  formData: z.infer<typeof complaintFormSchema>,
): Promise<ActionState & { ticketNumber?: string; emailFailed?: boolean }>;

// internal helper (extracted, shared with submitComplaint)
async function createComplaintRecord(
  business: { id: string; name: string },
  data: z.infer<typeof complaintFormSchema>,
): Promise<ActionState & { ticketNumber?: string; emailFailed?: boolean }>;

// constant
const PLATFORM_BUSINESS_SLUG = 'devkittop';
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `submitPlatformComplaint` | Extend `actions.test.ts`: valid submit → ticket + insert; invalid form rejected; honeypot fake success; rate-limit 24h; business-not-found → generic error; email failure non-blocking. |
| Unit | Page copy /devoluciones | `@testing-library/react`: 7-day window, service-consumed exclusion, WhatsApp-only, no email/phone/form rendered. |
| Unit | LR page renders | Form present, no auth check, no external form/embed; success state shows ticket + SLA note. |
| Unit | Footer + Términos | Footer links resolve (`/devoluciones`, `/libro-reclamaciones`), phone 958 119 418, address line; Términos: no "renuevan automáticamente", no "SAC". |
| Checks | `pnpm type-check`, `pnpm lint`, `pnpm test:unit` | CI gate per config. |

## Migration / Rollout

Seed SQL runs once via existing `scripts/migrate.js` pipeline; idempotent. No schema change. Rollback: delete routes (App Router 404s) + `git revert` footer/terminos/slug-guard; soft-delete platform business only (complaint records keep FK).

## Open Questions

- [ ] Confirm the Devkittop admin profile email for the seed (`devkittopsac@gmail.com` assumed; owner must hold a profile row).
- [ ] Confirm no existing business row uses slug `devkittop` or `libro-reclamaciones` before seeding.
- [ ] Reserved-slug guard: add only "libro-reclamaciones" and the platform slug, or a broader reserved list (follows `slug.ts` conventions).
- [ ] **Out of scope (future work)**: `app/(main)/privacidad/page.tsx` still shows "Devkittop SAC" + old phone — locked out of this change per spec.

## Size / Review Notes

Estimated ~450–550 changed lines (2 new static pages + form copy ~350, footer/terminos/slug edits ~80, actions refactor ~40, seed SQL ~20, tests ~80). Forecast: **400-line budget risk: Medium**, `Chained PRs recommended: No` (single coherent feature; pages + form could be slice 1, storage/action + seed slice 2 if split needed).
