'use server';

// =====================================================
// LEGAL — Admin Appeal Review (LEGAL-003)
// =====================================================
// Authenticated, role-guarded server action that resolves a
// seller appeal against auto-deactivation:
//  - approved → business reactivated, deactivation fields cleared
//  - rejected → business stays deactivated
// Every resolution writes the decision to the appeals row,
// resolves the linked deactivation notice, and sends the written
// decision notification (DS 011-2011-PCM notification trail).
// =====================================================

import { db } from '@/core/database/client';
import { appeals, businesses, deactivationNotices } from '@/core/database/schema';
import { appealReviewInputSchema } from '@/features/legal/schemas';
import { requireAuthenticatedUserId } from '@/features/storage/actions/authz';
import { sendAppealDecisionNotification } from '@/lib/legal/gracePeriodWorkflow';
import { logger, toErrorDetail } from '@/lib/logger';
import { getMemberPermissions } from '@/lib/permissions';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import type { z } from 'zod';

export interface AppealReviewResult {
  success: boolean;
  error?: string;
  skipped?: boolean;
  data?: {
    appealId: string;
    businessId: string;
    decision: 'approved' | 'rejected';
    resolution: 'reactivated' | 'upheld';
    reviewedAt: string;
    notificationSent: boolean;
  };
}

/**
 * Resolve a pending seller appeal. Feature-flag guarded: when
 * auto-deactivation is disabled the workflow is inert (no-op
 * success). Requires an authenticated reviewer with owner or
 * admin role on the business.
 */
export async function reviewAppeal(
  input: z.input<typeof appealReviewInputSchema>,
): Promise<AppealReviewResult> {
  // Feature flag: without auto-deactivation there is no appeal
  // lifecycle to act on — return a no-op success.
  if (process.env.ENABLE_AUTO_DEACTIVATION !== 'true') {
    return { success: true, skipped: true };
  }

  const parsed = appealReviewInputSchema.safeParse(input);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message;
    return { success: false, error: firstError || 'Invalid appeal review request' };
  }

  const { appealId, decision, adminNotes } = parsed.data;
  const reviewedAt = parsed.data.decisionTimestampOverride ?? new Date();

  try {
    // Authentication guard (throws when there is no session).
    const reviewerId = await requireAuthenticatedUserId();

    const appeal = await db.query.appeals.findFirst({
      where: eq(appeals.id, appealId),
    });

    if (!appeal) {
      return { success: false, error: 'Appeal not found' };
    }

    if (appeal.status !== 'pending') {
      return { success: false, error: 'Appeal already reviewed' };
    }

    // Role guard: only the business owner or an admin team
    // member may resolve an appeal (team permission pattern).
    const membership = await getMemberPermissions(appeal.businessId, reviewerId);
    if (membership.role !== 'owner' && membership.role !== 'admin') {
      return { success: false, error: 'Admin access required to review appeals' };
    }

    const notes = adminNotes ?? '';

    if (decision === 'approved') {
      // Re-activate the business and clear every deactivation marker.
      await db
        .update(businesses)
        .set({
          isActive: true,
          deactivationReason: null,
          deactivationDate: null,
          appealStatus: 'approved',
          gracePeriodEndsAt: null,
          updatedAt: reviewedAt,
        })
        .where(eq(businesses.id, appeal.businessId));

      await db
        .update(deactivationNotices)
        .set({
          isResolved: true,
          resolvedAt: reviewedAt,
          resolvedBy: 'appeal_approved',
        })
        .where(eq(deactivationNotices.id, appeal.deactivationNoticeId));

      await db
        .update(appeals)
        .set({
          status: 'approved',
          adminReviewerId: reviewerId,
          adminNotes: notes,
          reviewedAt,
          resolution: 'reactivated',
          reactivatedAt: reviewedAt,
        })
        .where(eq(appeals.id, appealId));
    } else {
      // Keep the business deactivated; record the rejection.
      await db
        .update(businesses)
        .set({
          appealStatus: 'rejected',
          updatedAt: reviewedAt,
        })
        .where(eq(businesses.id, appeal.businessId));

      await db
        .update(deactivationNotices)
        .set({
          isResolved: true,
          resolvedAt: reviewedAt,
          resolvedBy: 'admin_override',
        })
        .where(eq(deactivationNotices.id, appeal.deactivationNoticeId));

      await db
        .update(appeals)
        .set({
          status: 'rejected',
          adminReviewerId: reviewerId,
          adminNotes: notes,
          reviewedAt,
          resolution: 'upheld',
        })
        .where(eq(appeals.id, appealId));
    }

    // Written decision notification (DS 011). Non-fatal: the DB
    // record is the compliance trail; email delivery is best-effort.
    let notificationSent = false;
    const notification = await sendAppealDecisionNotification(
      appeal.businessId,
      decision,
      notes,
      decision === 'approved' ? reviewedAt : undefined,
    );
    if (notification.success) {
      notificationSent = true;
    } else {
      console.warn('[AppealReview] Decision notification failed (non-fatal):', notification.error);
    }

    revalidatePath('/', 'layout');

    return {
      success: true,
      data: {
        appealId,
        businessId: appeal.businessId,
        decision,
        resolution: decision === 'approved' ? 'reactivated' : 'upheld',
        reviewedAt: reviewedAt.toISOString(),
        notificationSent,
      },
    };
  } catch (error) {
    logger.error('[AppealReview] Error reviewing appeal:', { error: toErrorDetail(error) });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
