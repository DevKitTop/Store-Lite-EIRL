import { getBusinessTrustScore } from '@/actions/business/getBusinessTrustScore';
import { resolvePublicBusinessSlug } from '@/core/business/publicSlug';
import { replaceSlugInPath } from '@/core/business/slug';
import { db } from '@/core/database/client';
import { businessSettings, productCategories } from '@/core/database/schema';
import { getBusinessEntitlements } from '@/core/entitlements/getBusinessEntitlements';
import {
  buildStorefrontThemeStyleTag,
  createDefaultStorefrontTheme,
  getStorefrontLayoutFromPreferences,
  getStorefrontThemeFromPreferences,
  hasCustomStorefrontTheme,
} from '@/core/storefront';
import { getMemberPermissions } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { buildHomeBreadcrumbs } from '@/shared/seo/buildStorefrontBreadcrumbs';
import { buildStoreDescription, buildStoreTitle } from '@/shared/seo/buildStorefrontMeta';
import { toSafeJsonLd } from '@/shared/utils/safeJsonLd';
import { getCanonicalBusinessUrl } from '@/shared/utils/url';
import type { PublicBusiness } from '@/types/business';
import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import BusinessPageContent from '../BusinessPageContent';

interface Props {
  params: Promise<{ slug: string }>;
}

function buildBusinessJsonLd(business: PublicBusiness) {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: business.name,
    description: business.seoDescription || business.description,
    url: getCanonicalBusinessUrl(business.slug),
    logo: business.logoUrl,
    image: business.coverImageUrl,
    address: {
      '@type': 'PostalAddress',
      streetAddress: business.address,
      addressLocality: business.city,
      addressCountry: business.country || 'PE',
    },
    geo:
      business.latitude && business.longitude
        ? {
            '@type': 'GeoCoordinates',
            latitude: business.latitude,
            longitude: business.longitude,
          }
        : undefined,
    telephone: business.whatsappNumber,
  };
}

function buildBusinessGeoMeta(business: PublicBusiness) {
  return {
    ...(business.geoRegion && { 'geo.region': business.geoRegion }),
    ...(business.geoPlacename && { 'geo.placename': business.geoPlacename }),
    ...(business.city && !business.geoPlacename && { 'geo.placename': business.city }),
    ...(business.latitude &&
      business.longitude && {
        'geo.position': `${business.latitude};${business.longitude}`,
        ICBM: `${business.latitude}, ${business.longitude}`,
      }),
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const business = await resolvePublicBusinessSlug(slug);

  if (!business) {
    return {
      title: 'Business Not Found',
    };
  }

  const title = buildStoreTitle(business);
  const description = buildStoreDescription(business);

  const canonicalUrl = getCanonicalBusinessUrl(business.slug);

  return {
    title,
    description,
    keywords: business.seoKeywords?.join(', '),
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      type: 'website',
      ...(business.logoUrl && { images: [{ url: business.logoUrl }] }),
    },
    other: buildBusinessGeoMeta(business),
  };
}

export default async function BusinessPage({ params }: Props) {
  const { slug } = await params;
  const business = await resolvePublicBusinessSlug(slug);

  if (!business) {
    return notFound();
  }

  if (business.slug !== slug) {
    redirect(replaceSlugInPath(`/${slug}`, slug, business.slug));
  }

  // Everything below depends only on the business id, so it runs as one wave
  // instead of one round trip after another. The session read joins the wave
  // because `auth.getUser` is already a network call for signed-in visitors.
  const [categories, settings, entitlements, trustSignal, user] = await Promise.all([
    db.query.productCategories.findMany({
      where: eq(productCategories.businessId, business.id),
      orderBy: (categories, { asc }) => [asc(categories.displayOrder)],
    }),
    db.query.businessSettings.findFirst({
      where: eq(businessSettings.businessId, business.id),
      columns: {
        preferences: true,
        themeMode: true,
      },
    }),
    getBusinessEntitlements(business.id),
    getBusinessTrustScore(business.id),
    createClient().then(async (supabase) => {
      const { data } = await supabase.auth.getUser();
      return data.user;
    }),
  ]);

  const isLoggedIn = !!user;

  // Acceso basado en dueño o equipo
  const { isOwner, permissions } = await getMemberPermissions(business.id, user?.id);

  // Consideramos staff a quien tenga acceso de gestión (Dueño o Miembro con algún permiso)
  const isStaff = isOwner || permissions.length > 0;

  const { hasPaymentGateway, chatEnabled } = entitlements;

  const jsonLd = buildBusinessJsonLd(business);
  const breadcrumbJsonLd = buildHomeBreadcrumbs(business);

  const allProducts = await db.query.products.findMany({
    where: (p, { and, eq }) => {
      const basicFilter = eq(p.businessId, business.id);
      // El staff (dueño+equipo) ve todos los productos para poder gestionarlos
      return isStaff ? basicFilter : and(basicFilter, eq(p.isAvailable, true));
    },
    orderBy: (p, { desc }) => [desc(p.updatedAt)],
    with: {
      media: {
        orderBy: (m, { asc }) => [asc(m.displayOrder)],
      },
      category: true,
    },
  });

  const savedStorefrontTheme = hasCustomStorefrontTheme(settings?.preferences)
    ? getStorefrontThemeFromPreferences(settings?.preferences)
    : undefined;

  const defaultScheme = settings?.themeMode ?? 'light';
  const effectiveStorefrontTheme = savedStorefrontTheme ?? createDefaultStorefrontTheme();
  const ssrThemeStyleTag = buildStorefrontThemeStyleTag(effectiveStorefrontTheme, defaultScheme);

  // DS 011 customer-facing trust signal: same data source as the complaint
  // banner (getBusinessTrustScore). Returns null when ENABLE_AUTO_DEACTIVATION
  // is off, which ALSO gates the badge — mirroring the banner's gating. It is
  // part of the parallel wave above so it costs no extra round trip.

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: toSafeJsonLd(jsonLd) }}
        />
      )}
      {breadcrumbJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: toSafeJsonLd(breadcrumbJsonLd) }}
        />
      )}
      <style dangerouslySetInnerHTML={{ __html: ssrThemeStyleTag }} />
      <BusinessPageContent
        business={business}
        isOwner={isOwner}
        isStaff={isStaff}
        isLoggedIn={isLoggedIn}
        categories={categories.slice(0, 7)}
        products={allProducts}
        hasPaymentGateway={hasPaymentGateway}
        isPaymentConfigured={entitlements.isPaymentConfigured}
        culqiPublicKey={entitlements.culqiPublicKey}
        chatEnabled={chatEnabled}
        storefrontLayout={getStorefrontLayoutFromPreferences(settings?.preferences)}
        storefrontTheme={savedStorefrontTheme}
        previewCardTheme={savedStorefrontTheme}
        businessName={business.name}
        businessRuc={business.taxId ?? undefined}
        businessAddress={business.address ?? undefined}
        defaultScheme={settings?.themeMode ?? 'light'}
        trustSignal={trustSignal}
      />
    </>
  );
}
