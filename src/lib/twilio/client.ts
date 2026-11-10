import { env } from '@/config/env';
import { logger, toErrorDetail } from '@/lib/logger';
import twilio from 'twilio';

// Twilio client instance (initialized server-side only)
const client = twilio(env.twilioAccountSid, env.twilioAuthToken);

export interface TwilioMessageResponse {
  sid: string;
  status: string;
  to: string;
  body: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// TWILIO VERIFY (recomendado para producción)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends OTP via SMS using Twilio Verify
 * Verify handles expiration and delivery automatically.
 *
 * NOTE: WhatsApp channel is currently disabled because the verify_auto_created
 * templates are rejected (see Twilio ticket #28998565). Switch back to
 * 'whatsapp' once the templates are approved (cheaper in Peru: ~$0.05 vs ~$0.30).
 *
 * @param phone - Phone in E.164 format: "+51999999999"
 * @returns Verification SID and status
 */
export async function sendOtpViaVerify(phone: string): Promise<{ sid: string; status: string }> {
  const service = client.verify.v2.services(env.twilioServiceSid);

  const verification = await service.verifications.create({
    to: phone,
    channel: 'sms',
  });

  return { sid: verification.sid, status: verification.status };
}

/**
 * Checks an OTP code using Twilio Verify
 *
 * @param phone - Phone in E.164 format
 * @param code - 6-digit code entered by the user
 * @returns Object with valid flag and verification SID
 */
export async function checkOtpViaVerify(
  phone: string,
  code: string,
): Promise<{ valid: boolean; sid?: string }> {
  const service = client.verify.v2.services(env.twilioServiceSid);

  const check = await service.verificationChecks.create({
    to: phone,
    code,
  });

  return { valid: check.status === 'approved', sid: check.sid };
}

// ─────────────────────────────────────────────────────────────────────────────
// TWILIO MESSAGES API (legacy — usar Verify para producción)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends OTP via WhatsApp using Twilio Messages API
 * @deprecated Usar sendOtpViaVerify en su lugar. Esta función requiere
 *             templates aprobados por Meta para producción.
 */
export async function sendOtpWhatsApp(phone: string, code: string): Promise<TwilioMessageResponse> {
  let to = phone.trim();

  if (!to.startsWith('+')) {
    to = `+${to}`;
  }

  if (!to.startsWith('whatsapp:')) {
    to = `whatsapp:${to}`;
  }

  const from = env.twilioWhatsAppNumber;

  try {
    const message = await client.messages.create({
      body: `🛍️ *Store Lite* - Tu código de verificación es: *${code}*\nVálido por 5 minutos. No compartas este código con nadie.`,
      from,
      to,
    });

    return {
      sid: message.sid,
      status: message.status,
      to: message.to,
      body: message.body,
    };
  } catch (error: unknown) {
    logger.error('Twilio: send OTP failed', { error: toErrorDetail(error) });
    throw new Error(
      `Twilio error: ${error instanceof Error ? error.message : 'Failed to send OTP'}`,
    );
  }
}
