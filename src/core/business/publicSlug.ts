import { db } from '@/core/database/client';
import { sql } from 'drizzle-orm';

/**
 * Shape every anonymous visitor may see. It is a deliberate subset of
 * `businesses`: no tax id, no legal representative, no verification data, no
 * penalty or blacklist state.
 *
 * The projection lives in `public.public_business_by_slug` (migration 0008)
 * because a single runtime role cannot be granted the seller columns while
 * withholding the public ones. Row-level security filters rows, never columns.
 */
export interface PublicBusiness {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  description: string | null;
  storeType: string | null;
  whatsappNumber: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  socialLinks: Record<string, unknown> | null;
  heroImages: string[] | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string | null;
  paymentFlow: string[] | null;
  latitude: string | null;
  longitude: string | null;
  isActive: boolean;
}

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
  social_links: Record<string, unknown> | null;
  hero_images: string[] | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_keywords: string | null;
  payment_flow: string[] | null;
  latitude: string | null;
  longitude: string | null;
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
    latitude: row.latitude,
    longitude: row.longitude,
    isActive: row.is_active,
  };
}

/**
 * Resolve a storefront slug (or a retired alias) to the public projection.
 *
 * Use this from routes that serve anonymous visitors. Authenticated seller
 * surfaces keep the full resolver until their domain moves to the tenant
 * context.
 */
export async function resolvePublicBusinessSlug(slug: string): Promise<PublicBusiness | null> {
  const rows = (await db.execute(sql`
    select * from public.public_business_by_slug(${slug})
  `)) as unknown as PublicBusinessRow[];

  const row = rows.at(0);
  return row ? toPublicBusiness(row) : null;
}
