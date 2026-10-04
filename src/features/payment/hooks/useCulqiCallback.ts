'use client';

import type { CartItem } from '@/features/storage/context/CartContext';
import { chargePayment } from '@/shared/payments/paymentApi';
import type { CulqiOrderResult } from '@/types/culqi';
import { posthog } from 'posthog-js';
import { useEffect } from 'react';
import type { ShippingInfo } from '../../../../app/[slug]/(app)/components/Checkout';

// ─── Límites de métodos de pago ─────────────────────────────────────────────
// Yape tiene un tope de S/ 950 para pagos en comercios (según validación
// del propio Culqi Checkout v4). Montos mayores a 950 son rechazados por
// Culqi con error "invalid_number" en el parámetro amount.
// Fuente: error real de Culqi Checkout v4 + docs Culqi.
const YAPE_LIMITS = {
  min: 6.0,
  max: 950.0,
} as const;

export { YAPE_LIMITS };

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PaymentInstructionsData {
  culqiOrderId: string;
  paymentMethod: string;
  paymentCode: string | null;
  qrUrl: string | null;
  expirationDate: string | null;
}

export interface CustomerAuth {
  provider: string;
  authId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface UseCulqiCallbackOptions {
  culqiReady: boolean;
  finalTotal: number;
  businessId: string;
  cartItems: [CartItem, ...CartItem[]];
  email: string;
  customerName: string;
  shippingInfo: ShippingInfo;
  businessAddress?: string;
  businessCity?: string;
  slug: string;
  customerAuth: CustomerAuth | null;
  onCulqiProcessingChange: (processing: boolean) => void;
  onPaymentProcessingChange: (processing: boolean) => void;
  paymentGuardRef: React.MutableRefObject<boolean>;
  culqiCallbackGuardRef: React.MutableRefObject<boolean>;
  onOrderPaid: (order: {
    orderNumber: string;
    paymentMethod: string;
    trackingToken?: string;
  }) => void;
  onPaymentInstructions: (instructions: PaymentInstructionsData) => void;
  onError: (message: string) => void;
}

// ─── Metadata builder ───────────────────────────────────────────────────────
// NOTE: orderNumber is NO longer included here. The server (charge/route.ts) is
// the authoritative source for payments.order_number. The client must not send
// a client-generated value. The server response contains the generated orderNumber
// in paymentResult.payment.orderNumber.

interface BuildMetadataPayloadParams {
  shippingInfo: ShippingInfo;
  cartItems: [CartItem, ...CartItem[]];
  businessAddress?: string;
  businessCity?: string;
}

function buildMetadataPayload({
  shippingInfo,
  cartItems,
  businessAddress,
  businessCity,
}: BuildMetadataPayloadParams): Record<string, unknown> {
  return {
    dni: shippingInfo.dni,
    cartItems: cartItems.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      price: (item as unknown as Record<string, unknown>).secondPrice || item.price,
    })),
    shippingInfo: {
      ...shippingInfo,
      address: shippingInfo.courier === 'recojo' ? businessAddress : shippingInfo.address,
      district: shippingInfo.courier === 'recojo' ? businessCity : shippingInfo.district,
      dni: shippingInfo.dni,
    },
  };
}

