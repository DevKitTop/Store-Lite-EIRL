/**
 * =====================================================
 * API: POST /api/payment/charge
 * Backend: Crear cargo (charge) en Culqi y guardar payment
 * =====================================================
 */

import { db } from '@/core/database/client';
import { businesses, paymentOrders, payments, products } from '@/core/database/schema';
import { getBusinessEntitlements } from '@/core/entitlements/getBusinessEntitlements';
import { buildBuyerRateLimitKey } from '@/core/payments/buyerRateLimitKey';
import { CulqiReadError, getCulqiOrder, isCulqiOrderPaid } from '@/core/payments/culqiOrders';
import { resolveCulqiSecretKey } from '@/core/payments/culqiSecretKey';
import {
  completeIdempotencyKey,
  releaseIdempotencyKey,
  reserveIdempotencyKey,
} from '@/core/payments/idempotency';
import { resolveOrderNumber } from '@/core/payments/orderNumber';
import { paymentRateLimiter } from '@/core/payments/rateLimiter';
import {
  asMetadataObject,
  findSalePaymentRow,
  type SaleIdentity,
} from '@/core/payments/saleIdentity';
import {
  emitFulfillmentAlerts,
  fulfillPaidSale,
  readFulfillmentCartItems,
  type FulfillmentResult,
  type FulfillmentSnapshot,
} from '@/core/payments/stockFulfillment';
import { generateTrackingToken } from '@/core/utils/trackingToken';
import { validateAmount } from '@/features/billing/validateAmount';
import { captureEvent } from '@/lib/analytics/capture';
import { AnalyticsEvents } from '@/lib/analytics/taxonomy';
import { sendOrderConfirmationEmail } from '@/lib/email/orderEmails';
import { notifyLowStock, notifyNewOrder, notifyOutOfStock } from '@/lib/notifications';
import { setSentryContext } from '@/lib/sentryContext';
import { createClient } from '@/lib/supabase/server';
import * as Sentry from '@sentry/nextjs';
import { sendOrderStatusSms } from '@/lib/twilio/orderSms';
import { splitFullName } from '@/shared/payments/fullName';
import type { CulqiChargeResponse } from '@/types/culqi';
import { and, eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const LOW_STOCK_THRESHOLD = 5;

// Buyer-facing copy for a Culqi order that is not acknowledged as paid yet.
// `chargePayment` throws `data.details || data.error`, so this text lives in
// `error` and the response MUST NOT carry a `details` key.
const ORDER_NOT_PAID_MESSAGE =
  'Tu pago todavía se está confirmando con la pasarela. Esperá unos segundos e intentá de nuevo.';

// Buyer-facing copy for a charge whose amount/currency/product does not match the
// Culqi order that was actually verified. Same R12 discipline: the text lives in
// `error` (because `chargePayment` throws `data.details || data.error`) and the
// response MUST NOT carry a `details` key.
const ORDER_AMOUNT_MISMATCH_MESSAGE =
  'El monto de la orden no coincide con el pago solicitado. Contactá al negocio para resolverlo.';
const ORDER_CURRENCY_MISMATCH_MESSAGE =
  'La moneda de la orden no coincide con el pago solicitado. Contactá al negocio para resolverlo.';
const ORDER_PRODUCT_MISMATCH_MESSAGE =
  'La orden no corresponde a este producto. Contactá al negocio para resolverlo.';

// Single source of truth for the buyer's 500 message: the response body and the
// idempotency failure record must agree, or a replayed key would return a
// different text than the original attempt.
const INTERNAL_ERROR_MESSAGE = 'Error interno procesando el pago';

/**
 * `payment_orders.amount` is `decimal(10,2)` written in SOLES by create-order
 * (`String(amount / 100)`), while the request amount is minor units. Returns the
 * order amount in minor units, or `null` when the stored value is not a finite
 * number — `null` is a DENY, never a pass: `NaN !== x` is true but a future
 * `Number.isFinite`-free refactor must not be able to let it slip through.
 */
function orderAmountToMinorUnits(stored: unknown): number | null {
  const soles = typeof stored === 'string' || typeof stored === 'number' ? Number(stored) : NaN;
  if (!Number.isFinite(soles)) return null;
  return Math.round(soles * 100);
}

/**
 * `payment_orders` has NO productId column: the binding lives in
 * `metadata.productId` (create-order writes it only when a product was given, so
 * a product-less order legitimately has none).
 *
 * - `'absent'`  → nothing to bind against, the caller must ALLOW.
 * - `{ id }`    → the order is bound to that product.
 * - `'invalid'` → a binding is present but unusable (not a string). Fail closed:
 *                 an attacker cannot skip the check with a non-string value.
 */
type OrderProductBinding = 'absent' | 'invalid' | { id: string };

function readOrderProductBinding(metadata: unknown): OrderProductBinding {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return 'absent';
  const bound = (metadata as { productId?: unknown }).productId;
  if (bound === undefined || bound === null) return 'absent';
  if (typeof bound !== 'string' || bound === '') return 'invalid';
  return { id: bound };
}

/** Map a Culqi read failure: an abort is 504, anything else is a 502 transport fault. */
function culqiReadErrorResponse(err: unknown): NextResponse {
  if (err instanceof CulqiReadError && err.kind === 'timeout') {
    return NextResponse.json({ error: 'Timeout al leer la orden de Culqi' }, { status: 504 });
  }
  return NextResponse.json({ error: 'Error de conexión con la pasarela' }, { status: 502 });
}

/** Only the fields `useCulqiCallback` reads — never the raw row with buyer PII. */
function projectReplayPayment(payment: typeof payments.$inferSelect) {
  return {
    id: payment.id,
    trackingToken: payment.trackingToken,
    orderNumber: payment.orderNumber,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
  };
}

// ─── Internal types ─────────────────────────────────────────────────
interface ShippingInfoData {
  phone?: string | null;
  dni?: string | null;
  department?: string | null;
  province?: string | null;
  district?: string | null;
  address?: string | null;
  agency?: string | null;
  reference?: string | null;
  courier?: string;
  ubigeo?: string;
}

// ─── Helper: Execute Culqi charge API call ──────────────────────────
interface ExecuteCulqiChargeParams {
  token: string;
  secretKey: string;
  amount: number;
  currency: string;
  email?: string;
  customerName?: string;
  phone?: string | null;
  productTitle?: string;
  businessId: string;
  productId: string;
  qty?: number;
}

async function executeCulqiCharge({
  token,
  secretKey,
  amount,
  currency,
  email,
  customerName,
  phone,
  productTitle,
  businessId,
  productId,
  qty,
}: ExecuteCulqiChargeParams): Promise<{
  culqiData: CulqiChargeResponse;
  error: NextResponse | null;
}> {
  // Culqi charges identify the buyer via antifraud_details — this is what
  // populates the "Cliente" section in the CulqiPanel (first/last name).
  const antifraud_details = {
    ...(email ? { email } : {}),
    ...(phone ? { phone_number: phone } : {}),
    ...splitFullName(customerName),
  };

  const response = await fetch('https://api.culqi.com/v2/charges', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secretKey}`,
    },
    body: JSON.stringify({
      amount,
      currency_code: currency,
      email: email || 'cliente@culqi.com',
      source_id: token,
      description: `Compra: ${productTitle || 'Producto'} - Store Lite`,
      antifraud_details,
      metadata: { businessId, productId, platform: 'store-lite', qty },
    }),
  });

  const culqiData: CulqiChargeResponse = await response.json();
  const isSuccess = culqiData?.outcome?.type === 'venta_exitosa' || culqiData?.paid === true;

  if (!response.ok || !isSuccess) {
    return {
      culqiData,
      error: NextResponse.json(
        {
          error: 'Error en Culqi',
          details: culqiData?.user_message || culqiData?.outcome?.user_message || 'Pago rechazado',
        },
        { status: 400 },
      ),
    };
  }

  return { culqiData, error: null };
}

/**
 * Chooses the snapshot a sale is fulfilled from, following the SALE's channel
 * (design D6/W-A/W-B). Returns `null` when an order-backed sale has no
 * persisted cart: the caller MUST fail closed instead of trusting the request.
 */
function selectFulfillmentSnapshot(args: {
  isOrderFlow: boolean;
  persistedOrderMetadata: unknown;
  paymentMetadata: unknown;
  productId: string;
}): FulfillmentSnapshot | null {
  if (args.isOrderFlow) {
    const cartItems = readFulfillmentCartItems(args.persistedOrderMetadata);
    return cartItems ? { cartItems } : null;
  }

  return {
    cartItems: readFulfillmentCartItems(args.paymentMetadata),
    qty: null,
    productId: args.productId,
  };
}

// eslint-disable-next-line complexity, sonarjs/cognitive-complexity
export async function POST(request: Request) {
  // Declared OUTSIDE the try so the catch block can see them: a key that is
  // reserved and then abandoned at `processing` locks the buyer out forever.
  let reservedIdempotencyKey: string | null = null;
  // Set the moment the success path reaches its own completion, so the catch
  // block can never re-complete (and downgrade) a key for a committed payment.
  let successPathCompletedKey = false;

  try {
    const idempotencyKey = request.headers.get('Idempotency-Key');

    const rawBody = await request.json();

    // 0. Validate Data using Zod
    const { chargeRequestSchema } = await import('@/features/billing/schemas');
    const validationResult = chargeRequestSchema.safeParse(rawBody);

    if (!validationResult.success) {
      return NextResponse.json(
        { error: validationResult.error.issues[0]?.message || 'Datos no válidos' },
        { status: 400 },
      );
    }

    const {
      token,
      culqiOrderId,
      amount,
      email,
      businessId,
      productId,
      currency = 'PEN',
      customerAuth,
      customerName,
      metadata = {},
    } = validationResult.data;

    const rawShipping = (metadata?.shippingInfo || {}) as ShippingInfoData;

    // ─── PRICE REVALIDATION (fix-price-tampering) ────────────────
    // Reject client-supplied amount that doesn't match the authoritative
    // product price from the DB, before any flow branching or Culqi call.
    let priceCheck: {
      ok: boolean;
      serverAmount?: number;
      error?: string;
    } | null = null;
    if (!culqiOrderId) {
      priceCheck = await validateAmount({
        productId,
        businessId,
        clientAmount: amount,
        cartItems: metadata?.cartItems,
      });
      if (!priceCheck.ok) {
        return NextResponse.json({ error: priceCheck.error }, { status: 400 });
      }
    }

    // ─── Rate Limit Check ──────────────────────────────────────────
    if (!paymentRateLimiter.check(`${businessId}:${productId}`)) {
      return NextResponse.json(
        { error: 'Demasiados intentos. Esperá unos segundos antes de reintentar.' },
        { status: 429 },
      );
    }

    // ─── Buyer-scoped Rate Limit Check (W-P2) ──────────────────────
    // A second, independent bucket scoped to the buyer so a single buyer can't
    // fan out across many product/business combinations. Skipped when the
    // request carries no buyer identity (nothing to scope by).
    const buyerRateLimitKey = buildBuyerRateLimitKey({
      businessId,
      productId,
      email: email || customerAuth?.email,
      dni: rawShipping.dni,
      authId: customerAuth?.authId,
    });
    if (buyerRateLimitKey && !paymentRateLimiter.check(buyerRateLimitKey)) {
      return NextResponse.json(
        { error: 'Demasiados intentos. Esperá unos segundos antes de reintentar.' },
        { status: 429 },
      );
    }

    // ─── COMMON: Business lookup + Security checks ────────
    // 🔥 Must happen BEFORE any Culqi API call to prevent charging a blocked business
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, businessId),
      columns: { ownerId: true, culqiBlocked: true },
    });

    if (!business?.ownerId) {
      return NextResponse.json(
        { error: 'No se pudo obtener el propietario del negocio' },
        { status: 400 },
      );
    }

    // 🚫 CULQI BLOCK: Si el negocio tiene la pasarela bloqueada por multas impagas, rechazar
    if (business.culqiBlocked) {
      return NextResponse.json(
        {
          error:
            'Tu pasarela de pagos está bloqueada. Pagá tus multas pendientes en Dashboard > Mis Multas.',
        },
        { status: 403 },
      );
    }

    // 🚫 PLAN CHECK: Verificar que el negocio tiene un plan con pasarela de pagos
    const entitlements = await getBusinessEntitlements(businessId);
    if (!entitlements.hasPaymentGateway) {
      return NextResponse.json(
        {
          error:
            'Tu plan actual no incluye pasarela de pagos. Actualizá tu plan para recibir pagos.',
        },
        { status: 403 },
      );
    }

    // 🛡️ SECURITY: El dueño del negocio NO puede comprar su propio producto
    const supabase = await createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (authUser?.id && authUser.id === business.ownerId) {
      return NextResponse.json({ error: 'No puedes comprar tu propio producto' }, { status: 403 });
    }

    // ─── FLOW BRANCHING ─────────────────────────────────────────────
    let culqiData: CulqiChargeResponse | null = null;
    const isOrderFlow = !!culqiOrderId;
    const isTokenFlow = !!token;

    // The PERSISTED `payment_orders.metadata` read by the order-flow gate. It
    // is the ONLY sanctioned fulfilment snapshot for an order-backed sale
    // (W-B): the request cart is buyer-controlled and must never size the
    // decrement. Declared here so the transaction below can use the value the
    // gate already read from the database (no second read, no extra tx query).
    let persistedOrderMetadata: unknown = null;
    // Authoritative amount in cents (server-side). Never trust client amount.
    let authoritativeAmount: number = amount;

    // ─── ORDER FLOW — LOCAL PRE-CHECKS ──────────────────────────────
    // Everything here reads only our own DB and touches no external system, so
    // it must run BEFORE the reservation: a rejected request (unknown order,
    // underpayment, wrong product) must not burn an idempotency key.
    if (isOrderFlow) {
      // ORDER-BASED: Culqi Checkout ya cobró contra la orden
      // Solo creamos el payment en DB y marcamos la orden como pagada
      const orderRow = await db.query.paymentOrders.findFirst({
        where: and(
          eq(paymentOrders.culqiOrderId, culqiOrderId as string),
          eq(paymentOrders.businessId, businessId),
        ),
        // Projected on purpose: the gate needs the money fields and the product
        // binding, never buyerEmail/buyerPhone. Reading the full row would pull
        // buyer PII into memory for a check that never serialises it.
        columns: {
          amount: true,
          currency: true,
          metadata: true,
        },
      });

      if (!orderRow) {
        return NextResponse.json(
          { success: false, error: 'Orden de pago no encontrada' },
          { status: 404 },
        );
      }

      // The persisted snapshot the fulfilment step must use (W-B). Captured
      // from the row read above — never from the request.
      persistedOrderMetadata = orderRow.metadata;

      // ─── BINDING: the verified payment must be what gets recorded ───
      // A paid Culqi order only authorises ITS OWN amount and product. Without
      // this binding, a buyer can pay a S/ 1 order and have the transaction
      // record + decrement stock for a S/ 1000 product of the same business
      // (underpayment + fabricated financial record). Both checks run before the
      // Culqi read (no upstream round-trip is wasted) and before
      // reserveIdempotencyKey (no key is burned).
      const orderAmountMinor = orderAmountToMinorUnits(orderRow.amount);
      if (orderAmountMinor === null || orderAmountMinor !== amount) {
        try {
          Sentry.captureMessage('payment_integrity_amount_mismatch', {
            level: 'warning',
            tags: { flow: 'order', businessId, productId },
            extra: { culqiOrderId, expectedAmount: orderAmountMinor, providedAmount: amount },
          });
        } catch (e) {
          void e;
        }
        return NextResponse.json(
          {
            success: false,
            error: ORDER_AMOUNT_MISMATCH_MESSAGE,
            code: 'ORDER_AMOUNT_MISMATCH',
          },
          { status: 402 },
        );
      }
      // Authoritative amount comes from the persisted order (server-side)
      authoritativeAmount = orderAmountMinor;

      if (currency !== orderRow.currency) {
        return NextResponse.json(
          {
            success: false,
            error: ORDER_CURRENCY_MISMATCH_MESSAGE,
            code: 'ORDER_CURRENCY_MISMATCH',
          },
          { status: 402 },
        );
      }

      const productBinding = readOrderProductBinding(orderRow.metadata);
      const productIsBound =
        productBinding === 'invalid' ||
        (productBinding !== 'absent' && productBinding.id !== productId);
      if (productIsBound) {
        return NextResponse.json(
          {
            success: false,
            error: ORDER_PRODUCT_MISMATCH_MESSAGE,
            code: 'ORDER_PRODUCT_MISMATCH',
          },
          { status: 402 },
        );
      }
    }

    // ─── RESERVE THE IDEMPOTENCY KEY BEFORE ANY EXTERNAL CALL (W-P1) ──
    // The key exists to stop two in-flight requests from both charging the
    // buyer. Reserving AFTER the Culqi call (the previous order of operations)
    // let two concurrent requests with the same key execute the external call
    // twice and only then race on the key. Reserving first makes the call
    // single-flight. Any attempt that fails before money moves releases the
    // reservation (see `releaseIdempotencyKey`) so a genuine retry still works.
    const idempotencyReservation = await reserveIdempotencyKey(idempotencyKey);
    if (
      idempotencyReservation?.type === 'replay' ||
      idempotencyReservation?.type === 'processing'
    ) {
      return idempotencyReservation.response;
    }
    reservedIdempotencyKey = idempotencyReservation?.key ?? null;

    // ─── EXTERNAL CALLS ─────────────────────────────────────────────
    if (isOrderFlow) {
      const { secretKey, error: keyError } = await resolveCulqiSecretKey(businessId);
      if (keyError) {
        await releaseIdempotencyKey(reservedIdempotencyKey);
        return keyError;
      }

      let culqiOrderPaid = false;
      try {
        // PI-02: MUST verify against Culqi API server-side before marking paid.
        // Never trust the client saying "already paid".
        const culqiOrder = await getCulqiOrder(culqiOrderId as string, secretKey);
        culqiOrderPaid = isCulqiOrderPaid(culqiOrder);
        // Extra defensive checks: if Culqi returns amount/currency, they must match
        if (culqiOrderPaid && culqiOrder && typeof culqiOrder === 'object') {
          const co = culqiOrder as Record<string, unknown>;
          if (typeof co.amount === 'number' && co.amount !== authoritativeAmount) {
            try {
              Sentry.captureMessage('payment_integrity_culqi_order_amount_mismatch', {
                level: 'warning',
                tags: { flow: 'order', businessId, productId },
                extra: { culqiOrderId, expectedAmount: authoritativeAmount, culqiAmount: co.amount },
              });
            } catch (e) {
              void e;
            }
            await releaseIdempotencyKey(reservedIdempotencyKey);
            return NextResponse.json(
              {
                success: false,
                error: ORDER_AMOUNT_MISMATCH_MESSAGE,
                code: 'ORDER_AMOUNT_MISMATCH',
              },
              { status: 402 },
            );
          }
          if (typeof co.currency_code === 'string' && co.currency_code !== currency) {
            await releaseIdempotencyKey(reservedIdempotencyKey);
            return NextResponse.json(
              {
                success: false,
                error: ORDER_CURRENCY_MISMATCH_MESSAGE,
                code: 'ORDER_CURRENCY_MISMATCH',
              },
              { status: 402 },
            );
          }
        }
      } catch (err) {
        await releaseIdempotencyKey(reservedIdempotencyKey);
        return culqiReadErrorResponse(err);
      }

      if (!culqiOrderPaid) {
        try {
          Sentry.captureMessage('payment_integrity_culqi_order_not_paid', {
            level: 'info',
            tags: { flow: 'order', businessId, productId },
            extra: { culqiOrderId },
          });
        } catch (e) {
          void e;
        }
        // Not paid yet is recoverable: the buyer may retry once Culqi confirms.
        // The order-flow key is deterministic per Culqi order, so leaving it
        // reserved would replay this 402 forever.
        await releaseIdempotencyKey(reservedIdempotencyKey);
        return NextResponse.json(
          {
            success: false,
            error: ORDER_NOT_PAID_MESSAGE,
            code: 'ORDER_NOT_PAID',
          },
          { status: 402 },
        );
      }
    } else if (isTokenFlow) {
      // TOKEN-BASED: Ejecutar el cargo contra Culqi con la key del negocio
      const { secretKey, error: keyError } = await resolveCulqiSecretKey(businessId);
      if (keyError) {
        await releaseIdempotencyKey(reservedIdempotencyKey);
        return keyError;
      }

      // Scalar qty for the Culqi metadata: the bound line's quantity when the
      // cart carries a line for this product, else 1. Never the cart array.
      const boundQty =
        metadata?.cartItems?.find((i: { id: string; quantity: number }) => i.id === productId)
          ?.quantity ?? 1;

      // Use server-authoritative amount from price validation
      if (priceCheck?.serverAmount) {
        authoritativeAmount = priceCheck.serverAmount;
      }
      const { culqiData: chargeResult, error: chargeError } = await executeCulqiCharge({
        token,
        secretKey,
        amount: authoritativeAmount,
        currency,
        email,
        customerName,
        phone: rawShipping.phone ?? null,
        productTitle: undefined, // product title not needed for charge
        businessId,
        productId,
        qty: boundQty,
      });
      if (chargeError) {
        await releaseIdempotencyKey(reservedIdempotencyKey);
        return chargeError;
      }
      culqiData = chargeResult;
    }

    // The replay lookup is KIND-CORRECT (design D13): an order-flow sale is
    // keyed by `culqi_order_id`, a token-flow sale by `culqi_charge_id`. The
    // old lookup matched EITHER id against `culqi_charge_id`, so the same sale
    // could be found under two different names depending on who looked.
    const existingPayment = await findSalePaymentRow<typeof payments.$inferSelect>(db, {
      businessId,
      culqiOrderId: isOrderFlow ? (culqiOrderId as string) : null,
      culqiChargeId: isOrderFlow ? null : (culqiData?.id ?? null),
    });

    if (existingPayment) {
      const responseBody = {
        success: true,
        payment: projectReplayPayment(existingPayment),
        charge: {
          id: culqiOrderId || culqiData?.id || null,
          status: 'paid',
        },
        replayed: true,
      };
      await completeIdempotencyKey(reservedIdempotencyKey, responseBody, 200);
      return NextResponse.json(responseBody);
    }

    // 🔥 ATOMICITY: Transacción de Base de Datos
    // Declared outside the transaction on purpose: the fulfillment result must
    // only be emitted once the transaction COMMITS. Logging inside the callback
    // would report a rollback as a real event.
    let fulfillmentAnchor: SaleIdentity | null = null;
    let fulfillmentResult: FulfillmentResult | null = null;

    const result = await db.transaction(
      // eslint-disable-next-line complexity
      async (tx) => {
        // 4. Guardar Pago

        // Mapear tipo de courier
        let shippingType: 'agencia' | 'domicilio' | 'recojo';
        if (rawShipping.courier === 'urbano_agencia') {
          shippingType = 'agencia';
        } else if (rawShipping.courier === 'urbano_domicilio') {
          shippingType = 'domicilio';
        } else {
          shippingType = 'recojo';
        }

        let pm: 'card' | 'yape';
        if (isOrderFlow) {
          pm = 'card';
        } else if (token?.startsWith('ype_')) {
          pm = 'yape';
        } else {
          pm = 'card';
        }
        // The id columns are KIND-CORRECT (design D13): the order flow writes
        // the Culqi ORDER id (`ord_...`) into `culqi_order_id` and leaves
        // `culqi_charge_id` NULL; the token flow writes the Culqi CHARGE id
        // (`chr_...`) into `culqi_charge_id` and leaves `culqi_order_id` NULL.
        //
        // The old code wrote the ORDER id into `culqi_charge_id`, so the SAME
        // sale answered to a different name depending on which writer touched
        // it last — and the webhook (which upserts on the CHARGE id) never
        // matched the order-flow row, creating a second `payments` row for one
        // sale and decrementing its stock twice.
        const culqiChargeId = isOrderFlow ? null : (culqiData?.id ?? null);
        const culqiOrderIdForRow = isOrderFlow ? (culqiOrderId as string) : null;
        const culqiRefCode = culqiData?.reference_code || null;

        // RESOLVE-THEN-ADOPT (design D13): the webhook may have created this
        // sale's row before this transaction ran. Adopting that row keeps ONE
        // row per sale; a blind insert would create a second one and the sale
        // would be decremented twice.
        const adoptedRow = await findSalePaymentRow(tx, {
          businessId,
          culqiOrderId: culqiOrderIdForRow,
          culqiChargeId,
        });

        // The route-owned fields. On adopt they OVERWRITE the adopted row; the
        // id columns and the tracking token are NOT route-owned and are never
        // touched (the token is a unique buyer-facing link).
        const routeOwnedValues = {
          businessId,
          productId,
          sellerUserId: business.ownerId,
          amount: String(authoritativeAmount / 100),
          currency,
          paymentMethod: pm,
          culqiReferenceCode: culqiRefCode,
          buyerEmail: email || 'cliente@culqi.com',
          buyerPhone: rawShipping.phone ?? null,
          buyerDni: rawShipping.dni ?? null,
          status: 'paid' as const,
          orderNumber: resolveOrderNumber(metadata?.orderNumber),
          shippingType,
          shippingDepartment: rawShipping.department ?? null,
          shippingProvince: rawShipping.province ?? null,
          shippingDistrict: rawShipping.district ?? null,
          shippingAddress: rawShipping.address ?? null,
          shippingAgency: rawShipping.agency ?? null,
          shippingPhone: rawShipping.phone ?? null,
          shippingReference: rawShipping.reference ?? null,
          shippingUbigeo: rawShipping.ubigeo ?? null,
        };

        // The metadata MERGE: the adopted row may already carry the scalar
        // `qty` the webhook recovered from the Culqi charge metadata. Merging
        // (existing first, client's second) keeps that value while letting the
        // route's own cart snapshot win.
        const mergedMetadata = {
          ...asMetadataObject(adoptedRow?.metadata),
          ...metadata,
          culqiId: culqiChargeId ?? culqiOrderIdForRow,
          ...(customerAuth ? { customerAuth } : {}),
        };

        let payment: typeof payments.$inferSelect;
        if (adoptedRow) {
          const [updated] = await tx
            .update(payments)
            .set({ ...routeOwnedValues, metadata: mergedMetadata, updatedAt: new Date() })
            .where(eq(payments.id, adoptedRow.id))
            .returning();
          payment = updated;
        } else {
          const [inserted] = await tx
            .insert(payments)
            .values({
              ...routeOwnedValues,
              culqiChargeId,
              culqiOrderId: culqiOrderIdForRow,
              metadata: mergedMetadata,
              trackingToken: generateTrackingToken(),
            })
            .returning();
          payment = inserted;
        }

        // 5b. Si es pago contra orden, marcar la orden como pagada
        // The row uuid the flip actually updated is the ONLY safe key for the
        // `payment_orders` claim slot (R5): a text `culqiOrderId` would crash
        // the uuid `source_id`. Null for the token flow.
        let paymentOrderId: string | null = null;
        if (culqiOrderId) {
          const flipped = await tx
            .update(paymentOrders)
            .set({ status: 'paid', updatedAt: sql`now()` })
            .where(
              and(
                eq(paymentOrders.culqiOrderId, culqiOrderId),
                eq(paymentOrders.businessId, businessId),
              ),
            )
            .returning({ id: paymentOrders.id });

          // Fail closed: a 0-row flip (or an undefined result) means the order we
          // verified is not the row we would mark paid, so abort the transaction.
          if (flipped?.length !== 1) {
            throw new Error('payment_orders flip affected no row');
          }
          paymentOrderId = flipped[0].id;
        }

        // 5. Fulfill stock via the shared helper (NEW-8, design D1/D5).
        //
        // The helper owns the ONLY implementation of "decrement for a paid
        // sale": it claims the sale's ordered key set in the `stock_movements`
        // ledger (a CAS INSERT ... ON CONFLICT DO NOTHING ... RETURNING) in THIS
        // SAME transaction, then applies the conditional, business-scoped
        // decrement (`WHERE id AND businessId AND stock >= qty` with
        // `.returning()`). An already-claimed sale (0 claim rows) skips the
        // decrement without failing the payment — the loser of a race is not a
        // failure (R2). GREATEST/rowCount are forbidden: `rowCount` is
        // `undefined` on postgres-js and would fail open.
        //
        // The claim is an INSERT, never a third `tx.update`: tests pin exactly
        // two `mockTxUpdate` calls in the order flow (flip first, decrement
        // second).
        //
        // The claim keys come from the CANONICAL sale identity (design D14):
        // the resolved `payment_orders` row FIRST, then the resolved `payments`
        // row. Both are DB row uuids; a Culqi text id never becomes a
        // `source_id` (R2).
        const identity: SaleIdentity = {
          paymentOrderId,
          paymentId: payment.id,
          businessId,
          culqiOrderId: culqiOrderIdForRow,
          culqiChargeId,
        };

        // W-B: the snapshot source follows the SALE's channel, never the
        // request. An order-backed sale fulfils from the PERSISTED
        // `payment_orders.metadata.cartItems` written by create-order. The
        // request cart is buyer-controlled, so it MUST NOT size the decrement.
        //
        // If the persisted snapshot is absent or unusable the sale FAILS
        // CLOSED: no claim, no decrement. It must never fall back to the
        // request cart — that fallback is the W-B defect this branch closes.
        // The sale stays unclaimed, so the D10 backstop can heal it later from
        // the persisted rows.
        const fulfillmentSnapshot = selectFulfillmentSnapshot({
          isOrderFlow,
          persistedOrderMetadata,
          paymentMetadata: payment.metadata,
          productId,
        });

        if (fulfillmentSnapshot) {
          fulfillmentResult = await fulfillPaidSale(identity, fulfillmentSnapshot, { tx });
          fulfillmentAnchor = identity;
        }

        return payment;
      },
    );

    // A sale without enough stock is an operational incident: the buyer was
    // charged for units that did not exist. Emitted POST-COMMIT only, through
    // the helper's exported emitter (design D5).
    //
    // The emitter deliberately uses console.error, NOT `logger.error`: the
    // structured logger runs scrubPII, whose PHONE_REGEX matches any 6-11 digit
    // run and therefore mangles UUIDs ("...446655440001" ->
    // "...44665[REDACTED_PHONE]"), destroying the productId/businessId that make
    // this alert actionable. Do not "upgrade" this call until the scrubber stops
    // corrupting identifiers (B-07).
    if (fulfillmentAnchor && fulfillmentResult) {
      emitFulfillmentAlerts('charge', fulfillmentAnchor, fulfillmentResult);
    }

    // ─── Notificar al negocio ───
    // Fire-and-forget: no fallar si la notificación falla
    notifyNewOrder(businessId, {
      orderId: result.id,
      customerName: customerName || email || 'cliente@culqi.com',
      amount: authoritativeAmount / 100,
      itemsCount: (metadata?.cartItems as { id: string; quantity: number }[])?.length || 1,
    }).catch((notifyErr) => {
      console.error('[notifyNewOrder] Error:', notifyErr);
    });

    // ─── Notificar al customer por SMS ───
    notifyOrderPaymentSms(result, businessId).catch((smsErr) => {
      console.error('[charge] SMS notification error:', smsErr);
    });

    // Notificar stock bajo/agotado
    const cartItems = (metadata?.cartItems as { id: string; quantity: number }[]) || [];
    const itemsToCheck = cartItems.length > 0 ? cartItems : [{ id: productId, quantity: 1 }];

    for (const item of itemsToCheck) {
      const updatedProduct = await db.query.products.findFirst({
        where: eq(products.id, item.id),
        columns: { id: true, title: true, stock: true },
      });

      if (updatedProduct && updatedProduct.stock === 0) {
        notifyOutOfStock(businessId, {
          productId: updatedProduct.id,
          productName: updatedProduct.title,
        }).catch(() => {
          // ignore
        });
      } else if (updatedProduct && updatedProduct.stock <= LOW_STOCK_THRESHOLD) {
        notifyLowStock(businessId, {
          productId: updatedProduct.id,
          productName: updatedProduct.title,
          currentStock: updatedProduct.stock,
          minStock: LOW_STOCK_THRESHOLD,
        }).catch(() => {
          // ignore
        });
      }
    }

    // Fire-and-forget: capture payment completed event
    captureEvent(AnalyticsEvents.PAYMENT_COMPLETED, {
      order_id: result.id,
      amount: authoritativeAmount / 100,
      currency,
    }).catch(() => {
      // ignore
    });

    // Attach user + business context to Sentry for multi-tenant error tracing.
    // Guest checkouts (anonymous buyers) safely skip user context.
    if (authUser?.id) {
      setSentryContext(
        { id: authUser.id, email: authUser.email },
        { id: businessId, plan: entitlements.plan },
      );
    }

    const responseBody = {
      success: true,
      payment: result,
      charge: {
        id: culqiData?.id || culqiOrderId || result.id,
        status: 'paid',
      },
    };

    successPathCompletedKey = true;
    await completeIdempotencyKey(reservedIdempotencyKey, responseBody, 200);

    return NextResponse.json(responseBody);
  } catch (error) {
    console.error('[payment/charge] Critical Error:', error);

    // A key left at `processing` with a null body is a PERMANENT lockout: the
    // client key is deterministic (`charge-${token || culqiOrderId}`,
    // paymentApi.ts:68), `reserveIdempotencyKey` answers `{type:'processing'}`
    // for it forever, and no reaper exists for `payment_idempotency_keys`. So a
    // throw after the reservation must complete the key with the failure.
    if (reservedIdempotencyKey && !successPathCompletedKey) {
      try {
        await completeIdempotencyKey(
          reservedIdempotencyKey,
          { error: INTERNAL_ERROR_MESSAGE },
          500,
        );
      } catch (completeError) {
        // Never let the cleanup mask the original failure.
        console.error('[payment/charge] Idempotency completion error:', completeError);
      }
    }

    return NextResponse.json({ error: INTERNAL_ERROR_MESSAGE }, { status: 500 });
  }
}

// ─── Helper: Send SMS confirmation after successful payment ───

async function notifyOrderPaymentSms(
  payment: typeof payments.$inferSelect,
  businessId: string,
): Promise<void> {
  if (!payment.buyerPhone || !payment.trackingToken) return;

  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { slug: true, name: true },
  });

  if (!business) return;

  await sendOrderStatusSms({
    toStatus: 'PAID',
    buyerPhone: payment.buyerPhone,
    businessSlug: business.slug,
    businessName: business.name,
    trackingToken: payment.trackingToken,
  });

  // Also send confirmation email
  sendOrderConfirmationEmail(payment, businessId).catch((emailErr) => {
    console.error('[charge] Confirmation email error:', emailErr);
  });
}
