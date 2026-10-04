/**
 * paymentApi.ts
 *
 * Shared typed API helpers for Culqi payment operations.
 * Replaces raw fetch() calls in usePaymentGateway.ts and elsewhere.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface ChargePaymentParams {
  token?: string;
  culqiOrderId?: string;
  amount: number;
  currency?: string;
  email?: string;
  phone?: string | null;
  customerName?: string;
  businessId: string;
  productId: string;
  customerAuth?: {
    provider: string;
    authId: string;
    name?: string;
    email?: string;
    avatarUrl?: string | null;
  } | null;
  metadata?: Record<string, unknown>;
}

export interface ChargePaymentResponse {
  success: boolean;
  payment?: {
    id: string;
    trackingToken: string;
    orderNumber: string;
    amount: string;
    currency: string;
    status: string;
    [key: string]: unknown;
  };
  charge?: { id: string; status: string; [key: string]: unknown };
  error?: string;
  details?: string;
  [key: string]: unknown;
}

export interface CreateOrderParams {
  amount: number;
  currency?: string;
  email: string;
  phone?: string | null;
  customerName?: string;
  businessId: string;
  productId?: string;
  description?: string;
}

export interface CreateOrderResponse {
  success: boolean;
  culqiOrderId: string;
  paymentCode?: string | null;
  qrUrl?: string | null;
  expirationDate?: string;
  error?: string;
  details?: string;
  [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Sends a POST request to `/api/payment/charge`.
 * Handles both order-based (culqiOrderId) and token-based charges.
 */
export async function chargePayment(params: ChargePaymentParams): Promise<ChargePaymentResponse> {
  const idempotencyKey = `charge-${params.token || params.culqiOrderId || crypto.randomUUID()}`;

  const response = await fetch('/api/payment/charge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      ...(params.token ? { token: params.token } : {}),
      ...(params.culqiOrderId ? { culqiOrderId: params.culqiOrderId } : {}),
      amount: params.amount,
      currency: params.currency || 'PEN',
      email: params.email,
      phone: params.phone ?? undefined,
      ...(params.customerName ? { customerName: params.customerName } : {}),
      businessId: params.businessId,
      productId: params.productId,
      ...(params.customerAuth
        ? {
            customerAuth: {
              provider: params.customerAuth.provider,
              authId: params.customerAuth.authId,
              name: params.customerAuth.name,
              email: params.customerAuth.email,
              avatarUrl: params.customerAuth.avatarUrl,
            },
          }
        : {}),
      metadata: params.metadata || {},
    }),
  });

  const data: ChargePaymentResponse = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.details || data.error || 'Error al procesar el pago');
  }

  return data;
}

/**
 * Sends a POST request to `/api/payment/create-order`.
 * Creates an async payment order (PagoEfectivo, Billetera Móvil, Cuotéalo).
 */
export async function createOrder(params: CreateOrderParams): Promise<CreateOrderResponse> {
  const idempotencyKey = `order-${crypto.randomUUID()}`;

  const response = await fetch('/api/payment/create-order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      amount: params.amount,
      currency: params.currency || 'PEN',
      email: params.email,
      phone: params.phone ?? undefined,
      ...(params.customerName ? { customerName: params.customerName } : {}),
      businessId: params.businessId,
      ...(params.productId ? { productId: params.productId } : {}),
      ...(params.description ? { description: params.description } : {}),
    }),
  });

  const data: CreateOrderResponse = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.details || data.error || 'Error al crear la orden');
  }

  return data;
}
