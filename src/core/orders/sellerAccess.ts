import { db } from '@/core/database/client';
import { businessTeamMembers } from '@/core/database/schema';
import { isBusinessOwner } from '@/lib/permissions/checkPermission';
import { and, eq } from 'drizzle-orm';

/**
 * Is this user part of the selling side of THIS business?
 *
 * Two callers ask this for different reasons — the public order page refuses
 * sellers so they cannot confirm their own orders, and the legacy lookup route
 * refuses them so they cannot mint a tracking token for one — but it is one
 * rule, and it belongs in one place.
 *
 * It used to be written twice, differently, and both copies were wrong in ways
 * that cancelled out only by accident: one skipped the membership test when the
 * user owned nothing, the other skipped it when the user owned something. The
 * predicate is scoped by `businessId` on purpose. Asking "does this user own
 * some business" answers a different question, and that difference is exactly
 * what let a seller through.
 *
 * Ownership goes through `is_business_owner` because `businesses` is not
 * granted to the runtime role: it also holds `tax_id` and verification data,
 * and RLS filters rows, never columns.
 */
export async function isBusinessSeller(businessId: string, userId?: string): Promise<boolean> {
  if (!userId) {
    return false;
  }

  const membership = await db.query.businessTeamMembers.findFirst({
    where: and(
      eq(businessTeamMembers.businessId, businessId),
      eq(businessTeamMembers.userId, userId),
    ),
    columns: { id: true },
  });

  if (membership) {
    return true;
  }

  return isBusinessOwner(businessId, userId);
}
