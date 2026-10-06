'use server';

import { env } from '@/config/env';
import { db } from '@/core/database/client';
import { businesses, payments, profiles } from '@/core/database/schema';
import { transition } from '@/core/orders/orderService';
import { ORDER_STATUS, ORDER_STATUS_V2 } from '@/core/orders/orderStatus';
import { checkPermission } from '@/lib/permissions';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

const BUCKET_NAME = 'tickets';

// Every unauthorized outcome — unresolved actor, missing grant, or a payment row
// owned by another tenant — reports the same string, so an anonymous caller
// learns nothing about session state (spec R3).
const NO_PERMISSION_ERROR = 'No tienes permisos para este pedido';

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

function createAdminClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
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

export interface UploadTicketResult {
  success: boolean;
  error?: string;
  ticketImageUrl?: string;
  trackingToken?: string;
}

/**
 * Sube la imagen del ticket del courier y actualiza el payment
 * @param paymentId - ID del payment a actualizar
 * @param imageBase64 - Imagen en formato base64
 * @param businessId - ID del negocio (para validar propiedad)
 */
export async function uploadTicketAndUpdatePayment(
  paymentId: string,
  imageBase64: string,
  businessId: string,
): Promise<UploadTicketResult> {
  try {
    // Authorization gate — before any DB read and outside the orderFlowV2 branch (design D4).
    const gate = await requireOrderManager(businessId);
    if (!gate.ok) return { success: false, error: NO_PERMISSION_ERROR };
    const { actorId } = gate;

    // 1. Obtener datos del pago para validar y pasar preconditions
    const [existingPayment] = await db
      .select({
        trackingToken: payments.trackingToken,
        businessId: payments.businessId,
        version: payments.version,
      })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1);

    if (!existingPayment) {
      console.error('[uploadTicket] Payment not found:', paymentId);
      return { success: false, error: 'Pedido no encontrado' };
    }

    if (existingPayment.businessId !== businessId) {
      console.error(
        '[uploadTicket] Permission denied — expected:',
        businessId,
        'got:',
        existingPayment.businessId,
      );
      return { success: false, error: NO_PERMISSION_ERROR };
    }

    if (!existingPayment.trackingToken) {
      console.error('[uploadTicket] No trackingToken for payment:', paymentId);
      return { success: false, error: 'El pedido no tiene un token de seguimiento' };
    }

    const expectedVersion = existingPayment.version ?? 0;

    // 2. Convert base64 to Uint8Array (compatible with Edge runtime)
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // 3. Generate filename using trackingToken (unique per order)
    const fileName = `${existingPayment.trackingToken}.jpg`;
    const filePath = `${businessId}/${fileName}`;

    // 4. Upload to Supabase Storage
    const adminClient = createAdminClient();

    const { data: _uploadData, error: uploadError } = await adminClient.storage
      .from(BUCKET_NAME)
      .upload(filePath, bytes, {
        contentType: 'image/jpeg',
        upsert: true, // Sobrescribir si ya existe (para poder editar)
      });

    if (uploadError) {
      console.error('[uploadTicket] Upload error:', uploadError.message);
      return { success: false, error: uploadError.message };
    }

    // 5. Get public URL
    const { data: urlData } = adminClient.storage.from(BUCKET_NAME).getPublicUrl(filePath);
    const ticketImageUrl = urlData.publicUrl;

    // 6. Update payment — V2 path uses OrderService, legacy uses inline
    if (env.orderFlowV2) {
      const result = await transition({
        paymentId,
        toStatus: ORDER_STATUS_V2.WAITING_CUSTOMER_CONFIRMATION,
        actor: { type: 'seller', id: actorId },
        expectedVersion,
        extraFields: { ticketImageUrl },
        preconditions: {},
      });

      if (!result.success) {
        console.error('[uploadTicket] OrderService error:', result.error);
        // Mapear errores técnicos a mensajes amigables para el usuario
        const friendlyError = mapTransitionError(result.error);
        return { success: false, error: friendlyError };
      }
    } else {
      const [updated] = await db
        .update(payments)
        .set({
          ticketImageUrl,
          status: ORDER_STATUS.VALIDANDO,
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(payments.id, paymentId), eq(payments.version, expectedVersion)))
        .returning({ id: payments.id });

      if (!updated) {
        console.error('[uploadTicket] Version conflict for payment:', paymentId);
        return {
          success: false,
          error: 'El pedido fue modificado por otra operación. Recargá e intentá de nuevo.',
        };
      }
    }

    return { success: true, ticketImageUrl, trackingToken: existingPayment.trackingToken };
  } catch (error) {
    console.error('[uploadTicket] Error:', error instanceof Error ? error.message : String(error));
    return { success: false, error: 'Error al procesar el ticket' };
  }
}

export interface NotifyDeliveryResult {
  success: boolean;
  error?: string;
  autoCompletePending?: boolean;
}

/**
 * Notifica al customer que su pedido llegó al destino.
 * Cambia el estado a 'en_reparto' para que el customer pueda confirmar recepción.
 * Solo permitido cuando el status actual es 'delivered'.
 */