function buildCustomerAuthPayload(customerAuth: CustomerAuth | null): Record<string, unknown> {
  if (!customerAuth) return {};
  return {
    customerAuth: {
      provider: customerAuth.provider,
      authId: customerAuth.authId,
      name: customerAuth.name,
      email: customerAuth.email,
      avatarUrl: customerAuth.avatarUrl,
    },
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Registers the window.culqi callback in a useEffect.
 *
 * Handles both Culqi.order (async payments like PagoEfectivo, Billetera, Cuotéalo)
 * and Culqi.token (card / Yape) flows, including charge API calls, analytics,
 * guard ref management, and cleanup on unmount.
 */
export function useCulqiCallback({
  culqiReady,
  finalTotal,
  businessId,
  cartItems,
  email,
  customerName,
  shippingInfo,
  businessAddress,
  businessCity,
  slug,
  customerAuth,
  onCulqiProcessingChange,
  onPaymentProcessingChange,
  paymentGuardRef,
  culqiCallbackGuardRef,
  onOrderPaid,
  onPaymentInstructions,
  onError,
}: UseCulqiCallbackOptions): void {
  const primaryProduct = cartItems[0];

  // ── Order handler: Culqi.order (card paid / async payment) ──────────

  // eslint-disable-next-line complexity
  async function handleCulqiOrder(order: CulqiOrderResult): Promise<void> {
    onCulqiProcessingChange(false);

    if (order.status === 'paid') {
      // Card payment completed through the order
      const paymentMethod = 'Tarjeta';
      onPaymentProcessingChange(true);
      if (window.Culqi?.close) window.Culqi.close();

      try {
        const paymentResult = await chargePayment({
          culqiOrderId: order.id,
          amount: order.amount || Math.round(finalTotal * 100),
          currency: 'PEN',
          email,
          phone: shippingInfo.phone,
          customerName,
          businessId,
          productId: primaryProduct.id,
          ...buildCustomerAuthPayload(customerAuth),
          metadata: buildMetadataPayload({
            shippingInfo,
            cartItems,
            businessAddress,
            businessCity,
          }),
        });

        // Server is authoritative for orderNumber (W-P4). Read from response.
        const serverOrderNumber = paymentResult?.payment?.orderNumber;
        if (!serverOrderNumber) {
          throw new Error('Server did not return orderNumber');
        }

        onOrderPaid({
          orderNumber: serverOrderNumber,
          paymentMethod,
          trackingToken: paymentResult?.payment?.trackingToken as string | undefined,
        });

        trackPaymentAnalytics({
          orderId: serverOrderNumber,
          paymentId: order.id,
          amount: finalTotal,
          businessSlug: slug,
          method: paymentMethod,
        });
      } catch (error) {
        console.error('Order card payment failed:', error);
        const message =
          error instanceof Error ? error.message : 'Hubo un problema al procesar tu pago.';
        onError(message);
        paymentGuardRef.current = false;
        culqiCallbackGuardRef.current = false;
        onPaymentProcessingChange(false);
        if (window.Culqi?.close) window.Culqi.close();
        return;
      }

      onPaymentProcessingChange(false);
      if (window.Culqi?.close) window.Culqi.close();
      return;
    }

    // Async payment method (PagoEfectivo, Billetera Móvil, Cuotéalo)
    onPaymentInstructions({
      culqiOrderId: order.id,
      paymentMethod: order.payment_method || 'pago_efectivo',
      paymentCode: order.cip_code || null,
      qrUrl: order.action?.qr?.image_url || null,
      expirationDate: order.expiration_date
        ? new Date(order.expiration_date * 1000).toISOString()
        : null,
    });
    if (window.Culqi?.close) window.Culqi.close();
  }

  // ── Token handler: Culqi.token (card / Yape one-step charge) ────────

  async function handleCulqiToken(token: string, tokenType: string): Promise<void> {
    const paymentMethod = tokenType === 'yape' || token.startsWith('ype_') ? 'Yape' : 'Tarjeta';

    onPaymentProcessingChange(true);
    if (window.Culqi?.close) window.Culqi.close();

    try {
      const paymentResult = await chargePayment({
        token,
        amount: Math.round(finalTotal * 100),
        currency: 'PEN',
        email,
        phone: shippingInfo.phone,
        customerName,
        businessId,
        productId: primaryProduct.id,
        ...buildCustomerAuthPayload(customerAuth),
        metadata: buildMetadataPayload({
          shippingInfo,
          cartItems,
          businessAddress,
          businessCity,
        }),
      });

      // SEGURIDAD EXTRA: Verificar que el cargo en Culqi también fue exitoso
      const chargeStatus = paymentResult?.charge?.status;
      if (chargeStatus !== 'paid') {
        throw new Error('El pago no fue completado. Estado: ' + chargeStatus);
      }

      if (!paymentResult?.charge?.id) {
        throw new Error('No se recibió confirmación del pago');
      }

      // Server is authoritative for orderNumber (W-P4). Read from response.
      const serverOrderNumber = paymentResult?.payment?.orderNumber;
      if (!serverOrderNumber) {
        throw new Error('Server did not return orderNumber');
      }

      onOrderPaid({
        orderNumber: serverOrderNumber,
        paymentMethod,
        trackingToken: paymentResult?.payment?.trackingToken as string | undefined,
      });

      trackPaymentAnalytics({
        orderId: serverOrderNumber,
        paymentId: paymentResult?.charge?.id ?? token,
        amount: finalTotal,
        businessSlug: slug,
        method: paymentMethod,
      });

      if (window.Culqi && window.Culqi.close) window.Culqi.close();
    } catch (error) {
      console.error('API call failed:', error);
      const message =
        error instanceof Error ? error.message : 'Hubo un problema al procesar tu pago.';
      onError(message);
      paymentGuardRef.current = false;
      culqiCallbackGuardRef.current = false;
      onPaymentProcessingChange(false);
      return;
    }
  }

  // ── Error handler: when Culqi returns neither order nor token ───────

  function handleCulqiError(): void {
    const culqiError = window.Culqi?.error;
    console.error(
      '[Culqi] Error:',
      culqiError ? JSON.stringify(culqiError) : '(no error object on window.Culqi)',
    );

    if (culqiError?.code === 'invalid_number' && culqiError?.param === 'amount') {
      const exceedAmount = finalTotal > YAPE_LIMITS.max;
      if (exceedAmount) {
        onError(
          `Yape solo permite pagos hasta S/ ${YAPE_LIMITS.max.toFixed(2)}. ` +
            `Para esta compra de S/ ${finalTotal.toFixed(2)}, usá tarjeta de débito o crédito.`,
        );
      } else {
        onError(culqiError?.user_message || 'El monto del pago no es válido para este método.');
      }
    } else {
      const errorMsg =
        culqiError?.user_message ||
        culqiError?.merchant_message ||
        'Hubo un problema con el pago. Intenta nuevamente.';
      onError(errorMsg);
    }

    culqiCallbackGuardRef.current = false;
  }

  // ── Effect: bind window.culqi callback ──────────────────────────────

  useEffect(() => {
    if (!culqiReady) return;

    window.culqi = async function () {
      if (culqiCallbackGuardRef.current) return;

      if (window.Culqi?.order) {
        culqiCallbackGuardRef.current = true;
        await handleCulqiOrder(window.Culqi.order);
        return;
      }

      if (window.Culqi?.token) {
        culqiCallbackGuardRef.current = true;
        const tokenType = window.Culqi.token.type || 'card';
        await handleCulqiToken(window.Culqi.token.id, tokenType);
        paymentGuardRef.current = false;
        onCulqiProcessingChange(false);
        onPaymentProcessingChange(false);
        return;
      }

      handleCulqiError();
      paymentGuardRef.current = false;
      onCulqiProcessingChange(false);
      onPaymentProcessingChange(false);
    };

    return () => {
      window.culqi = undefined as unknown as () => void;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    culqiReady,
    finalTotal,
    businessId,
    cartItems,
    email,
    customerName,
    shippingInfo,
    businessAddress,
    businessCity,
    // NOTE: Refs, callbacks, slug, and customerAuth are intentionally omitted:
    // refs and callbacks are stable across renders; slug/customerAuth don't change
    // during a single checkout flow.
  ]);
}

// ─── Tracking helper ─────────────────────────────────────────────────────────

interface TrackPaymentAnalyticsParams {
  orderId: string;
  paymentId: string;
  amount: number;
  businessSlug: string;
  method: string;
}

function trackPaymentAnalytics({
  orderId,
  paymentId,
  amount,
  businessSlug,
  method,
}: TrackPaymentAnalyticsParams): void {
  try {
    if (typeof posthog?.capture === 'function') {
      posthog.capture('order_created', { orderId, amount, businessSlug });
      posthog.capture('payment_completed', { paymentId, amount, method });
    }
  } catch {
    // Analytics should never block user flow
  }
}
