// ──────────────────────────────────────────
// OrderService — facade for order status transitions
// Orchestrates: state machine validation → version-locked update → timeline recording
// Handles legacy→V2 status mapping for backward compatibility
// ──────────────────────────────────────────

import { db } from '@/core/database/client';
import { businesses, payments } from '@/core/database/schema';
import { and, eq } from 'drizzle-orm';

import { sendOrderCompletedEmail } from '@/lib/email/orderEmails';
import { sendOrderStatusSms } from '@/lib/twilio/orderSms';
import { generatePickupCode } from './orderPickup';
import {
  ForbiddenActorError,
  InvalidTransitionError,
  validateTransitionFull,
} from './orderStateMachine';
import type { OrderStatusV2, TransitionInput } from './orderStatus';
import { ORDER_STATUS_V2 } from './orderStatus';
import { mapToNewStatus } from './orderStatusMapping';
import { recordEvent } from './orderTimeline';
import type { OrderTimelineEventType } from './orderTypes';

// ─── Error types ───
export class VersionConflictError extends Error {
  constructor(paymentId: string) {
    super(`Version conflict for payment ${paymentId}`);
    this.name = 'VersionConflictError';
  }
}

// ─── Result type ───
export interface TransitionResult {
  success: true;
  payment: typeof payments.$inferSelect;
  eventId: string;
}

export interface TransitionError {
  success: false;
  error: string;
}

// ─── OrderService ───

/**
 * Execute a status transition with full validation and timeline recording.
 *
 * The service reads the current payment from the DB, maps its legacy status
 * to V2 (if needed), validates the transition via the state machine,
 * performs a version-locked update, and records a timeline event.
 *
 * @param input - Transition input with paymentId, toStatus (V2), actor info, etc.
 * @returns TransitionResult on success, TransitionError on failure
 */
