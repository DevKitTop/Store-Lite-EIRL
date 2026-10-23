# Delta Spec: seo-shareability — T5 + T6

> **Change**: `seo-shareability`
> **Scope**: T5 (Dynamic OG images) + T6 (BreadcrumbList JSON-LD)
> **Groups**: Grupo 2 — MEDIA priority, all plans (no gating)
> **Status**: Draft

---

## 1. Context

Social share cards render a generic platform image for every storefront. BreadcrumbList structured data is absent. Both are low-effort, high-visibility SEO wins requiring zero seller effort.

**Existing patterns observed:**
- Root `app/opengraph-image.tsx` uses `next/og` `ImageResponse` with system fonts, static exports (`alt`, `size`, `contentType`).
- Home page (`app/[slug]/(app)/(home)/page.tsx`) injects `LocalBusiness` JSON-LD via inline `buildBusinessJsonLd()` + `<script type="application/ld+json">`.
- Product page (`app/[slug]/(app)/product/[productId]/page.tsx`) injects `Product` JSON-LD the same way.
- Self-hosted fonts in `app/fonts/` (poppins-400.woff2, poppins-700.woff2, etc.).
- Storefront theme: `StorefrontTheme` with `light.dark` → `StorefrontColorConfig` → `palette: { primary, secondary, accent }`. Resolved via `getStorefrontThemeFromPreferences()`, fallback `createDefaultStorefrontTheme()`.
- Business fields: `name`, `slug`, `logoUrl`, `coverImageUrl`, `city`. Product fields: `title`, `price`, `currency`, `media[].mediaUrl`.

---

## 2. Requirements

### T5 — Dynamic OG / Social Share Images

**R1. Home OG image renders per-tenant with business brand.**
- The home page route (`app/[slug]/(app)/(home)/`) exports an `opengraph-image.tsx` that generates a dynamic OG image.
- The image includes: business name, gradient background using the tenant's storefront theme primary color.
- When `business.logoUrl` exists, it is rendered (fetched from Supabase public URL). When absent, falls back to text-only design.
- Image size: 1200×630, content type: `image/png`.

**R2. Product OG image renders per-tenant with product details.**
- The product page route (`app/[slug]/(app)/product/[productId]/`) exports an `opengraph-image.tsx`.
- The image includes: business name, product title, product price (formatted with currency), product image (from `product.media[0].mediaUrl`).
- When product image is missing, shows text-only design with title + price.
- When `business.logoUrl` exists, rendered as small brand badge; otherwise omitted.

**R3. OG images use self-hosted Poppins fonts.**
- The edge-runtime ImageResponse loads `poppins-700.woff2` for headings and `poppins-400.woff2` for body text via `fs.readFileSync` + `ArrayBuffer` conversion.
- Fallback to system fonts if local font loading fails.

**R4. OG images are edge-runtime compatible.**
- No `export const runtime = 'edge'` required (Next.js App Router resolves `opengraph-image.tsx` in edge by default for ImageResponse).
- External fetches (logo/product images) use Supabase public URLs which are edge-accessible.

**R5. OG images gracefully handle missing assets.**
- Missing logo: business name on gradient background (no logo element).
- Missing product image: product title + price on gradient background.
- Missing theme: falls back to default palette (`#6366f1` primary).

### T6 — BreadcrumbList JSON-LD

**R6. BreadcrumbList JSON-LD is injected on the home page.**
- BreadcrumbList with items: `Inicio` (store root URL).
- Injected alongside the existing `LocalBusiness` JSON-LD via `<script type="application/ld+json">`.

**R7. BreadcrumbList JSON-LD is injected on the product page.**
- BreadcrumbList with 3 items: `Inicio` → `{business.name}` (store root) → `{product.title}` (product URL).
- Injected alongside the existing `Product` JSON-LD.

**R8. BreadcrumbList builder is a pure function.**
- A new function `buildStorefrontBreadcrumbs` in `src/shared/seo/buildStorefrontBreadcrumbs.ts` accepts business and optional product, returns a schema.org-valid `BreadcrumbList` object.
- Unit-testable with Vitest.

---

## 3. Acceptance Criteria / Scenarios

### R1 — Home OG image

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| AC1.1 | Normal render | Business has name "Mi Tienda", logoUrl, theme primary `#6366f1` | OG image is requested for `/{slug}` | Image renders at 1200×630 with gradient background, business name in Poppins 700, logo fetched and displayed |
| AC1.2 | No logo | Business has name "Mi Tienda", no logoUrl | OG image is requested | Image renders with business name text only, no logo element |
| AC1.3 | No custom theme | Business has no saved theme preferences | OG image is requested | Image uses default palette primary `#6366f1` |
| AC1.4 | Response type | Any valid business | OG image is requested | Response is `image/png`, 1200×630 |