export async function notifyDelivery(
  paymentId: string,
  businessId: string,
): Promise<NotifyDeliveryResult> {
  try {
    // Authorization gate — before any DB read and outside the orderFlowV2 branch (design D4).
    const gate = await requireOrderManager(businessId);
    if (!gate.ok) return { success: false, error: NO_PERMISSION_ERROR };
    const { actorId } = gate;

    const [existingPayment] = await db
      .select({
        status: payments.status,
        businessId: payments.businessId,
        version: payments.version,
      })
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1);

    if (!existingPayment) {
      return { success: false, error: 'Pedido no encontrado' };
    }

    if (existingPayment.businessId !== businessId) {
      return { success: false, error: NO_PERMISSION_ERROR };
    }

    // Solo se puede notificar entrega si el ticket ya fue validado (status = delivered)
    if (existingPayment.status !== ORDER_STATUS.DELIVERED) {
      return { success: false, error: 'El ticket aún no fue validado por el cliente' };
    }

    // Version-locked update
    const expectedVersion = existingPayment.version ?? 0;

    if (env.orderFlowV2) {
      const result = await transition({
        paymentId,
        toStatus: ORDER_STATUS_V2.IN_TRANSIT,
        actor: { type: 'seller', id: actorId },
        expectedVersion,
      });

      if (!result.success) {
        console.error('[notifyDelivery] OrderService error:', result.error);
        return { success: false, error: result.error };
      }
    } else {
      const [updated] = await db
        .update(payments)
        .set({
          status: ORDER_STATUS.EN_REPARTO,
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(payments.id, paymentId), eq(payments.version, expectedVersion)))
        .returning({ id: payments.id });

      if (!updated) {
        console.error('[notifyDelivery] Version conflict for payment:', paymentId);
        return {
          success: false,
          error: 'El estado del pedido fue modificado. Recargá e intentá de nuevo.',
        };
      }
    }

    return { success: true };
  } catch (error) {
    console.error(
      '[notifyDelivery] Error:',
      error instanceof Error ? error.message : String(error),
    );
    return { success: false, error: 'Error al notificar la entrega' };
  }
}

// ── prepareOrder ───────────────────────────────────────────────

export async function prepareOrder(
  paymentId: string,
  businessId: string,
): Promise<NotifyDeliveryResult> {
  try {
    // Authorization gate — before any DB read and outside the orderFlowV2 branch (design D4).
    const gate = await requireOrderManager(businessId);
    if (!gate.ok) return { success: false, error: NO_PERMISSION_ERROR };
    const { actorId } = gate;

    const [existingPayment] = await db
      .select({
        status: payments.status,
        businessId: payments.businessId,
        version: payments.version,
      })
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.businessId, businessId)))
      .limit(1);

    if (!existingPayment) return { success: false, error: 'Pedido no encontrado' };
    if (existingPayment.businessId !== businessId)
      return { success: false, error: NO_PERMISSION_ERROR };

    const expectedVersion = existingPayment.version ?? 0;

    if (env.orderFlowV2) {
      const result = await transition({
        paymentId,
        toStatus: ORDER_STATUS_V2.PREPARING_ORDER,
        actor: { type: 'seller', id: actorId },
        expectedVersion,
      });
      if (!result.success) return { success: false, error: mapTransitionError(result.error) };
    } else {
      return { success: false, error: 'El flujo de envío requiere orderFlowV2' };
    }

    revalidatePath(`/${businessId}/dashboard`, 'page');
    return { success: true };
  } catch (error) {
    console.error('[prepareOrder] Error:', error instanceof Error ? error.message : String(error));
    return { success: false, error: 'Error al preparar el pedido' };
  }
}

// ── markReadyForPickup ──────────────────────────────────────────

export async function markReadyForPickup(
  paymentId: string,
  businessId: string,
): Promise<NotifyDeliveryResult> {
  try {
    // Authorization gate — before any DB read and outside the orderFlowV2 branch (design D4).
    const gate = await requireOrderManager(businessId);
    if (!gate.ok) return { success: false, error: NO_PERMISSION_ERROR };
    const { actorId } = gate;

    const [existingPayment] = await db
      .select({
        status: payments.status,
        businessId: payments.businessId,
        version: payments.version,
      })
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.businessId, businessId)))
      .limit(1);

    if (!existingPayment) return { success: false, error: 'Pedido no encontrado' };
    if (existingPayment.businessId !== businessId)
      return { success: false, error: NO_PERMISSION_ERROR };

    const expectedVersion = existingPayment.version ?? 0;

    if (env.orderFlowV2) {
      const result = await transition({
        paymentId,
        toStatus: ORDER_STATUS_V2.READY_FOR_PICKUP,
        actor: { type: 'seller', id: actorId },
        expectedVersion,
      });
      if (!result.success) return { success: false, error: mapTransitionError(result.error) };
    } else {
      return { success: false, error: 'El flujo de recojo requiere orderFlowV2' };
    }

    revalidatePath(`/${businessId}/dashboard`, 'page');
    return { success: true };
  } catch (error) {
    console.error(
      '[markReadyForPickup] Error:',
      error instanceof Error ? error.message : String(error),
    );
    return { success: false, error: 'Error al marcar como listo para recojo' };
  }
}

