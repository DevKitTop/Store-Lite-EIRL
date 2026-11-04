/**
 * What the public storefront is allowed to render.
 *
 * This is deliberately a subset of the `businesses` row. The full row carries
 * `verification_data`, `legal_rep_email`, `penalty_debt`, `blacklisted` and the
 * owner linkage; none of that may reach a component tree that an anonymous
 * visitor can inspect.
 *
 * The projection is produced by `public.public_business_by_slug` (migration
 * 0009) so the boundary exists in the database too, not only in TypeScript.
 *
 * `taxId`, `geoRegion` and `geoPlacename` are included on purpose: the
 * storefront already publishes the RUC through structured data and shows the
 * region metadata for local SEO. Removing them would be a regression, not a
 * hardening.
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
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  email: string | null;
  personType: string | null;
  verificationStatus: 'unverified' | 'pending' | 'verified' | 'rejected';
  socialLinks: Record<string, string> | null;
  heroImages: string[] | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string[] | null;
  paymentFlow: string[] | null;
  geoRegion: string | null;
  geoPlacename: string | null;
  latitude: string | null;
  longitude: string | null;
  taxId: string | null;
  createdAt: Date;
  isActive: boolean;
}

export type { Business } from '@/core/database/schema';