### R2 — Product OG image

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| AC2.1 | Normal render | Product has title "Zapatillas", price 99.90, currency "PEN", media with mediaUrl | OG image is requested for `/product/{id}` | Image shows product image, title, price "S/ 99.90", business name |
| AC2.2 | No product image | Product has no media | OG image is requested | Image shows title + price on gradient background |
| AC2.3 | No logo | Business has no logoUrl | OG image is requested | No logo badge rendered; product image + title + price only |
| AC2.4 | Price formatting | Product price 150.00, currency "PEN" | OG image is requested | Price shown as "S/ 150.00" |

### R3 — Font loading

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| AC3.1 | Fonts loaded | `app/fonts/poppins-700.woff2` and `poppins-400.woff2` exist | ImageResponse is constructed | Fonts are loaded via `fs.readFileSync` and passed as `ArrayBuffer` to ImageResponse `fonts` option |
| AC3.2 | Fallback | Font file is missing or unreadable | ImageResponse is constructed | Image renders with system font fallback (no crash) |

### R6 — Home BreadcrumbList

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| AC6.1 | Single item | Business "Mi Tienda", slug "mi-tienda" | Home page renders | JSON-LD script contains `BreadcrumbList` with 1 item: `{ name: "Inicio", item: "http://localhost:3000/mi-tienda" }` |
| AC6.2 | Valid schema | Any business | Home page renders | JSON-LD validates as schema.org BreadcrumbList (`@type: BreadcrumbList`, `itemListElement` array with `position` starting at 1) |

### R7 — Product BreadcrumbList

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| AC7.1 | Three items | Business "Mi Tienda", product "Zapatillas Nike", slug "mi-tienda", productSlug "zapatillas-nike" | Product page renders | JSON-LD contains 3 items: `Inicio` → `Mi Tienda` → `Zapatillas Nike`, each with correct URL |
| AC7.2 | Valid schema | Any product | Product page renders | JSON-LD validates as schema.org BreadcrumbList |

### R8 — Pure function

| # | Scenario | Given | When | Then |
|---|----------|-------|------|------|
| AC8.1 | Home breadcrumbs | `buildStorefrontBreadcrumbs(business)` | Called | Returns `{ '@type': 'BreadcrumbList', itemListElement: [{ position: 1, name: 'Inicio', item: url }] }` |
| AC8.2 | Product breadcrumbs | `buildStorefrontBreadcrumbs(business, product)` | Called | Returns BreadcrumbList with 3 items |
| AC8.3 | Missing product | `buildStorefrontBreadcrumbs(business, null)` | Called | Returns home-only BreadcrumbList (1 item) |

---

## 4. Steel Thread (Minimal Vertical Slice)

**Phase 1 — Home OG + Home Breadcrumbs:**
1. Create `app/[slug]/(app)/(home)/opengraph-image.tsx` — dynamic OG image with business name + theme gradient + font loading.
2. Create `src/shared/seo/buildStorefrontBreadcrumbs.ts` — pure function for BreadcrumbList generation.
3. Create `src/shared/seo/__tests__/buildStorefrontBreadcrumbs.test.ts` — unit tests.
4. Inject BreadcrumbList JSON-LD in home page alongside existing LocalBusiness JSON-LD.

**Phase 2 — Product OG + Product Breadcrumbs:**
5. Create `app/[slug]/(app)/product/[productId]/opengraph-image.tsx` — dynamic OG image with product image + title + price + business name.
6. Inject BreadcrumbList JSON-LD in product page alongside existing Product JSON-LD.

---

## 5. Non-Goals (Explicitly NOT in this change)

- **UI breadcrumbs widget** — visual breadcrumb navigation component. Not in scope.
- **T7 Dashboard UX / gating** — SERP preview, "SEO avanzado" plegado, `seoAdvancedEnabled` flag.
- **T8 Alt text** — auto alt text on product images.
- **Domain propio** — custom domain support.
- **Pricing changes** — pricing page fixes.
- **Auth changes** — no auth-related modifications.
- **FAQPage schema** — Google deprecated this in May 2026. Skipped.
- **Category BreadcrumbList** — out of scope for this delta; categories may be added later.

---

## 6. Testability

### Unit Tests (Vitest)

