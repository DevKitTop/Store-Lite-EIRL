// =====================================================
// GRACE PERIOD NOTIFICATION WORKFLOW
// =====================================================
// DS 011-2011-PCM written notification workflow for the
// 72-hour grace period after auto-deactivation:
//  - initial deactivation notice (triggerGracePeriodNotifications)
//  - grace period reminder (sendGracePeriodReminder)
//  - appeal received confirmation (sendAppealReceivedNotification)
//  - appeal decision (sendAppealDecisionNotification)
//
// Cross-cutting rules:
//  - Everything is gated by ENABLE_AUTO_DEACTIVATION.
//  - Email sending is NON-FATAL: failures are logged and the
//    written-notification record is still persisted (the DB
//    record is the DS 011 compliance trail).
// =====================================================

import { desc, eq } from 'drizzle-orm';

import { db } from '@/core/database/client';
import type { Business } from '@/core/database/schema';
import { appeals, businesses, deactivationNotices } from '@/core/database/schema';
import { computeDeactivationWindows } from '@/lib/complaintScoringCore';
import { sendEmail, type SendEmailParams } from '@/lib/email/resend';
import {
  appealDecisionNotice,
  appealReceivedNotice,
  deactivationNotice,
  gracePeriodNotice,
} from '@/lib/legal/notificationTemplates';
import { logger } from '@/lib/logger';

export type DeactivationReason = 'verified_complaints' | 'incomplete_orders';

type NoticeKind = 'deactivation' | 'grace_period_reminder' | 'appeal_received' | 'appeal_decision';

export interface GracePeriodWorkflowResult {
  success: boolean;
  skipped?: boolean;
  noticeId?: string;
  graceUntil?: Date;
  error?: string;
}

function isAutoDeactivationEnabled(): boolean {
  return process.env.ENABLE_AUTO_DEACTIVATION === 'true';
}

/** Shape required by the notification templates (BusinessInfo). */
interface BusinessInfo {
  id: string;
  name: string;
  slug: string;
  legalName: string;
  taxId: string;
  email: string;
  address: string;
}

function toBusinessInfo(business: Business): BusinessInfo {
  return {
    id: business.id,
    name: business.name,
    slug: business.slug,
    // The businesses table has no legalName column; the store name is the
    // best available identifier for the RUC holder display in templates.
    legalName: business.name,
    taxId: business.taxId ?? '',
    email: business.email ?? '',
    address: business.address ?? '',
  };
}

/**
 * Send a notification email without letting failures break the workflow.
 * The written-notification DB record is the DS 011 compliance trail.
 */
