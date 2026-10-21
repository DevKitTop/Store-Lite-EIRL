'use client';

import type {
  CustomerAuth,
  PaymentInstructionsData,
} from '@/features/payment/hooks/useCulqiCallback';
import { useCulqiCallback, YAPE_LIMITS } from '@/features/payment/hooks/useCulqiCallback';
import type { CartItem } from '@/features/storage/context/CartContext';
import { validateBuyerName } from '@/shared/payments/buyerName';
import { loadCulqiScript } from '@/shared/payments/culqiScript';
import { createOrder } from '@/shared/payments/paymentApi';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShippingInfo } from '../Checkout';

// ─── Re-export shared constants ─────────────────────
export { YAPE_LIMITS };

// ─── Types ───────────────────────────────────────────

export interface UsePaymentGatewayOptions {
  culqiPublicKey?: string;
  businessId: string;
  businessName: string;
  cartItems: [CartItem, ...CartItem[]];
  shippingInfo: ShippingInfo;
  email: string;
  customerName: string;
  customerAuth: CustomerAuth | null;
  finalTotal: number;
  slug: string;
  businessAddress?: string;
  businessCity?: string;
  onOrderPaid: (order: {
    orderNumber: string;
    paymentMethod: string;
    trackingToken?: string;
  }) => void;
  onPaymentInstructions: (instructions: PaymentInstructionsData) => void;
  onError: (message: string) => void;
}

export interface UsePaymentGatewayReturn {
  culqiReady: boolean;
  isCulqiProcessing: boolean;
  isPaymentProcessing: boolean;
  handlePayment: () => Promise<void>;
}

// ─── Hook ────────────────────────────────────────────

export function useCheckoutPayment({
  culqiPublicKey,
  businessId,
  businessName,
  cartItems,
  shippingInfo,
  email,
  customerName,
  customerAuth,
  finalTotal,
  slug,
  businessAddress,
  businessCity,
  onOrderPaid,
  onPaymentInstructions,
  onError,
}: UsePaymentGatewayOptions): UsePaymentGatewayReturn {
  const [culqiReady, setCulqiReady] = useState(false);
  const [isCulqiProcessing, setIsCulqiProcessing] = useState(false);
  const [isPaymentProcessing, setIsPaymentProcessing] = useState(false);
  const paymentGuardRef = useRef(false);
  const culqiCallbackGuardRef = useRef(false);

  // Load Culqi Script (v4) — using shared promise-cached loader
  useEffect(() => {
    if (!culqiPublicKey || typeof window === 'undefined') return;

    // Synchronous path: when Culqi is already loaded (tests, other callers)
    if (window.Culqi) {
      window.Culqi.publicKey = culqiPublicKey;
      setCulqiReady(true);
      return;
    }

    loadCulqiScript(culqiPublicKey).then(() => setCulqiReady(true));
  }, [culqiPublicKey]);

  // Register callback via extracted hook
  useCulqiCallback({
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
    onCulqiProcessingChange: setIsCulqiProcessing,
    onPaymentProcessingChange: setIsPaymentProcessing,
    paymentGuardRef,
    culqiCallbackGuardRef,
    onOrderPaid,
    onPaymentInstructions,
    onError,
  });

  const handlePayment = useCallback(async () => {
    // ── GUARD: evita doble click incluso antes de React render ──
    if (paymentGuardRef.current) return;

    if (shippingInfo.dni.length !== 8) {
      onError('Por favor, ingresá un DNI válido de 8 dígitos para tu comprobante.');
      return;
    }

    if (!email || !email.includes('@')) {
      onError('Por favor, ingresa un correo electrónico válido.');
      return;
    }

    // Nombre completo: empty keeps legacy handling; non-empty must be a two-word Spanish-letters name
    const trimmedName = customerName.trim();
    if (!trimmedName) {
      onError('Por favor, ingresá tu nombre completo (mínimo 3 letras).');
      return;
    }
    const nameError = validateBuyerName(trimmedName);
    if (nameError) {
      onError(nameError);
      return;
    }

    if (!window.Culqi || !culqiReady) {
      onError('Cargando pasarela de pagos...');
      return;
    }

    paymentGuardRef.current = true;
    culqiCallbackGuardRef.current = false;
    setIsCulqiProcessing(true);

    try {
      const Culqi = window.Culqi;
      if (!Culqi) {
        throw new Error('Culqi no está disponible');
      }

      // If amount exceeds Yape limit, create order for async payment methods first
      let orderId: string | null = null;
      if (finalTotal > YAPE_LIMITS.max) {
        try {
          const orderData = await createOrder({
            amount: Math.round(finalTotal * 100),
            email: email || 'cliente@store-lite.com',
            customerName: customerName.trim(),
            phone: shippingInfo.phone || null,
            businessId,
            productId: cartItems[0]?.id,
            description: `Compra - ${cartItems.length} productos`,
            // Durable fulfilment snapshot (R1/A1): the whole cart, in the exact
            // `{ id, quantity }` shape the server reconciles and persists in
            // `payment_orders.metadata.cartItems`. Without it the order flow can
            // only ever recover the FIRST line, so a multi-item order fulfils
            // a single line.
            cartItems: cartItems.map((item) => ({ id: item.id, quantity: item.quantity })),
          });
          orderId = orderData.culqiOrderId;
        } catch (e) {
          console.warn('[Checkout] Order creation failed, falling back to charge-only flow:', e);
        }
      }

      // amount y order son MUTUAMENTE EXCLUYENTES en Culqi Checkout v4
      // Si pasamos order (órdenes de pago async), NO podemos pasar amount
      const settings: Record<string, unknown> = {
        title: businessName,
        currency: 'PEN',
        description: `Compra en linea - ${cartItems.length} productos`,
      };
      if (orderId) {
        settings.order = orderId;
      } else {
        settings.amount = Math.round(finalTotal * 100);
      }
      Culqi.settings(settings);

      Culqi.options({
        lang: 'auto',
        installments: true,
        modal: true,
        paymentMethods: {
          tarjeta: true,
          yape: true,
          billetera: true,
          bancaMovil: true,
          agente: true,
        },
      });

      Culqi.open();
    } catch (error) {
      console.error('Culqi open error:', error);
      onError('No se pudo abrir la pasarela de pagos.');
      paymentGuardRef.current = false;
      setIsCulqiProcessing(false);
    }
  }, [
    culqiReady,
    finalTotal,
    businessId,
    businessName,
    cartItems,
    email,
    customerName,
    shippingInfo,
    onError,
  ]);

  return {
    culqiReady,
    isCulqiProcessing,
    isPaymentProcessing,
    handlePayment,
  };
}
