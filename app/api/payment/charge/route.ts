/**
 * =====================================================
 * API: POST /api/payment/charge
 * Backend: Crear cargo (charge) en Culqi y guardar payment
 * =====================================================
 */

import { db } from '@/core/database/client';
import {
  businesses,
  businessSettings,
  paymentOrders,
  payments,
  products,
} from '@/core/database/schema';
import { getBusinessEntitlements } from '@/core/entitlements/getBusinessEntitlements';
import { CulqiReadError, getCulqiOrder, isCulqiOrderPaid } from '@/core/payments/culqiOrders';
import { completeIdempotencyKey, reserveIdempotencyKey } from '@/core/payments/idempotency';
import { paymentRateLimiter } from '@/core/payments/rateLimiter';
import { generateTrackingToken } from '@/core/utils/trackingToken';
import { validateAmount } from '@/features/billing/validateAmount';
import { captureEvent } from '@/lib/analytics/capture';
import { AnalyticsEvents } from '@/lib/analytics/taxonomy';
import { sendOrderConfirmationEmail } from '@/lib/email/orderEmails';
import { notifyLowStock, notifyNewOrder, notifyOutOfStock } from '@/lib/notifications';
import { setSentryContext } from '@/lib/sentryContext';
import { createClient } from '@/lib/supabase/server';
import { sendOrderStatusSms } from '@/lib/twilio/orderSms';
import { splitFullName } from '@/shared/payments/fullName';
import type { CulqiChargeResponse } from '@/types/culqi';
import { decrypt } from '@/utils/crypto';
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

