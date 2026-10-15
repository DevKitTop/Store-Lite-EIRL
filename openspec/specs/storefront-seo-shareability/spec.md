# storefront-seo-shareability Specification

Permanent capability — social share images and breadcrumb structured data for all storefront tenants.

## Purpose

All storefront tenants receive automatic social share optimization and breadcrumb structured data regardless of plan. The system generates dynamic Open Graph images per-tenant (using business brand colors and logos) and BreadcrumbList JSON-LD structured data for home and product pages. Both features require zero seller effort and apply to all plans without gating.

## Requirements

### R1: Dynamic OG image for home page

Every home page route (`app/[slug]/(app)/(home)/`) MUST export an `opengraph-image.tsx` that generates a dynamic OG image per-tenant.

- Image includes: business name, gradient background using the tenant's storefront theme primary color
- When `business.logoUrl` exists, it is rendered (fetched from Supabase public URL). When absent, falls back to text-only design
- Image size: 1200×630, content type: `image/png`
- Uses self-hosted Poppins fonts (`poppins-700.woff2` for headings, `poppins-400.woff2` for body text)
- Falls back to system fonts if local font loading fails

### R2: Dynamic OG image for product page

Every product page route (`app/[slug]/(app)/product/[productId]/`) MUST export an `opengraph-image.tsx` that generates a dynamic OG image per-tenant.

- Image includes: business name, product title, product price (formatted with currency), product image (from `product.media[0].mediaUrl`)
- When product image is missing, shows text-only design with title + price
- When `business.logoUrl` exists, rendered as small brand badge; otherwise omitted
- Image size: 1200×630, content type: `image/png`

### R3: BreadcrumbList JSON-LD for home page

Every home page MUST inject `BreadcrumbList` structured data alongside existing `LocalBusiness` JSON-LD.

- BreadcrumbList with items: `Inicio` (store root URL)
- Injected via `<script type="application/ld+json">` following existing pattern

### R4: BreadcrumbList JSON-LD for product page

Every product page MUST inject `BreadcrumbList` structured data alongside existing `Product` JSON-LD.

- BreadcrumbList with 3 items: `Inicio` → `{business.name}` (store root) → `{product.title}` (product URL)
- Injected via `<script type="application/ld+json">` following existing pattern

### R5: Pure BreadcrumbList builder function

A pure function `buildStorefrontBreadcrumbs` in `src/shared/seo/buildStorefrontBreadcrumbs.ts` MUST generate BreadcrumbList objects.

- Accepts business and optional product parameters
- Returns schema.org-valid `BreadcrumbList` object
- Unit-testable with Vitest

### R6: Edge-runtime compatibility

OG image generators MUST be edge-runtime compatible.

- No `export const runtime = 'edge'` required (Next.js App Router resolves `opengraph-image.tsx` in edge by default)
- External fetches (logo/product images) use Supabase public URLs which are edge-accessible
- Graceful handling of missing assets with text-only fallbacks

## Architecture Notes

- Pure functions in `src/shared/seo/buildStorefrontBreadcrumbs.ts` — no side effects, fully unit-testable
- Font loading in `src/shared/seo/ogFonts.ts` — shared helper for OG image font loading
- OG generators follow existing pattern from root `app/opengraph-image.tsx` but with dynamic data
- BreadcrumbList injection follows existing JSON-LD pattern in home and product pages
- Theme colors resolved via `getStorefrontColorConfig` from `src/core/storefront/storefrontTheme.ts`
- Business/product data resolved via existing `resolveBusinessSlug` and database queries
- No new dependencies required

## Files

- `src/shared/seo/buildStorefrontBreadcrumbs.ts` — pure BreadcrumbList builder functions
- `src/shared/seo/__tests__/buildStorefrontBreadcrumbs.test.ts` — 12 unit tests
- `src/shared/seo/ogFonts.ts` — Poppins font loader for OG images
- `app/[slug]/(app)/(home)/opengraph-image.tsx` — dynamic home OG generator
- `app/[slug]/(app)/product/[productId]/opengraph-image.tsx` — dynamic product OG generator
- `app/[slug]/(app)/(home)/page.tsx` — home page with BreadcrumbList injection
- `app/[slug]/(app)/product/[productId]/page.tsx` — product page with BreadcrumbList injection
