// =====================================================
// embeddedSignupEvents.ts
//
// Typed parser for Meta's WhatsApp Embedded Signup postMessage protocol.
// The coexistence popup posts `event.data` as a JSON STRING shaped like:
//
//   {
//     type: 'WA_EMBEDDED_SIGNUP',
//     event: 'FINISH' | 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' | 'ERROR' | 'CANCEL',
//     data: {
//       business_id?, waba_id?, phone_number_id?,   // on FINISH
//       error_message?, error?: { message? }        // on ERROR
//     }
//   }
//
// The discriminator is the top-level UPPERCASE `event` — NOT a nested
// `data.type`, and NOT a lowercase 'cancel'. Only messages from allowlisted
// facebook.com origins are accepted (the dashboard must never act on a
// postMessage forged by another origin).
// =====================================================

/** Origins allowed to deliver WA_EMBEDDED_SIGNUP events. Configurable const. */
export const ALLOWED_EMBEDDED_SIGNUP_ORIGINS: readonly string[] = [
  'https://www.facebook.com',
  'https://web.facebook.com',
];

/**
 * True when the message origin is one of Meta's registered facebook.com
 * surfaces. The exact list covers the documented variants; the suffix check
 * also admits other Meta-owned subdomains (m.facebook.com, ...) — no
 * third party can host under *.facebook.com, so this stays safe.
 */
export function isAllowedEmbeddedSignupOrigin(origin: string): boolean {
  return ALLOWED_EMBEDDED_SIGNUP_ORIGINS.includes(origin) || origin.endsWith('.facebook.com');
}

/** The postMessage envelope type Facebook's Embedded Signup popup emits. */
const EMBEDDED_SIGNUP_EVENT_TYPE = 'WA_EMBEDDED_SIGNUP';

/** Success events — both mean the seller completed the QR/scan flow. */
const FINISH_EVENTS: readonly string[] = ['FINISH', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'];

/** Payload extracted from a FINISH event (snake_case ids from Meta). */
export interface EmbeddedSignupFinishPayload {
  businessId: string;
  wabaId: string;
  phoneNumberId: string;
}

/** Typed result of parsing a WA_EMBEDDED_SIGNUP message. */
export type EmbeddedSignupEvent =
  | { kind: 'finish'; payload: EmbeddedSignupFinishPayload }
  | { kind: 'error'; message: string | null }
  | { kind: 'cancel' };

interface EmbeddedSignupEnvelope {
  type?: unknown;
  event?: unknown;
  data?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The popup serializes the envelope with JSON.stringify into event.data.
 * Anything that is NOT a string (the old invented object shape) is rejected
 * immediately — silently, like any other irrelevant message.
 */
function parseEnvelope(data: unknown): EmbeddedSignupEnvelope | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed = JSON.parse(data) as unknown;
    return isRecord(parsed) ? (parsed as EmbeddedSignupEnvelope) : null;
  } catch {
    return null;
  }
}

/**
 * Parses a raw MessageEvent into a typed EmbeddedSignupEvent, or null when the
 * message is irrelevant (wrong origin, malformed payload, unknown event, or a
 * FINISH missing its ids).
 */
export function parseEmbeddedSignupEvent(event: MessageEvent): EmbeddedSignupEvent | null {
  if (!isAllowedEmbeddedSignupOrigin(event.origin)) return null;

  const envelope = parseEnvelope(event.data);
  if (!envelope || envelope.type !== EMBEDDED_SIGNUP_EVENT_TYPE) return null;
  if (typeof envelope.event !== 'string') return null;

  const payload = isRecord(envelope.data) ? envelope.data : {};

  if (FINISH_EVENTS.includes(envelope.event)) {
    const businessId = payload.business_id;
    const wabaId = payload.waba_id;
    const phoneNumberId = payload.phone_number_id;
    if (
      typeof businessId !== 'string' ||
      typeof wabaId !== 'string' ||
      typeof phoneNumberId !== 'string'
    ) {
      return null;
    }
    return { kind: 'finish', payload: { businessId, wabaId, phoneNumberId } };
  }

  if (envelope.event === 'ERROR') {
    const errorMessage = payload.error_message;
    const error = isRecord(payload.error) ? payload.error : {};
    const message =
      typeof errorMessage === 'string'
        ? errorMessage
        : typeof error.message === 'string'
          ? error.message
          : null;
    return { kind: 'error', message };
  }

  if (envelope.event === 'CANCEL') {
    return { kind: 'cancel' };
  }

  return null;
}
