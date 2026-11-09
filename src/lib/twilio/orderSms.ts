// ──────────────────────────────────────────
// Order SMS Notifications
// Sends SMS to customers on order status changes via Twilio
// ──────────────────────────────────────────

import { env } from '@/config/env';
import { ORDER_STATUS_V2, type OrderStatusV2 } from '@/core/orders/orderStatus';
import { logger, toErrorDetail } from '@/lib/logger';
import { sendSms } from '../sms/jsonpe';

// ─── Message templates per status ───

const STATUS_MESSAGES: Record<string, (businessName: string, trackingUrl: string) => string> = {
  [ORDER_STATUS_V2.PAID]: (_name, url) => `✅ ¡Compra confirmada! Seguí tu pedido en: ${url}`,
  [ORDER_STATUS_V2.PREPARING_ORDER]: (name, url) =>
    `📦 ${name} está preparando tu pedido. Seguilo en: ${url}`,
  [ORDER_STATUS_V2.READY_FOR_PICKUP]: (name, url) =>
    `📦 Tu pedido está listo para recoger en ${name}. Más info: ${url}`,
  [ORDER_STATUS_V2.PICKED_UP]: (_name, _url) => `✅ Recogiste tu pedido. ¡Gracias por tu compra!`,
  [ORDER_STATUS_V2.WAITING_CUSTOMER_CONFIRMATION]: (name, url) =>
    `📬 ${name} registró el envío. Confirmá que lo recibiste en: ${url}`,
  [ORDER_STATUS_V2.READY_TO_SHIP]: (name, url) =>
    `🚚 ${name} tiene tu pedido listo para enviar. Seguilo en: ${url}`,
  [ORDER_STATUS_V2.IN_TRANSIT]: (name, url) =>
    `🚚 Tu pedido de ${name} está en tránsito. Tracking: ${url}`,
  [ORDER_STATUS_V2.DELIVERED]: (name, url) =>
    `✅ Pedido entregado por ${name}. Confirmá en: ${url}`,
  [ORDER_STATUS_V2.COMPLETED]: (_name, _url) => `⭐ ¡Pedido finalizado! Gracias por tu compra.`,
  [ORDER_STATUS_V2.ISSUE_REPORTED]: (name, url) =>
    `ℹ️ Reportaste un problema con tu pedido de ${name}. El vendedor se comunicará. Seguilo en: ${url}`,
  [ORDER_STATUS_V2.CANCELLED]: (name, _url) =>
    `❌ Pedido de ${name} cancelado. Si tenés dudas, contactanos.`,
};

// ─── Build tracking URL ───

function buildTrackingUrl(slug: string, trackingToken: string): string {
  const base = env.nextPublicAppUrl || 'http://localhost:3000';
  return `${base}/${slug}/order/${trackingToken}`;
}

// ─── Send order SMS ───

export interface SendOrderSmsParams {
  toStatus: OrderStatusV2;
  buyerPhone: string;
  businessSlug: string;
  businessName: string;
  trackingToken: string;
}

/**
 * Send an SMS notification to the customer when their order status changes.
 * Fire-and-forget: never throws, logs errors instead.
 */
export async function sendOrderStatusSms(params: SendOrderSmsParams): Promise<void> {
  const { toStatus, buyerPhone, businessName, businessSlug, trackingToken } = params;

  if (!buyerPhone) {
    return;
  }

  const template = STATUS_MESSAGES[toStatus];
  if (!template) {
    return;
  }

  const trackingUrl = buildTrackingUrl(businessSlug, trackingToken);
  const message = template(businessName, trackingUrl);

  try {
    await sendSms(buyerPhone, message);
  } catch (error) {
    logger.error('OrderSms: send failed', { status: toStatus, error: toErrorDetail(error) });
  }
}
