# Seller Identity Fraud Vector — Analysis & Fix Plan

> **Status**: ANALYSIS COMPLETE — PLAN APPROVED (simple scope) — implementation NOT started
> **Date**: 2026-09-09 (analysis) / 2026-09-10 (scope decision)
> **Origin**: Item 19 of the seller-flow analysis (Store_Lite)
> **Engram ref**: observation #837 (`Seller identity mutation / fraud vector — item 19 analysis`)
> **PR status**: none yet — this document is the durable record and future fix baseline
> **Scope decision**: APPROVED minimal approach — 2 mutation guards (business identity + product title/price), 1 zod schema, UI disable + tests. NO snapshot/backfill, NO re-KYB, NO audit table, NO render changes, NO RLS work.

---

## 1. The Question

> "¿Tenemos una forma de estafar? Si tengo un negocio con productos y todo, y hago ventas y luego cambio todo — logo, productos, URL — ¿es posible hacerlo sin que mi SaaS tenga validaciones? Verifiquemos esto. ¿Es posible? ¿Cómo lo estamos validando?"

Translation: **Can a seller make sales (orders + payments) and then change their entire business identity — logo, business name, store URL/slug, products — without the SaaS having validations or traceability that protect buyers and order provenance?**

## 2. Executive Summary — Overall Verdict

**YES — the fraud scenario is possible end-to-end.**

A seller can take sales, then change logo, business name, **RUC/taxId**, legal-representative data, slug, and product titles/prices/images — with no validation tied to order history, no KYB re-verification, and no audit trail. Every _newly rendered_ buyer-facing proof (verify page, tracking page, dashboards, subsequent emails/SMS) shows the **new** identity.

The only true snapshots persisted are `amount`, `orderNumber`, buyer contact, and cart item **IDs + quantities**.

Compounding detail: the intended snapshot (`metadata.cartItems` name/price, built in `useCulqiCallback.ts`) is **silently stripped by zod** before persistence — so the traceability that was designed never reached the database.

**What protects buyers today** (the only solid anchors):

- Immutable FKs: `businessId`, `productId`, `sellerUserId`, `amount`, `culqiChargeId`, `createdAt`
- `ON DELETE RESTRICT` FK blocks deleting products with payments
- Server-side amount validation (tamper-proof)
- Buyer card statement is tied to the seller's own Culqi merchant account — external to the SaaS, not launderable

## 3. Verdict Matrix

| Sub-vector                       | Verdict                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Logo change after sales          | **POSSIBLE** (untraced)        | `app/actions/business.ts:82-162` — ownerId check only; old logo files **deleted from storage** (137-152). Rendered LIVE in tracking page `app/[slug]/(app)/order/[token]/page.tsx:715-728`                                                                                                                                                                                                                                           |
| Business name change after sales | **POSSIBLE** (untraced)        | `app/actions/business.ts:164-232` (`updateBusinessData`) — raw `Partial<{...}>` spread straight into `db.update` (216-222), **no zod schema**, no order check, no audit row. Rendered LIVE: verify page `order/verify/[orderNumber]/page.tsx:203`, tracking page `:447,731`                                                                                                                                                          |
| taxId (RUC) / legal rep change   | **POSSIBLE** (worst)           | Same `updateBusinessData` (fields 176-184). `verificationStatus='verified'` set once at creation (`app/create-business/actions.ts:239`) and **never re-checked on update**. Verify page prints `RUC: {business.taxId}` LIVE on "Comprobante Oficial Verificado" (`verify/page.tsx:205-209`). DB-level CHECK constraints **commented out** (`schema/businesses.ts:87-106`)                                                            |
| URL/slug change                  | **POSSIBLE**, partially traced | `app/[slug]/(app)/settings/actions.ts:34-122` — plan-gated, format-checked, old slug recorded in `business_slug_aliases` (84-85) + reserved via `isBusinessSlugTaken` (`src/core/business/slug.ts:82-95`), PostHog event. BUT no order-awareness: old tracking links 404 (strict slug compare `order/[token]/page.tsx:69`; verify page does direct slug lookup `verify/page.tsx:31-41`, no alias resolution)                         |
| Product edit after sale          | **POSSIBLE**                   | `src/features/storage/actions/products.ts:345-489` — `updateProduct` freely rewrites title/price/description/images (media delete+reinsert 441-452) with **no check for existing payments**. Receipts render LIVE `products.title`/`products.price`: `verify/page.tsx:92-113`, `order/[token]/page.tsx:1363,1780`, seller dashboard `dashboard/page.tsx:439-441`                                                                     |
| Product delete after sale        | **BLOCKED** (DB FK)            | `products.ts:591-621` would delete, but FK `payments.productId → products.id ON DELETE RESTRICT` (`schema/orders.ts:47-49`) blocks it. Note: media deleted before the failing delete — non-atomic, minor                                                                                                                                                                                                                             |
| Order display mutation           | **POSSIBLE** (core laundering) | Everything buyer-facing is a **live join**: verify page `:31-41,92-113`, tracking page `:61-67`, `generateMetadata :36`. Immutable anchors that survive: `businessId`/`productId`/`sellerUserId`/`amount`/`culqiChargeId`/`createdAt` (FK restrict), `order_events`/`order_timeline_events` status history, idempotency keys                                                                                                         |
| Culqi side                       | **PARTIALLY-TRACED**           | Charge metadata pins only `{businessId, productId, platform}` (`charge/route.ts:148`); description is literally `Compra: Producto - Store Lite` (`productTitle: undefined`, `:293`). Buyer card statement shows the seller's own Culqi merchant account — external, unlaunderable by SaaS. Amount tampering blocked server-side (`billing/validateAmount.ts:35-71` at `charge/route.ts:208-216`); self-purchase blocked (`:263-270`) |

