'use server';

// =====================================================
// FEEDBACK — Server Actions
// =====================================================
// Server actions for the seller feedback system.
// Handles ticket creation, history, and responses.
// Security: All actions require authentication.
// =====================================================

import { db } from '@/core/database/client';
import { businesses, feedbackResponses, feedbackTickets, profiles } from '@/core/database/schema';
import { requireAccessOnId } from '@/features/storage/actions/authz';
import { logger, toErrorDetail } from '@/lib/logger';
import { desc, eq, sql } from 'drizzle-orm';
import { notifyAdminNewTicket, notifyUserResponse } from './email';
import { respondToTicketSchema, submitFeedbackSchema } from './schemas';
import type {
  FeedbackPriority,
  GetFeedbackHistoryResult,
  GetFeedbackTicketResult,
  SubmitFeedbackResult,
} from './types';

// ── Helpers ──

function generateTicketNumber(): string {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `FB-${year}${month}-${random}`;
}

export async function getFeedbackPriority(businessId: string): Promise<FeedbackPriority> {
  // Query the active subscription plan for this business
  const result = await db.execute(sql`
    SELECT plan_type FROM business_subscriptions 
    WHERE business_id = ${businessId} 
    AND plan_status = 'active' 
    LIMIT 1
  `);

  const rows = result as unknown as { plan_type: string }[];
  const planType = rows[0]?.plan_type;

  // Lite Plus = high priority
  if (planType === 'lite_plus') {
    return 'high';
  }

  // Lite (free) plan = low priority
  if (planType === 'lite' || !planType) {
    return 'low';
  }

  // Lite Pago = normal priority
  return 'normal';
}

// ── Submit Feedback ──

interface SubmitFeedbackParams {
  businessId: string;
  requestType: 'support' | 'feedback' | 'complaint';
  category: 'bug' | 'suggestion' | 'question' | 'other';
  subject: string;
  message: string;
  contactEmail?: string;
  contactPhone?: string;
}

export async function submitFeedback({
  businessId,
  requestType,
  category,
  subject,
  message,
  contactEmail,
  contactPhone,
}: SubmitFeedbackParams): Promise<SubmitFeedbackResult> {
  try {
    // 1. Validate input
    const parsed = submitFeedbackSchema.safeParse({
      businessId,
      requestType,
      category,
      subject,
      message,
    });
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message;
      return { success: false, error: firstError || 'Datos no válidos' };
    }

    // 2. Require authentication (user must be owner or team member)
    const { businessId: validBusinessId, userId } = await requireAccessOnId(
      businessId,
      'feedback.submit',
    );

    // 3. Determine priority based on plan
    const priority = await getFeedbackPriority(validBusinessId);

    // 4. Generate ticket number
    const ticketNumber = generateTicketNumber();

    // 5. Get business name for email
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, validBusinessId),
      columns: { name: true },
    });

    // 6. Insert ticket
    const [ticket] = await db
      .insert(feedbackTickets)
      .values({
        businessId: validBusinessId,
        userId,
        ticketNumber,
        requestType: parsed.data.requestType,
        category: parsed.data.category,
        subject: parsed.data.subject,
        message: parsed.data.message,
        priority,
      })
      .returning({ id: feedbackTickets.id });

    if (!ticket) {
      return { success: false, error: 'Error al crear el ticket' };
    }

    // 7. Send email notification to admin (fire-and-forget)
    notifyAdminNewTicket({
      ticketNumber,
      businessName: business?.name || 'Desconocido',
      requestType: parsed.data.requestType,
      category: parsed.data.category,
      subject: parsed.data.subject,
      message: parsed.data.message,
      priority,
      contactEmail,
      contactPhone,
    }).catch((err) =>
      logger.error('Feedback: admin notification failed', { error: toErrorDetail(err) }),
    );

    return {
      success: true,
      ticketId: ticket.id,
      ticketNumber,
    };
  } catch (error) {
    logger.error('[Feedback] Error submitting feedback:', { error: toErrorDetail(error) });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al enviar el feedback',
    };
  }
}

// ── Get Feedback History ──

