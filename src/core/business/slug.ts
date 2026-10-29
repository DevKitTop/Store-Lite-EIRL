import { db } from '@/core/database/client';
import { isSchemaDriftError } from '@/core/database/safe';
import { businessSlugAliases, businesses } from '@/core/database/schema';
import { and, eq, ne } from 'drizzle-orm';

export interface ResolvedBusinessSlug {
  business: typeof businesses.$inferSelect;
  canonicalSlug: string;
  requestedSlug: string;
  matchedAlias: boolean;
}

// =====================================================
// Reserved slugs — platform-owned paths/businesses that
// sellers must never claim:
//  - 'libro-reclamaciones'  → platform complaint book route (app/(main))
//  - 'devkittop'            → platform business (storage target for
//                             complaint_book_records, migrations/0032)
// =====================================================

export const RESERVED_BUSINESS_SLUGS: ReadonlySet<string> = new Set([
  'devkittop',
  'libro-reclamaciones',
]);

export function isReservedBusinessSlug(slug: string): boolean {
  return RESERVED_BUSINESS_SLUGS.has(slug);
}

function isMissingColumnError(error: unknown): boolean {
  return isSchemaDriftError(error);
}

const SAFE_BUSINESS_COLUMNS = {
  id: businesses.id,
  slug: businesses.slug,
  name: businesses.name,
  ownerId: businesses.ownerId,
  isActive: businesses.isActive,
  verificationStatus: businesses.verificationStatus,
  country: businesses.country,
  city: businesses.city,
  logoUrl: businesses.logoUrl,
  coverImageUrl: businesses.coverImageUrl,
  description: businesses.description,
  whatsappNumber: businesses.whatsappNumber,
  socialLinks: businesses.socialLinks,
  seoTitle: businesses.seoTitle,
  seoDescription: businesses.seoDescription,
  seoKeywords: businesses.seoKeywords,
  paymentFlow: businesses.paymentFlow,
  createdAt: businesses.createdAt,
  updatedAt: businesses.updatedAt,
  culqiBlocked: businesses.culqiBlocked,
  penaltyDebt: businesses.penaltyDebt,
  penaltyCount: businesses.penaltyCount,
  blacklisted: businesses.blacklisted,
  blacklistedAt: businesses.blacklistedAt,
  taxId: businesses.taxId,
  personType: businesses.personType,
  address: businesses.address,
  storeType: businesses.storeType,
  email: businesses.email,
  legalRepName: businesses.legalRepName,
  legalRepRole: businesses.legalRepRole,
  legalRepPhone: businesses.legalRepPhone,
  legalRepEmail: businesses.legalRepEmail,
  latitude: businesses.latitude,
  longitude: businesses.longitude,
  geoRegion: businesses.geoRegion,
  geoPlacename: businesses.geoPlacename,
  verificationData: businesses.verificationData,
  deactivationReason: businesses.deactivationReason,
  deactivationDate: businesses.deactivationDate,
  appealStatus: businesses.appealStatus,
  gracePeriodEndsAt: businesses.gracePeriodEndsAt,
} as const;

export async function resolveBusinessSlug(slug: string): Promise<ResolvedBusinessSlug | null> {
  try {
    const directBusiness = await db.query.businesses.findFirst({
      where: eq(businesses.slug, slug),
    });

    if (directBusiness) {
      return {
        business: directBusiness,
        canonicalSlug: directBusiness.slug,
        requestedSlug: slug,
        matchedAlias: false,
      };
    }

    const alias = await db.query.businessSlugAliases.findFirst({
      where: eq(businessSlugAliases.slug, slug),
      with: {
        business: true,
      },
    });

    if (!alias?.business) {
      return null;
    }

    return {
      business: alias.business,
      canonicalSlug: alias.business.slug,
      requestedSlug: slug,
      matchedAlias: true,
    };
  } catch (error) {
    if (isMissingColumnError(error)) {
      console.error(
        '[resolveBusinessSlug] schema drift detected; falling back to explicit column projection',
        {
          slug,
          error,
        },
      );

      try {
        const directRows = await db
          .select(SAFE_BUSINESS_COLUMNS)
          .from(businesses)
          .where(eq(businesses.slug, slug))
          .limit(1);

        const directBusiness = directRows[0] as typeof businesses.$inferSelect | undefined;

        if (directBusiness) {
          return {
            business: directBusiness,
            canonicalSlug: directBusiness.slug,
            requestedSlug: slug,
            matchedAlias: false,
          };
        }

        const aliasRows = await db
          .select({
            business: SAFE_BUSINESS_COLUMNS,
          })
          .from(businessSlugAliases)
          .innerJoin(businesses, eq(businessSlugAliases.businessId, businesses.id))
          .where(eq(businessSlugAliases.slug, slug))
          .limit(1);

        const aliasBusiness = aliasRows[0]?.business as typeof businesses.$inferSelect | undefined;
        if (!aliasBusiness) {
          return null;
        }

        return {
          business: aliasBusiness,
          canonicalSlug: aliasBusiness.slug,
          requestedSlug: slug,
          matchedAlias: true,
        };
      } catch (fallbackError) {
        console.error('[resolveBusinessSlug] schema drift fallback failed', {
          slug,
          error: fallbackError,
        });
        return null;
      }
    }

    throw error;
  }
}

export async function isBusinessSlugTaken(
  slug: string,
  options?: { excludeBusinessId?: string },
): Promise<boolean> {
  // Platform-owned slugs are always taken (never assignable to sellers).
  if (isReservedBusinessSlug(slug)) {
    return true;
  }

  const businessConflict = await db.query.businesses.findFirst({
    where: options?.excludeBusinessId
      ? and(eq(businesses.slug, slug), ne(businesses.id, options.excludeBusinessId))
      : eq(businesses.slug, slug),
    columns: { id: true },
  });

  if (businessConflict) {
    return true;
  }

  const aliasConflict = await db.query.businessSlugAliases.findFirst({
    where: eq(businessSlugAliases.slug, slug),
    columns: { id: true, businessId: true },
  });

  if (!aliasConflict) {
    return false;
  }

  if (options?.excludeBusinessId && aliasConflict.businessId === options.excludeBusinessId) {
    return false;
  }

  return true;
}

export async function generateAvailableBusinessSlug(
  generator: () => string,
  options?: { excludeBusinessId?: string; maxAttempts?: number },
): Promise<string> {
  const maxAttempts = options?.maxAttempts ?? 10;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const slug = generator();
    if (!(await isBusinessSlugTaken(slug, options))) {
      return slug;
    }
  }

  throw new Error('No se pudo generar un slug disponible.');
}

export function replaceSlugInPath(pathname: string, requestedSlug: string, canonicalSlug: string) {
  if (requestedSlug === canonicalSlug) {
    return pathname;
  }

  const requestedPrefix = `/${requestedSlug}`;
  if (pathname === requestedPrefix) {
    return `/${canonicalSlug}`;
  }

  if (pathname.startsWith(`${requestedPrefix}/`)) {
    return `/${canonicalSlug}${pathname.slice(requestedPrefix.length)}`;
  }

  return pathname;
}
