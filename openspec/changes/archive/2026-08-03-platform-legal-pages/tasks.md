# Tasks: Platform legal compliance pages (devoluciones + Libro de Reclamaciones)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 450–550 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | No PR — direct commits (user override) |
| Delivery strategy | ask-always (overridden: no PR) |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units (each = one reviewable commit)

| Unit | Goal | Notes |
|------|------|-------|
| 1 | Pre-apply data check | Verify profile + slug availability; no code |
| 2 | Seed platform business | `migrations/0032_platform_business.sql` |
| 3 | Shared `createComplaintRecord` + `submitPlatformComplaint` | actions.ts + tests |
| 4 | `/devoluciones` page | page + tests |
| 5 | `/libro-reclamaciones` page + slug-free form | page + ComplaintForm + tests |
| 6 | Footer + Términos copy | FooterSection + terminos + tests |
| 7 | Reserved-slug guard | slug.ts + tests |
| 8 | Final checks | type-check, lint, test:unit |

## Phase 1: Pre-apply Check & Foundation

- [ ] 1.1 CHECK (no code): verify profile row exists for devkittopsac@gmail.com (seed owner FK NOT NULL) AND no business/slug-alias uses "devkittop" or "libro-reclamaciones"; report findings before any code change.
- [ ] 1.2 Create `migrations/0032_platform_business.sql`: idempotent INSERT-SELECT from profiles (email devkittopsac@gmail.com) → business slug `devkittop`, is_active=false, name "Devkittop"; `ON CONFLICT (slug) DO NOTHING`.
- [ ] 1.3 TDD `src/core/business/slug.ts`: RED test that "libro-reclamaciones"/"devkittop" are reserved; GREEN — add both to reserved lists in `isBusinessSlugTaken`/`generateAvailableBusinessSlug`.
- [ ] 1.4 TDD `src/features/legal/actions.ts`: RED — extend `src/features/legal/__tests__/actions.test.ts` for submitPlatformComplaint: valid → ticket+insert; invalid rejected; honeypot fake success; 24h rate-limit; business-not-found generic error; email failure non-blocking.
- [ ] 1.5 GREEN — extract shared `createComplaintRecord(business, data)` from submitComplaint; add `submitPlatformComplaint(formData)` resolving `PLATFORM_BUSINESS_SLUG='devkittop'`; keep submitComplaint signature unchanged (per-store intact).

## Phase 2: Core Implementation

- [ ] 2.1 TDD `app/(main)/devoluciones/page.tsx`: RED test — 7-day window, service-consumed exclusion, same-method refund, manual monthly no auto-renewal, WhatsApp-only (no email/phone/form); GREEN — static page mirroring terminos structure + `.legal-page` styles + indexable metadata.
- [ ] 2.2 Create `app/(main)/libro-reclamaciones/ComplaintForm.tsx`: adapt from `app/[slug]/(public)/libro-reclamaciones/ComplaintForm.tsx` — drop slug prop, call submitPlatformComplaint; keep Anexo I fields, honeypot, client validation, success/ticket state.
- [ ] 2.3 Create `app/(main)/libro-reclamaciones/page.tsx`: static page, metadata, intro copy (15 días hábiles, DS 011-2011-PCM), renders ComplaintForm; test — renders without auth, no external form/embed, success shows ticket + SLA note.

## Phase 3: Integration

- [ ] 3.1 TDD `app/(main)/home/FooterSection.tsx`: "Política de reembolsos" → `/devoluciones`; add "Libro de Reclamaciones" → `/libro-reclamaciones`; phone `tel:+51958119418`; address "Arequipa, Arequipa, Ciudad de Dios"; email devkittopsac@gmail.com retained.
- [ ] 3.2 TDD `app/(main)/terminos/page.tsx`: replace auto-renewal claim with manual monthly payment; replace "Devkittop SAC" with MAMANI TACORA ERNESTO ALONSO / RUC 10741399852; update phone; tests — no "renuevan automáticamente", no "SAC".

## Phase 4: Verification

- [ ] 4.1 Run `pnpm type-check`, `pnpm lint`, `pnpm test:unit`; fix regressions (per-store submitComplaint + ComplaintForm tests must stay green).
- [ ] 4.2 Cross-check spec scenarios: devoluciones WhatsApp-only; LR public + no-embed; footer links resolve; Términos copy; complaint persisted/retrievable for Devkittop (reuse ComplaintsPanel at `/{platform-slug}/settings/libro-reclamaciones`).
