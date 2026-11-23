// =====================================================
// DRIZZLE ORM SCHEMA - Web Push delivery outbox (T2.5)
// =====================================================

import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { notifications } from './notifications';
import { profiles } from './profiles';
import { pushSubscriptions } from './pushSubscriptions';

export const PUSH_DELIVERY_STATUSES = [
  'pending',
  'processing',
  'delivered',
  'retryable_failed',
  'terminal_failed',
  'invalidated',
  'skipped',
] as const;

export type PushDeliveryStatus = (typeof PUSH_DELIVERY_STATUSES)[number];

export const pushNotificationDeliveries = pgTable(
  'push_notification_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    pushSubscriptionId: uuid('push_subscription_id')
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: 'cascade' }),
    status: text('status').$type<PushDeliveryStatus>().notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    providerStatusCode: integer('provider_status_code'),
    lastErrorClass: text('last_error_class'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueDelivery: unique('push_notification_deliveries_unique').on(
      table.notificationId,
      table.recipientUserId,
      table.pushSubscriptionId,
    ),
    readyIdx: index('idx_push_deliveries_ready')
      .on(table.status, table.nextAttemptAt)
      .where(sql`${table.status} IN ('pending', 'retryable_failed')`),
    notificationIdx: index('idx_push_deliveries_notification').on(table.notificationId),
    subscriptionIdx: index('idx_push_deliveries_subscription').on(table.pushSubscriptionId),
    statusCheck: check(
      'push_notification_deliveries_status_check',
      sql`${table.status} IN ('pending', 'processing', 'delivered', 'retryable_failed', 'terminal_failed', 'invalidated', 'skipped')`,
    ),
  }),
);

export type PushNotificationDelivery = typeof pushNotificationDeliveries.$inferSelect;
export type NewPushNotificationDelivery = typeof pushNotificationDeliveries.$inferInsert;
