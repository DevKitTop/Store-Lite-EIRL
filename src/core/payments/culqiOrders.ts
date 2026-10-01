// =====================================================
// src/core/payments/culqiOrders.ts
// =====================================================
// Culqi order read utilities (server-side).
// Reads a Culqi Order via REST and evaluates its paid state.
// The module is transport-agnostic (no dependency on next/server)
// for reuse outside route handlers.
// =====================================================

const CULQI_TIMEOUT_MS = 15000;

export type CulqiReadErrorKind = 'timeout' | 'transport';

export class CulqiReadError extends Error {
  readonly kind: CulqiReadErrorKind;

  constructor(kind: CulqiReadErrorKind) {
    super(kind === 'timeout' ? 'Culqi order read timeout' : 'Culqi order read transport error');
    this.name = 'CulqiReadError';
    this.kind = kind;
  }
}

export interface CulqiOrderState {
  id?: string;
  status?: unknown;
  state?: unknown;
  [k: string]: unknown;
}

export async function getCulqiOrder(orderId: string, secretKey: string): Promise<CulqiOrderState> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, CULQI_TIMEOUT_MS);

  try {
    const response = await fetch(`https://api.culqi.com/v2/orders/${orderId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    // A body the gateway labels as JSON MUST parse: a failure there is a transport
    // fault, not an empty order. A non-JSON body (HTML error page, empty proxy
    // response) is tolerated down to `{}` so the caller fails closed on "not paid".
    const contentType = response.headers?.get?.('content-type') ?? '';
    const declaresJson = contentType.includes('json');

    let data: unknown = {};
    try {
      data = await response.json();
    } catch {
      if (declaresJson) {
        clearTimeout(timeout);
        throw new CulqiReadError('transport');
      }
      data = {};
    }

    clearTimeout(timeout);

    if (data && typeof data === 'object') {
      return data as CulqiOrderState;
    }

    return {};
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (isAbort) {
      throw new CulqiReadError('timeout');
    }
    throw new CulqiReadError('transport');
  }
}

// Culqi reports the paid marker as `status`; the community field `state` carries
// the same signal. Either marker can be present on its own, but every marker that
// IS present must be exactly 'paid' — non-strings count as not-paid (R11).
export function isCulqiOrderPaid(order: CulqiOrderState): boolean {
  const markers = [order.status, order.state].filter((marker) => marker !== undefined);

  // No marker at all means the gateway never confirmed the payment.
  if (markers.length === 0) return false;

  return markers.every((marker) => typeof marker === 'string' && marker === 'paid');
}
