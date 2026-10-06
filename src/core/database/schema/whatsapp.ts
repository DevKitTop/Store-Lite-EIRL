// =====================================================
// DRIZZLE ORM SCHEMA - YCloud WhatsApp Integration
// TABLES: whatsapp_channels, whatsapp_conversations,
//         whatsapp_messages, whatsapp_templates
// =====================================================

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { businesses } from './businesses';

// =====================================================
// TABLE: whatsapp_channels
// One per seller/business (1:1 relationship)
// =====================================================

export const whatsappChannels = pgTable(
  'whatsapp_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    ycloudPhoneNumberId: text('ycloud_phone_number_id').notNull().unique(),
    wabaId: text('waba_id'),
    displayPhoneNumber: text('display_phone_number'),
    isActive: boolean('is_active').notNull().default(false),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    businessIdIdx: uniqueIndex('uq_whatsapp_channels_business_id').on(table.businessId),
    ycloudPhoneNumberIdIdx: uniqueIndex('uq_whatsapp_channels_ycloud_phone_number_id').on(table.ycloudPhoneNumberId),
    isActiveIdx: index('idx_whatsapp_channels_is_active').on(table.isActive),
    createdAtIdx: index('idx_whatsapp_channels_created_at').on(table.createdAt.desc()),
  }),
);

// =====================================================
// TABLE: whatsapp_conversations
// Customer conversations per channel
// =====================================================

export const whatsappConversations = pgTable(
  'whatsapp_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => whatsappChannels.id, { onDelete: 'cascade' }),
    customerPhone: text('customer_phone').notNull(),
    customerName: text('customer_name'),
    metaBsuId: text('meta_bsu_id'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow(),
    status: text('status', { enum: ['active', 'closed'] }).default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    channelIdIdx: index('idx_whatsapp_conversations_channel_id').on(table.channelId),
    customerPhoneIdx: index('idx_whatsapp_conversations_customer_phone').on(table.customerPhone),
    metaBsuIdIdx: index('idx_whatsapp_conversations_meta_bsu_id').on(table.metaBsuId),
    statusIdx: index('idx_whatsapp_conversations_status').on(table.status),
    lastMessageAtIdx: index('idx_whatsapp_conversations_last_message_at').on(table.lastMessageAt.desc()),
    // One active conversation per (channel, metaBsuId) for deduplication
    activePerChannelMetaBsuIdx: uniqueIndex('uq_whatsapp_conversations_active_per_channel_meta_bsu')
      .on(table.channelId, table.metaBsuId)
      .where(sql`status = 'active'`),
    createdAtIdx: index('idx_whatsapp_conversations_created_at').on(table.createdAt.desc()),
  }),
);

// =====================================================
// TABLE: whatsapp_messages
// All inbound/outbound messages
// =====================================================

export const whatsappMessages = pgTable(
  'whatsapp_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => whatsappConversations.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => whatsappChannels.id, { onDelete: 'cascade' }),
    direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
    type: text('type', { enum: ['text', 'template', 'media', 'interactive'] }).notNull(),
    templateName: text('template_name'),
    body: text('body'),
    ycloudMessageId: text('ycloud_message_id').notNull().unique(),
    status: text('status', {
      enum: ['accepted', 'sent', 'delivered', 'read', 'failed'],
    }).notNull().default('accepted'),
    metaPrice: text('meta_price'),
    metaCurrency: text('meta_currency'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    conversationIdIdx: index('idx_whatsapp_messages_conversation_id').on(table.conversationId),
    channelIdIdx: index('idx_whatsapp_messages_channel_id').on(table.channelId),
    ycloudMessageIdIdx: uniqueIndex('uq_whatsapp_messages_ycloud_message_id').on(table.ycloudMessageId),
    statusIdx: index('idx_whatsapp_messages_status').on(table.status),
    createdAtIdx: index('idx_whatsapp_messages_created_at').on(table.createdAt.desc()),
    conversationCreatedIdx: index('idx_whatsapp_messages_conversation_created').on(
      table.conversationId,
      table.createdAt.desc(),
    ),
  }),
);

// =====================================================
// TABLE: whatsapp_templates
// Template management per channel (or global)
// =====================================================

export const whatsappTemplates = pgTable(
  'whatsapp_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id').references(() => whatsappChannels.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category', { enum: ['marketing', 'utility', 'authentication'] }).notNull(),
    language: text('language').notNull().default('es'),
    body: text('body').notNull(),
    metaStatus: text('meta_status', { enum: ['pending', 'approved', 'rejected'] }).default('pending'),
    metaTemplateId: text('meta_template_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    channelIdIdx: index('idx_whatsapp_templates_channel_id').on(table.channelId),
    nameIdx: index('idx_whatsapp_templates_name').on(table.name),
    metaStatusIdx: index('idx_whatsapp_templates_meta_status').on(table.metaStatus),
    metaTemplateIdIdx: uniqueIndex('uq_whatsapp_templates_meta_template_id').on(table.metaTemplateId),
    // Unique per (channelId, name) where channelId is not null
    channelNameIdx: uniqueIndex('uq_whatsapp_templates_channel_name')
      .on(table.channelId, table.name)
      .where(sql`channel_id IS NOT NULL`),
    createdAtIdx: index('idx_whatsapp_templates_created_at').on(table.createdAt.desc()),
  }),
);

// =====================================================
// TYPE EXPORTS
// =====================================================

export type WhatsappChannel = typeof whatsappChannels.$inferSelect;
export type NewWhatsappChannel = typeof whatsappChannels.$inferInsert;

export type WhatsappConversation = typeof whatsappConversations.$inferSelect;
export type NewWhatsappConversation = typeof whatsappConversations.$inferInsert;

export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
export type NewWhatsappMessage = typeof whatsappMessages.$inferInsert;

export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
export type NewWhatsappTemplate = typeof whatsappTemplates.$inferInsert;