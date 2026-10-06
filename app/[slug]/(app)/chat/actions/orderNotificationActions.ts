'use server';

import { env } from '@/config/env';
import { db } from '@/core/database/client';
import {
  payments,
  whatsappChannels,
  whatsappConversations,
  whatsappMessages,
  whatsappTemplates,
} from '@/core/database/schema';
import { BASE_TEMPLATES } from '@/features/chat/constants/baseTemplates';
import { and, eq } from 'drizzle-orm';

const YCLOUD_API_BASE = 'https://api.ycloud.com/v2';

interface OrderNotificationData {
  businessId: string;
  orderId: string;
  templateName: 'order_confirmed' | 'order_shipped' | 'payment_reminder' | 'delivery_update';
  variables: Record<string, string>;
}

interface SendNotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Get the active WhatsApp channel for a business
 */
async function getActiveChannel(businessId: string) {
  const channel = await db
    .select()
    .from(whatsappChannels)
    .where(and(eq(whatsappChannels.businessId, businessId), eq(whatsappChannels.isActive, true)))
    .limit(1);
  return channel[0] ?? null;
}

/**
 * Get or create a WhatsApp conversation for a customer phone
 */
async function getOrCreateConversation(channelId: string, customerPhone: string) {
  const existing = await db
    .select()
    .from(whatsappConversations)
    .where(
      and(
        eq(whatsappConversations.channelId, channelId),
        eq(whatsappConversations.customerPhone, customerPhone),
      ),
    )
    .limit(1);

  if (existing.length) return existing[0];

  const [newConv] = await db
    .insert(whatsappConversations)
    .values({
      channelId,
      customerPhone,
    })
    .returning();

  return newConv;
}

/**
 * Get approved template by name for a channel
 */
async function getApprovedTemplate(channelId: string, templateName: string) {
  const template = await db
    .select()
    .from(whatsappTemplates)
    .where(
      and(
        eq(whatsappTemplates.channelId, channelId),
        eq(whatsappTemplates.name, templateName),
        eq(whatsappTemplates.metaStatus, 'approved'),
      ),
    )
    .limit(1);

  return template[0] ?? null;
}

/**
 * Build template components with variables substituted
 */
function buildTemplateComponents(
  template: typeof whatsappTemplates.$inferSelect,
  variables: Record<string, string>,
) {
  // For now, we use a simple approach: variables are passed as body parameters
  // The template body uses {{1}}, {{2}} etc. and we map variables in order
  const variableValues = Object.values(variables);

  return [
    {
      type: 'body' as const,
      parameters: variableValues.map((text) => ({ type: 'text' as const, text })),
    },
  ];
}

/**
 * Send a WhatsApp template notification for an order event
 *
 * Usage:
 * - Order paid → sendOrderNotification(businessId, orderId, 'order_confirmed', {
 *     customerName, orderNumber, businessName, amount, orderUrl
 *   })
 * - Order shipped → sendOrderNotification(businessId, orderId, 'order_shipped', {
 *     orderNumber, carrier, trackingNumber, estimatedDelivery, trackingUrl
 *   })
 * - Before deadline → sendOrderNotification(businessId, orderId, 'payment_reminder', {
 *     customerName, orderNumber, amount, dueDate, paymentUrl
 *   })
 */
