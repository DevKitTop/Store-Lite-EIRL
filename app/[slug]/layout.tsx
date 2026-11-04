import { resolvePublicBusinessRoute } from '@/core/business/publicSlug';
import { replaceSlugInPath } from '@/core/business/slug';
import { notFound, redirect } from 'next/navigation';

interface BusinessLayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

/**
 * Minimal parent layout for all /[slug]/* routes.
 *
 * Only resolves the business slug and handles redirects for alias slugs.
 * Auth, BusinessProviders and AppLayout live in (app)/layout.tsx.
 * Public pages in (public)/ use their own minimal layout.
 */
export default async function BusinessLayout({ children, params }: BusinessLayoutProps) {
  const { slug } = await params;

  const resolved = await resolvePublicBusinessRoute(slug);
  const business = resolved?.business;

  if (!business) {
    return notFound();
  }

  if (resolved.matchedAlias) {
    redirect(replaceSlugInPath(`/${slug}`, slug, resolved.canonicalSlug));
  }

  return <>{children}</>;
}