// ─── Helper: Resolve and validate Culqi secret key ──────────────────
async function resolveCulqiSecretKey(
  businessId: string,
): Promise<{ secretKey: string; error: NextResponse | null }> {
  const settings = await db.query.businessSettings.findFirst({
    where: eq(businessSettings.businessId, businessId),
    columns: { culqiSecretKey: true },
  });

  if (!settings?.culqiSecretKey) {
    return {
      secretKey: '',
      error: NextResponse.json(
        { error: 'El negocio no tiene configurada pasarela de pagos' },
        { status: 400 },
      ),
    };
  }

  const secretKey = decrypt(settings.culqiSecretKey);
  const isProd = process.env.NODE_ENV === 'production';
  const isKeyLive = secretKey.startsWith('sk_live');

  if (isProd && !isKeyLive) {
    return {
      secretKey: '',
      error: NextResponse.json(
        { error: 'Configuración inválida: Se requiere una llave de producción (sk_live).' },
        { status: 400 },
      ),
    };
  }

  if (!isProd && isKeyLive) {
    return {
      secretKey: '',
      error: NextResponse.json(
        {
          error: 'Configuración inválida: No se permiten llaves sk_live en entorno de desarrollo.',
        },
        { status: 400 },
      ),
    };
  }

  return { secretKey, error: null };
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
      metadata: { businessId, productId, platform: 'store-lite' },
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
    const priceCheck = await validateAmount({
      productId,
      businessId,
      clientAmount: amount,
      cartItems: metadata?.cartItems,
    });
    if (!priceCheck.ok) {
      return NextResponse.json({ error: priceCheck.error }, { status: 400 });
    }

    // ─── Rate Limit Check ──────────────────────────────────────────
    if (!paymentRateLimiter.check(`${businessId}:${productId}`)) {
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

      // ─── BINDING: the verified payment must be what gets recorded ───
      // A paid Culqi order only authorises ITS OWN amount and product. Without
      // this binding, a buyer can pay a S/ 1 order and have the transaction
      // record + decrement stock for a S/ 1000 product of the same business
      // (underpayment + fabricated financial record). Both checks run before the
      // Culqi read (no upstream round-trip is wasted) and before
      // reserveIdempotencyKey (no key is burned).
      const orderAmountMinor = orderAmountToMinorUnits(orderRow.amount);
      if (orderAmountMinor === null || orderAmountMinor !== amount) {
        return NextResponse.json(
          {
            success: false,
            error: ORDER_AMOUNT_MISMATCH_MESSAGE,
            code: 'ORDER_AMOUNT_MISMATCH',
          },
          { status: 402 },
        );
      }

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

      const { secretKey, error: keyError } = await resolveCulqiSecretKey(businessId);
      if (keyError) return keyError;

      let culqiOrderPaid = false;
      try {
        culqiOrderPaid = isCulqiOrderPaid(await getCulqiOrder(culqiOrderId as string, secretKey));
      } catch (err) {
        return culqiReadErrorResponse(err);
      }

      if (!culqiOrderPaid) {
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
      if (keyError) return keyError;

      const { culqiData: chargeResult, error: chargeError } = await executeCulqiCharge({
        token,
        secretKey,
        amount,
        currency,
        email,
        customerName,
        phone: rawShipping.phone ?? null,
        productTitle: undefined, // product title not needed for charge
        businessId,
        productId,
      });
      if (chargeError) return chargeError;
      culqiData = chargeResult;
    }

    const idempotencyReservation = await reserveIdempotencyKey(idempotencyKey);
    if (
      idempotencyReservation?.type === 'replay' ||
      idempotencyReservation?.type === 'processing'
    ) {
      return idempotencyReservation.response;
    }
    reservedIdempotencyKey = idempotencyReservation?.key ?? null;

    const culqiChargeIdForLookup = culqiOrderId || culqiData?.id || null;
    if (culqiChargeIdForLookup) {
      const existingPayment = await db.query.payments.findFirst({
        where: and(
          eq(payments.culqiChargeId, culqiChargeIdForLookup),
          eq(payments.businessId, businessId),
        ),
      });

      if (existingPayment) {
        const responseBody = {
          success: true,
          payment: projectReplayPayment(existingPayment),
          charge: {
            id: culqiChargeIdForLookup,
            status: 'paid',
          },
          replayed: true,
        };
        await completeIdempotencyKey(reservedIdempotencyKey, responseBody, 200);
        return NextResponse.json(responseBody);
      }
    }

    // 🔥 ATOMICITY: Transacción de Base de Datos
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
        const culqiChargeId = culqiOrderId || culqiData?.id || null;
        const culqiRefCode = culqiData?.reference_code || null;

        const [payment] = await tx
          .insert(payments)
          .values({
            businessId,
            productId,
            sellerUserId: business.ownerId,
            amount: String(amount / 100),
            currency,
            paymentMethod: pm,
            culqiChargeId,
            culqiReferenceCode: culqiRefCode,
            buyerEmail: email || 'cliente@culqi.com',
            buyerPhone: rawShipping.phone ?? null,
            buyerDni: rawShipping.dni ?? null,
            status: 'paid',
            orderNumber: (metadata?.orderNumber as string) ?? null,
            shippingType,
            shippingDepartment: rawShipping.department ?? null,
            shippingProvince: rawShipping.province ?? null,
            shippingDistrict: rawShipping.district ?? null,
            shippingAddress: rawShipping.address ?? null,
            shippingAgency: rawShipping.agency ?? null,
            shippingPhone: rawShipping.phone ?? null,
            shippingReference: rawShipping.reference ?? null,
            shippingUbigeo: rawShipping.ubigeo ?? null,
            metadata: {
              ...metadata,
              culqiId: culqiChargeId,
              ...(customerAuth ? { customerAuth } : {}),
            },
            trackingToken: generateTrackingToken(),
          })
          .returning();

        // 5b. Si es pago contra orden, marcar la orden como pagada
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
        }

        // 5. Actualizar Stock
        const cartItems = (metadata?.cartItems as { id: string; quantity: number }[]) || [];
        const itemsToUpdate = cartItems.length > 0 ? cartItems : [{ id: productId, quantity: 1 }];

        for (const item of itemsToUpdate) {
          await tx
            .update(products)
            .set({ stock: sql`GREATEST(${products.stock} - ${Math.max(1, item.quantity)}, 0)` })
            .where(eq(products.id, item.id));
        }

        return payment;
      },
    );

    // ─── Notificar al negocio ───
    // Fire-and-forget: no fallar si la notificación falla
    notifyNewOrder(businessId, {
      orderId: result.id,
      customerName: customerName || email || 'cliente@culqi.com',
      amount: amount / 100,
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
        }).catch(() => {});
      } else if (updatedProduct && updatedProduct.stock <= LOW_STOCK_THRESHOLD) {
        notifyLowStock(businessId, {
          productId: updatedProduct.id,
          productName: updatedProduct.title,
          currentStock: updatedProduct.stock,
          minStock: LOW_STOCK_THRESHOLD,
        }).catch(() => {});
      }
    }

    // Fire-and-forget: capture payment completed event
    captureEvent(AnalyticsEvents.PAYMENT_COMPLETED, {
      order_id: result.id,
      amount: amount / 100,
      currency,
    }).catch(() => {});

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