export async function getFeedbackHistory(businessId: string): Promise<GetFeedbackHistoryResult> {
  try {
    // 1. Require authentication
    const { businessId: validBusinessId } = await requireAccessOnId(businessId, 'feedback.view');

    // 2. Fetch tickets with response count
    const tickets = await db
      .select({
        id: feedbackTickets.id,
        ticketNumber: feedbackTickets.ticketNumber,
        category: feedbackTickets.category,
        subject: feedbackTickets.subject,
        status: feedbackTickets.status,
        priority: feedbackTickets.priority,
        responseCount: sql<number>`count(${feedbackResponses.id})::int`.as('response_count'),
        createdAt: feedbackTickets.createdAt,
      })
      .from(feedbackTickets)
      .leftJoin(feedbackResponses, eq(feedbackTickets.id, feedbackResponses.ticketId))
      .where(eq(feedbackTickets.businessId, validBusinessId))
      .groupBy(feedbackTickets.id)
      .orderBy(desc(feedbackTickets.createdAt));

    return {
      success: true,
      tickets: tickets.map((t) => ({
        id: t.id,
        ticketNumber: t.ticketNumber,
        category: t.category,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        responseCount: t.responseCount,
        createdAt: t.createdAt,
      })),
    };
  } catch (error) {
    logger.error('[Feedback] Error getting history:', { error: toErrorDetail(error) });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al obtener el historial',
    };
  }
}

// ── Get Feedback Ticket (with responses) ──

export async function getFeedbackTicket(ticketId: string): Promise<GetFeedbackTicketResult> {
  try {
    // 1. Fetch ticket
    const ticket = await db.query.feedbackTickets.findFirst({
      where: eq(feedbackTickets.id, ticketId),
    });

    if (!ticket) {
      return { success: false, error: 'Ticket no encontrado' };
    }

    // 2. Verify user has access to this ticket's business
    await requireAccessOnId(ticket.businessId, 'feedback.view');

    // 3. Fetch responses
    const responses = await db.query.feedbackResponses.findMany({
      where: eq(feedbackResponses.ticketId, ticketId),
      orderBy: [desc(feedbackResponses.createdAt)],
    });

    // 4. Fetch business and user names
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, ticket.businessId),
      columns: { name: true },
    });

    const user = await db.query.profiles.findFirst({
      where: eq(profiles.id, ticket.userId),
      columns: { fullName: true },
    });

    return {
      success: true,
      ticket: {
        ...ticket,
        responses,
        businessName: business?.name,
        userName: user?.fullName || undefined,
      },
    };
  } catch (error) {
    logger.error('[Feedback] Error getting ticket:', { error: toErrorDetail(error) });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al obtener el ticket',
    };
  }
}

// ── Respond to Ticket (Admin) ──

export async function respondToTicket(
  ticketId: string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Validate input
    const parsed = respondToTicketSchema.safeParse({ ticketId, message });
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message;
      return { success: false, error: firstError || 'Datos no válidos' };
    }

    // 2. Fetch ticket to get businessId and userId
    const ticket = await db.query.feedbackTickets.findFirst({
      where: eq(feedbackTickets.id, parsed.data.ticketId),
    });

    if (!ticket) {
      return { success: false, error: 'Ticket no encontrado' };
    }

    // 3. Insert response
    await db.insert(feedbackResponses).values({
      ticketId: parsed.data.ticketId,
      senderType: 'admin',
      message: parsed.data.message,
    });

    // 4. Get user email for notification
    const user = await db.query.profiles.findFirst({
      where: eq(profiles.id, ticket.userId),
      columns: { email: true },
    });

    // 5. Send email notification to user (fire-and-forget)
    if (user?.email) {
      notifyUserResponse({
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        adminMessage: parsed.data.message,
        userEmail: user.email,
      }).catch((err) =>
        logger.error('Feedback: user notification failed', { error: toErrorDetail(err) }),
      );
    }

    return { success: true };
  } catch (error) {
    logger.error('[Feedback] Error responding to ticket:', { error: toErrorDetail(error) });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al responder al ticket',
    };
  }
}

// ── Close Ticket (Admin/Owner) ──

export async function closeTicket(ticketId: string): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Fetch ticket
    const ticket = await db.query.feedbackTickets.findFirst({
      where: eq(feedbackTickets.id, ticketId),
    });

    if (!ticket) {
      return { success: false, error: 'Ticket no encontrado' };
    }

    // 2. Verify user has access
    await requireAccessOnId(ticket.businessId, 'feedback.respond');

    // 3. Update status to closed
    await db
      .update(feedbackTickets)
      .set({ status: 'closed', updatedAt: new Date() })
      .where(eq(feedbackTickets.id, ticketId));

    return { success: true };
  } catch (error) {
    logger.error('[Feedback] Error closing ticket:', { error: toErrorDetail(error) });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Error al cerrar el ticket',
    };
  }
}
