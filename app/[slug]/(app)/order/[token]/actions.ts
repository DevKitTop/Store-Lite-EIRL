'use server';

import { db } from '@/core/database/client';
import { chatSessions, messages, payments } from '@/core/database/schema';
import { transition } from '@/core/orders/orderService';
import { ORDER_STATUS_V2, type OrderStatusV2 } from '@/core/orders/orderStatus';
import { deleteOrderAccessCookie, setOrderAccessCookie } from '@/lib/orderAccessCookie';
import {
  ORDER_ACCESS_DENIED_ERROR,
  requireOrderAccess,
  type OrderAccessRefusalReason,
} from '@/lib/orderAccessGate';
import {
  checkOrderAccessRateLimitFor,
  resetOrderAccessRateLimit,
} from '@/lib/orderAccessRateLimit';
import { getClientIdentifierFromHeaders } from '@/lib/rateLimit';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import type { CallerProof } from './types';

/**
 * Verify that at least one of {dni, authId} in callerProof matches
 * the payment record. Throws if neither matches or the payment is not found.
 */
async function verifyCallerProof(paymentId: string, callerProof: CallerProof): Promise<void> {
  const payment = await db.query.payments.findFirst({
    where: eq(payments.id, paymentId),
    columns: {
      id: true,
      buyerDni: true,
      metadata: true,
    },
  });

  if (!payment) {
    throw new Error('Pedido no encontrado');
  }

  // Check DNI match
  if (callerProof.dni && payment.buyerDni === callerProof.dni) {
    return;
  }

  // Check Google authId match
  if (callerProof.authId) {
    const metadata = payment.metadata as Record<string, unknown> | null;
    const customerAuth = metadata?.customerAuth as Record<string, unknown> | null;
    const storedAuthId = customerAuth?.authId as string | undefined;
    if (storedAuthId === callerProof.authId) {
      return;
    }
  }

  throw new Error('No autorizado');
}

// ─── Legacy→V2 status mapping for customer actions ───
const CUSTOMER_ACTION_MAP: Record<string, string> = {
  delivered: ORDER_STATUS_V2.DELIVERED,
  disputed: ORDER_STATUS_V2.DISPUTE,
};

export async function updateOrderStatus(
  paymentId: string,
  trackingToken: string,
  status: string,
  options?: { rejectionReason?: string; callerProof?: CallerProof },
) {
  try {
    // R19: the signed httpOnly cookie is the authorization decision. It runs
    // BEFORE the callerProof check and BEFORE the first DB read, so an
    // unauthorized caller never makes the server touch `payments`. `callerProof`
    // stays below as defense-in-depth — it is a value the client keeps in
    // `localStorage`, so it can never be the primary gate (R19).
    const access = await requireOrderAccess(trackingToken);
    if (!access.ok) {
      return { success: false, error: ORDER_ACCESS_DENIED_ERROR, reason: access.reason };
    }

    // Validate caller if callerProof is provided
    if (options?.callerProof) {
      await verifyCallerProof(paymentId, options.callerProof);
    }

    const [current] = await db
      .select({ version: payments.version })
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.trackingToken, trackingToken)))
      .limit(1);

    if (!current) {
      // R20: the cookie verified, so a missing row is about the ORDER — and
      // re-minting cannot conjure one, so it must never read as reauth_required.
      return { success: false, error: 'Pedido no encontrado', reason: 'order_not_found' };
    }

    const expectedVersion = current.version ?? 0;

    // Map legacy customer status to V2 and use transition() for safety
    const v2Status = (CUSTOMER_ACTION_MAP[status] || status) as OrderStatusV2;

    const extraFields: Record<string, unknown> = {};
    if (options?.rejectionReason) {
      extraFields.rejectionReason = options.rejectionReason;
    }

    const result = await transition({
      paymentId,
      toStatus: v2Status,
      actor: { type: 'customer' },
      expectedVersion,
      extraFields,
    });

    if (!result.success) {
      // The cookie verified, so a refused transition is about the ORDER's state.
      return { success: false, error: result.error, reason: 'order_not_actionable' };
    }

    revalidatePath('/[slug]/order/[token]', 'page');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al actualizar el estado';
    if (message === 'No autorizado') {
      // The access cookie verified; it is the `localStorage` proof that belongs
      // to somebody else (a shared device, a stale marker). Re-minting the
      // cookie would not change that, so this is NOT reauth_required — and the
      // order is fine, so it is NOT order_not_actionable either (R20).
      return { success: false, error: message, reason: 'caller_proof_mismatch' };
    }
    if (message === 'Pedido no encontrado') {
      return { success: false, error: message, reason: 'order_not_found' };
    }
    console.error('[Action Error] updateOrderStatus:', error);
    // Unclassified: a dead socket is not an authorization decision, and telling
    // the buyer to re-verify would be a loop that cannot help.
    return { success: false, error: 'Error al actualizar el estado', reason: 'generic' };
  }
}

