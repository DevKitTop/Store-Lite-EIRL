import { index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { profiles } from './profiles';

// =====================================================
// TABLE: push_subscriptions (PWA Web Push, per user/device)
// =====================================================

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    expirationTime: timestamp('expiration_time', { withTimezone: true }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    failureCount: integer('failure_count').notNull().default(0),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    lastFailureCode: text('last_failure_code'),
  },
  (table) => ({
    uniqueUserEndpoint: unique('push_subscriptions_user_id_endpoint_unique').on(
      table.userId,
      table.endpoint,
    ),
    userIdIdx: index('idx_push_subscriptions_user_id').on(table.userId),
    // NOTE: partial active index (WHERE revoked_at IS NULL AND invalidated_at IS NULL)
    // is defined in the manual migration 0057; Drizzle does not model partial indexes here.
  }),
);

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert;
