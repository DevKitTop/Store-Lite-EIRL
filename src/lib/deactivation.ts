// =====================================================
// AUTO-DEACTIVATION CORE LOGIC
// =====================================================
// Main deactivation engine that checks triggers and executes deactivation.
// Feature flag: ENABLE_AUTO_DEACTIVATION
// =====================================================

import { db } from '@/core/database/client';
import {
  appeals,
  businesses,
  complaintBookRecords,
  deactivationNotices,
} from '@/core/database/schema';
import { and, eq, gte, lt } from 'drizzle-orm';

/** Keeps the catch blocks terse: a ternary per handler inflates complexity. */
function describeError(error: unknown): string {
  return describeError(error);
}

import {
  sendAppealReceivedNotification,
  triggerGracePeriodNotifications,
} from '@/lib/legal/gracePeriodWorkflow';
import { logger } from '@/lib/logger';
import { calculateComplaintScore, updateComplaintScore } from './complaintScoring';
import { computeDeactivationWindows } from './complaintScoringCore';
import { checkIncompleteOrderDeactivation } from './incompleteOrderRate';
import { get30DayWindowStart } from './incompleteOrderRateCore';

export interface DeactivationTrigger {
  shouldDeactivate: boolean;
  reason: 'verified_complaints' | 'incomplete_orders' | null;
  complaintCount?: number;
  incompleteOrderRate?: number;
  evidence?: {
    complaintIds?: string[];
    orderIds?: string[];
    scoreBreakdown?: Record<string, number>;
  };
}

export interface DeactivationResult {
  success: boolean;
  error?: string;
  deactivationNoticeId?: string;
  gracePeriodEndsAt?: Date;
  appealDeadline?: Date;
}

/**
 * Check if business should be deactivated based on verified complaints
 * Trigger: >=3 verified complaints in 30 days
 */
