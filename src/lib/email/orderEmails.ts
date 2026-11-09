import { env } from '@/config/env';
import { db } from '@/core/database/client';
import { businesses, products } from '@/core/database/schema';
import { OrderCompletedEmail } from '@/emails/OrderCompletedEmail';
import { OrderConfirmationEmail } from '@/emails/OrderConfirmationEmail';
import { logger, toErrorDetail } from '@/lib/logger';
import { render } from '@react-email/components';
import { eq } from 'drizzle-orm';
import { sendEmail } from './resend';

// ─── Helpers ───

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return new Date().toLocaleDateString('es-PE', { dateStyle: 'long' });
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('es-PE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTotal(amount: string | null | undefined): string {
  if (!amount) return '';
  const num = Number.parseFloat(amount);
  if (Number.isNaN(num)) return `S/ ${amount}`;
  return `S/ ${num.toFixed(2)}`;
}

function formatPaymentMethod(method: string | null | undefined): string {
  if (!method) return '';
  const map: Record<string, string> = {
    card: 'Tarjeta',
    yape: 'Yape',
    plin: 'Plin',
    pago_efectivo: 'Pago Efectivo',
    billetera_movil: 'Billetera Móvil',
    cuotealo: 'Cuotealo',
  };
  return map[method] || method;
}

// ─── Send order confirmation email ───

export async function sendOrderConfirmationEmail(
  payment: {
    buyerEmail?: string | null;
    id: string;
    trackingToken?: string | null;
    amount?: string | null;
    productId?: string | null;
    createdAt?: Date | string | null;
    buyerDni?: string | null;
    paymentMethod?: string | null;
    orderNumber?: string | null;
    buyerName?: string | null;
  },
  businessId: string,
): Promise<void> {
  if (!payment.buyerEmail) {
    return;
  }

  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { slug: true, name: true },
  });
  if (!business) return;

  // Look up product title
  let productTitle = 'tu compra';
  if (payment.productId) {
    const product = await db.query.products.findFirst({
      where: eq(products.id, payment.productId),
      columns: { title: true },
    });
    if (product) productTitle = product.title;
  }

  const trackingUrl = `${env.nextPublicAppUrl}/${business.slug}/order/${payment.trackingToken || payment.id}`;
  const date = formatDate(payment.createdAt);
  const total = formatTotal(payment.amount);
  const displayOrderNumber = payment.orderNumber || payment.id.slice(0, 8).toUpperCase();

  try {
    const html = await render(
      OrderConfirmationEmail({
        businessName: business.name,
        orderNumber: displayOrderNumber,
        date,
        productSummary: productTitle,
        total,
        trackingUrl,
        customerName: payment.buyerName || undefined,
        customerDni: payment.buyerDni || undefined,
        paymentMethod: formatPaymentMethod(payment.paymentMethod),
      }),
    );

    await sendEmail({
      to: payment.buyerEmail,
      subject: `¡Compra confirmada en ${business.name}!`,
      html,
    });
  } catch (error) {
    logger.error('OrderEmails: confirmation email failed', { error: toErrorDetail(error) });
  }
}

// ─── Send order completed email ───

export async function sendOrderCompletedEmail(
  payment: {
    buyerEmail?: string | null;
    id: string;
    trackingToken?: string | null;
    createdAt?: Date | string | null;
    buyerDni?: string | null;
    paymentMethod?: string | null;
    orderNumber?: string | null;
    buyerName?: string | null;
  },
  businessId: string,
): Promise<void> {
  if (!payment.buyerEmail) {
    return;
  }

  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { slug: true, name: true },
  });
  if (!business) return;

  const trackingUrl = `${env.nextPublicAppUrl}/${business.slug}/order/${payment.trackingToken || payment.id}`;
  const date = formatDate(payment.createdAt);
  const displayOrderNumber = payment.orderNumber || payment.id.slice(0, 8).toUpperCase();

  try {
    const html = await render(
      OrderCompletedEmail({
        businessName: business.name,
        orderNumber: displayOrderNumber,
        date,
        trackingUrl,
        customerName: payment.buyerName || undefined,
        customerDni: payment.buyerDni || undefined,
        paymentMethod: formatPaymentMethod(payment.paymentMethod),
      }),
    );

    await sendEmail({
      to: payment.buyerEmail,
      subject: `¡Tu pedido en ${business.name} está completo!`,
      html,
    });
  } catch (error) {
    logger.error('OrderEmails: completion email failed', { error: toErrorDetail(error) });
  }
}