export async function verifyOrderAccess(trackingToken: string, dni: string, orderNumber?: string) {
  try {
    // Rate limiting check — the SHARED auth-intent limiter keyed (client, dni),
    // the same primitive POST /api/order/lookup uses. Runs BEFORE the payment
    // lookup so a refused caller cannot learn whether the order exists.
    const clientId = getClientIdentifierFromHeaders(await headers());
    const rateLimit = checkOrderAccessRateLimitFor(clientId, { dni });
    if (!rateLimit.allowed) {
      return {
        success: false,
        error: `Demasiados intentos. Esperá ${Math.ceil(rateLimit.resetInMs / 1000)} segundos.`,
        rateLimited: true,
      };
    }

    const order = await db.query.payments.findFirst({
      where: and(eq(payments.trackingToken, trackingToken), eq(payments.buyerDni, dni)),
    });

    if (!order) {
      return { success: false };
    }

    // P4: Normalize orderNumber comparison (handle null/empty)
    // R15: ensure `null !== null` cannot authorize — an absent order number
    // must never pass when the order itself has no order number.
    const providedOrderNumber = orderNumber?.trim() || null;
    const dbOrderNumber = order.orderNumber || null;

    if (!providedOrderNumber || providedOrderNumber !== dbOrderNumber) {
      return { success: false };
    }

    // Success — refund this caller's own (client, dni) budget, scoped so no
    // sibling dni is handed a fresh window it has not paid for.
    resetOrderAccessRateLimit(clientId, { dni });

    await setOrderAccessCookie(trackingToken);

    return { success: true };
  } catch (error) {
    return { success: false };
  }
}

/**
 * Sincroniza la sesión de chat vinculada a un pedido específico.
 *
 * Lógica:
 * 1. Busca una sesión activa vinculada al paymentId exacto → si existe, la reusa.
 * 2. Si no, busca una sesión activa del mismo buyer (guestId) → la REUSA y
 *    la vincula al paymentId. Esto es CLAVE para mantener el historial del
 *    chat pre-compra (donde el seller ya mandó mensajes).
 * 3. Si no hay ninguna, CREA una nueva sesión vinculada al paymentId.
 */
export async function syncChatSession(params: {
  guestIdFromStorage: string | null;
  // 🔒 SECURITY (R17): nullable — the order page's public projection omits the
  // buyer DNI. A falsy value keeps the existing `guest-${paymentId}` identity,
  // so an unverified visitor can never join another buyer's `dni-{dni}` thread.
  dni: string | null;
  businessId: string;
  buyerName: string;
  paymentId: string;
}) {
  try {
    // Unique guestId for this order if shared DNI session is already active for another order
    const orderGuestId = `guest-${params.paymentId}`;
    const targetGuestId = params.dni ? `dni-${params.dni}` : orderGuestId;

    // 1. Buscar sesión activa vinculada EXACTAMENTE a este paymentId
    const exactSession = await db.query.chatSessions.findFirst({
      where: and(
        eq(chatSessions.paymentId, params.paymentId),
        eq(chatSessions.businessId, params.businessId),
        eq(chatSessions.status, 'active'),
      ),
      orderBy: [desc(chatSessions.createdAt)],
    });

    if (exactSession) {
      return { success: true, sessionId: exactSession.id, guestId: exactSession.guestId };
    }

    // 2. Buscar sesión activa del mismo buyer SIN paymentId (pre-compra)
    //    para REUSARLA y mantener el historial del chat pre-compra.
    //    ⚠️ Solo reusamos sesiones con paymentId IS NULL — si ya tiene
    //    un paymentId asignado, pertenece a OTRA orden y NO debe reusarse.
    const existingSession = await db.query.chatSessions.findFirst({
      where: and(
        eq(chatSessions.guestId, targetGuestId),
        eq(chatSessions.businessId, params.businessId),
        eq(chatSessions.status, 'active'),
        isNull(chatSessions.paymentId),
      ),
      orderBy: [desc(chatSessions.createdAt)],
    });

    if (existingSession) {
      // Reusamos la sesión existente: vinculamos el paymentId
      // así el cliente ve el historial completo del chat pre-compra
      await db
        .update(chatSessions)
        .set({ paymentId: params.paymentId, updatedAt: new Date() })
        .where(eq(chatSessions.id, existingSession.id));

      return { success: true, sessionId: existingSession.id, guestId: targetGuestId };
    }

    // 3. Si ya existe una sesión activa para este targetGuestId (ej. de otra orden previa),
    // usaremos orderGuestId para evitar la violación del índice único uq_chat_sessions_active_per_guest
    const existingActiveSession = await db.query.chatSessions.findFirst({
      where: and(
        eq(chatSessions.guestId, targetGuestId),
        eq(chatSessions.businessId, params.businessId),
        eq(chatSessions.status, 'active'),
      ),
    });

    const finalGuestId = existingActiveSession ? orderGuestId : targetGuestId;

    // 4. No hay sesión previa libre → CREAMOS una nueva vinculada al paymentId
    const [newSession] = await db
      .insert(chatSessions)
      .values({
        businessId: params.businessId,
        paymentId: params.paymentId,
        guestId: finalGuestId,
        guestName: params.buyerName,
        guestGender: 'other',
        status: 'active',
      })
      .returning();

    // Mensaje de bienvenida automático
    await db.insert(messages).values({
      sessionId: newSession.id,
      isFromStore: true,
      content: `¡Hola ${params.buyerName}! Bienvenido al canal de soporte de tu orden. ¿Cómo podemos ayudarte?`,
    });

    return { success: true, sessionId: newSession.id, guestId: finalGuestId };
  } catch (error) {
    console.error('[Action Error] syncChatSession:', error);
    return { success: false, error: 'Error al sincronizar chat' };
  }
}

