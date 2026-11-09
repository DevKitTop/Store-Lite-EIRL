import { env } from '@/config/env';
import { logger } from '@/lib/logger';
import { Resend } from 'resend';

let _client: Resend | null = null;

function getResend(): Resend | null {
  if (!env.resendApiKey) {
    logger.warn('Resend: API key not configured, skipping email');
    return null;
  }
  if (!_client) {
    _client = new Resend(env.resendApiKey);
  }
  return _client;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

/**
 * Send a transactional email via Resend.
 * Fire-and-forget: logs errors, never throws.
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  if (!env.resendFromEmail) {
    logger.warn('Resend: from address not configured, skipping email');
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: env.resendFromEmail,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    if (error) {
      logger.error('Resend: API error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } catch (err) {
    logger.error('Resend: network error', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
