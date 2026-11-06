import { db } from '@/core/database/client';
import type { PublicBusiness } from '@/types/business';
import { sql } from 'drizzle-orm';
import { cache } from 'react';

export type { PublicBusiness };

/**
 * Raw shape returned by `public.public_business_by_slug`.
 *
 * `latitude` and `longitude` arrive as strings because the columns are
 * `numeric`; `hero_images` and `payment_flow` are `text[]`.
 */
interface PublicBusinessRow {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  cover_image_url: string | null;
  description: string | null;
  store_type: string | null;
  whatsapp_number: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  social_links: Record<string, string> | null;
  hero_images: string[] | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_keywords: string[] | null;
  payment_flow: string[] | null;
  geo_region: string | null;
  geo_placename: string | null;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  email: string | null;
  person_type: string | null;
  verification_status: 'unverified' | 'pending' | 'verified' | 'rejected';
  created_at: Date;
  latitude: string | null;
  longitude: string | null;
  tax_id: string | null;
  is_active: boolean;
}

function toPublicBusiness(row: PublicBusinessRow): PublicBusiness {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    logoUrl: row.logo_url,
    coverImageUrl: row.cover_image_url,
    description: row.description,
    storeType: row.store_type,
    whatsappNumber: row.whatsapp_number,
    address: row.address,
    city: row.city,
    country: row.country,
    socialLinks: row.social_links,
    heroImages: row.hero_images,
    seoTitle: row.seo_title,
    seoDescription: row.seo_description,
    seoKeywords: row.seo_keywords,
    paymentFlow: row.payment_flow,
    geoRegion: row.geo_region,
    geoPlacename: row.geo_placename,
    departamento: row.departamento,
    provincia: row.provincia,
    distrito: row.distrito,
    email: row.email,
    personType: row.person_type,
    verificationStatus: row.verification_status,
    createdAt: row.created_at,
    latitude: row.latitude,
    longitude: row.longitude,
    taxId: row.tax_id,
    isActive: row.is_active,
  };
}

/**
 * Resolve a storefront slug (or a retired alias) to the public projection.
 *
 * This is the way application code reads a business. The full row is not
 * granted to the runtime role and must not come back through a helper: private
 * fields are served by narrower functions, one per consumer that needs them.
 *
 * Wrapped in React `cache` on purpose: one request resolves the same slug from
 * the layout, the group layout, `generateMetadata` and the page. Without it the
 * storefront paid for four identical calls to `public_business_by_slug` before
 * rendering anything. The cache is per request, never across requests.
 */
export const resolvePublicBusinessSlug = cache(
  async (slug: string): Promise<PublicBusiness | null> => {
    const rows = (await db.execute(sql`
    select * from public.public_business_by_slug(${slug})
  `)) as unknown as PublicBusinessRow[];

    const row = rows.at(0);
    return row ? toPublicBusiness(row) : null;
  },
);

/**
 * Routing-aware variant of {@link resolvePublicBusinessSlug}.
 *
 * Screens that redirect retired aliases to the canonical slug need to know
 * whether the requested slug was an alias and what the canonical one is. This
 * keeps that metadata out of the plain resolver, and keeps the same shape the
 * previous full-row resolver returned, so call sites only swap the function.
 */
export interface ResolvedPublicBusiness {
  business: PublicBusiness;
  canonicalSlug: string;
  requestedSlug: string;
  matchedAlias: boolean;
}

export async function resolvePublicBusinessRoute(
  slug: string,
): Promise<ResolvedPublicBusiness | null> {
  const business = await resolvePublicBusinessSlug(slug);

  if (!business) {
    return null;
  }

  return {
    business,
    canonicalSlug: business.slug,
    requestedSlug: slug,
    matchedAlias: business.slug !== slug,
  };
}
