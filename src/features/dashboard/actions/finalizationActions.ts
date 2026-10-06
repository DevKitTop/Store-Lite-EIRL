'use server';

import { env } from '@/config/env';
import { db } from '@/core/database/client';
import { businesses, chatSessions, messages, payments, profiles } from '@/core/database/schema';
import { transition } from '@/core/orders/orderService';
import {
  CONFIRMABLE_STATUSES,
  ORDER_STATUS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_V2,
} from '@/core/orders/orderStatus';
import { processOrderCompletion } from '@/lib/deactivation';
import { checkIncompleteOrderDeactivation } from '@/lib/incompleteOrderRate';
import { createBusinessNotification } from '@/lib/notifications';
import { checkPermission } from '@/lib/permissions';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { and, eq, lt } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

// Every unauthorized outcome — unresolved actor, missing grant, or a payment row
// owned by another tenant — reports the same string, so an anonymous caller
// learns nothing about session state (spec R3).
const NO_PERMISSION_ERROR = 'Pago no encontrado o no tienes permisos.';

async function getAuthenticatedUserId(): Promise<string | null> {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    // Ensure profile exists to satisfy FK constraints on order_timeline_events
    const existingProfile = await db.query.profiles.findFirst({
      where: eq(profiles.id, user.id),
    });

    if (!existingProfile) {
      console.warn('[getAuthenticatedUserId] Profile missing, auto-creating for user:', user.id);
      await db.insert(profiles).values({
        id: user.id,
        email: user.email ?? '',
        fullName:
          user.user_metadata?.full_name ??
          user.user_metadata?.name ??
          user.email?.split('@')[0] ??
          'Unknown User',
        avatarUrl: user.user_metadata?.avatar_url ?? null,
      });
    }

    return user.id;
  } catch {
    return null;
  }
}

/**
 * Authorization gate for the seller order actions.
 *
 * Callers MUST run this at the top of the action, before the first DB read and
 * outside the `env.orderFlowV2` branch, so the legacy inline path is guarded
 * too (design D4). An unresolved actor is a hard abort, not a permissive
 * default (design D6) — callers must not fall back to a partial actor.
 */
async function requireOrderManager(
  businessId: string,
): Promise<{ ok: true; actorId: string } | { ok: false }> {
  const actorId = await getAuthenticatedUserId();
  if (!actorId) return { ok: false };
  const canManage = await checkPermission(businessId, actorId, 'orders.manage');
  if (!canManage) return { ok: false };
  return { ok: true, actorId };
}

// =====================================================
// TYPES
// =====================================================

export interface FinalizationActionResult {
  success: boolean;
  error?: string;
  data?: {
    status: string;
    finalizationDeadline?: string;
  };
}

// =====================================================
// CONSTANTS
// =====================================================

const _HOURS_BEFORE_SELLER_CAN_REQUEST = 24; // 24h después de "aceptado" (reservado para validación temporal)
const DAYS_FOR_CUSTOMER_TO_CONFIRM = 3; // 3 días para que el customer confirme

// =====================================================
// 1. SELLER: Request Finalization
// =====================================================
// Called when the seller clicks "FINALIZAR COMPRA"
// Requirements:
// - Payment must be in 'aceptado' status
// - At least 24 hours must have passed since 'aceptado' (aceptado_at)
// - Payment must not be already in finalization process

