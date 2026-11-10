'use server';

import { db } from '@/core/database/client';
import { businesses, payments } from '@/core/database/schema';
import { logger, toErrorDetail } from '@/lib/logger';
import { and, eq } from 'drizzle-orm';

/**
 * Busca una orden usando la identidad de Google (authId) + número de orden + slug del negocio.
 *
 * A diferencia de verifyOrderByGoogleIdentity (que requiere un trackingToken),
 * esta acción busca la orden desde cero para el modal "Ver Pedido".
 */
export async function lookupOrderByGoogleIdentity(
  authId: string,
  orderNumber: string,
  businessSlug: string,
) {
  try {
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.slug, businessSlug),
      columns: { id: true },
    });

    if (!business) {
      return { success: false as const, error: 'Negocio no encontrado' };
    }

    // Limpiar el número de orden (por si viene con #)
    const cleanOrderNumber = orderNumber.startsWith('#') ? orderNumber.slice(1) : orderNumber;

    const payment = await db.query.payments.findFirst({
      where: and(eq(payments.businessId, business.id), eq(payments.orderNumber, cleanOrderNumber)),
      columns: {
        id: true,
        trackingToken: true,
        metadata: true,
      },
    });

    if (!payment || !payment.trackingToken) {
      return { success: false as const, error: 'No se encontró ningún pedido con ese número' };
    }

    // Verificar que la orden tenga Google vinculado
    const metadata = payment.metadata as Record<string, unknown> | null;
    const customerAuth = metadata?.customerAuth as Record<string, unknown> | null;
    const storedAuthId = customerAuth?.authId as string | undefined;

    if (!storedAuthId) {
      return {
        success: false as const,
        error: 'Esta compra fue realizada sin una cuenta de Google. Usá DNI + N° de orden.',
        reason: 'no_google_link' as const,
      };
    }

    if (storedAuthId !== authId) {
      return {
        success: false as const,
        error: 'Esta orden está vinculada a otra cuenta de Google.',
        reason: 'wrong_account' as const,
      };
    }

    return {
      success: true as const,
      token: payment.trackingToken,
    };
  } catch (error) {
    logger.error('[lookupOrderByGoogleIdentity] Error:', { error: toErrorDetail(error) });
    return { success: false as const, error: 'Error al buscar el pedido' };
  }
}
