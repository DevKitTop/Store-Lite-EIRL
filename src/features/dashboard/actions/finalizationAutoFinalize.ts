// =====================================================
// Legacy auto-finalization sweep — SERVER-ONLY, NOT a server action (NEW-1)
// =====================================================
// `autoFinalizeExpiredPayments` used to live in `finalizationActions.ts`, a
// `'use server'` module. Next.js turns EVERY exported async function in such a
// module into a public RPC endpoint, so that export exposed a system-wide
// mutation — it flips every business's expired `not_delivered` payments to
// `completed` and fires notifications — with NO authorization, reachable by any
// anonymous client that knows the generated action id.
//
// WHY NOT A USER-PERMISSION GUARD. This is a cross-tenant system job, not a
// user-scoped action: there is no single `businessId` to check `orders.manage`
// against (it sweeps every tenant at once), so `requireOrderManager` would be
// the wrong shape. The correct hardening is the one the cron route already
// applies by hand at its HTTP boundary (`app/api/cron/order-timeouts/route.ts:24`):
// keep the sweep OFF the RPC surface. A plain (non-`'use server'`) module has no
// action id to invoke, which removes the endpoint entirely.
//
// The legacy `not_delivered` → `completed` transition is owned today by the
// `auto-complete` rule of `processTimeouts()` (`src/core/orders/orderTimeouts.ts:78-85`),
// which is why nothing calls this function directly: it is kept out of the
// action surface for a scheduler that still needs the legacy deadline sweep.
// =====================================================

import { env } from '@/config/env';
import { db } from '@/core/database/client';
import { chatSessions, messages, payments } from '@/core/database/schema';
import { ORDER_STATUS } from '@/core/orders/orderStatus';
import { createBusinessNotification } from '@/lib/notifications';
import { and, eq, lt } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

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