export async function requestFinalization(
  paymentId: string,
  businessId: string,
): Promise<FinalizationActionResult> {
  try {
    // Authorization gate — before any DB read and outside the orderFlowV2 branch (design D4).
    const gate = await requireOrderManager(businessId);
    if (!gate.ok) return { success: false, error: NO_PERMISSION_ERROR };
    const { actorId } = gate;

    // 1. Fetch the payment and validate ownership + status
    const [payment] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.businessId, businessId)))
      .limit(1);

    if (!payment) {
      console.error('[requestFinalization] Payment not found or not owned by business');
      return { success: false, error: NO_PERMISSION_ERROR };
    }

    // 2. Check if status allows finalization
    const currentStatus = String(payment.status);
    const isValidForFinalization = env.orderFlowV2
      ? currentStatus === ORDER_STATUS_V2.IN_TRANSIT || currentStatus === ORDER_STATUS.EN_REPARTO
      : currentStatus === ORDER_STATUS.DELIVERED;

    if (!isValidForFinalization) {
      console.error('[requestFinalization] Invalid status:', payment.status);
      return {
        success: false,
        error: env.orderFlowV2
          ? `El pedido debe estar "en tránsito" para solicitar finalización. Estado actual: ${payment.status}`
          : `El pago debe estar en estado "delivered". Estado actual: ${payment.status}`,
      };
    }

    // 3. Jump to finalization check (24h validation removed for flexibility)

    // 4. Check if already in finalization process
    if (payment.finalizationRequestedAt) {
      console.warn(
        '[requestFinalization] Finalization already requested at:',
        payment.finalizationRequestedAt,
      );
      return { success: false, error: 'La finalización ya fue solicitada anteriormente.' };
    }

    // 5. Calculate deadline (now + 3 days)
    const now = new Date();
    const deadline = new Date(now);
    deadline.setDate(deadline.getDate() + DAYS_FOR_CUSTOMER_TO_CONFIRM);

    // 6. Update payment — V2 path uses OrderService, legacy uses inline
    const expectedVersion = (payment as { version?: number }).version ?? 0;

    if (env.orderFlowV2) {
      const result = await transition({
        paymentId,
        // In legacy flow, requestFinalization moves to 'not_delivered' which maps to DELIVERED.
        // In V2, this means the seller confirms the order was delivered to the customer.
        toStatus: ORDER_STATUS_V2.DELIVERED,
        actor: { type: 'seller', id: actorId },
        expectedVersion,
        extraFields: { finalizationRequestedAt: now, finalizationDeadline: deadline },
      });

      if (!result.success) {
        console.error('[requestFinalization] OrderService error:', result.error);
        return { success: false, error: result.error };
      }
    } else {
      const [updated] = await db
        .update(payments)
        .set({
          status: ORDER_STATUS.NOT_DELIVERED,
          version: expectedVersion + 1,
          finalizationRequestedAt: now,
          finalizationDeadline: deadline,
          updatedAt: now,
        })
        .where(and(eq(payments.id, paymentId), eq(payments.version, expectedVersion)))
        .returning({ id: payments.id });

      if (!updated) {
        console.error('[requestFinalization] Version conflict for payment:', paymentId);
        return {
          success: false,
          error: 'El pedido fue modificado por otra operación. Recargá e intentá de nuevo.',
        };
      }
    }

    // 7. Create notification for the business (seller)
    await createBusinessNotification({
      businessId,
      type: 'order_finalization_requested',
      category: 'pedidos',
      title: 'Solicitud de finalización enviada',
      message: `Se ha enviado la solicitud de finalización para el pedido ${payment.orderNumber || paymentId.slice(0, 8)}. Esperando confirmación del cliente.`,
      data: {
        paymentId,
        orderNumber: payment.orderNumber,
        finalizationDeadline: deadline.toISOString(),
      },
    });

    // 8. Send automatic chat message to the customer
    // Buscar por paymentId (sesión aislada de esta orden), no por DNI
    const chatSession = await db.query.chatSessions.findFirst({
      where: and(eq(chatSessions.paymentId, payment.id), eq(chatSessions.status, 'active')),
    });

    if (chatSession) {
      await db.insert(messages).values({
        sessionId: chatSession.id,
        isFromStore: true,
        content: `⚠️ EL VENDEDOR HA SOLICITADO FINALIZAR LA COMPRA. 

Si ya recibiste tu pedido correctamente, por favor confírmalo en el portal de seguimiento. 

Recuerda que si no respondes en 3 días (${deadline.toLocaleDateString('es-PE')}), el pedido se finalizará automáticamente.`,
      });
    }

    revalidatePath(`/${businessId}/dashboard`, 'page');
    if (payment.trackingToken) {
      // Find the business slug if possible, but businessId is often the slug in this project or we can use the business object
      const business = await db.query.businesses.findFirst({
        where: eq(businesses.id, businessId),
      });
      const slug = business?.slug || businessId;
      revalidatePath(`/${slug}/order/${payment.trackingToken}`, 'page');
    }

    return {
      success: true,
      data: {
        status: ORDER_STATUS_LABELS.ESPERANDO_CONFIRMACION,
        finalizationDeadline: deadline.toISOString(),
      },
    };
  } catch (error) {
    console.error('[requestFinalization] Error:', error);
    return {
      success: false,
      error: 'Error al solicitar la finalización del pedido.',
    };
  }
}