export async function checkComplaintDeactivation(businessId: string): Promise<DeactivationTrigger> {
  // Feature flag guard
  if (process.env.ENABLE_AUTO_DEACTIVATION !== 'true') {
    return { shouldDeactivate: false, reason: null };
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

  const complaintCount = verifiedComplaints.length;
  const complaintIds = verifiedComplaints.map((c) => c.id);

  if (complaintCount >= 3) {
    return {
      shouldDeactivate: true,
      reason: 'verified_complaints',
      complaintCount,
      evidence: { complaintIds },
    };
  }

  return { shouldDeactivate: false, reason: null, complaintCount };
}

/**
 * Check if business has an active deactivation notice in grace period
 */
export async function hasActiveDeactivationNotice(businessId: string): Promise<boolean> {
  const now = new Date();
  const notice = await db.query.deactivationNotices.findFirst({
    where: and(
      eq(deactivationNotices.businessId, businessId),
      eq(deactivationNotices.isResolved, false),
      gte(deactivationNotices.gracePeriodEndsAt, now),
    ),
  });
  return !!notice;
}

/**
 * Check if business has pending appeal
 */
export async function hasPendingAppeal(businessId: string): Promise<boolean> {
  const appeal = await db.query.appeals.findFirst({
    where: and(eq(appeals.businessId, businessId), eq(appeals.status, 'pending')),
  });
  return !!appeal;
}

/**
 * Execute auto-deactivation for a business
 */
export async function executeDeactivation(
  businessId: string,
  trigger: DeactivationTrigger,
): Promise<DeactivationResult> {
  // Feature flag guard
  if (process.env.ENABLE_AUTO_DEACTIVATION !== 'true') {
    return { success: false, error: 'Auto-deactivation disabled' };
  }

  // Check if already deactivated or in grace period
  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { isActive: true, appealStatus: true },
  });

  if (!business || !business.isActive) {
    return { success: false, error: 'Business already inactive' };
  }

  if (business.appealStatus === 'pending') {
    return { success: false, error: 'Appeal already pending' };
  }

  if (await hasActiveDeactivationNotice(businessId)) {
    return { success: false, error: 'Already in grace period' };
  }

  if (await hasPendingAppeal(businessId)) {
    return { success: false, error: 'Appeal pending' };
  }

  try {
    const now = new Date();
    // DS 011 timeline: 72h calendar grace period + 10 BUSINESS days appeal window.
    const { gracePeriodEndsAt, appealDeadline } = computeDeactivationWindows(now);

    // trigger.reason is guaranteed to be non-null when shouldDeactivate is true
    const reason = trigger.reason as 'verified_complaints' | 'incomplete_orders';

    // Deactivate the business first: this is the source of truth for the
    // soft-deactivation (works for every entry point: verified complaints,
    // incomplete order rate, penalties).
    await db
      .update(businesses)
      .set({
        isActive: false,
        deactivationReason: reason,
        deactivationDate: now,
        appealStatus: 'pending',
        gracePeriodEndsAt,
        updatedAt: now,
      })
      .where(eq(businesses.id, businessId));

    // DS 011-2011-PCM written notification (NON-FATAL): the workflow inserts
    // the deactivation_notices row WITH notificationSentAt and sends the
    // written-notification email. Email or notification failures must NOT
    // fail the deactivation itself — the DB record is the compliance trail.
    let deactivationNoticeId: string | undefined;
    try {
      const noticeResult = await triggerGracePeriodNotifications(
        businessId,
        reason,
        trigger.evidence?.complaintIds ?? [],
      );
      if (noticeResult.success && noticeResult.noticeId) {
        deactivationNoticeId = noticeResult.noticeId;
      } else {
        logger.warn('Deactivation: written notification flow failed (non-fatal)', {
          error: noticeResult.error,
        });
      }
    } catch (error) {
      logger.warn('Deactivation: written notification flow threw (non-fatal)', {
        error: describeError(error),
      });
    }

    return {
      success: true,
      deactivationNoticeId,
      gracePeriodEndsAt,
      appealDeadline,
    };
  } catch (error) {
    logger.error('Deactivation: execution failed', {
      error: describeError(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Process complaint submission - check for deactivation trigger
 * Called from complaint submission action
 */
export async function processComplaintSubmission(
  complaintId: string,
  businessId: string,
): Promise<void> {
  if (process.env.ENABLE_AUTO_DEACTIVATION !== 'true') return;

  // Calculate complaint score
  const scoreResult = await calculateComplaintScore(complaintId, businessId);
  await updateComplaintScore(complaintId, scoreResult);

  // Only check deactivation if complaint is verified
  if (scoreResult.tier !== 'verified') return;

  // Check if this triggers deactivation (>=3 verified complaints in 30 days)
  const trigger = await checkComplaintDeactivation(businessId);
  if (trigger.shouldDeactivate) {
    await executeDeactivation(businessId, trigger);
  }
}

/**
 * Process order completion - check for incomplete order rate deactivation
 * Called from order completion/finalization action
 */
export async function processOrderCompletion(businessId: string): Promise<void> {
  if (process.env.ENABLE_AUTO_DEACTIVATION !== 'true') return;

  const result = await checkIncompleteOrderDeactivation(businessId);
  if (result.shouldDeactivate) {
    const trigger: DeactivationTrigger = {
      shouldDeactivate: true,
      reason: 'incomplete_orders',
      incompleteOrderRate: result.rate.incompleteRate,
      evidence: { complaintIds: [], orderIds: [] },
    };
    await executeDeactivation(businessId, trigger);
  }
}

/**
 * Submit appeal for a deactivated business
 */
export interface SubmitAppealParams {
  businessId: string;
  deactivationNoticeId: string;
  sellerStatement: string;
  sellerEvidence: { documents: string[]; arguments: string[] };
}

export async function submitAppeal(
  params: SubmitAppealParams,
): Promise<{ success: boolean; error?: string; appealId?: string }> {
  if (process.env.ENABLE_AUTO_DEACTIVATION !== 'true') {
    return { success: false, error: 'Auto-deactivation disabled' };
  }

  const { businessId, deactivationNoticeId, sellerStatement, sellerEvidence } = params;

  // Verify deactivation notice exists and is active
  const notice = await db.query.deactivationNotices.findFirst({
    where: and(
      eq(deactivationNotices.id, deactivationNoticeId),
      eq(deactivationNotices.businessId, businessId),
      eq(deactivationNotices.isResolved, false),
    ),
  });

  if (!notice) {
    return { success: false, error: 'No active deactivation notice found' };
  }

  // Check if appeal already submitted
  const existingAppeal = await db.query.appeals.findFirst({
    where: and(
      eq(appeals.businessId, businessId),
      eq(appeals.deactivationNoticeId, deactivationNoticeId),
    ),
  });

  if (existingAppeal) {
    return { success: false, error: 'Appeal already submitted' };
  }

  // Check grace period
  if (new Date() > notice.gracePeriodEndsAt) {
    return { success: false, error: 'Grace period expired' };
  }

  try {
    const slaDeadline = notice.appealDeadline;

    const [appeal] = await db
      .insert(appeals)
      .values({
        businessId,
        deactivationNoticeId,
        sellerStatement,
        sellerEvidence,
        submittedAt: new Date(),
        status: 'pending',
        slaDeadline,
        slaBreached: false,
      })
      .returning({ id: appeals.id });

    // DS 011 written confirmation of appeal receipt (NON-FATAL): a written
    // notification DURING the 72h grace period. A failure must not fail the
    // appeal submission — the deactivation notice row is the compliance trail.
    try {
      const notifyResult = await sendAppealReceivedNotification(businessId, appeal.id, slaDeadline);
      if (!notifyResult.success) {
        logger.warn('Appeal: received notification failed (non-fatal)', {
          error: notifyResult.error,
        });
      }
    } catch (error) {
      logger.warn('Appeal: received notification threw (non-fatal)', {
        error: describeError(error),
      });
    }

    return { success: true, appealId: appeal.id };
  } catch (error) {
    logger.error('Appeal: submission failed', {
      error: describeError(error),
    });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Admin review of appeal
 */
export interface ReviewAppealParams {
  appealId: string;
  adminReviewerId: string;
  decision: 'approved' | 'rejected';
  adminNotes: string;
}

export async function reviewAppeal(
  params: ReviewAppealParams,
): Promise<{ success: boolean; error?: string }> {
  if (process.env.ENABLE_AUTO_DEACTIVATION !== 'true') {
    return { success: false, error: 'Auto-deactivation disabled' };
  }

  const { appealId, adminReviewerId, decision, adminNotes } = params;

  const appeal = await db.query.appeals.findFirst({
    where: eq(appeals.id, appealId),
  });

  if (!appeal) {
    return { success: false, error: 'Appeal not found' };
  }

  if (appeal.status !== 'pending') {
    return { success: false, error: 'Appeal already reviewed' };
  }

  try {
    const now = new Date();

    if (decision === 'approved') {
      // Reactivate business
      await db
        .update(businesses)
        .set({
          isActive: true,
          deactivationReason: null,
          deactivationDate: null,
          appealStatus: 'approved',
          gracePeriodEndsAt: null,
          updatedAt: now,
        })
        .where(eq(businesses.id, appeal.businessId));

      // Update deactivation notice
      await db
        .update(deactivationNotices)
        .set({
          isResolved: true,
          resolvedAt: now,
          resolvedBy: 'appeal_approved',
        })
        .where(eq(deactivationNotices.id, appeal.deactivationNoticeId));

      await db
        .update(appeals)
        .set({
          status: 'approved',
          adminReviewerId,
          adminNotes,
          reviewedAt: now,
          resolution: 'reactivated',
          reactivatedAt: now,
        })
        .where(eq(appeals.id, appealId));
    } else {
      // Uphold deactivation
      await db
        .update(businesses)
        .set({
          appealStatus: 'rejected',
          updatedAt: now,
        })
        .where(eq(businesses.id, appeal.businessId));

      await db
        .update(deactivationNotices)
        .set({
          isResolved: true,
          resolvedAt: now,
          resolvedBy: 'admin_override',
        })
        .where(eq(deactivationNotices.id, appeal.deactivationNoticeId));

      await db
        .update(appeals)
        .set({
          status: 'rejected',
          adminReviewerId,
          adminNotes,
          reviewedAt: now,
          resolution: 'upheld',
        })
        .where(eq(appeals.id, appealId));
    }

    return { success: true };
  } catch (error) {
    logger.error('Appeal: review failed', {
      error: describeError(error),
    });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Check and process expired grace periods (for cron or manual trigger)
 */
export async function processExpiredGracePeriods(): Promise<{ processed: number; errors: number }> {
  if (process.env.ENABLE_AUTO_DEACTIVATION !== 'true') {
    return { processed: 0, errors: 0 };
  }

  const now = new Date();
  let processed = 0;
  let errors = 0;

  // Find notices where grace period expired and not resolved
  const expiredNotices = await db.query.deactivationNotices.findMany({
    where: and(
      eq(deactivationNotices.isResolved, false),
      lt(deactivationNotices.gracePeriodEndsAt, now),
    ),
  });

  for (const notice of expiredNotices) {
    try {
      // Check if appeal was submitted
      const appeal = await db.query.appeals.findFirst({
        where: and(eq(appeals.deactivationNoticeId, notice.id), eq(appeals.status, 'pending')),
      });

      if (appeal) {
        // Appeal pending - wait for admin review
        continue;
      }

      // No appeal - deactivation stands, mark notice resolved
      await db
        .update(deactivationNotices)
        .set({
          isResolved: true,
          resolvedAt: now,
          resolvedBy: 'auto',
        })
        .where(eq(deactivationNotices.id, notice.id));

      // Business already deactivated, just confirm
      processed++;
    } catch (error) {
      errors++;
      logger.error('Deactivation: expired grace period processing failed', {
        error: describeError(error),
      });
    }
  }

  return { processed, errors };
}

/**
 * Check and process SLA breaches for appeals (for cron or manual trigger)
 */
export async function processAppealSLABreaches(): Promise<{ processed: number; errors: number }> {
  if (process.env.ENABLE_AUTO_DEACTIVATION !== 'true') {
    return { processed: 0, errors: 0 };
  }

  const now = new Date();
  let processed = 0;
  let errors = 0;

  // Find pending appeals past SLA deadline
  const breachedAppeals = await db.query.appeals.findMany({
    where: and(
      eq(appeals.status, 'pending'),
      lt(appeals.slaDeadline, now),
      eq(appeals.slaBreached, false),
    ),
  });

  for (const appeal of breachedAppeals) {
    try {
      // Mark SLA breached
      await db.update(appeals).set({ slaBreached: true }).where(eq(appeals.id, appeal.id));

      // Notify admin (would be async)
      processed++;
    } catch (error) {
      errors++;
      logger.error('Appeal: SLA breach processing failed', {
        error: describeError(error),
      });
    }
  }

  return { processed, errors };
}