/**
 * Verifica el acceso a una orden usando la identidad de Google.
 *
 * Busca en el metadata de payments si el `customerAuth.authId` coincide
 * con el `authId` del usuario autenticado.
 */
export async function verifyOrderByGoogleIdentity(
  trackingToken: string,
  authId: string,
  orderNumber?: string,
) {
  try {
    // 1. Primero verificar si la orden existe (por trackingToken)
    const order = await db.query.payments.findFirst({
      where: eq(payments.trackingToken, trackingToken),
      columns: {
        id: true,
        orderNumber: true,
        metadata: true,
      },
    });

    if (!order) {
      return { success: false, reason: 'not_found' };
    }

    // 2. Verificar si la orden tiene Google vinculado
    const metadata = order.metadata as Record<string, unknown> | null;
    const customerAuth = metadata?.customerAuth as Record<string, unknown> | null;
    const storedAuthId = customerAuth?.authId as string | undefined;

    if (!storedAuthId) {
      // La orden existe pero NO fue vinculada a Google
      return { success: false, reason: 'no_google_link' };
    }

    if (storedAuthId !== authId) {
      // Hay Google vinculado pero es otra cuenta
      return { success: false, reason: 'wrong_account' };
    }

    // 3. Si se provee orderNumber, validar que coincida
    if (orderNumber) {
      const dbOrderNumber = order.orderNumber || null;
      const providedOrderNumber = orderNumber.trim() || null;

      if (!providedOrderNumber || providedOrderNumber !== dbOrderNumber) {
        return { success: false, reason: 'wrong_order' };
      }
    }

    await setOrderAccessCookie(trackingToken);

    return { success: true };
  } catch (error) {
    console.error('[Action Error] verifyOrderByGoogleIdentity:', error);
    return { success: false, reason: 'error' };
  }
}

/**
 * Revokes the signed order-access cookie (R16) — the server half of logout.
 *
 * Named `clearOrderAccessCookie` rather than re-exporting the module's
 * `deleteOrderAccessCookie`, because a `'use server'` file may only export
 * async functions and the R16 name has to stay stable for `LogoutButton`.
 */
export async function clearOrderAccessCookie(trackingToken: string): Promise<void> {
  await deleteOrderAccessCookie(trackingToken);
}

// =====================================================
// 5. V2: Report Issue (ISSUE_REPORTED flow)
// =====================================================

export interface ReportIssueV2Result {
  success: boolean;
  error?: string;
  /** R20: a refusal is never a bare boolean — the UI branches on this. */
  reason?: OrderAccessRefusalReason;
}

/**
 * Report an issue on an order (V2 flow).
 * Uses OrderService.transition() with ISSUE_REPORTED status.
 * Works for WAITING_CUSTOMER_CONFIRMATION, READY_TO_SHIP, IN_TRANSIT, DELIVERED.
 */
export async function reportIssueV2(
  paymentId: string,
  trackingToken: string,
  reason: string,
  callerProof?: CallerProof,
): Promise<ReportIssueV2Result> {
  try {
    // R19: the signed httpOnly cookie is the authorization decision, checked
    // before the callerProof block and before the first DB read.
    const access = await requireOrderAccess(trackingToken);
    if (!access.ok) {
      return { success: false, error: ORDER_ACCESS_DENIED_ERROR, reason: access.reason };
    }

    // Validate caller if callerProof is provided
    if (callerProof) {
      try {
        await verifyCallerProof(paymentId, callerProof);
      } catch {
        // Cookie verified, proof does not belong to this buyer — see the twin
        // branch in `updateOrderStatus` (R20).
        return { success: false, error: 'No autorizado', reason: 'caller_proof_mismatch' };
      }
    }

    const [payment] = await db
      .select({ version: payments.version })
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.trackingToken, trackingToken)))
      .limit(1);

    if (!payment) {
      return { success: false, error: 'Pedido no encontrado', reason: 'order_not_found' };
    }

    const result = await transition({
      paymentId,
      toStatus: ORDER_STATUS_V2.ISSUE_REPORTED,
      actor: { type: 'customer' },
      expectedVersion: payment.version ?? 0,
      extraFields: { rejectionReason: reason },
    });

    if (!result.success) {
      // The cookie verified, so a refused transition is about the ORDER's state.
      return { success: false, error: result.error, reason: 'order_not_actionable' };
    }

    revalidatePath('/[slug]/order/[token]', 'page');
    return { success: true };
  } catch (error) {
    console.error('[reportIssueV2] Error:', error);
    // Unclassified: a thrown error is not an authorization decision (R20).
    return { success: false, error: 'Error al reportar el problema', reason: 'generic' };
  }
}