// =====================================================
// 2. CUSTOMER: Confirm Finalization (Accept)
// =====================================================
// Called when the customer accepts the finalization
// Requirements:
// - Payment must be in 'esperando_confirmacion' status
// - Token must match (security check)

export async function confirmFinalization(
  paymentId: string,
  token: string,
): Promise<FinalizationActionResult> {
  try {
    // 1. Fetch payment and validate token + status
    const [payment] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.trackingToken, token)))
      .limit(1);

    if (!payment) {
      console.error('[confirmFinalization] Payment not found or invalid token');
      return { success: false, error: 'Pedido no encontrado o token inválido.' };
    }

    const confirmableStatuses: readonly string[] = CONFIRMABLE_STATUSES;
    if (!confirmableStatuses.includes(payment.status)) {
      console.error('[confirmFinalization] Invalid status:', payment.status);
      return {
        success: false,
        error: `El pedido no está en estado de espera de confirmación. Estado actual: ${payment.status}`,
      };
    }

    const now = new Date();

    // 2. Update payment — V2 path uses OrderService, legacy uses inline
    const expectedVersion = (payment as { version?: number }).version ?? 0;

    if (env.orderFlowV2) {
      const result = await transition({
        paymentId,
        toStatus: ORDER_STATUS_V2.COMPLETED,
        actor: { type: 'customer' },
        expectedVersion,
        extraFields: { finalizationConfirmedAt: now, completedAt: now },
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }
    } else {
      const [updated] = await db
        .update(payments)
        .set({
          status: ORDER_STATUS.COMPLETED,
          version: expectedVersion + 1,
          finalizationConfirmedAt: now,
          completedAt: now,
          updatedAt: now,
        })
        .where(and(eq(payments.id, paymentId), eq(payments.version, expectedVersion)))
        .returning({ id: payments.id });

      if (!updated) {
        return {
          success: false,
          error: 'El estado del pedido fue modificado. Recargá la página e intentá de nuevo.',
        };
      }
    }

    // 3. Notify the business (seller)
    await createBusinessNotification({
      businessId: payment.businessId,
      type: 'order_finalization_confirmed',
      category: 'pedidos',
      title: '¡Pedido finalizado!',
      message: `El cliente ha confirmado la recepción satisfactoria del pedido ${payment.orderNumber || payment.id.slice(0, 8)}.`,
      data: {
        paymentId,
        orderNumber: payment.orderNumber,
        confirmedAt: now.toISOString(),
      },
    });

    // 4. Send chat message
    // Buscar por paymentId (sesión aislada de esta orden), no por DNI
    const chatSession = await db.query.chatSessions.findFirst({
      where: and(eq(chatSessions.paymentId, payment.id), eq(chatSessions.status, 'active')),
    });

    if (chatSession) {
      await db.insert(messages).values({
        sessionId: chatSession.id,
        isFromStore: false, // From customer
        content: `✅ HE CONFIRMADO LA RECEPCIÓN DEL PEDIDO. Todo conforme.`,
      });
    }

    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, payment.businessId),
    });
    const slug = business?.slug || payment.businessId;

    revalidatePath(`/${slug}/dashboard`, 'page');
    revalidatePath(`/${slug}/order/${token}`, 'page');

    // Check incomplete order rate and trigger deactivation if needed (feature flag guarded)
    if (process.env.ENABLE_AUTO_DEACTIVATION === 'true') {
      try {
        const deactivationCheck = await checkIncompleteOrderDeactivation(payment.businessId);
        if (deactivationCheck.shouldDeactivate) {
          await processOrderCompletion(payment.businessId);
        }
      } catch (deactivationError) {
        console.error(
          '[confirmFinalization] Error checking incomplete order rate:',
          deactivationError,
        );
        // Don't fail the confirmation if deactivation check fails
      }
    }

    return {
      success: true,
      data: {
        status: ORDER_STATUS_LABELS.FINALIZADO,
      },
    };
  } catch (error) {
    console.error('[confirmFinalization] Error:', error);
    return {
      success: false,
      error: 'Error al confirmar la finalización del pedido.',
    };
  }
}

