import { resolvePublicBusinessRoute } from '@/core/business/publicSlug';
import { replaceSlugInPath } from '@/core/business/slug';
import { db } from '@/core/database/client';
import { payments } from '@/core/database/schema';
import { getBusinessEntitlements } from '@/core/entitlements/getBusinessEntitlements';
import { checkPermission } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/server';
import { getBusinessPath } from '@/shared/utils/url';
import { and, eq, inArray } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { PlanExpiredBanner } from './components/PlanExpiredBanner';
import { RealtimeToast } from './components/RealtimeToast';

interface DashboardLayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function DashboardLayout({ children, params }: DashboardLayoutProps) {
  const { slug } = await params;

  const resolvedBusiness = await resolvePublicBusinessRoute(slug);
  const business = resolvedBusiness?.business;

  if (!business) {
    return notFound();
  }

  if (resolvedBusiness.matchedAlias) {
    redirect(replaceSlugInPath(`/${slug}/dashboard`, slug, resolvedBusiness.canonicalSlug));
  }

  const entitlements = await getBusinessEntitlements(business.id);

  let hasPendingOrders = false;

  if (entitlements.plan === 'lite') {
    // Non-terminal order statuses that keep the dashboard accessible
    const activeStatuses: (typeof payments.$inferSelect.status)[] = [
      'pending',
      'paid',
      'validando',
      'not_delivered',
      'en_reparto',
      'disputed',
      'refund_requested',
    ];

    const pendingOrder = await db.query.payments.findFirst({
      where: and(eq(payments.businessId, business.id), inArray(payments.status, activeStatuses)),
      columns: { id: true },
    });

    if (!pendingOrder) {
      redirect(getBusinessPath(resolvedBusiness.canonicalSlug));
    }

    hasPendingOrders = true;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAllowed = await checkPermission(business.id, user?.id, 'dashboard.view');
  if (!isAllowed) {
    redirect(getBusinessPath(resolvedBusiness.canonicalSlug));
  }

  return (
    <>
      <RealtimeToast />
      {hasPendingOrders && <PlanExpiredBanner />}
      {children}
    </>
  );
}
