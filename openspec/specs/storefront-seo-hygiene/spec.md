# storefront-seo-hygiene Specification

Permanent capability — technical SEO hygiene for all storefront tenants.

## Purpose

All storefront tenants receive automatic technical SEO hygiene regardless of plan. The system generates strong metadata defaults (title/description templates, per-tenant sitemap, JSON-LD structured data, canonical tags) for every active business. Seller manual SEO fields (`seoTitle`/`seoDescription`/`seoKeywords`) serve as optional overrides; the system produces strong defaults automatically.

The `seoEnabled` flag remains ONLY for dashboard manual SEO controls (settings page). It does NOT gate storefront metadata, sitemap, JSON-LD, or canonical URLs.

## Requirements

### R1: Auto-generated storefront metadata (Home)

Every home page MUST always produce SEO-optimized metadata (title ≤60 chars, description 150-160 chars, canonical URL, OG tags, keywords) regardless of plan.

- Title priority: `business.seoTitle` → `${business.name} — Tienda en ${business.city || 'Perú'}` (truncate at 60 chars)
- Description priority: `business.seoDescription` → `business.description` → `Bienvenido a ${business.name}, tu tienda de confianza en ${business.city || 'Perú'}.` (pad/trim to 150-160 chars)
- `alternates.canonical` via `getCanonicalBusinessUrl(slug)`
- OpenGraph tags present
- `robots` is NEVER `{ index: false, follow: false }` for active businesses

### R2: Auto-generated product metadata

Every product page MUST always produce SEO-optimized metadata (title ≤60 chars, description ≤160 chars, canonical URL, OG tags) regardless of plan.

- Title priority: `product.seoTitle` → `${product.title} - ${business.name}` (truncate at 60 chars)
- Description priority: `product.seoDescription` → `product.description?.slice(0, 160)` → `Compra ${product.title} en ${business.name}` (pad/trim to 160 chars)
- `alternates.canonical` via `getCanonicalBusinessUrl(slug, '/product/${product.slug}')`
- OpenGraph tags with product image

### R3: Per-tenant sitemap

Each tenant MUST have its own sitemap at `[slug]/sitemap.xml` listing home, products, and categories.

- All active businesses get sitemap entries (no `seoEnabled` filtering)
- Each entry has `lastModified` set to the entity's `updatedAt`
- ISR revalidate=3600
- Batched `Promise.all` (no N+1)

### R4: Per-tenant robots.txt

Each tenant MUST have its own `robots.txt` at `[slug]/robots.txt` pointing to the tenant-specific sitemap.

- Rules: `userAgent: '*', allow: '/'`
- Sitemap URL: `${baseUrl}/${slug}/sitemap.xml`

### R5: LocalBusiness JSON-LD for all plans

Every home page MUST always emit `LocalBusiness` structured data regardless of plan. No `seoEnabled` gate.

### R6: Product JSON-LD for all plans

Every product page MUST always emit `Product` structured data with offers regardless of plan. Enhanced with:

- `sku` from `product.externalCode` when present
- `aggregateRating` when `product.stars > 0`

### R7: Seller overrides respected

When a seller has set `seoTitle` or `seoDescription` on their business or product, those values take priority over auto-generated defaults.

### R8: Dashboard SEO gate preserved

The dashboard SEO settings section remains gated behind `seoEnabled`. Free-plan tenants still see the upgrade banner in settings. `seoEnabled` in `plans.ts` is NOT modified.

## Architecture Notes

- Pure functions in `src/shared/seo/buildStorefrontMeta.ts` — no side effects, fully unit-testable
- `getCanonicalBusinessUrl` from `src/shared/utils/url.ts` handles both path-based and subdomain-mode URLs
- `seoEnabled` in `plans.ts` unchanged — `basico: false` stays. Only WHERE it's checked changed: dashboard/settings only, not storefront paths
- No database columns or schema changes needed
- No new dependencies required

## Files

- `src/shared/seo/buildStorefrontMeta.ts` — pure util functions (buildStoreTitle, buildStoreDescription, buildProductTitle, buildProductDescription)
- `src/shared/seo/__tests__/buildStorefrontMeta.test.ts` — 25 unit tests
- `app/[slug]/(app)/(home)/page.tsx` — home page metadata + JSON-LD
- `app/[slug]/(app)/product/[productId]/page.tsx` — product page metadata + JSON-LD
- `app/[slug]/sitemap.ts` — per-tenant sitemap
- `app/[slug]/robots.ts` — per-tenant robots
- `app/sitemap.ts` — root sitemap (all active businesses, no seoEnabled filter)