// =====================================================
// 3. CUSTOMER: Reject Finalization (Report Problem)
// =====================================================
// Called when the customer reports a problem
// Requirements:
// - Payment must be in 'esperando_confirmacion' status
// - Token must match

export async function rejectFinalization(
  paymentId: string,
  token: string,
  reason: string,
): Promise<FinalizationActionResult> {
  try {
    // 1. Fetch payment and validate token + status
    const [payment] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.trackingToken, token)))
      .limit(1);

    if (!payment) {
      console.error('[rejectFinalization] Payment not found or invalid token');
      return { success: false, error: 'Pedido no encontrado o token inválido.' };
    }

    if (!CONFIRMABLE_STATUSES.includes(payment.status as string)) {
      console.error('[rejectFinalization] Invalid status:', payment.status);
      return {
        success: false,
        error: `El pedido no está en estado de espera de confirmación. Estado actual: ${payment.status}`,
      };
    }

    // 2. Update payment — V2 path uses OrderService (→ ISSUE_REPORTED), legacy uses inline (→ disputed)
    // Legacy also clears completedAt if it was previously set (P17)
    const now = new Date();
    const expectedVersion = (payment as { version?: number }).version ?? 0;

    if (env.orderFlowV2) {
      const result = await transition({
        paymentId,
        toStatus: ORDER_STATUS_V2.ISSUE_REPORTED,
        actor: { type: 'customer' },
        expectedVersion,
        extraFields: { rejectionReason: reason, completedAt: null },
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }
    } else {
      const [updated] = await db
        .update(payments)
        .set({
          status: ORDER_STATUS.DISPUTED,
          version: expectedVersion + 1,
          rejectionReason: reason,
          completedAt: null, // P17: clear completion date on rejection
          updatedAt: now,
        })
        .where(and(eq(payments.id, paymentId), eq(payments.version, expectedVersion)))
        .returning({ id: payments.id });

      if (!updated) {
        return {
          success: false,
          error: 'El estado del pedido fue modificado. Recargá la página e intentá de nuevo.',
        };
      }
    }

    // 3. Notify the business (seller)
    await createBusinessNotification({
      businessId: payment.businessId,
      type: 'order_finalization_rejected',
      category: 'pedidos',
      title: 'Problema reportado en pedido',
      message: `El cliente ha reportado un problema con el pedido ${payment.orderNumber || payment.id.slice(0, 8)}: ${reason}`,
      data: {
        paymentId,
        orderNumber: payment.orderNumber,
        reason,
        rejectedAt: new Date().toISOString(),
      },
    });

    // 4. Send chat message
    // Buscar por paymentId (sesión aislada de esta orden), no por DNI
    const chatSession = await db.query.chatSessions.findFirst({
      where: and(eq(chatSessions.paymentId, payment.id), eq(chatSessions.status, 'active')),
    });

    if (chatSession) {
      await db.insert(messages).values({
        sessionId: chatSession.id,
        isFromStore: false, // From customer
        content: `❌ HE REPORTADO UN PROBLEMA: ${reason}`,
      });
    }

    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, payment.businessId),
    });
    const slug = business?.slug || payment.businessId;

    revalidatePath(`/${slug}/dashboard`, 'page');
    revalidatePath(`/${slug}/order/${token}`, 'page');

    return {
      success: true,
      data: {
        status: ORDER_STATUS_LABELS.REPORTE,
      },
    };
  } catch (error) {
    console.error('[rejectFinalization] Error:', error);
    return {
      success: false,
      error: 'Error al reportar el problema del pedido.',
    };
  }
}