## 4. Gaps Ranked by Severity

1. **[CRITICAL] No identity snapshot on orders; all proofs render live joins** — `schema/orders.ts:40-125`, `order/verify/[orderNumber]/page.tsx:31-113`, `order/[token]/page.tsx:61-67`. A seller changing identity mutates what buyers see retroactively.
2. **[CRITICAL] `updateBusinessData` is unvalidated and unguarded** — name/RUC/legalRep freely overwritable post-verification; verify page prints live RUC as "verified". `app/actions/business.ts:164-232`, `schema/businesses.ts:87-106`.
3. **[HIGH] `updateProduct` has no order awareness** — receipts render live title/price. `src/features/storage/actions/products.ts:345-489`, `verify/page.tsx:92-113`.
4. **[HIGH] cartItems snapshot stripped by zod** — the intended snapshot never lands in DB. `src/features/billing/schemas.ts:44-51`, `charge/route.ts:181-201,383-388`.
5. **[MEDIUM] Slug change unvalidated vs orders** — breaks old tracking links/emails (404), alias-traced but harmful. `settings/actions.ts:34-122`, `order/[token]/page.tsx:69`.
6. **[MEDIUM] Logo/cover update deletes prior assets** — destroys forensic artifacts. `app/actions/business.ts:137-152,321-343`.
7. **[MEDIUM] No audit table for business identity mutations** — only `updatedAt`. `schema/businesses.ts:76-77`.
8. **[MEDIUM, defense-in-depth] No RLS on payments/businesses/products; DB client uses `DATABASE_URL`-role** — only app-level ownerId checks guard the data layer. `src/core/database/client.ts:14-46`.

## 5. Approved Fix Approach (simple scope — decided 2026-09-10)

> Decision: the full plan (snapshot, re-KYB, audit table, render-from-snapshot, RLS) is **explicitly out of scope**.
> The approved fix closes the actionable fraud vector with two mutation guards:

1. **Business identity guard** — if `payments.count(businessId) > 0`, block edits to _identity_ fields:
   blocked: `businessName`, `taxId` (RUC), `legalRep`, `address/city`, `slug/URL`
   allowed: logo, cover, description, contact info, plan/theme settings, etc.
2. **Product guard** — if a product has sold (`payments.productId` exists), block edits to `title` and `price`;
   allowed: stock, images, description, availability, tags, brand, etc.
3. **Validation first**: `updateBusinessData` gets a zod schema (it is currently an unvalidated
   `Partial<...>` spread). The guard is impossible to enforce reliably without field-level validation.