// ── confirmPickedUp ────────────────────────────────────────────

export async function confirmPickedUp(
  paymentId: string,
  businessId: string,
  customerCode: string,
): Promise<NotifyDeliveryResult> {
  try {
    // Authorization gate — before any DB read and outside the orderFlowV2 branch (design D4).
    const gate = await requireOrderManager(businessId);
    if (!gate.ok) return { success: false, error: NO_PERMISSION_ERROR };
    const { actorId } = gate;

    const [existingPayment] = await db
      .select({
        status: payments.status,
        businessId: payments.businessId,
        version: payments.version,
        pickupCode: payments.pickupCode,
        trackingToken: payments.trackingToken,
        businessSlug: businesses.slug,
      })
      .from(payments)
      .innerJoin(businesses, eq(businesses.id, payments.businessId))
      .where(and(eq(payments.id, paymentId), eq(payments.businessId, businessId)))
      .limit(1);

    if (!existingPayment) return { success: false, error: 'Pedido no encontrado' };
    if (existingPayment.businessId !== businessId)
      return { success: false, error: NO_PERMISSION_ERROR };

    // Validar que el código ingresado coincida con el código generado
    if (!existingPayment.pickupCode) {
      return { success: false, error: 'El pedido aún no tiene un código de recojo generado' };
    }

    const normalizedCode = customerCode.trim().toUpperCase();
    if (normalizedCode !== existingPayment.pickupCode.toUpperCase()) {
      return { success: false, error: 'El código de recojo no coincide. Verificá con el cliente.' };
    }

    const expectedVersion = existingPayment.version ?? 0;

    if (env.orderFlowV2) {
      // 1. First transition: READY_FOR_PICKUP → PICKED_UP (records pickup event)
      const pickupResult = await transition({
        paymentId,
        toStatus: ORDER_STATUS_V2.PICKED_UP,
        actor: { type: 'seller', id: actorId },
        expectedVersion,
      });
      if (!pickupResult.success)
        return { success: false, error: mapTransitionError(pickupResult.error) };

      // 2. Immediately auto-complete: PICKED_UP → COMPLETED
      //    The seller verified the code, so the order is effectively done.
      const completeResult = await transition({
        paymentId,
        toStatus: ORDER_STATUS_V2.COMPLETED,
        actor: { type: 'system' },
        expectedVersion: pickupResult.payment.version ?? 0,
        metadata: { autoCompletedAfterPickup: true },
      });
      if (!completeResult.success) {
        console.error(
          '[confirmPickedUp] Auto-complete failed (order stays PICKED_UP):',
          completeResult.error,
        );
        // Non-fatal — the order is already PICKED_UP, auto-complete will retry via cron.
        // Return success with a flag so the client knows to show PICKED_UP status (not COMPLETED)
        revalidatePath(`/${businessId}/dashboard`, 'page');
        if (existingPayment.trackingToken && existingPayment.businessSlug) {
          revalidatePath(
            `/${existingPayment.businessSlug}/order/${existingPayment.trackingToken}`,
            'page',
          );
        }
        return { success: true, autoCompletePending: true };
      }
    } else {
      return { success: false, error: 'El flujo de recojo requiere orderFlowV2' };
    }

    revalidatePath(`/${businessId}/dashboard`, 'page');
    if (existingPayment.trackingToken && existingPayment.businessSlug) {
      revalidatePath(
        `/${existingPayment.businessSlug}/order/${existingPayment.trackingToken}`,
        'page',
      );
    }
    return { success: true };
  } catch (error) {
    console.error(
      '[confirmPickedUp] Error:',
      error instanceof Error ? error.message : String(error),
    );
    return { success: false, error: 'Error al confirmar el recojo' };
  }
}

/**
 * Mapea errores técnicos de la máquina de estados a mensajes amigables para el usuario.
 */
function mapTransitionError(error: string): string {
  if (error.includes('Version conflict')) {
    return 'El pedido fue modificado por otra operación. Recargá la página e intentá de nuevo.';
  }
  if (
    error.includes('Invalid transition') ||
    error.includes('not allowed') ||
    error.includes('not permitted')
  ) {
    return 'No se puede cambiar el estado del pedido en este momento. Recargá la página e intentá de nuevo.';
  }
  if (error.includes('Seller must provide')) {
    return 'Faltan datos del courier. Completá los campos de transporte y volvé a intentar.';
  }
  if (error.includes('Pickup statuses require')) {
    return 'Este pedido no es de tipo recojo. No se puede usar el flujo de recojo.';
  }
  if (error.includes('El código de recojo no coincide')) {
    return error; // ya es un mensaje amigable
  }
  if (error.includes('El pedido aún no tiene un código')) {
    return error; // ya es un mensaje amigable
  }
  if (error.includes('Estado actual desconocido')) {
    return 'El pedido tiene un estado desconocido. Contactá a soporte.';
  }
  // Si no hay un mapeo conocido, devolver el error original
  return error;
}
