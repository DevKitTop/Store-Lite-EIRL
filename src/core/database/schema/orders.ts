// =====================================================
// DRIZZLE ORM SCHEMA - Virtual Stores Platform
// TABLES: payments, order_events, seller_payout_accounts,
//         plan_payments, payment_orders, payment_idempotency_keys
// =====================================================

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  decimal,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { businesses } from './businesses';
import {
  orderAttachmentTypeEnum,
  orderStatusEnum,
  orderTimelineEventTypeEnum,
  paymentMethodEnum,
  planPaymentStatusEnum,
  shippingTypeEnum,
  subscriptionPlanEnum,
} from './enums';
import { products } from './products';
import { profiles } from './profiles';

// =====================================================
// TABLE: payments
// =====================================================

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    sellerUserId: uuid('seller_user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('PEN'),
    paymentMethod: text('payment_method', {
      enum: ['card', 'yape', 'plin', 'pago_efectivo', 'billetera_movil', 'cuotealo'],
    }).notNull(),
    // The Culqi CHARGE id (`chr_...`) — the token flow's arbiter (design D13).
    // This column holds the CHARGE id ONLY.
    culqiChargeId: text('culqi_charge_id').unique(),
    // The Culqi ORDER id (`ord_...`) — the order flow's arbiter (design D13).
    // Before this column existed, the order flow stored its `ord_...` id in
    // `culqi_charge_id`, so one sale carried two different names depending on
    // which writer touched it last, and the webhook's upsert on the charge id
    // never matched the order-flow row ⇒ a second `payments` row per sale ⇒
    // two claim keys ⇒ two stock decrements.
    // The sale link is now the SAME-KIND equality
    // `payments.culqi_order_id = payment_orders.culqi_order_id`.
    culqiOrderId: text('culqi_order_id').unique(),
    culqiReferenceCode: text('culqi_reference_code'),
    culqiTrackingId: text('culqi_tracking_id'),
    buyerEmail: text('buyer_email').notNull(),
    buyerPhone: text('buyer_phone'),
    buyerDni: text('buyer_dni'),
    trackingToken: text('tracking_token').notNull().unique(),
    status: text('status', {
      enum: [
        'pending',
        'paid',
        'validando',
        'not_delivered',
        'delivered',
        'en_reparto',
        'completed',
        'failed',
        'disputed',
        'refund_requested',
        'refunded',
      ],
    })
      .notNull()
      .default('pending'),
    deliveryCodeHash: text('delivery_code_hash'),
    deliveryCodeExpiresAt: timestamp('delivery_code_expires_at', { withTimezone: true }),
    // Logistics & Shipping
    orderNumber: text('order_number').notNull(),
    shippingType: shippingTypeEnum('shipping_type'),
    shippingDepartment: text('shipping_department'),
    shippingProvince: text('shipping_province'),
    shippingDistrict: text('shipping_district'),
    shippingAddress: text('shipping_address'),
    shippingAgency: text('shipping_agency'),
    shippingReference: text('shipping_reference'),
    shippingPhone: text('shipping_phone'),
    shippingUbigeo: text('shipping_ubigeo'),
    shippingCost: decimal('shipping_cost', { precision: 10, scale: 2 }),
    // ── New courier/shipping fields (additive, nullable) ──
    courierName: text('courier_name'),
    trackingNumber: text('tracking_number'),
    pickupCode: text('pickup_code'),
    sellerNote: text('seller_note'),
    shippingPaidAt: timestamp('shipping_paid_at', { withTimezone: true }),
    ticketUrl: text('ticket_url'),
    ticketImageUrl: text('ticket_image_url'),
    rejectionReason: text('rejection_reason'),
    rejectionImage: text('rejection_image'),
    finalizationDeadline: timestamp('finalization_deadline', { withTimezone: true }),
    finalizationRequestedAt: timestamp('finalization_requested_at', { withTimezone: true }),
    finalizationConfirmedAt: timestamp('finalization_confirmed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    metadata: jsonb('metadata').default({}),
    // Optimistic locking counter — incremented on every status change
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    businessIdIdx: index('idx_payments_business_id').on(table.businessId),
    productIdIdx: index('idx_payments_product_id').on(table.productId),
    sellerUserIdIdx: index('idx_payments_seller_user_id').on(table.sellerUserId),
    statusIdx: index('idx_payments_status').on(table.status),
    culqiChargeIdIdx: index('idx_payments_culqi_charge_id').on(table.culqiChargeId),
    culqiOrderIdIdx: index('idx_payments_culqi_order_id').on(table.culqiOrderId),
    createdAtIdx: index('idx_payments_created_at').on(table.createdAt.desc()),
    orderNumberUnique: uniqueIndex('payments_order_number_unique').on(table.orderNumber),
    paymentsAmountPositive: check('payments_amount_positive', sql`${table.amount} > 0`),
  }),
);

