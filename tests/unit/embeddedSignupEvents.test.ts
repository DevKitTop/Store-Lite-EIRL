// =====================================================
// embeddedSignupEvents — WA_EMBEDDED_SIGNUP postMessage parser
// =====================================================
// Regression (C1): Meta's coexistence popup posts `event.data` as a JSON
// STRING with the discriminator at top level:
//
//   window.parent.postMessage(JSON.stringify({
//     type: 'WA_EMBEDDED_SIGNUP',
//     event: 'FINISH' | 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' | 'ERROR' | 'CANCEL',
//     data: { business_id?, waba_id?, phone_number_id?, error_message?, error?: { message? } }
//   }), '*')
//
// The previous parser expected an invented OBJECT shape
// ({ data: { type, data } }, lowercase 'cancel') and silently dropped every
// real event. Only messages from allowlisted origins are accepted.
// =====================================================

import {
  ALLOWED_EMBEDDED_SIGNUP_ORIGINS,
  isAllowedEmbeddedSignupOrigin,
  parseEmbeddedSignupEvent,
} from '@/features/whatsapp/lib/embeddedSignupEvents';
import { describe, expect, it } from 'vitest';

const ALLOWED_ORIGIN = 'https://www.facebook.com';
const EVIL_ORIGIN = 'https://evil.example.com';

/** Real Meta wire shape: event.data is a JSON string; `event` is UPPERCASE. */
function signupMessage(origin: string, event: string, data: unknown = null): MessageEvent {
  return {
    origin,
    data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event, data }),
  } as MessageEvent;
}

const FINISH_DATA = {
  business_id: 'biz-1001',
  waba_id: 'waba-2002',
  phone_number_id: 'pn-3003',
};

describe('parseEmbeddedSignupEvent', () => {
  it('parses a FINISH event from an allowlisted origin into typed ids', () => {
    const result = parseEmbeddedSignupEvent(signupMessage(ALLOWED_ORIGIN, 'FINISH', FINISH_DATA));

    expect(result).toEqual({
      kind: 'finish',
      payload: { businessId: 'biz-1001', wabaId: 'waba-2002', phoneNumberId: 'pn-3003' },
    });
  });

  it('parses FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING as a finish event', () => {
    const result = parseEmbeddedSignupEvent(
      signupMessage(ALLOWED_ORIGIN, 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', FINISH_DATA),
    );

    expect(result).toEqual({
      kind: 'finish',
      payload: { businessId: 'biz-1001', wabaId: 'waba-2002', phoneNumberId: 'pn-3003' },
    });
  });

  it('rejects FINISH events from non-allowlisted origins', () => {
    const result = parseEmbeddedSignupEvent(signupMessage(EVIL_ORIGIN, 'FINISH', FINISH_DATA));

    expect(result).toBeNull();
  });

  it('rejects a FINISH missing required ids instead of emitting garbage', () => {
    const result = parseEmbeddedSignupEvent(
      signupMessage(ALLOWED_ORIGIN, 'FINISH', { business_id: 'biz-1001' }),
    );

    expect(result).toBeNull();
  });

  it('surfaces an ERROR event with its error_message text', () => {
    const result = parseEmbeddedSignupEvent(
      signupMessage(ALLOWED_ORIGIN, 'ERROR', { error_message: 'WABA no encontrado' }),
    );

    expect(result).toEqual({ kind: 'error', message: 'WABA no encontrado' });
  });

  it('surfaces an ERROR event with a nested error.message text', () => {
    const result = parseEmbeddedSignupEvent(
      signupMessage(ALLOWED_ORIGIN, 'ERROR', {
        error: { code: 2635, message: 'WABA no encontrado' },
      }),
    );

    expect(result).toEqual({ kind: 'error', message: 'WABA no encontrado' });
  });

  it('surfaces an ERROR event without a message as a null message', () => {
    const result = parseEmbeddedSignupEvent(signupMessage(ALLOWED_ORIGIN, 'ERROR'));

    expect(result).toEqual({ kind: 'error', message: null });
  });

  it('parses an UPPERCASE CANCEL event as a no-payload cancel', () => {
    const result = parseEmbeddedSignupEvent(signupMessage(ALLOWED_ORIGIN, 'CANCEL'));

    expect(result).toEqual({ kind: 'cancel' });
  });

  it('REJECTS the old invented lowercase cancel shape', () => {
    const result = parseEmbeddedSignupEvent(signupMessage(ALLOWED_ORIGIN, 'cancel'));

    expect(result).toBeNull();
  });

  it('ignores messages that are not WA_EMBEDDED_SIGNUP', () => {
    const result = parseEmbeddedSignupEvent({
      origin: ALLOWED_ORIGIN,
      data: JSON.stringify({ type: 'AUTH_SUCCESS', event: 'FINISH', data: FINISH_DATA }),
    } as unknown as MessageEvent);

    expect(result).toBeNull();
  });

  it('ignores unknown WA_EMBEDDED_SIGNUP events', () => {
    const result = parseEmbeddedSignupEvent(signupMessage(ALLOWED_ORIGIN, 'start'));

    expect(result).toBeNull();
  });

  it('rejects the invented OBJECT envelope (old broken contract) — data must be a string', () => {
    const result = parseEmbeddedSignupEvent({
      origin: ALLOWED_ORIGIN,
      data: { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: FINISH_DATA },
    } as unknown as MessageEvent);

    expect(result).toBeNull();
  });

  it('rejects malformed JSON payloads', () => {
    const result = parseEmbeddedSignupEvent({
      origin: ALLOWED_ORIGIN,
      data: '{not-json',
    } as unknown as MessageEvent);

    expect(result).toBeNull();
  });

  it('exposes the facebook.com allowlist as a configurable constant', () => {
    expect(ALLOWED_EMBEDDED_SIGNUP_ORIGINS).toContain('https://www.facebook.com');
  });

  it('accepts FINISH from the web.facebook.com market variant', () => {
    const result = parseEmbeddedSignupEvent(
      signupMessage('https://web.facebook.com', 'FINISH', FINISH_DATA),
    );

    expect(result).toEqual({
      kind: 'finish',
      payload: { businessId: 'biz-1001', wabaId: 'waba-2002', phoneNumberId: 'pn-3003' },
    });
  });

  it('rejects lookalike domains that are not under facebook.com', () => {
    const result = parseEmbeddedSignupEvent(
      signupMessage('https://evilfacebook.com', 'FINISH', FINISH_DATA),
    );

    expect(result).toBeNull();
  });

  it('rejects origins whose final label is NOT facebook.com (TLD-boundary safety)', () => {
    const result = parseEmbeddedSignupEvent(
      signupMessage('https://facebook.com.evil.com', 'FINISH', FINISH_DATA),
    );

    expect(result).toBeNull();
  });

  it('isAllowedEmbeddedSignupOrigin admits Meta-owned facebook.com surfaces only', () => {
    expect(isAllowedEmbeddedSignupOrigin('https://www.facebook.com')).toBe(true);
    expect(isAllowedEmbeddedSignupOrigin('https://web.facebook.com')).toBe(true);
    expect(isAllowedEmbeddedSignupOrigin('https://m.facebook.com')).toBe(true);
    expect(isAllowedEmbeddedSignupOrigin('https://evil.example.com')).toBe(false);
    expect(isAllowedEmbeddedSignupOrigin('https://evilfacebook.com')).toBe(false);
    expect(isAllowedEmbeddedSignupOrigin('https://facebook.com.evil.com')).toBe(false);
    expect(ALLOWED_EMBEDDED_SIGNUP_ORIGINS).toContain('https://web.facebook.com');
  });
});