4. **UI mirrors the guard**: disabled fields in settings + product editor when the row is locked
   (server-side check remains authoritative — UI hiding alone is NOT sufficient).
5. **Guard lives in server actions**, never only in the client.

Rationale for excluding the rest: snapshot/render changes protect historical orders but are heavy;
the guards prevent the fraud **from this point forward**, which is the seller-facing behavior the
business owner asked to stop. Historical orders are not rewritten.

## 6. Approved Task Breakdown (simple scope — for the future SDD change / PR)

> Status: APPROVED — nothing from this section is implemented. Estimated well under the 400-line review budget
> (single PR expected: server actions + zod + UI disable + tests).

- [ ] T1. zod schema for `updateBusinessData` — validate every accepted field (name, taxId format, legalRep, address/city, contact, logo/cover, description), replace the raw `Partial<...>` spread. `app/actions/business.ts:164-232`
- [ ] T2. Business identity guard — in `updateBusinessData` (and slug action), when `payments.count(businessId) > 0`, reject changes to identity fields (name, taxId, legalRep, address/city, slug); return a clear error. Allow logo/cover/description/contact edits. `app/actions/business.ts`, `app/[slug]/(app)/settings/actions.ts:34-122`
- [ ] T3. Product guard — in `updateProduct`, when the product has payments, reject `title` and `price` changes; allow stock/images/description/availability. `src/features/storage/actions/products.ts:345-489`
- [ ] T4. UI disable — settings form + product editor: disable the locked fields when the guard applies (with tooltip/notice), mirroring the server-side rule.
- [ ] T5. Tests — guards unit/integration: business with 0 sales can edit identity; business with sales cannot edit RUC/name/slug; product with sales cannot edit title/price; cosmetic fields still editable in both cases.

### Explicitly deferred (NOT in this fix)

- Snapshot of identity/product on `payments` + render proofs from snapshot (Phase A/C/D of old plan)
- Re-KYB flow for taxId changes
- `business_identity_events` audit table + legal-hold bucket for logo/cover files
- Slug alias resolution in verify/tracking pages for pre-existing changed slugs
- RLS / DB read-role separation (defense in depth)

## 7. Repo State at Writing / at Scope Decision

- Branch: `develop` at `1d36edd` (sync after PR #136 compress + #137 crop modal; both merged)
- Uncommitted (NOT part of this fix — user's own pending change, do NOT touch):
  - `app/[slug]/(app)/storefrontAbout.module.css` (contactLink tweak, 1 ins / 1 del)
- Theme experiment from 2026-09-10 was fully reverted (`git restore`) — no residual theme changes.
- Clean baseline for this fix: `develop` + only the user's `storefrontAbout.module.css`.

## 8. Key Files Referenced

- `app/actions/business.ts`
- `app/[slug]/(app)/settings/actions.ts`
- `app/api/payment/charge/route.ts`
- `app/[slug]/(app)/order/verify/[orderNumber]/page.tsx`
- `app/[slug]/(app)/order/[token]/page.tsx`
- `app/[slug]/(app)/dashboard/page.tsx`
- `src/core/database/schema/orders.ts`, `src/core/database/schema/businesses.ts`, `src/core/database/schema/products.ts`
- `src/core/database/client.ts`
- `src/core/business/slug.ts`
- `src/core/orders/orderService.ts`
- `src/features/billing/schemas.ts`, `src/features/billing/validateAmount.ts`
- `src/features/storage/actions/products.ts`
- `src/features/payment/hooks/useCulqiCallback.ts`
- `src/features/business/actions/businessActions.ts`, `src/features/business/actions/kybActions.ts`
- `src/shared/payments/paymentApi.ts`
- `src/lib/email/orderEmails.ts`
- `app/create-business/actions.ts`
- Migrations (RLS / payment checks)

## 9. Next Steps

1. ✅ Review the analysis and decide scope — DONE (simple scope approved 2026-09-10).
2. ✅ Rewrite the task breakdown to the approved minimal plan (T1-T5).
3. When ready to implement: kick off an SDD change from this baseline (`/sdd-new`), single PR expected.
4. The user's `storefrontAbout.module.css` stays untouched; implementation starts from the clean baseline above.