| What | Where | Why |
|------|-------|-----|
| `buildStorefrontBreadcrumbs(business)` | `src/shared/seo/__tests__/buildStorefrontBreadcrumbs.test.ts` | Pure function, easy to test. Verify shape, position numbering, URL correctness, fallback when product is null |
| `buildStorefrontBreadcrumbs(business, product)` | Same file | Verify 3-item list, correct product URL, product title in name |

### Integration / Smoke Tests

| What | How | Why |
|------|-----|-----|
| Home OG image generator exists and type-checks | `pnpm type-check` | Ensures `opengraph-image.tsx` exports are valid |
| Product OG image generator exists and type-checks | `pnpm type-check` | Same |
| BreadcrumbList JSON-LD present in HTML output | Manual: `curl` or browser dev tools on `/{slug}` and `/{slug}/product/{id}`, inspect `<script type="application/ld+json">` | Verify injection works |
| OG image returns 200 with image/png | Manual: hit `/{slug}/opengraph-image` in browser, verify image renders | Smoke test |

### Manual Verification Checklist

- [ ] Home OG: business name visible, gradient matches theme primary, Poppins font rendered
- [ ] Home OG: no logo → text-only, no crash
- [ ] Product OG: product image + title + price visible
- [ ] Product OG: no product image → text-only with title + price
- [ ] Product OG: price formatted with currency symbol (S/ for PEN)
- [ ] Home BreadcrumbList JSON-LD: 1 item, valid schema
- [ ] Product BreadcrumbList JSON-LD: 3 items, valid schema
- [ ] `pnpm type-check` passes
- [ ] `pnpm lint` passes
- [ ] All existing tests pass

---

## 7. Files to Create / Modify

### New Files
| File | Purpose |
|------|---------|
| `app/[slug]/(app)/(home)/opengraph-image.tsx` | Dynamic OG image for home page |
| `app/[slug]/(app)/product/[productId]/opengraph-image.tsx` | Dynamic OG image for product page |
| `src/shared/seo/buildStorefrontBreadcrumbs.ts` | Pure BreadcrumbList builder |
| `src/shared/seo/__tests__/buildStorefrontBreadcrumbs.test.ts` | Unit tests for breadcrumbs |

### Modified Files
| File | Change |
|------|--------|
| `app/[slug]/(app)/(home)/page.tsx` | Inject BreadcrumbList JSON-LD alongside existing LocalBusiness |
| `app/[slug]/(app)/product/[productId]/page.tsx` | Inject BreadcrumbList JSON-LD alongside existing Product |

### Unchanged Files
| File | Reason |
|------|--------|
| `app/opengraph-image.tsx` | Platform fallback remains as-is |
| `src/shared/seo/buildStorefrontMeta.ts` | No changes needed |
| `src/core/storefront/storefrontTheme.ts` | Reused, not modified |

---

## 8. Dependencies & Constraints

- `next/og` `ImageResponse` — already used in root `opengraph-image.tsx`, no new dependency.
- Self-hosted fonts in `app/fonts/` — already present, no new files.
- `getStorefrontColorConfig`, `createDefaultStorefrontTheme` — already exported from `src/core/storefront`.
- `getCanonicalBusinessUrl` — already used in both pages, reuse for breadcrumb URLs.
- Edge runtime compatibility — `ImageResponse` works in edge by default in Next.js App Router.

---

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Font loading in edge runtime may fail if `fs.readFileSync` is unavailable | Fallback to system fonts; verify in edge runtime during implementation |
| External image fetch (logo, product media) may timeout in edge | Use Supabase public URLs (CDN-backed); set reasonable timeout |
| OG image cache invalidation | Next.js handles caching via `revalidate` or on-demand; acceptable for initial implementation |
| Currency formatting for non-PEN | Use `Intl.NumberFormat` with business/product currency; fallback to raw number |

---

## 10. Verification Commands

```bash
pnpm type-check    # Ensure all new files type-check
pnpm lint          # Ensure no lint errors
pnpm vitest run    # Run unit tests (breadcrumbs)
```

Manual:
```bash
# Home OG
curl -I http://localhost:3000/{slug}/opengraph-image
# Product OG
curl -I http://localhost:3000/{slug}/product/{productId}/opengraph-image
# BreadcrumbList (inspect HTML)
curl -s http://localhost:3000/{slug} | grep -A 20 'BreadcrumbList'
curl -s http://localhost:3000/{slug}/product/{productId} | grep -A 20 'BreadcrumbList'
```
