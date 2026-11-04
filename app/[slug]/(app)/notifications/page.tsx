import { resolvePublicBusinessRoute } from '@/core/business/publicSlug';
import { replaceSlugInPath } from '@/core/business/slug';
import { getBusinessEntitlements } from '@/core/entitlements/getBusinessEntitlements';
import { getMemberPermissions } from '@/lib/permissions/checkPermission';
import { createClient } from '@/lib/supabase/server';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getAvailableCategoryIds } from './categoryAccess';
import NotificationsClient from './NotificationsClient';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const business = (await resolvePublicBusinessRoute(slug))?.business;

  if (!business) {
    return {
      title: 'Negocio No Encontrado',
    };
  }

  return {
    title: `Notificaciones - ${business.name}`,
    description: `Centro de notificaciones para ${business.name}`,
  };
}

export default async function NotificationsPage({ params }: Props) {
  const { slug } = await params;
  const resolvedBusiness = await resolvePublicBusinessRoute(slug);
  const business = resolvedBusiness?.business;

  if (!business) {
    return notFound();
  }

  if (resolvedBusiness.matchedAlias) {
    redirect(replaceSlugInPath(`/${slug}/notifications`, slug, resolvedBusiness.canonicalSlug));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/list-business');
  }

  const { isOwner, permissions } = await getMemberPermissions(business.id, user.id);

  if (!isOwner && !permissions.includes('notifications.view')) {
    redirect('/list-business');
  }

  const entitlements = await getBusinessEntitlements(business.id);
  const availableCategoryIds = getAvailableCategoryIds(entitlements);

  return (
    <NotificationsClient businessName={business.name} availableCategoryIds={availableCategoryIds} />
  );
}
