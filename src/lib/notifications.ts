// =====================================================
// NOTIFICATIONS HELPER
// =====================================================
// Backend functions to create business notifications
// Usage: Call from API routes, webhooks, or background jobs
// =====================================================

import { db } from '@/core/database/client';
import {
  notificationCategoryEnum,
  notifications,
  notificationTypeEnum,
  type NewNotification,
} from '@/core/database/schema';
import { logger } from '@/lib/logger';
import { enqueuePushFanout } from '@/lib/push/pushFanout';

/**
 * Parameters for creating a business notification
 */
export interface CreateNotificationParams {
  businessId: string;
  type: (typeof notificationTypeEnum.enumValues)[number];
  category: (typeof notificationCategoryEnum.enumValues)[number];
  title: string;
  message: string;
  /**
   * Optional additional data (orderId, productId, etc.)
   */
  data?: Record<string, unknown>;
}

/**
 * Creates a notification for a business.
 * Note: this inserts a new row on every call.
 * If you need deduplication for retries/replays, add an explicit idempotency key.
 *
 * @example
 * ```typescript
 * // Notify about a new order
 * await createBusinessNotification({
 *   businessId: 'abc-123',
 *   type: 'order_created',
 *   category: 'pedidos',
 *   title: 'Nuevo pedido recibido',
 *   message: 'El cliente Juan Díaz ha realizado un pedido de S/120.00',
 *   data: { orderId: 'ord-456', amount: 120.00 }
 * });
 * ```
 */
export async function createBusinessNotification(
  params: CreateNotificationParams,
): Promise<NewNotification> {
  const { businessId, type, category, title, message, data } = params;

  // Validate types
  if (!notificationTypeEnum.enumValues.includes(type)) {
    throw new Error(`Invalid notification type: ${type}`);
  }

  if (!notificationCategoryEnum.enumValues.includes(category)) {
    throw new Error(`Invalid notification category: ${category}`);
  }

  const notificationData: NewNotification = {
    businessId,
    type,
    category,
    title,
    message,
    data: data ?? {},
  };

  const [created] = await db.insert(notifications).values(notificationData).returning();

  // T2.5: best-effort fan-out only after the inbox row is durable. Enqueue
  // failures are isolated: payment/order/inbox success never depends on push.
  try {
    await enqueuePushFanout(created);
  } catch (error) {
    logger.error('[push] fan-out enqueue hook failed', {
      notificationId: created?.id,
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
  }

  return created;
}

// =====================================================
// CONVENIENCE FUNCTIONS
// =====================================================
// Pre-built notification creators for common scenarios
// =====================================================

/**
 * Notify about a new order/order created
 */
export async function notifyNewOrder(
  businessId: string,
  orderData: {
    orderId: string;
    customerName: string;
    amount: number;
    itemsCount: number;
  },
): Promise<NewNotification> {
  return createBusinessNotification({
    businessId,
    type: 'order_created',
    category: 'pedidos',
    title: 'Nuevo pedido recibido',
    message: `El cliente ${orderData.customerName} ha realizado un pedido de S/${orderData.amount.toFixed(2)} (${orderData.itemsCount} productos)`,
    data: { orderId: orderData.orderId },
  });
}

/**
 * Notify about order status change
 */
export async function notifyOrderStatusChange(
  businessId: string,
  orderData: {
    orderId: string;
    customerName: string;
    oldStatus: string;
    newStatus: string;
  },
): Promise<NewNotification> {
  const statusMessages: Record<string, string> = {
    pending: 'pendiente',
    paid: 'pagado',
    not_delivered: 'por entregar',
    delivered: 'entregado',
    completed: 'completado',
    failed: 'fallido',
  };

  return createBusinessNotification({
    businessId,
    type: 'order_status_changed',
    category: 'pedidos',
    title: 'Estado de pedido actualizado',
    message: `El pedido de ${orderData.customerName} cambió de ${statusMessages[orderData.oldStatus] || orderData.oldStatus} a ${statusMessages[orderData.newStatus] || orderData.newStatus}`,
    data: {
      orderId: orderData.orderId,
      oldStatus: orderData.oldStatus,
      newStatus: orderData.newStatus,
    },
  });
}

/**
 * Notify about a new message in chat
 */
export async function notifyNewMessage(
  businessId: string,
  messageData: {
    customerName: string;
    preview: string;
  },
): Promise<NewNotification> {
  return createBusinessNotification({
    businessId,
    type: 'message_new',
    category: 'chat',
    title: 'Nuevo mensaje',
    message: `${messageData.customerName}: ${messageData.preview.slice(0, 50)}${messageData.preview.length > 50 ? '...' : ''}`,
    data: { preview: messageData.preview },
  });
}

/**
 * Notify about low stock
 */
export async function notifyLowStock(
  businessId: string,
  productData: {
    productId: string;
    productName: string;
    currentStock: number;
    minStock: number;
  },
): Promise<NewNotification> {
  return createBusinessNotification({
    businessId,
    type: 'stock_low',
    category: 'almacen',
    title: 'Stock bajo',
    message: `${productData.productName} tiene solo ${productData.currentStock} unidades (mínimo: ${productData.minStock})`,
    data: { productId: productData.productId },
  });
}

/**
 * Notify about out of stock
 */
export async function notifyOutOfStock(
  businessId: string,
  productData: {
    productId: string;
    productName: string;
  },
): Promise<NewNotification> {
  return createBusinessNotification({
    businessId,
    type: 'stock_out',
    category: 'almacen',
    title: 'Sin stock',
    message: `${productData.productName} está agotado`,
    data: { productId: productData.productId },
  });
}

/**
 * Notify about plan expiring soon
 */
export async function notifyPlanExpiring(
  businessId: string,
  planData: {
    planName: string;
    daysRemaining: number;
    expiryDate: string;
  },
): Promise<NewNotification> {
  return createBusinessNotification({
    businessId,
    type: 'plan_expiring',
    category: 'plan',
    title: 'Plan por expirar',
    message: `Tu plan "${planData.planName}" expira en ${planData.daysRemaining} días (${planData.expiryDate}). Renueva para continuar usando todas las funciones.`,
    data: { daysRemaining: planData.daysRemaining },
  });
}

/**
 * Notify about plan expired
 */
export async function notifyPlanExpired(
  businessId: string,
  planData: {
    planName: string;
    expiryDate: string;
  },
): Promise<NewNotification> {
  return createBusinessNotification({
    businessId,
    type: 'plan_expired',
    category: 'plan',
    title: 'Plan expirado',
    message: `Tu plan "${planData.planName}" ha expirado el ${planData.expiryDate}.某些 funciones pueden estar limitadas.`,
    data: {},
  });
}

/**
 * Notify about plan upgraded
 */
export async function notifyPlanUpgraded(
  businessId: string,
  planData: {
    oldPlan: string;
    newPlan: string;
  },
): Promise<NewNotification> {
  return createBusinessNotification({
    businessId,
    type: 'plan_upgraded',
    category: 'plan',
    title: 'Plan actualizado',
    message: `Has actualizado tu plan de "${planData.oldPlan}" a "${planData.newPlan}". ¡Gracias por tu preferencia!`,
    data: { oldPlan: planData.oldPlan, newPlan: planData.newPlan },
  });
}

/**
 * Generic system notification
 */
export async function notifySystem(
  businessId: string,
  message: string,
  data?: Record<string, unknown>,
): Promise<NewNotification> {
  return createBusinessNotification({
    businessId,
    type: 'system',
    category: 'sistema',
    title: 'Notificación del sistema',
    message,
    data,
  });
}
