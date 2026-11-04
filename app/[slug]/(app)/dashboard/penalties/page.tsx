import { resolvePublicBusinessRoute } from '@/core/business/publicSlug';
import { replaceSlugInPath } from '@/core/business/slug';
import { getBusinessEntitlements } from '@/core/entitlements/getBusinessEntitlements';
import { notFound, redirect } from 'next/navigation';
import PenaltiesClient from './PenaltiesClient';

interface PenaltiesPageProps {
  params: Promise<{ slug: string }>;
}

export default async function PenaltiesPage({ params }: PenaltiesPageProps) {
  const { slug } = await params;

  // 1. Resolve business from slug
  const resolvedBusiness = await resolvePublicBusinessRoute(slug);
  const business = resolvedBusiness?.business;

  if (!business) {
    return notFound();
  }

  if (resolvedBusiness.matchedAlias) {
    redirect(
      replaceSlugInPath(`/${slug}/dashboard/penalties`, slug, resolvedBusiness.canonicalSlug),
    );
  }

  // 2. Get entitlements for Culqi public key
  const entitlements = await getBusinessEntitlements(business.id);

  return (
    <PenaltiesClient
      businessId={business.id}
      slug={slug}
      culqiPublicKey={entitlements.culqiPublicKey}
    />
  );
}
