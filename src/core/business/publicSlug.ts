import { db } from '@/core/database/client';
import type { PublicBusiness } from '@/types/business';
import { sql } from 'drizzle-orm';

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
 * Use this from any route that renders for anonymous visitors, including the
 * storefront home and its layout. Authenticated seller screens keep the full
 * resolver until their domain moves to the tenant context.
 */
export async function resolvePublicBusinessSlug(slug: string): Promise<PublicBusiness | null> {
  const rows = (await db.execute(sql`
    select * from public.public_business_by_slug(${slug})
  `)) as unknown as PublicBusinessRow[];

  const row = rows.at(0);
  return row ? toPublicBusiness(row) : null;
}
