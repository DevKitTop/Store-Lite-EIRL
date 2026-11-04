import { env } from '@/config/env';
import { resolvePublicBusinessRoute } from '@/core/business/publicSlug';
import { replaceSlugInPath } from '@/core/business/slug';
import { getMemberPermissions } from '@/lib/permissions/checkPermission';
import { createServerClient } from '@supabase/ssr';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { FeedbackPageClient } from './pageClient';

interface FeedbackPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: FeedbackPageProps): Promise<Metadata> {
  const { slug } = await params;
  const business = (await resolvePublicBusinessRoute(slug))?.business;

  return {
    title: business ? `Feedback — ${business.name}` : 'Feedback',
    description: 'Enviá feedback, sugerencias o reportá bugs.',
    robots: { index: false, follow: false },
  };
}

export default async function FeedbackPage({ params }: FeedbackPageProps) {
  const { slug } = await params;

  const resolvedBusiness = await resolvePublicBusinessRoute(slug);
  const business = resolvedBusiness?.business;

  if (!business) {
    return notFound();
  }

  if (resolvedBusiness.matchedAlias) {
    redirect(replaceSlugInPath(`/${slug}/ayuda`, slug, resolvedBusiness.canonicalSlug));
  }

  // --- Auth & Permission Guard ---
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

  if (!user) {
    return notFound();
  }

  const { role } = await getMemberPermissions(business.id, user.id);

  if (!role) {
    return notFound();
  }
  // ------------------------------

  // Determine priority from subscription
  const { getFeedbackPriority } = await import('@/features/feedback/actions');
  const priority = await getFeedbackPriority(business.id);

  return <FeedbackPageClient businessId={business.id} priority={priority} userRole={role} />;
}
