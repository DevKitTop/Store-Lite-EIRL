import { env } from '@/config/env';
import { logger, toErrorDetail } from '@/lib/logger';

const API_URL = 'https://api.sms.json.pe/send';

/**
 * Normalize a Peruvian phone number to E.164 without the '+' prefix.
 *
 * - "978775813" (9 digits) → "51978775813"
 * - "+51978775813"        → "51978775813"
 * - "51978775813"         → "51978775813" (passthrough)
 */
function normalizePhoneToE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  // Already in E.164 without + (country code + number)
  if (digits.length === 12 && digits.startsWith('51')) {
    return digits;
  }

  // Peruvian mobile without country code (9 digits starting with 9)
  if (digits.length === 9) {
    return `51${digits}`;
  }

  // Already has + prefix or unknown format — just clean it
  return phone.startsWith('+') ? phone.slice(1) : phone;
}

/**
 * Send an SMS via JSON.pe API.
 * Fire-and-forget: logs errors, never throws.
 *
 * @param phone - Destination phone (any format; normalized internally)
 * @param message - SMS body text
 */
export async function sendSms(phone: string, message: string): Promise<void> {
  const number = normalizePhoneToE164(phone);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.jsonpeSmsToken}`,
      },
      body: JSON.stringify({ number, message }),
    });

    const data = await response.json();

    if (!data.success) {
      logger.error('JSON.pe: API error', { message: data.message });
    }
  } catch (error) {
    logger.error('JSON.pe: network error', { error: toErrorDetail(error) });
  }
}