export async function transition(
  input: TransitionInput,
): Promise<TransitionResult | TransitionError> {
  try {
    // 1. Read current payment
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, input.paymentId))
      .limit(1);

    if (!payment) {
      return { success: false, error: 'Pedido no encontrado' };
    }

    // 2. Map legacy status to V2 if needed
    const fromStatus = mapToNewStatus(payment.status as string);
    if (!fromStatus) {
      return {
        success: false,
        error: `Estado actual desconocido: ${payment.status}`,
      };
    }

    // 3. Validate transition via state machine (skip if same-status, e.g. re-uploading ticket)
    if (fromStatus !== input.toStatus) {
      // Inject DB-level shippingType into validation — caller cannot fake it
      const validation = validateTransitionFull(fromStatus, input.toStatus, {
        actor: input.actor,
        preconditions: {
          ...input.preconditions,
          shippingType: payment.shippingType,
        },
      });

      if (!validation.valid) {
        if (
          validation.error?.includes('not permitted') ||
          validation.error?.includes('not allowed')
        ) {
          throw new ForbiddenActorError(fromStatus, input.toStatus, input.actor.type);
        }
        throw new InvalidTransitionError(
          fromStatus,
          input.toStatus,
          validation.error ?? 'Error de validación',
        );
      }
    }

    // 4. Pre-hooks
    const metadata: Record<string, unknown> = { ...input.metadata };
    const updateData: Record<string, unknown> = {
      status: input.toStatus,
      version: (payment.version ?? 0) + 1,
      updatedAt: new Date(),
      ...input.extraFields, // merge caller-provided extra fields (e.g. ticketImageUrl)
    };

    // Pre-hook: generate pickup code for pickup orders on READY_FOR_PICKUP
    if (input.toStatus === ORDER_STATUS_V2.READY_FOR_PICKUP) {
      const code = generatePickupCode();
      updateData.pickupCode = code;
      metadata.pickupCode = code;
    }

    // Pre-hook: generate pickup code for delivery orders on IN_TRANSIT (unchanged for non-pickup)
    if (input.toStatus === ORDER_STATUS_V2.IN_TRANSIT && payment.shippingType !== 'recojo') {
      const code = generatePickupCode();
      updateData.pickupCode = code;
      metadata.pickupCode = code;
    }

    // Pre-hook: set completedAt when the order is finalized
    if (input.toStatus === ORDER_STATUS_V2.COMPLETED) {
      updateData.completedAt = new Date();
    }

    // Pre-hook: set courier/tracking info when transitioning to WAITING_CUSTOMER_CONFIRMATION
    if (input.toStatus === ORDER_STATUS_V2.WAITING_CUSTOMER_CONFIRMATION) {
      const pre = input.preconditions ?? {};
      if (pre.courierName) updateData.courierName = pre.courierName;
      if (pre.trackingNumber) updateData.trackingNumber = pre.trackingNumber;
      if (pre.sellerNote) updateData.sellerNote = pre.sellerNote;
    }

    // 5. Version-locked update
    const [updated] = await db
      .update(payments)
      .set(updateData)
      .where(and(eq(payments.id, input.paymentId), eq(payments.version, payment.version ?? 0)))
      .returning();

    if (!updated) {
      throw new VersionConflictError(input.paymentId);
    }

    // 6. Record timeline event
    const event = await recordEvent({
      orderId: input.paymentId,
      eventType: mapTransitionToEvent(fromStatus, input.toStatus),
      actorType: input.actor.type,
      actorId: input.actor.id,
      metadata: { fromStatus, toStatus: input.toStatus, ...metadata },
    });

    // 7. Fire-and-forget: notify customer via SMS (no await)
    notifyOrderSms(updated, input.toStatus, input.actor.type).catch((err) => {
      console.error('[OrderService] SMS notification failed:', err);
    });

    // 8. Fire-and-forget: notify customer via WhatsApp template (no await)
    notifyOrderWhatsApp(updated, input.toStatus, input.actor.type).catch((err) => {
      console.error('[OrderService] WhatsApp notification failed:', err);
    });

    return { success: true, payment: updated, eventId: event.id };
  } catch (error) {
    if (
      error instanceof VersionConflictError ||
      error instanceof InvalidTransitionError ||
      error instanceof ForbiddenActorError
    ) {
      return { success: false, error: error.message };
    }
    console.error('[OrderService.transition] Error:', error);
    return { success: false, error: 'Error al actualizar el estado del pedido' };
  }
}

// ─── Notification helpers (fire-and-forget) ───

async function notifyOrderSms(
  payment: typeof payments.$inferSelect,
  toStatus: OrderStatusV2,
  actorType: string,
): Promise<void> {
  // Skip SMS for system/customer actions (avoid duplicate notifications)
  // Focus on seller-initiated transitions where the customer needs to know
  if (actorType === 'system') return;

  if (!payment.buyerPhone) return;
  if (!payment.trackingToken || !payment.businessId) return;

  // Read business to get slug and name
  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, payment.businessId),
    columns: { slug: true, name: true },
  });

  if (!business) return;

  await sendOrderStatusSms({
    toStatus,
    buyerPhone: payment.buyerPhone,
    businessSlug: business.slug,
    businessName: business.name,
    trackingToken: payment.trackingToken,
  });

  // Send email notification for completed orders
  if (toStatus === ORDER_STATUS_V2.COMPLETED) {
    sendOrderCompletedEmail(payment, payment.businessId).catch((err) => {
      console.error('[OrderService] Completion email error:', err);
    });
  }
}

