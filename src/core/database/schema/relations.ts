// =====================================================
// DRIZZLE ORM RELATIONS - Virtual Stores Platform
// =====================================================

import { relations } from 'drizzle-orm';

import {
  businesses,
  businessInvitations,
  businessSettings,
  businessSlugAliases,
  businessSubscriptions,
  businessTeamMembers,
  businessTeamRoles,
} from './businesses';
import { chatSessions, messages } from './chat';
import { complaintBookRecords } from './complaints';
import { importJobs, importRows } from './imports';
import { notifications } from './notifications';
import {
  orderAttachments,
  orderTimelineEvents,
  paymentOrders,
  payments,
  planPayments,
  sellerPayoutAccounts,
} from './orders';
import { productCategories, productLikes, productMedia, products } from './products';
import { profiles } from './profiles';
import { pushSubscriptions } from './pushSubscriptions';

// =====================================================
// RELATIONS
// =====================================================

export const profilesRelations = relations(profiles, ({ many }) => ({
  businesses: many(businesses),
  pushSubscriptions: many(pushSubscriptions),
}));

export const businessesRelations = relations(businesses, ({ one, many }) => ({
  owner: one(profiles, {
    fields: [businesses.ownerId],
    references: [profiles.id],
  }),
  slugAliases: many(businessSlugAliases),
  settings: one(businessSettings, {
    fields: [businesses.id],
    references: [businessSettings.businessId],
  }),
  categories: many(productCategories),
  products: many(products),
  chatSessions: many(chatSessions),
  subscriptions: many(businessSubscriptions),
  paymentOrders: many(paymentOrders),
  invitations: many(businessInvitations),
  teamMembers: many(businessTeamMembers),
  teamRoles: many(businessTeamRoles),
  notifications: many(notifications),
}));

export const businessSlugAliasesRelations = relations(businessSlugAliases, ({ one }) => ({
  business: one(businesses, {
    fields: [businessSlugAliases.businessId],
    references: [businesses.id],
  }),
}));

export const businessSettingsRelations = relations(businessSettings, ({ one }) => ({
  business: one(businesses, {
    fields: [businessSettings.businessId],
    references: [businesses.id],
  }),
}));

export const businessSubscriptionsRelations = relations(businessSubscriptions, ({ one }) => ({
  business: one(businesses, {
    fields: [businessSubscriptions.businessId],
    references: [businesses.id],
  }),
}));

export const productCategoriesRelations = relations(productCategories, ({ one, many }) => ({
  business: one(businesses, {
    fields: [productCategories.businessId],
    references: [businesses.id],
  }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  business: one(businesses, {
    fields: [products.businessId],
    references: [businesses.id],
  }),
  category: one(productCategories, {
    fields: [products.categoryId],
    references: [productCategories.id],
  }),
  media: many(productMedia),
  likes: many(productLikes),
}));

export const productMediaRelations = relations(productMedia, ({ one }) => ({
  product: one(products, {
    fields: [productMedia.productId],
    references: [products.id],
  }),
}));

export const productLikesRelations = relations(productLikes, ({ one }) => ({
  product: one(products, {
    fields: [productLikes.productId],
    references: [products.id],
  }),
}));

export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  business: one(businesses, {
    fields: [chatSessions.businessId],
    references: [businesses.id],
  }),
  payment: one(payments, {
    fields: [chatSessions.paymentId],
    references: [payments.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  session: one(chatSessions, {
    fields: [messages.sessionId],
    references: [chatSessions.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  business: one(businesses, {
    fields: [payments.businessId],
    references: [businesses.id],
  }),
  product: one(products, {
    fields: [payments.productId],
    references: [products.id],
  }),
  seller: one(profiles, {
    fields: [payments.sellerUserId],
    references: [profiles.id],
  }),
  chatSessions: many(chatSessions),
  orderAttachments: many(orderAttachments),
  orderTimelineEvents: many(orderTimelineEvents),
}));

export const orderAttachmentsRelations = relations(orderAttachments, ({ one }) => ({
  order: one(payments, {
    fields: [orderAttachments.orderId],
    references: [payments.id],
  }),
}));

export const orderTimelineEventsRelations = relations(orderTimelineEvents, ({ one }) => ({
  order: one(payments, {
    fields: [orderTimelineEvents.orderId],
    references: [payments.id],
  }),
}));

export const sellerPayoutAccountsRelations = relations(sellerPayoutAccounts, ({ one }) => ({
  seller: one(profiles, {
    fields: [sellerPayoutAccounts.sellerUserId],
    references: [profiles.id],
  }),
}));

// =====================================================
// RELATIONS: Team Collaboration
// =====================================================

export const businessInvitationsRelations = relations(businessInvitations, ({ one }) => ({
  business: one(businesses, {
    fields: [businessInvitations.businessId],
    references: [businesses.id],
  }),
  creator: one(profiles, {
    fields: [businessInvitations.createdBy],
    references: [profiles.id],
  }),
}));

export const businessTeamMembersRelations = relations(businessTeamMembers, ({ one }) => ({
  business: one(businesses, {
    fields: [businessTeamMembers.businessId],
    references: [businesses.id],
  }),
  user: one(profiles, {
    fields: [businessTeamMembers.userId],
    references: [profiles.id],
  }),
  invitation: one(businessInvitations, {
    fields: [businessTeamMembers.invitationId],
    references: [businessInvitations.id],
  }),
}));

export const businessTeamRolesRelations = relations(businessTeamRoles, ({ one }) => ({
  business: one(businesses, {
    fields: [businessTeamRoles.businessId],
    references: [businesses.id],
  }),
}));

export const planPaymentsRelations = relations(planPayments, ({ one }) => ({
  business: one(businesses, {
    fields: [planPayments.businessId],
    references: [businesses.id],
  }),
}));

export const paymentOrdersRelations = relations(paymentOrders, ({ one }) => ({
  business: one(businesses, {
    fields: [paymentOrders.businessId],
    references: [businesses.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  business: one(businesses, {
    fields: [notifications.businessId],
    references: [businesses.id],
  }),
}));

export const complaintBookRecordsRelations = relations(complaintBookRecords, ({ one }) => ({
  business: one(businesses, {
    fields: [complaintBookRecords.businessId],
    references: [businesses.id],
  }),
}));

// ─── Import Relations ──────────────────────────────────────

export const importJobsRelations = relations(importJobs, ({ one, many }) => ({
  business: one(businesses, {
    fields: [importJobs.businessId],
    references: [businesses.id],
  }),
  rows: many(importRows),
}));

export const importRowsRelations = relations(importRows, ({ one }) => ({
  job: one(importJobs, {
    fields: [importRows.jobId],
    references: [importJobs.id],
  }),
  product: one(products, {
    fields: [importRows.productId],
    references: [products.id],
  }),
}));
export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(profiles, {
    fields: [pushSubscriptions.userId],
    references: [profiles.id],
  }),
}));
