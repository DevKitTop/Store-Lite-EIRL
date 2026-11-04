import { env } from '@/config/env';
import { resolvePublicBusinessRoute, resolvePublicBusinessSlug } from '@/core/business/publicSlug';
import { replaceSlugInPath } from '@/core/business/slug';
import { getMemberPermissions } from '@/lib/permissions/checkPermission';
import { createServerClient } from '@supabase/ssr';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { StorageClient } from './StorageClient';

interface StoragePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: StoragePageProps): Promise<Metadata> {
  const { slug } = await params;
  const business = await resolvePublicBusinessSlug(slug);

  return {
    title: business ? `Almacén — ${business.name}` : 'Almacén',
    description: 'Gestión de inventario y productos.',
    robots: { index: false, follow: false },
  };
}

export default async function StoragePage({ params }: StoragePageProps) {
  const { slug } = await params;

  const resolvedBusiness = await resolvePublicBusinessRoute(slug);
  const business = resolvedBusiness?.business;

  if (!business) {
    return notFound();
  }

  if (resolvedBusiness.matchedAlias) {
    redirect(replaceSlugInPath(`/${slug}/storage`, slug, resolvedBusiness.canonicalSlug));
  }

  // --- Auth & Ownership Guard ---
  const cookieStore = await cookies();
  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return notFound();

  const { isOwner, permissions } = await getMemberPermissions(business.id, user.id);

  if (
    !isOwner &&
    !permissions.includes('products.view') &&
    !permissions.includes('categories.view')
  ) {
    return notFound();
  }

  return (
    <StorageClient
      businessSlug={resolvedBusiness.canonicalSlug}
      businessId={business.id}
      isOwner={isOwner}
      permissions={permissions}
    />
  );
}
