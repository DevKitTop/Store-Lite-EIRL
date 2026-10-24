import { replaceSlugInPath, resolveBusinessSlug } from '@/core/business/slug';
import { db } from '@/core/database/client';
import { products as productsTable } from '@/core/database/schema';
import { getBusinessEntitlements } from '@/core/entitlements/getBusinessEntitlements';
import { buildProductBreadcrumbs } from '@/shared/seo/buildStorefrontBreadcrumbs';
import { buildProductDescription, buildProductTitle } from '@/shared/seo/buildStorefrontMeta';
import { toSafeJsonLd } from '@/shared/utils/safeJsonLd';
import { getCanonicalBusinessUrl } from '@/shared/utils/url';
import { and, eq, or } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { CartShell } from '../../components/CartShell';
import ProductDetailContent from './components/ProductDetailContent';

interface Props {
  params: Promise<{ slug: string; productId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, productId } = await params;

  const business = (await resolveBusinessSlug(slug))?.business;

  if (!business) return {};

  const product = await db.query.products.findFirst({
    where: and(
      eq(productsTable.businessId, business.id),
      or(eq(productsTable.id, productId), eq(productsTable.slug, productId)),
    ),
    with: {
      media: {
        orderBy: (m, { asc }) => [asc(m.displayOrder)],
        limit: 1,
      },
    },
  });

  if (!product) return {};

  const title = buildProductTitle(product, business);
  const description = buildProductDescription(product, business);

  const productSlug = product.slug || product.id;
  const canonicalUrl = getCanonicalBusinessUrl(business.slug, `/product/${productSlug}`);

  return {
    title,
    description,
    keywords: product.tags?.join(', '),
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title,
      description,
      url: canonicalUrl,
      images: product.media?.[0]?.mediaUrl ? [{ url: product.media[0].mediaUrl }] : [],
      type: 'website',
    },
  };
}

export default async function ProductDetailPage({ params }: Props) {
  const { slug, productId } = await params;

  const resolvedBusiness = await resolveBusinessSlug(slug);
  const businessDetail = resolvedBusiness?.business;

  if (!businessDetail) {
    notFound();
  }

  if (resolvedBusiness.matchedAlias) {
    redirect(
      replaceSlugInPath(`/${slug}/product/${productId}`, slug, resolvedBusiness.canonicalSlug),
    );
  }

  const product = await db.query.products.findFirst({
    where: and(
      eq(productsTable.businessId, businessDetail.id),
      or(eq(productsTable.id, productId), eq(productsTable.slug, productId)),
    ),
    with: {
      media: {
        orderBy: (m, { asc }) => [asc(m.displayOrder)],
        limit: 1,
      },
    },
  });

  if (!product) {
    notFound();
  }

  const entitlements = await getBusinessEntitlements(businessDetail.id);
  const { hasPaymentGateway } = entitlements;
  const paymentsEnabled = hasPaymentGateway && entitlements.isPaymentConfigured;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description: product.description,
    image: product.media?.[0]?.mediaUrl,
    sku: product.externalCode || undefined,
    brand: {
      '@type': 'Brand',
      name: product.brand || businessDetail.name,
    },
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: product.currency,
      availability: product.isAvailable
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      seller: {
        '@type': 'Organization',
        name: businessDetail.name,
      },
    },
    ...(product.stars && product.stars > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: product.stars,
            bestRating: 5,
          },
        }
      : {}),
  };

  const breadcrumbJsonLd = buildProductBreadcrumbs(businessDetail, product);

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
      <ProductDetailContent
        slug={resolvedBusiness.canonicalSlug}
        productId={productId}
        hasPaymentGateway={hasPaymentGateway}
        isPaymentConfigured={entitlements.isPaymentConfigured}
        culqiPublicKey={entitlements.culqiPublicKey}
      />
      <CartShell
        hasPaymentGateway={paymentsEnabled}
        culqiPublicKey={entitlements.culqiPublicKey}
        businessId={businessDetail.id}
        businessName={businessDetail.name}
        businessAddress={businessDetail.address ?? undefined}
        businessCity={businessDetail.city ?? undefined}
        businessLogoUrl={businessDetail.logoUrl ?? undefined}
        business={businessDetail}
      />
    </>
  );
}