// =====================================================
// 4. CRON JOB: Auto-Finalize Expired Requests
// =====================================================
// This function should be called periodically (e.g., every 24h)
// It finds all payments in 'not_delivered' with expired deadlines
// and automatically sets them to 'completed'

export async function autoFinalizeExpiredPayments(): Promise<{
  success: boolean;
  processedCount: number;
  error?: string;
}> {
  // V2: timeouts are handled by dedicated processor (T11/T16)
  if (env.orderFlowV2) {
    return { success: true, processedCount: 0 };
  }

  try {
    const now = new Date();

    // 1. Find payments in 'not_delivered' with expired deadlines
    const expiredPayments = await db
      .select({
        id: payments.id,
        businessId: payments.businessId,
        orderNumber: payments.orderNumber,
        finalizationDeadline: payments.finalizationDeadline,
        buyerDni: payments.buyerDni,
      })
      .from(payments)
      .where(
        and(
          eq(payments.status, ORDER_STATUS.NOT_DELIVERED),
          lt(payments.finalizationDeadline, now), // Deadline has passed
        ),
      );

    if (expiredPayments.length === 0) {
      return { success: true, processedCount: 0 };
    }

    // 2. Update each payment to 'completed'
    let processedCount = 0;
    for (const payment of expiredPayments) {
      try {
        await db
          .update(payments)
          .set({
            status: ORDER_STATUS.COMPLETED,
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(payments.id, payment.id));

        // 3. Notify business (seller)
        await createBusinessNotification({
          businessId: payment.businessId,
          type: 'order_auto_finalized',
          category: 'pedidos',
          title: 'Pedido finalizado automáticamente',
          message: `El pedido ${payment.orderNumber || payment.id.slice(0, 8)} se ha finalizado automáticamente tras 3 días sin respuesta del cliente.`,
          data: {
            paymentId: payment.id,
            orderNumber: payment.orderNumber,
            finalizedAt: now.toISOString(),
            reason: 'auto_finalized_timeout',
          },
        });

        // 4. Send chat message
        // Buscar por paymentId (sesión aislada de esta orden), no por DNI
        const chatSession = await db.query.chatSessions.findFirst({
          where: and(eq(chatSessions.paymentId, payment.id), eq(chatSessions.status, 'active')),
        });

        if (chatSession) {
          await db.insert(messages).values({
            sessionId: chatSession.id,
            isFromStore: true,
            content: `⌛ PEDIDO FINALIZADO AUTOMÁTICAMENTE. Debido a la falta de respuesta en los últimos 3 días, el sistema ha dado por concluido este pedido.`,
          });
        }

        processedCount++;
      } catch (err) {
        console.error(`[autoFinalize] Error processing payment ${payment.id}:`, err);
      }
    }

    revalidatePath(`/[slug]/dashboard`, 'page');

    return { success: true, processedCount };
  } catch (error) {
    console.error('[autoFinalize] Error:', error);
    return {
      success: false,
      processedCount: 0,
      error: 'Error en la auto-finalización de pagos.',
    };
  }
}
