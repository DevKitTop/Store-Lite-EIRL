/**
 * Analytics Taxonomy
 *
 * Single source of truth for event names and tag keys
 * across Sentry and PostHog. Using `as const` objects
 * for zero runtime cost and full TypeScript autocomplete.
 *
 * Event names are a public contract: they are what every saved insight,
 * funnel and dashboard queries. Never rename one to "clean it up" — add a new
 * constant and deprecate the old one instead, or the historical data detaches
 * from the code.
 */

export const AnalyticsEvents = {
  // Authentication. `user_signed_up` fires when the provider confirms the
  // identity (auth callback); `user_registered` fires when onboarding starts.
  // They are two funnel steps, not two spellings of one event.
  USER_SIGNED_UP: 'user_signed_up',
  USER_REGISTERED: 'user_registered',
  USER_SIGNED_IN: 'user_signed_in',
  USER_SIGNED_OUT: 'user_signed_out',

  // Business lifecycle and storefront configuration
  BUSINESS_CREATED: 'business_created',
  BUSINESS_SLUG_UPDATED: 'business_slug_updated',
  STOREFRONT_CUSTOMIZED: 'storefront_customized',
  PAYMENT_GATEWAY_CONFIGURED: 'payment_gateway_configured',

  // Catalog
  PRODUCT_CREATED: 'product_created',
  PRODUCT_VIEWED: 'product_viewed',
  EXPORT_DOWNLOADED: 'export_downloaded',

  // Cart, checkout and payment
  CART_ITEM_ADDED: 'cart_item_added',
  CHECKOUT_STARTED: 'checkout_started',
  CHECKOUT_SHIPPING_COMPLETED: 'checkout_shipping_completed',
  PAYMENT_INITIATED: 'payment_initiated',
  ORDER_CREATED: 'order_created',
  ORDER_COMPLETED: 'order_completed',
  PAYMENT_COMPLETED: 'payment_completed',

  // Identity verification (OTP)
  OTP_REQUESTED: 'otp_requested',
  OTP_VERIFIED: 'otp_verified',
  OTP_VERIFICATION_FAILED: 'otp_verification_failed',

  // WhatsApp messaging
  WHATSAPP_MESSAGE_SENT: 'whatsapp_message_sent',
  WHATSAPP_TEMPLATE_MESSAGE_SENT: 'whatsapp_template_message_sent',

  // Support
  CHAT_SESSION_STARTED: 'chat_session_started',
  COMPLAINT_SUBMITTED: 'complaint_submitted',
  PLATFORM_COMPLAINT_SUBMITTED: 'platform_complaint_submitted',
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

export const AnalyticsTags = {
  USER_ID: 'user_id',
  BUSINESS_ID: 'business_id',
  PLAN: 'plan',
} as const;

export type AnalyticsTagKey = (typeof AnalyticsTags)[keyof typeof AnalyticsTags];
