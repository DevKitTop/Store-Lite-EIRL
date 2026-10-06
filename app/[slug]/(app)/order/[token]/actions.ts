'use server';

import { db } from '@/core/database/client';
import { chatSessions, messages, payments } from '@/core/database/schema';
import { transition } from '@/core/orders/orderService';
import { ORDER_STATUS_V2, type OrderStatusV2 } from '@/core/orders/orderStatus';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import type { CallerProof } from './types';

// ─── Rate Limiting (in-memory) ───
// 5 intentos por IP cada 15 minutos
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

async function checkRateLimit(): Promise<{ allowed: boolean; retryAfter?: number }> {
  const headersList = await headers();
  const ip =
    headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headersList.get('x-real-ip') ||
    'unknown';

  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    // Primera vez o ventana expirada
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter };
  }

  entry.count += 1;
  return { allowed: true };
}

async function clearRateLimit() {
  const headersList = await headers();
  const ip =
    headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headersList.get('x-real-ip') ||
    'unknown';
  rateLimitMap.delete(ip);
}

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
      return { success: false, error: 'Pedido no encontrado' };
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
      return { success: false, error: result.error };
    }

    revalidatePath('/[slug]/order/[token]', 'page');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error al actualizar el estado';
    if (message === 'No autorizado' || message === 'Pedido no encontrado') {
      return { success: false, error: message };
    }
    console.error('[Action Error] updateOrderStatus:', error);
    return { success: false, error: 'Error al actualizar el estado' };
  }
}

export async function verifyOrderAccess(trackingToken: string, dni: string, orderNumber?: string) {
  try {
    // Rate limiting check
    const rateLimit = await checkRateLimit();
    if (!rateLimit.allowed) {
      return {
        success: false,
        error: `Demasiados intentos. Esperá ${rateLimit.retryAfter} segundos.`,
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
    const providedOrderNumber = orderNumber?.trim() || null;
    const dbOrderNumber = order.orderNumber || null;

    if (providedOrderNumber !== dbOrderNumber) {
      return { success: false };
    }

    // Success — clear rate limit counter
    await clearRateLimit();

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
  dni: string;
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

      if (providedOrderNumber !== dbOrderNumber) {
        return { success: false, reason: 'wrong_order' };
      }
    }

    return { success: true };
  } catch (error) {
    console.error('[Action Error] verifyOrderByGoogleIdentity:', error);
    return { success: false, reason: 'error' };
  }
}

// =====================================================
// 5. V2: Report Issue (ISSUE_REPORTED flow)
// =====================================================

export interface ReportIssueV2Result {
  success: boolean;
  error?: string;
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
    // Validate caller if callerProof is provided
    if (callerProof) {
      try {
        await verifyCallerProof(paymentId, callerProof);
      } catch {
        return { success: false, error: 'No autorizado' };
      }
    }

    const [payment] = await db
      .select({ version: payments.version })
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.trackingToken, trackingToken)))
      .limit(1);

    if (!payment) {
      return { success: false, error: 'Pedido no encontrado' };
    }

    const result = await transition({
      paymentId,
      toStatus: ORDER_STATUS_V2.ISSUE_REPORTED,
      actor: { type: 'customer' },
      expectedVersion: payment.version ?? 0,
      extraFields: { rejectionReason: reason },
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    revalidatePath('/[slug]/order/[token]', 'page');
    return { success: true };
  } catch (error) {
    console.error('[reportIssueV2] Error:', error);
    return { success: false, error: 'Error al reportar el problema' };
  }
}
