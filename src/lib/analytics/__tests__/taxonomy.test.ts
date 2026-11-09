import { describe, expect, it } from 'vitest';

import { AnalyticsEvents, AnalyticsTags } from '../taxonomy';

describe('AnalyticsEvents', () => {
  it('keeps the original funnel events stable', () => {
    // These names are already queried by saved insights: they must never move.
    expect(AnalyticsEvents.USER_SIGNED_UP).toBe('user_signed_up');
    expect(AnalyticsEvents.BUSINESS_CREATED).toBe('business_created');
    expect(AnalyticsEvents.PRODUCT_CREATED).toBe('product_created');
    expect(AnalyticsEvents.CHECKOUT_STARTED).toBe('checkout_started');
    expect(AnalyticsEvents.PAYMENT_COMPLETED).toBe('payment_completed');
  });

  it('covers every product area that captures events', () => {
    expect(AnalyticsEvents.USER_REGISTERED).toBe('user_registered');
    expect(AnalyticsEvents.USER_SIGNED_IN).toBe('user_signed_in');
    expect(AnalyticsEvents.USER_SIGNED_OUT).toBe('user_signed_out');

    expect(AnalyticsEvents.BUSINESS_SLUG_UPDATED).toBe('business_slug_updated');
    expect(AnalyticsEvents.STOREFRONT_CUSTOMIZED).toBe('storefront_customized');
    expect(AnalyticsEvents.PAYMENT_GATEWAY_CONFIGURED).toBe('payment_gateway_configured');

    expect(AnalyticsEvents.PRODUCT_VIEWED).toBe('product_viewed');
    expect(AnalyticsEvents.EXPORT_DOWNLOADED).toBe('export_downloaded');

    expect(AnalyticsEvents.CART_ITEM_ADDED).toBe('cart_item_added');
    expect(AnalyticsEvents.CHECKOUT_SHIPPING_COMPLETED).toBe('checkout_shipping_completed');
    expect(AnalyticsEvents.PAYMENT_INITIATED).toBe('payment_initiated');
    expect(AnalyticsEvents.ORDER_CREATED).toBe('order_created');
    expect(AnalyticsEvents.ORDER_COMPLETED).toBe('order_completed');

    expect(AnalyticsEvents.CHAT_SESSION_STARTED).toBe('chat_session_started');
    expect(AnalyticsEvents.COMPLAINT_SUBMITTED).toBe('complaint_submitted');
    expect(AnalyticsEvents.PLATFORM_COMPLAINT_SUBMITTED).toBe('platform_complaint_submitted');
  });

  it('covers identity verification and WhatsApp messaging', () => {
    expect(AnalyticsEvents.OTP_REQUESTED).toBe('otp_requested');
    expect(AnalyticsEvents.OTP_VERIFIED).toBe('otp_verified');
    expect(AnalyticsEvents.OTP_VERIFICATION_FAILED).toBe('otp_verification_failed');

    expect(AnalyticsEvents.WHATSAPP_MESSAGE_SENT).toBe('whatsapp_message_sent');
    expect(AnalyticsEvents.WHATSAPP_TEMPLATE_MESSAGE_SENT).toBe('whatsapp_template_message_sent');
  });

  it('has exactly 26 events (no extra, no missing)', () => {
    expect(Object.keys(AnalyticsEvents)).toHaveLength(26);
  });

  it('uses constant values that are unique', () => {
    const values = Object.values(AnalyticsEvents);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('uses snake_case values only', () => {
    for (const value of Object.values(AnalyticsEvents)) {
      expect(value).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe('AnalyticsTags', () => {
  it('exports all three tag keys with correct values', () => {
    expect(AnalyticsTags.USER_ID).toBe('user_id');
    expect(AnalyticsTags.BUSINESS_ID).toBe('business_id');
    expect(AnalyticsTags.PLAN).toBe('plan');
  });

  it('has exactly three tags', () => {
    expect(Object.keys(AnalyticsTags)).toHaveLength(3);
  });
});
