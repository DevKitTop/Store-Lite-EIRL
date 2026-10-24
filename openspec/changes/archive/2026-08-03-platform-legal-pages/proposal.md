# Proposal: Platform legal compliance pages (devoluciones + Libro de Reclamaciones)

## Intent

Culqi production validation requires the SaaS site itself to expose a refund policy, Libro de Reclamaciones (DS 011-2011-PCM), and correct contact/legal identity. Today footer "Política de reembolsos" points to `#`, no platform Libro de Reclamaciones exists, phone/legal identity are outdated, and Términos claims auto-renewal contradicting the real manual monthly payment model.

## Scope

### In Scope
- `/devoluciones` (new): refund policy — 7 calendar days per plan payment; no refund if customer had sales or used any plan feature within the window; refund via same payment method (Culqi reversal); manual monthly payment, no auto-renewal. Refund requests are manual, via WhatsApp only (`wa.me/958119418`) — no email/phone form (avoids easy/abusive refunds).
- `/libro-reclamaciones` (new): INDECOPI-compliant, internal form reusing ComplaintForm.tsx + complaint_book_records storage, targeting Devkittop. Open design question: fixed platform business row vs. separate storage.
- Footer: "Política de reembolsos" → /devoluciones; add "Libro de Reclamaciones" → /libro-reclamaciones; phone → 958 119 418; add address line.
- Legal identity: MAMANI TACORA ERNESTO ALONSO, RUC 10741399852 (persona natural con negocio, NOT SAC); brand Devkittop; address Arequipa, Ciudad de Dios; email devkittopsac@gmail.com; phone 958 119 418.
- Términos: replace auto-renewal line with manual monthly payment; normalize "Devkittop SAC" refs to legal identity.
- Page copy in neutral professional Spanish (Peru).

### Out of Scope
- Seller-store compliance (per-store legal-pages/complaint-book — separate change).
- Recurring billing / auto-charge implementation.
- Platform admin complaints UI (deferred).

## Capabilities

### New Capabilities
- `platform-legal-pages`: Platform refund policy page + Términos/contact/legal identity fixes on the SaaS site.
- `platform-complaint-book`: Platform INDECOPI Libro de Reclamaciones persisting to complaint_book_records for Devkittop.

### Modified Capabilities
None. Per-store `legal-pages`/`complaint-book` (culqi-prod-unblock-legal-pages) stay separate; spec phase may write deltas under those names if archived first.

## Approach

Static server component for /devoluciones (plain Spanish copy, mirroring terminos/privacidad). Platform LR adapts ComplaintForm.tsx (no slug) + submitComplaint; storage target resolved in design phase. Localized footer/terminos edits. Strict TDD: unit tests for pages and platform complaint submission.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/(main)/devoluciones/page.tsx` | New | Refund policy page |
| `app/(main)/libro-reclamaciones/page.tsx` | New | Platform LR page |
| `app/(main)/libro-reclamaciones/ComplaintForm.tsx` | New | Adapted form (no slug) |
| `app/(main)/home/FooterSection.tsx` | Modified | Links, phone, address |
| `app/(main)/terminos/page.tsx` | Modified | Auto-renewal + legal identity |
| `src/features/legal/actions.ts` | Modified | Platform complaint target |
| `src/features/legal/schemas.ts` | Modified | If storage target changes |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| business_id NOT NULL — no platform business row | Med | Design: seeded platform business vs. nullable business_id |
| Legal copy mis-stated | Med | Reviewed against locked decisions |
| Refund manual (Culqi reversal) | Low | Policy text reflects manual process |

## Rollback Plan

1. Delete new routes (App Router 404s).
2. `git revert` footer/terminos edits.
3. Complaint storage change reversible; soft-delete only.

## Dependencies

- Existing `complaint_book_records` table + `submitComplaint` action.
- Supabase access (configured).

## Success Criteria

- [ ] `/devoluciones` renders refund policy per locked decisions
- [ ] Footer links resolve; phone 958 119 418 + address visible
- [ ] `/libro-reclamaciones` stores complaints for Devkittop
- [ ] Términos: manual monthly payment + correct legal identity
- [ ] `pnpm type-check`, `pnpm lint`, unit tests pass
