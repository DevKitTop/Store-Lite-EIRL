# Archive Report — platform-legal-pages

**Change**: platform-legal-pages
**Status**: ✅ ARCHIVED
**Archived on**: 2026-08-03
**Archived to**: `openspec/changes/archive/2026-08-03-platform-legal-pages/`
**Artifact store mode**: openspec (archive report also persisted to Engram: `sdd/platform-legal-pages/archive-report`)

## Verification Gate

| Check | Result |
|-------|--------|
| Verify report verdict | PASS WITH WARNINGS (no CRITICAL) |
| Tasks complete | 12/12 |
| Spec scenarios compliant | 18/18 |
| Change tests | 48/48 pass |
| Type-check / lint | Clean |
| CRITICAL issues blocking archive | None |

Archive gate passed — no CRITICAL issues present.

## Specs Synced to Source of Truth

Both delta specs were **new domains** (no existing main spec), so each was copied verbatim as the full main spec.

| Domain | Action | Main spec |
|--------|--------|-----------|
| `platform-legal-pages` | Created | `openspec/specs/platform-legal-pages/spec.md` (6 requirements, 9 scenarios) |
| `platform-complaint-book` | Created | `openspec/specs/platform-complaint-book/spec.md` (5 requirements, 8 scenarios) |

Verified: main spec files are byte-identical to the archived delta specs.

## Archive Contents

- `proposal.md` ✅
- `specs/platform-legal-pages/spec.md` ✅
- `specs/platform-complaint-book/spec.md` ✅
- `design.md` ✅
- `tasks.md` ✅ (12/12 tasks complete)
- `verify-report.md` ✅
- `archive-report.md` ✅ (this file)

## Delivery Summary

- **Branch**: `fix/auth-redirect-origin`
- **Commits**: a36c48c..f3c8de0 + d3c5c6e (neutral Spanish copy fix)
- **Delivery**: no PR (user override) — direct commits
- **Migration**: `0032_platform_business.sql` applied in dev

## Deployment Follow-Ups

1. **Apply `0032_platform_business.sql` in production at deploy time** — out of repo scope; scheduled for the deployment that ships this branch. Idempotent (`ON CONFLICT (slug) DO NOTHING`), seeds platform business `devkittop` (`is_active=false`) from owner profile `devkittopsac@gmail.com`.
2. **Verify seeded row + owner profile in production post-deploy** (same check as pre-apply gate 1.1).
3. **Pre-existing global CI failure** — `pnpm test:unit` exit non-zero due to 5 pre-existing failures in `tests/unit/server-actions/settingsActions.test.ts` (plan-enforcement), unrelated to this change; should be resolved independently.
4. **Copy deviation (warning, optional)**: `/libro-reclamaciones` page metadata + intro use voseo ("presentá", "Completá") instead of neutral Peruvian Spanish; a follow-up copy fix was made in d3c5c6e per the context, but verify both lines render neutral (`Complete el formulario`, `Presente su reclamo`).
5. **Intermittent flake (watch)**: 2 `ComplaintForm.test.tsx` cases flaked once under parallel jsdom (`getByLabelText('Número de documento')`); non-reproducible, worth a stability audit.
6. **Suggestion (optional)**: `actions.test.ts` SLA test re-implements `addBusinessDays` locally; import the production helper for meaningful SLA assertion.
7. **Out of scope (future work)**: `app/(main)/privacidad/page.tsx` still shows "Devkittop SAC" + old phone; broader neutral-Spanish sweep of pre-existing voseo copy (e.g., footer tagline "Creá tu tienda").

## Rollback Path

Per design: delete new routes (App Router 404s) + `git revert` footer/terminos/slug-guard edits; soft-delete platform business only (complaint records keep FK). Archive is an audit trail — contents are read-only.

## Traceability

- **Apply-progress (Engram)**: observation #422 — `sdd/platform-legal-pages/apply-progress` (stale/BLOCKED at gate 1.1; blocker later resolved — dev row seeded — but artifact never updated; TDD evidence re-derived from repo in verify report, finding W1).
- **Archive report (Engram)**: topic_key `sdd/platform-legal-pages/archive-report`, project `store_lite`.
