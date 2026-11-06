'use client';

import { captureTicketPng } from '@/shared/payments/ticketCapture';
import { useCallback, useRef, useState } from 'react';

/**
 * usePurchasePlan
 * Hook que orquesta el flujo completo de compra de un plan SaaS:
 *  1. POST /api/billing/purchase-plan → cobra, guarda en BD, activa suscripción
 *  2. Captura PlanTicketTemplate como PNG (html-to-image)
 *  3. POST /api/billing/update-plan-ticket → el API sube a `tickets_plans`
 *     (bucket privado, service role) y devuelve un link firmado
 */

export interface PurchasePlanData {
  token: string;
  planType: 'lite' | 'lite_pago' | 'lite_plus';
  period: 'monthly' | 'annual';
  businessId: string;
  buyerEmail: string;
  buyerFullName: string;
  buyerDocumentType: 'DNI' | 'RUC';
  buyerDocumentNumber: string;
  buyerAddress?: string;
}

export interface PurchasePlanIssuer {
  ruc: string;
  name: string;
  address: string;
  district: string;
  province: string;
  department: string;
}

export interface PurchasePlanResult {
  planPaymentId: string;
  ticketNumber: string;
  planActivatedUntil: string;
  amountTotal: number;
  /** Present only when server-side Meta CAPI fired (consent accepted). */
  eventId?: string;
  ticketUrl?: string;
  issuer?: PurchasePlanIssuer;
}

export function usePurchasePlan() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PurchasePlanResult | null>(null);

  const [capturingData, setCapturingData] = useState<
    (PurchasePlanResult & { buyerData: PurchasePlanData }) | null
  >(null);

  /**
   * Ref al nodo DOM del PlanTicketTemplate para capturar con html-to-image.
   */
  const ticketRef = useRef<HTMLDivElement>(null);

  const purchase = useCallback(
    async (data: PurchasePlanData): Promise<PurchasePlanResult | null> => {
      setLoading(true);
      setError(null);
      setCapturingData(null);

      try {
        // ── 1. Comprar el plan en el backend ───────────────────────────────────
        const purchaseResponse = await fetch('/api/billing/purchase-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        const purchaseJson = await purchaseResponse.json();

        if (!purchaseResponse.ok || !purchaseJson.success) {
          const errorMsg =
            purchaseJson.details || purchaseJson.error || 'Error al procesar el pago';
          setError(errorMsg);
          return null;
        }

        const purchaseResult = purchaseJson as PurchasePlanResult;

        // ── 2. Preparar datos para el render del ticket ────────────────────────
        // Seteamos estos datos para que el PlanTicketTemplate se renderice en el DOM
        setCapturingData({ ...purchaseResult, buyerData: data });

        // Esperar dos frames para asegurar que React renderizó y fuentes cargadas
        await new Promise((resolve) => setTimeout(resolve, 600));

        let ticketUrl: string | undefined;

        // ── 3. Generar el PNG y enviarlo al API ─────────────────────────────────
        // El navegador nunca escribe en Storage: el API sube a `tickets_plans`
        // con service role y devuelve un link firmado de corta duración.
        if (ticketRef.current) {
          try {
            const png = await captureTicketPng(ticketRef);
            const form = new FormData();
            form.append('planPaymentId', purchaseResult.planPaymentId);
            form.append('file', png, 'ticket.png');

            const ticketResponse = await fetch('/api/billing/update-plan-ticket', {
              method: 'POST',
              body: form,
            });
            const ticketJson = await ticketResponse.json();

            if (ticketResponse.ok && ticketJson.success) {
              ticketUrl = ticketJson.signedUrl;
            } else {
              console.error('[usePurchasePlan] Error guardando ticket:', ticketJson.error);
            }
          } catch (ticketError) {
            console.error('[usePurchasePlan] Error generando ticket PNG:', ticketError);
          }
        }

        const finalResult: PurchasePlanResult = {
          ...purchaseResult,
          ticketUrl,
        };

        setResult(finalResult);
        setCapturingData(null);
        return finalResult;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Error inesperado al comprar el plan';
        setError(errorMsg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setError(null);
    setResult(null);
    setLoading(false);
    setCapturingData(null);
  }, []);

  return {
    purchase,
    loading,
    error,
    result,
    capturingData,
    ticketRef,
    reset,
  };
}