async function notifyOrderWhatsApp(
  payment: typeof payments.$inferSelect,
  toStatus: OrderStatusV2,
  actorType: string,
): Promise<void> {
  // Skip WhatsApp for system/customer actions
  if (actorType === 'system') return;

  if (!payment.buyerPhone) return;
  if (!payment.businessId) return;

  // Read business to get name and slug
  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, payment.businessId),
    columns: { slug: true, name: true },
  });

  if (!business) return;

  // Import WhatsApp notification functions dynamically to avoid circular deps
  const { sendOrderConfirmedNotification, sendOrderShippedNotification } =
    await import('@app/[slug]/(app)/chat/actions/orderNotificationActions');

  // Send WhatsApp template based on status transition
  try {
    switch (toStatus) {
      case ORDER_STATUS_V2.PAID: {
        // Order confirmed - send order_confirmed template
        // Variables: customerName, orderNumber, businessName, amount, orderUrl
        await sendOrderConfirmedNotification(payment.businessId, payment.id, {
          customerName: payment.buyerPhone, // Use phone as fallback, could fetch customer name
          orderNumber: payment.orderNumber ?? payment.id.slice(0, 8),
          businessName: business.name,
          amount: payment.amount.toString(),
          orderUrl: `https://${business.slug}.storelite.app/orders/${payment.trackingToken}`,
        }).catch((err: Error) =>
          console.error('[OrderService] WhatsApp order_confirmed failed:', err),
        );
        break;
      }
      case ORDER_STATUS_V2.IN_TRANSIT: {
        // Order shipped - send order_shipped template
        // Variables: orderNumber, carrier, trackingNumber, estimatedDelivery, trackingUrl
        await sendOrderShippedNotification(payment.businessId, payment.id, {
          orderNumber: payment.orderNumber ?? payment.id.slice(0, 8),
          carrier: payment.courierName ?? 'Por confirmar',
          trackingNumber: payment.trackingNumber ?? 'Por confirmar',
          estimatedDelivery: 'Por confirmar', // Could be calculated from shipping info
          trackingUrl: `https://${business.slug}.storelite.app/track/${payment.trackingToken}`,
        }).catch((err: Error) =>
          console.error('[OrderService] WhatsApp order_shipped failed:', err),
        );
        break;
      }
      // Add more status transitions as needed
    }
  } catch (error) {
    console.error('[OrderService] WhatsApp notification error:', error);
  }
}

// ─── Helper: map from→to to a timeline event type ───
function mapTransitionToEvent(from: OrderStatusV2, to: OrderStatusV2): OrderTimelineEventType {
  // Main flow transitions
  if (to === ORDER_STATUS_V2.PAID) return 'ORDER_PAID';
  if (to === ORDER_STATUS_V2.PREPARING_ORDER) return 'ORDER_PREPARING';
  if (to === ORDER_STATUS_V2.WAITING_CUSTOMER_CONFIRMATION) return 'SHIPPING_PAYMENT_PENDING';
  if (to === ORDER_STATUS_V2.READY_TO_SHIP) {
    return from === ORDER_STATUS_V2.ISSUE_REPORTED ? 'CUSTOMER_CONFIRMED' : 'ORDER_READY_TO_SHIP';
  }
  if (to === ORDER_STATUS_V2.IN_TRANSIT) return 'ORDER_IN_TRANSIT';
  if (to === ORDER_STATUS_V2.DELIVERED) return 'ORDER_DELIVERED';
  if (to === ORDER_STATUS_V2.COMPLETED) return 'ORDER_COMPLETED';
  if (to === ORDER_STATUS_V2.READY_FOR_PICKUP) return 'ORDER_READY_FOR_PICKUP';
  if (to === ORDER_STATUS_V2.PICKED_UP) return 'ORDER_PICKED_UP';

  // Issue flow
  if (to === ORDER_STATUS_V2.ISSUE_REPORTED) return 'CUSTOMER_REPORTED_ISSUE';
  if (to === ORDER_STATUS_V2.DISPUTE) return 'DISPUTE_CREATED';

  // Cancellation
  if (to === ORDER_STATUS_V2.CANCELLED) return 'ORDER_CANCELLED';

  // Timeouts
  if (to === ORDER_STATUS_V2.SELLER_TIMEOUT) return 'SELLER_TIMEOUT';

  // Fallback (should be unreachable for valid V2 statuses)
  return `ORDER_${to}` as OrderTimelineEventType;
}