export async function sendOrderNotification(
  data: OrderNotificationData,
): Promise<SendNotificationResult> {
  try {
    const { businessId, orderId, templateName, variables } = data;

    // 1. Get the order/payment to get buyer phone
    const order = await db
      .select({
        id: payments.id,
        buyerPhone: payments.buyerPhone,
        orderNumber: payments.orderNumber,
        amount: payments.amount,
        trackingToken: payments.trackingToken,
        businessId: payments.businessId,
      })
      .from(payments)
      .where(eq(payments.id, orderId))
      .limit(1);

    if (!order.length) {
      return { success: false, error: 'Pedido no encontrado' };
    }

    const payment = order[0];

    if (!payment.buyerPhone) {
      return { success: false, error: 'El cliente no tiene teléfono registrado' };
    }

    // 2. Get active WhatsApp channel for business
    const channel = await getActiveChannel(businessId);
    if (!channel) {
      return { success: false, error: 'Canal de WhatsApp no configurado o inactivo' };
    }

    // 3. Get approved template
    const template = await getApprovedTemplate(channel.id, templateName);
    if (!template) {
      return { success: false, error: `Template '${templateName}' no aprobado o no encontrado` };
    }

    // 4. Get or create conversation
    const conversation = await getOrCreateConversation(channel.id, payment.buyerPhone);

    // 5. Build components with variables
    const components = buildTemplateComponents(template, variables);

    // 6. Send via YCloud
    const apiKey = env.ycloudApiKey;
    if (!apiKey) {
      console.error('[sendOrderNotification] Missing YCloud API key');
      return { success: false, error: 'Configuración de WhatsApp incompleta' };
    }

    const ycloudPayload = {
      from: channel.ycloudPhoneNumberId,
      to: payment.buyerPhone,
      type: 'template' as const,
      template: {
        name: template.name,
        components,
      },
    };

    const response = await fetch(`${YCLOUD_API_BASE}/whatsapp/messages/sendDirectly`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(ycloudPayload),
    });

    const ycloudResponse = await response.json();

    if (!response.ok) {
      console.error('[sendOrderNotification] YCloud error:', ycloudResponse);
      return {
        success: false,
        error: ycloudResponse.message || 'Error al enviar template por WhatsApp',
      };
    }

    const ycloudMessageId = ycloudResponse.id;
    if (!ycloudMessageId) {
      return { success: false, error: 'Respuesta inválida de YCloud' };
    }

    // 7. Store the message
    const [newMessage] = await db
      .insert(whatsappMessages)
      .values({
        conversationId: conversation.id,
        channelId: channel.id,
        direction: 'outbound',
        type: 'template',
        templateName: template.name,
        body: JSON.stringify(components),
        ycloudMessageId,
        status: 'accepted',
      })
      .returning();

    // 8. Update conversation timestamp
    await db
      .update(whatsappConversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(whatsappConversations.id, conversation.id));

    return { success: true, messageId: newMessage.id };
  } catch (error) {
    console.error('[sendOrderNotification] Error:', error);
    return { success: false, error: 'No se pudo enviar la notificación' };
  }
}

/**
 * Helper to send order_confirmed notification
 * Variables needed: customerName, orderNumber, businessName, amount, orderUrl
 */
export async function sendOrderConfirmedNotification(
  businessId: string,
  orderId: string,
  variables: {
    customerName: string;
    orderNumber: string;
    businessName: string;
    amount: string;
    orderUrl: string;
  },
): Promise<SendNotificationResult> {
  return sendOrderNotification({
    businessId,
    orderId,
    templateName: 'order_confirmed',
    variables,
  });
}

/**
 * Helper to send order_shipped notification
 * Variables needed: orderNumber, carrier, trackingNumber, estimatedDelivery, trackingUrl
 */
export async function sendOrderShippedNotification(
  businessId: string,
  orderId: string,
  variables: {
    orderNumber: string;
    carrier: string;
    trackingNumber: string;
    estimatedDelivery: string;
    trackingUrl: string;
  },
): Promise<SendNotificationResult> {
  return sendOrderNotification({
    businessId,
    orderId,
    templateName: 'order_shipped',
    variables,
  });
}

/**
 * Helper to send payment_reminder notification
 * Variables needed: customerName, orderNumber, amount, dueDate, paymentUrl
 */
export async function sendPaymentReminderNotification(
  businessId: string,
  orderId: string,
  variables: {
    customerName: string;
    orderNumber: string;
    amount: string;
    dueDate: string;
    paymentUrl: string;
  },
): Promise<SendNotificationResult> {
  return sendOrderNotification({
    businessId,
    orderId,
    templateName: 'payment_reminder',
    variables,
  });
}

/**
 * Helper to send delivery_update notification
 * Variables needed: orderNumber, status, details
 */
export async function sendDeliveryUpdateNotification(
  businessId: string,
  orderId: string,
  variables: { orderNumber: string; status: string; details: string },
): Promise<SendNotificationResult> {
  return sendOrderNotification({
    businessId,
    orderId,
    templateName: 'delivery_update',
    variables,
  });
}

/**
 * Get all available base templates (for UI display)
 */
export async function getAvailableBaseTemplates() {
  return BASE_TEMPLATES.map((t) => ({
    name: t.name,
    category: t.category,
    language: t.language,
    body: t.body,
    components: t.components,
  }));
}