async function sendNotificationEmail(params: SendEmailParams): Promise<void> {
  try {
    await sendEmail(params);
  } catch (error) {
    logger.warn('GracePeriodWorkflow: email send failed (non-fatal)', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Evidence JSON stored on deactivation_notices rows. The schema type only
 * declares complaintIds/orderIds/scoreBreakdown; the workflow additionally
 * records the rendered content and metadata for the audit trail.
 */
interface NoticeEvidence {
  complaintIds: string[];
  orderIds: string[];
  scoreBreakdown?: Record<string, number>;
  noticeKind?: string;
  subject?: string;
  content?: string;
  [key: string]: unknown;
}

interface NoticeRecordInput {
  businessId: string;
  reason: DeactivationReason;
  kind: NoticeKind;
  subject: string;
  content: string;
  gracePeriodEndsAt: Date;
  appealDeadline: Date;
  complaintIds?: string[];
  metadata?: Record<string, unknown>;
}

async function insertNoticeRecord(input: NoticeRecordInput): Promise<string> {
  const evidence: NoticeEvidence = {
    ...input.metadata,
    complaintIds: input.complaintIds ?? [],
    orderIds: [],
    noticeKind: input.kind,
    subject: input.subject,
    content: input.content,
  };

  const [notice] = await db
    .insert(deactivationNotices)
    .values({
      businessId: input.businessId,
      reason: input.reason,
      complaintCount: input.complaintIds?.length ?? 0,
      evidence,
      notificationSentAt: new Date(),
      notificationMethod: 'email',
      notificationReference: input.kind,
      gracePeriodEndsAt: input.gracePeriodEndsAt,
      appealDeadline: input.appealDeadline,
      isResolved: false,
    })
    .returning({ id: deactivationNotices.id });

  return notice.id;
}

/**
 * Insert the deactivation_notices record that starts the 72-hour grace
 * period (invoked when auto-deactivation is triggered).
 */
export async function triggerGracePeriodNotifications(
  businessId: string,
  reason: DeactivationReason,
  complaintIds: string[],
): Promise<GracePeriodWorkflowResult> {
  if (!isAutoDeactivationEnabled()) {
    return { success: false, skipped: true };
  }

  try {
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, businessId),
    });

    if (!business) {
      return { success: false, error: 'Business not found' };
    }

    const now = new Date();
    // DS 011 timeline: 72h calendar grace period + 10 BUSINESS days appeal window.
    const { gracePeriodEndsAt: graceUntil, appealDeadline } = computeDeactivationWindows(now);

    const businessInfo = toBusinessInfo(business);
    const subject = `Notificación de Desactivación de Cuenta - ${business.name}`;
    const html = deactivationNotice({
      business: businessInfo,
      reason,
      complaintIds,
      graceUntil,
    });

    await sendNotificationEmail({ to: businessInfo.email, subject, html });

    const noticeId = await insertNoticeRecord({
      businessId,
      reason,
      kind: 'deactivation',
      subject,
      content: html,
      gracePeriodEndsAt: graceUntil,
      appealDeadline,
      complaintIds,
    });

    return { success: true, noticeId, graceUntil };
  } catch (error) {
    logger.error('GracePeriodWorkflow: deactivation notices failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send the grace period reminder mid-window. The grace window comes from
 * the business row (gracePeriodEndsAt); the appeal deadline and original
 * reason are taken from the original deactivation notice record.
 */
export async function sendGracePeriodReminder(
  businessId: string,
): Promise<GracePeriodWorkflowResult> {
  if (!isAutoDeactivationEnabled()) {
    return { success: false, skipped: true };
  }

  try {
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, businessId),
    });

    if (!business) {
      return { success: false, error: 'Business not found' };
    }

    const graceUntil = business.gracePeriodEndsAt;
    if (!graceUntil) {
      return { success: false, error: 'No active grace period' };
    }

    const notice = await db.query.deactivationNotices.findFirst({
      where: eq(deactivationNotices.businessId, businessId),
      orderBy: desc(deactivationNotices.createdAt),
    });

    if (!notice) {
      return { success: false, error: 'No deactivation notice on record' };
    }

    const businessInfo = toBusinessInfo(business);
    const subject = `Recordatorio: Período de Gracia - ${business.name}`;
    const html = gracePeriodNotice({
      business: businessInfo,
      graceUntil,
      appealDeadline: notice.appealDeadline,
    });

    await sendNotificationEmail({ to: businessInfo.email, subject, html });

    const noticeId = await insertNoticeRecord({
      businessId,
      reason: notice.reason,
      kind: 'grace_period_reminder',
      subject,
      content: html,
      gracePeriodEndsAt: graceUntil,
      appealDeadline: notice.appealDeadline,
    });

    return { success: true, noticeId };
  } catch (error) {
    logger.error('GracePeriodWorkflow: grace period reminder failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Confirm appeal receipt to the seller. The linked deactivation notice
 * supplies the reason and deadline values for the written-notification trail.
 */
export async function sendAppealReceivedNotification(
  businessId: string,
  appealId: string,
  slaDeadline: Date,
): Promise<GracePeriodWorkflowResult> {
  if (!isAutoDeactivationEnabled()) {
    return { success: false, skipped: true };
  }

  try {
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, businessId),
    });

    if (!business) {
      return { success: false, error: 'Business not found' };
    }

    const appeal = await db.query.appeals.findFirst({
      where: eq(appeals.id, appealId),
    });

    if (!appeal) {
      return { success: false, error: 'Appeal not found' };
    }

    const notice = await db.query.deactivationNotices.findFirst({
      where: eq(deactivationNotices.id, appeal.deactivationNoticeId),
    });

    if (!notice) {
      return { success: false, error: 'Deactivation notice not found' };
    }

    const businessInfo = toBusinessInfo(business);
    const subject = `Confirmación de Recepción de Apelación - ${business.name}`;
    const html = appealReceivedNotice({ business: businessInfo, appealId, slaDeadline });

    await sendNotificationEmail({ to: businessInfo.email, subject, html });

    const noticeId = await insertNoticeRecord({
      businessId,
      reason: notice.reason,
      kind: 'appeal_received',
      subject,
      content: html,
      gracePeriodEndsAt: notice.gracePeriodEndsAt,
      appealDeadline: notice.appealDeadline,
      metadata: { appealId },
    });

    return { success: true, noticeId };
  } catch (error) {
    logger.error('GracePeriodWorkflow: appeal received notification failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Notify the seller of the appeal decision. The written-notification record
 * keeps the original notice's reason and deadlines for the audit trail.
 */
export async function sendAppealDecisionNotification(
  businessId: string,
  decision: 'approved' | 'rejected',
  adminNotes: string,
  reactivatedAt?: Date,
): Promise<GracePeriodWorkflowResult> {
  if (!isAutoDeactivationEnabled()) {
    return { success: false, skipped: true };
  }

  try {
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, businessId),
    });

    if (!business) {
      return { success: false, error: 'Business not found' };
    }

    const notice = await db.query.deactivationNotices.findFirst({
      where: eq(deactivationNotices.businessId, businessId),
      orderBy: desc(deactivationNotices.createdAt),
    });

    if (!notice) {
      return { success: false, error: 'Deactivation notice not found' };
    }

    const businessInfo = toBusinessInfo(business);
    const subject = `${decision === 'approved' ? 'Apelación Aprobada' : 'Apelación Rechazada'} - ${business.name}`;
    const html = appealDecisionNotice({
      business: businessInfo,
      decision,
      adminNotes,
      reactivatedAt,
    });

    await sendNotificationEmail({ to: businessInfo.email, subject, html });

    const noticeId = await insertNoticeRecord({
      businessId,
      reason: notice.reason,
      kind: 'appeal_decision',
      subject,
      content: html,
      gracePeriodEndsAt: notice.gracePeriodEndsAt,
      appealDeadline: notice.appealDeadline,
      metadata: { decision, adminNotes, reactivatedAt: reactivatedAt?.toISOString() ?? null },
    });

    return { success: true, noticeId };
  } catch (error) {
    logger.error('GracePeriodWorkflow: appeal decision notification failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
