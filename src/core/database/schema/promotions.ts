// =====================================================
// DRIZZLE ORM SCHEMA - Billing promotions (0059)
// =====================================================
// Campaign catalog and per-owner redemption ledger. Amounts are integer
// cents. The enums live as text + CHECK constraints in SQL, mirroring
// migrations/0059_promotions_and_redemptions.sql.
// =====================================================

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { businesses } from './businesses';
import { planPayments } from './orders';
import { profiles } from './profiles';

export const PROMOTION_TYPES = ['free_period', 'percent_off', 'fixed_off'] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

export const PROMOTION_PLAN_SCOPES = ['lite_pago', 'lite_plus', 'any'] as const;
export type PromotionPlanScope = (typeof PROMOTION_PLAN_SCOPES)[number];

export const PROMOTION_PERIOD_SCOPES = ['monthly', 'annual', 'any'] as const;
export type PromotionPeriodScope = (typeof PROMOTION_PERIOD_SCOPES)[number];

export const PROMOTION_ELIGIBILITIES = ['new_owner', 'all_users', 'code', 'manual'] as const;
export type PromotionEligibility = (typeof PROMOTION_ELIGIBILITIES)[number];

export const PROMOTION_REDEMPTION_STATUSES = ['granted', 'consumed', 'reversed'] as const;
export type PromotionRedemptionStatus = (typeof PROMOTION_REDEMPTION_STATUSES)[number];

export const promotions = pgTable(
  'promotions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').$type<PromotionType>().notNull(),
    planScope: text('plan_scope').$type<PromotionPlanScope>().notNull().default('lite_pago'),
    periodScope: text('period_scope').$type<PromotionPeriodScope>().notNull().default('any'),
    durationDays: integer('duration_days'),
    percentOff: integer('percent_off'),
    amountOffCents: integer('amount_off_cents'),
    eligibility: text('eligibility').$type<PromotionEligibility>().notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    maxRedemptions: integer('max_redemptions'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codeUnique: unique('promotions_code_unique').on(table.code),
    activeWindowIdx: index('idx_promotions_active_window').on(
      table.isActive,
      table.startsAt,
      table.endsAt,
    ),
    typeCheck: check(
      'promotions_type_check',
      sql`${table.type} IN ('free_period', 'percent_off', 'fixed_off')`,
    ),
    planScopeCheck: check(
      'promotions_plan_scope_check',
      sql`${table.planScope} IN ('lite_pago', 'lite_plus', 'any')`,
    ),
    periodScopeCheck: check(
      'promotions_period_scope_check',
      sql`${table.periodScope} IN ('monthly', 'annual', 'any')`,
    ),
    eligibilityCheck: check(
      'promotions_eligibility_check',
      sql`${table.eligibility} IN ('new_owner', 'all_users', 'code', 'manual')`,
    ),
    valueCheck: check(
      'promotions_value_check',
      sql`(${table.type} = 'free_period' AND ${table.durationDays} IS NOT NULL AND ${table.durationDays} > 0 AND ${table.percentOff} IS NULL AND ${table.amountOffCents} IS NULL)
        OR (${table.type} = 'percent_off' AND ${table.percentOff} IS NOT NULL AND ${table.percentOff} BETWEEN 1 AND 99 AND ${table.durationDays} IS NULL AND ${table.amountOffCents} IS NULL)
        OR (${table.type} = 'fixed_off' AND ${table.amountOffCents} IS NOT NULL AND ${table.amountOffCents} > 0 AND ${table.durationDays} IS NULL AND ${table.percentOff} IS NULL)`,
    ),
    windowCheck: check(
      'promotions_window_check',
      sql`${table.endsAt} IS NULL OR ${table.endsAt} > ${table.startsAt}`,
    ),
    maxRedemptionsCheck: check(
      'promotions_max_redemptions_check',
      sql`${table.maxRedemptions} IS NULL OR ${table.maxRedemptions} > 0`,
    ),
  }),
);

export const promotionRedemptions = pgTable(
  'promotion_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    promotionId: uuid('promotion_id')
      .notNull()
      .references(() => promotions.id, { onDelete: 'cascade' }),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    planPaymentId: uuid('plan_payment_id').references(() => planPayments.id, {
      onDelete: 'set null',
    }),
    originalAmountCents: integer('original_amount_cents').notNull().default(0),
    discountAmountCents: integer('discount_amount_cents').notNull().default(0),
    finalAmountCents: integer('final_amount_cents').notNull().default(0),
    status: text('status').$type<PromotionRedemptionStatus>().notNull().default('granted'),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueRedemption: unique('promotion_redemptions_unique').on(table.promotionId, table.ownerId),
    promotionIdx: index('idx_promotion_redemptions_promotion').on(table.promotionId),
    businessIdx: index('idx_promotion_redemptions_business').on(table.businessId),
    ownerIdx: index('idx_promotion_redemptions_owner').on(table.ownerId),
    statusCheck: check(
      'promotion_redemptions_status_check',
      sql`${table.status} IN ('granted', 'consumed', 'reversed')`,
    ),
    amountsCheck: check(
      'promotion_redemptions_amounts_check',
      sql`${table.originalAmountCents} >= 0 AND ${table.discountAmountCents} >= 0 AND ${table.finalAmountCents} >= 0`,
    ),
  }),
);

export type Promotion = typeof promotions.$inferSelect;
export type NewPromotion = typeof promotions.$inferInsert;
export type PromotionRedemption = typeof promotionRedemptions.$inferSelect;
export type NewPromotionRedemption = typeof promotionRedemptions.$inferInsert;