// =====================================================
// TABLE: order_events — Audit trail for payment status changes
// =====================================================

export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    // Who triggered the change: 'customer', 'seller', 'system'
    triggeredBy: text('triggered_by'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    paymentIdIdx: index('idx_order_events_payment_id').on(table.paymentId),
    createdAtIdx: index('idx_order_events_created_at').on(table.createdAt.desc()),
  }),
);

// =====================================================
// TABLE: order_attachments — typed attachments per order (max 3)
// =====================================================

export const orderAttachments = pgTable(
  'order_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    fileUrl: text('file_url').notNull(),
    fileName: text('file_name').notNull(),
    attachmentType: orderAttachmentTypeEnum('attachment_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orderIdIdx: index('idx_order_attachments_order_id').on(table.orderId),
  }),
);

// =====================================================
// TABLE: order_timeline_events — typed audit trail
// =====================================================

export const orderTimelineEvents = pgTable(
  'order_timeline_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    eventType: orderTimelineEventTypeEnum('event_type').notNull(),
    actorType: text('actor_type', { enum: ['customer', 'seller', 'system'] }).notNull(),
    actorId: uuid('actor_id').references(() => profiles.id),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orderIdIdx: index('idx_timeline_events_order_id').on(table.orderId),
    createdAtIdx: index('idx_timeline_events_created_at').on(table.createdAt.desc()),
  }),
);

// =====================================================
// TABLE: seller_payout_accounts
// =====================================================

export const sellerPayoutAccounts = pgTable(
  'seller_payout_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerUserId: uuid('seller_user_id')
      .notNull()
      .unique()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    documentType: text('document_type').notNull().default('DNI'),
    documentNumber: text('document_number').notNull(),
    bankName: text('bank_name').notNull(),
    bankAccountNumber: text('bank_account_number').notNull(),
    bankCci: text('bank_cci'),
    country: text('country').notNull().default('PE'),
    verified: boolean('verified').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sellerUserIdIdx: index('idx_payout_accounts_seller_user_id').on(table.sellerUserId),
  }),
);

// =====================================================
// SEQUENCE: Correlativo automático para tickets SUNAT (B001)
// =====================================================

export const planPaymentSeq = pgSequence('seq_plan_payment_b001', {
  startWith: 1,
  increment: 1,
  minValue: 1,
  maxValue: 2147483647,
  cache: 1,
});

// =====================================================
// TABLE: plan_payments
// =====================================================

/**
 * Pagos de planes SaaS — completamente separado de payments (productos).
 * Incluye campos SUNAT: serie B001, correlativo secuencial, montos con/sin IGV.
 * Los precios base son SIN IGV. El IGV (18%) se calcula y almacena por separado.
 */
export const planPayments = pgTable(
  'plan_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'restrict' }),

    // Plan comprado
    planType: subscriptionPlanEnum('plan_type').notNull(),
    period: text('period', { enum: ['monthly', 'annual'] })
      .notNull()
      .default('monthly'),

    // Montos — SIN IGV base, IGV calculado encima
    amountSubtotal: decimal('amount_subtotal', { precision: 10, scale: 2 }).notNull(),
    amountIgv: decimal('amount_igv', { precision: 10, scale: 2 }).notNull(),
    amountTotal: decimal('amount_total', { precision: 10, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('PEN'),

    // Pasarela de pago
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    culqiChargeId: text('culqi_charge_id').unique(),
    culqiReferenceCode: text('culqi_reference_code'),
    status: planPaymentStatusEnum('status').notNull().default('pending'),

    // Datos del comprador (merchant) para SUNAT
    buyerEmail: text('buyer_email').notNull(),
    buyerFullName: text('buyer_full_name'),
    buyerDocumentType: text('buyer_document_type'), // 'DNI' | 'RUC'
    buyerDocumentNumber: text('buyer_document_number'),
    buyerAddress: text('buyer_address'),

    // Comprobante SUNAT — serie B001 + correlativo secuencial
    ticketSeries: text('ticket_series').notNull().default('B001'),
    ticketCorrelative: integer('ticket_correlative')
      .notNull()
      .default(sql`nextval('seq_plan_payment_b001')`),

    // ticket_number se computa en query: ticketSeries || '-' || LPAD(ticketCorrelative, 8, '0')
    ticketUrl: text('ticket_url'),
    ticketIssuedAt: timestamp('ticket_issued_at', { withTimezone: true }),

    // Período de suscripción activado
    planStartDate: timestamp('plan_start_date', { withTimezone: true }),
    planEndDate: timestamp('plan_end_date', { withTimezone: true }),

    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    businessIdIdx: index('idx_plan_payments_business_id').on(table.businessId),
    statusIdx: index('idx_plan_payments_status').on(table.status),
    culqiChargeIdIdx: index('idx_plan_payments_culqi_charge').on(table.culqiChargeId),
    ticketIssuedAtIdx: index('idx_plan_payments_ticket_issued').on(table.ticketIssuedAt.desc()),
    createdAtIdx: index('idx_plan_payments_created_at').on(table.createdAt.desc()),
    uniqueCorrelative: unique('unique_plan_payment_correlative').on(
      table.ticketSeries,
      table.ticketCorrelative,
    ),
  }),
);

