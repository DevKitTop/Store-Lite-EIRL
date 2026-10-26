// =====================================================
// SERVER ACTION: Get Business Trust Score
// =====================================================
// Fetches trust score data for storefront banner display.
// Feature flag: ENABLE_AUTO_DEACTIVATION
// =====================================================

'use server';

import { db } from '@/core/database/client';
import { businesses, complaintBookRecords } from '@/core/database/schema';
import { calculateBusinessIncompleteOrderRate } from '@/lib/incompleteOrderRate';
import { get30DayWindowStart } from '@/lib/incompleteOrderRateCore';
import { and, eq, gte } from 'drizzle-orm';

export interface BusinessTrustScore {
  businessId: string;
  businessName: string;
  kybVerified: boolean;
  trustLevel: 'verified' | 'confiable' | 'new' | 'warning' | 'deactivated';
  verifiedComplaints30d: number;
  incompleteRate30d: number;
  deactivationRisk: 'none' | 'verified_complaints' | 'incomplete_orders';
  shouldShowBanner: boolean;
}

/**
 * Get business trust score for storefront display.
 * Returns data needed for BusinessBadge and complaint banner.
 */
export async function getBusinessTrustScore(
  businessId: string,
): Promise<BusinessTrustScore | null> {
  // Feature flag guard
  if (process.env.ENABLE_AUTO_DEACTIVATION !== 'true') {
    return null;
  }

  // The trust score is optional storefront enrichment (a badge/banner). It must
  // never take the whole storefront render down: a schema drift or a transient
  // DB failure here used to surface as a 500 on every /[slug] page.
  try {
    return await computeBusinessTrustScore(businessId);
  } catch (error) {
    console.error('[storefront] getBusinessTrustScore failed; hiding trust banner', {
      businessId,
      error,
    });
    return null;
  }
}

async function computeBusinessTrustScore(businessId: string): Promise<BusinessTrustScore | null> {
  // Fetch business
  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: {
      id: true,
      name: true,
      isActive: true,
      verificationStatus: true,
    },
  });

  if (!business) {
    return null;
  }

  // If business is inactive, return deactivated status
  if (!business.isActive) {
    return {
      businessId: business.id,
      businessName: business.name,
      kybVerified: business.verificationStatus === 'verified',
      trustLevel: 'deactivated',
      verifiedComplaints30d: 0,
      incompleteRate30d: 0,
      deactivationRisk: 'none',
      shouldShowBanner: true,
    };
  }

  const windowStart = get30DayWindowStart();

  // Count verified complaints in last 30 days
  const verifiedComplaints = await db
    .select({ id: complaintBookRecords.id })
    .from(complaintBookRecords)
    .where(
      and(
        eq(complaintBookRecords.businessId, businessId),
        eq(complaintBookRecords.isVerified, true),
        gte(complaintBookRecords.verifiedAt, windowStart),
      ),
    );

  const verifiedComplaints30d = verifiedComplaints.length;

  // Calculate incomplete order rate
  const rateResult = await calculateBusinessIncompleteOrderRate(businessId);
  const incompleteRate30d = rateResult.incompleteRate;

  // Determine trust level and deactivation risk
  let trustLevel: BusinessTrustScore['trustLevel'] = 'new';
  let deactivationRisk: BusinessTrustScore['deactivationRisk'] = 'none';
  let shouldShowBanner = false;

  if (verifiedComplaints30d >= 3) {
    trustLevel = 'warning';
    deactivationRisk = 'verified_complaints';
    shouldShowBanner = true;
  } else if (verifiedComplaints30d >= 2) {
    trustLevel = 'warning';
    shouldShowBanner = true;
  } else if (rateResult.exceedsThreshold) {
    trustLevel = 'warning';
    deactivationRisk = 'incomplete_orders';
    shouldShowBanner = true;
  } else if (business.verificationStatus === 'verified') {
    trustLevel = 'confiable';
  }

  return {
    businessId: business.id,
    businessName: business.name,
    kybVerified: business.verificationStatus === 'verified',
    trustLevel,
    verifiedComplaints30d,
    incompleteRate30d,
    deactivationRisk,
    shouldShowBanner,
  };
}