// =====================================================
// TABLE: payment_orders
// =====================================================

export const paymentOrders = pgTable(
  'payment_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'restrict' }),
    culqiOrderId: text('culqi_order_id').notNull().unique(),
    amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('PEN'),
    status: orderStatusEnum('status').notNull().default('pending'),
    paymentMethod: text('payment_method', {
      enum: ['pago_efectivo', 'billetera_movil', 'cuotealo'],
    }).notNull(),
    paymentCode: text('payment_code'),
    qrUrl: text('qr_url'),
    buyerEmail: text('buyer_email').notNull(),
    buyerPhone: text('buyer_phone'),
    expirationDate: timestamp('expiration_date', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    culqiOrderIdIdx: index('idx_payment_orders_culqi_order_id').on(table.culqiOrderId),
    businessIdIdx: index('idx_payment_orders_business_id').on(table.businessId),
    statusIdx: index('idx_payment_orders_status').on(table.status),
  }),
);

export type PaymentOrder = typeof paymentOrders.$inferSelect;
export type NewPaymentOrder = typeof paymentOrders.$inferInsert;

// =====================================================
// TABLE: payment_idempotency_keys
// =====================================================

export const paymentIdempotencyKeys = pgTable(
  'payment_idempotency_keys',
  {
    key: text('key').primaryKey(),
    status: text('status', { enum: ['processing', 'succeeded', 'failed'] })
      .notNull()
      .default('processing'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('idx_payment_idempotency_keys_status').on(table.status),
    createdAtIdx: index('idx_payment_idempotency_keys_created_at').on(table.createdAt.desc()),
  }),
);

export type PaymentIdempotencyKey = typeof paymentIdempotencyKeys.$inferSelect;
export type NewPaymentIdempotencyKey = typeof paymentIdempotencyKeys.$inferInsert;

// =====================================================
// TABLE: stock_movements — exactly-once fulfillment ledger (NEW-8)
// =====================================================
// One row per CLAIM. The unique (source_type, source_id) pair is the CAS unit:
// `INSERT ... ON CONFLICT DO NOTHING ... RETURNING` lets the first trigger win
// and every later trigger observe 0 rows (design D1-D3). `source_id` is
// deliberately polymorphic (no FK): it points at either a `payments` row or a
// `payment_orders` row depending on `source_type`. RLS is enabled with zero
// policies in migration 0051 (0050 pattern) — Drizzle connects as `postgres`
// and bypasses it, while PostgREST anon is denied.

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'restrict' }),
    sourceType: text('source_type', { enum: ['payments', 'payment_orders'] }).notNull(),
    sourceId: uuid('source_id').notNull(),
    items: jsonb('items')
      .$type<{ productId: string; quantity: number; applied: boolean }[]>()
      .notNull()
      .default([]),
    outcome: text('outcome', { enum: ['fulfilled', 'partial', 'no_product'] }).notNull(),
    fallbackQty1: boolean('fallback_qty1').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceUnique: unique('stock_movements_source_unique').on(table.sourceType, table.sourceId),
    businessIdIdx: index('idx_stock_movements_business_id').on(table.businessId),
    createdAtIdx: index('idx_stock_movements_created_at').on(table.createdAt.desc()),
  }),
);

export type StockMovement = typeof stockMovements.$inferSelect;
export type NewStockMovement = typeof stockMovements.$inferInsert;

// =====================================================
// TYPE EXPORTS
// =====================================================

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;

export type OrderAttachment = typeof orderAttachments.$inferSelect;
export type NewOrderAttachment = typeof orderAttachments.$inferInsert;

export type OrderTimelineEvent = typeof orderTimelineEvents.$inferSelect;
export type NewOrderTimelineEvent = typeof orderTimelineEvents.$inferInsert;

export type SellerPayoutAccount = typeof sellerPayoutAccounts.$inferSelect;
export type NewSellerPayoutAccount = typeof sellerPayoutAccounts.$inferInsert;

export type PlanPayment = typeof planPayments.$inferSelect;
export type NewPlanPayment = typeof planPayments.$inferInsert;
