// =====================================================
// WHATSAPP SEND GUARDS (anti-spam / Meta quality rating)
// Enforced per seller (channel) before any outbound send.
//
// Design decision: guards RETURN result objects instead of
// throwing. Callers check `ok` (or the boolean) and decide
// the error to surface — keeps the server-action error flow
// free of try/catch duplication and preserves the reason
// code (NO_INBOUND vs WINDOW_EXPIRED).
// =====================================================

import { and, desc, eq, gte, isNull } from 'drizzle-orm';

import { env } from '@/config/env';
import { db } from '@/core/database/client';
import { whatsappMessages, whatsappTemplates } from '@/core/database/schema';

/** Meta's 24h customer-service window, in milliseconds. */
export const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ReplyWindowCheck {
  ok: boolean;
  /** Absent when `ok` is true. */
  reason?: 'NO_INBOUND' | 'WINDOW_EXPIRED';
  /** When the window closes (only meaningful when the customer messaged first). */
  expiresAt?: Date;
}

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export interface RateLimitCheck {
  ok: boolean;
  current: number;
  limit: number;
  /** Present only when blocked: safe upper bound until a slot frees up. */
  retryAfterSeconds?: number;
}

/**
 * Parses the env-driven rate limit configuration.
 * Env keeps both values as STRINGS (`src/config/env.ts`); parsing happens here.
 * Unparseable / non-positive / non-integer values fall back to the safe
 * Meta-friendly defaults (100 sends / 5 minutes).
 */
export function resolveRateLimitConfig(
  perWindow: string,
  windowMinutes: string,
): RateLimitConfig {
  const parsedLimit = Number(perWindow);
  const parsedMinutes = Number(windowMinutes);
  const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100;
  const minutes = Number.isInteger(parsedMinutes) && parsedMinutes > 0 ? parsedMinutes : 5;
  return { limit, windowMs: minutes * 60_000 };
}

/**
 * Rule 1+2: free-form text replies are only allowed INSIDE the 24h
 * customer-service window that a customer message opens.
 *
 * The window anchors on the last INBOUND message (`whatsapp_messages`
 * with direction='inbound'), NOT on `conversation.lastMessageAt` (which
 * also updates on outbound sends and would extend the window forever).
 * If the customer never messaged first, the window is CLOSED.
 */
export async function assertWithinServiceWindow(
  conversationId: string,
): Promise<ReplyWindowCheck> {
  const rows = await db
    .select({ createdAt: whatsappMessages.createdAt })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.conversationId, conversationId),
        eq(whatsappMessages.direction, 'inbound'),
      ),
    )
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(1);

  const lastInbound = rows[0];
  // Careful with `createdAt ?? now`: a null createdAt must NOT open the window —
  // the customer never messaged first, so the window stays CLOSED.
  if (!lastInbound?.createdAt) {
    return { ok: false, reason: 'NO_INBOUND' };
  }

  const inboundAt = new Date(lastInbound.createdAt);
  const expiresAt = new Date(inboundAt.getTime() + WHATSAPP_SERVICE_WINDOW_MS);

  if (expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'WINDOW_EXPIRED', expiresAt };
  }
  return { ok: true, expiresAt };
}

/**
 * Rule 3: outside the 24h window only APPROVED templates may be sent.
 *
 * Passes when an approved row exists for (channelId, name) WITH a
 * metaTemplateId, or — as fallback — a global approved row (channelId
 * null) with the same name and a metaTemplateId. An approved row without
 * a metaTemplateId does NOT count (nothing to send against).
 */
export async function assertTemplateApproved(
  channelId: string,
  templateName: string,
): Promise<boolean> {
  const channelTemplate = await db
    .select({ metaTemplateId: whatsappTemplates.metaTemplateId })
    .from(whatsappTemplates)
    .where(
      and(
        eq(whatsappTemplates.channelId, channelId),
        eq(whatsappTemplates.name, templateName),
        eq(whatsappTemplates.metaStatus, 'approved'),
      ),
    )
    .limit(1);

  if (channelTemplate[0]?.metaTemplateId) return true;

  // Global fallback: platform-wide approved template with the same name.
  const globalTemplate = await db
    .select({ metaTemplateId: whatsappTemplates.metaTemplateId })
    .from(whatsappTemplates)
    .where(
      and(
        isNull(whatsappTemplates.channelId),
        eq(whatsappTemplates.name, templateName),
        eq(whatsappTemplates.metaStatus, 'approved'),
      ),
    )
    .limit(1);

  return !!globalTemplate[0]?.metaTemplateId;
}

/**
 * Rule 4: per-seller sliding-window rate limit on OUTBOUND sends to
 * protect the Meta quality rating.
 *
 * Counts `whatsapp_messages` with direction='outbound' created at
 * `now - window <= createdAt` (sliding window, inclusive lower bound).
 */
export async function assertOutboundRateLimit(channelId: string): Promise<RateLimitCheck> {
  const now = new Date();
  const { limit, windowMs } = resolveRateLimitConfig(
    env.whatsappRateLimitPerWindow,
    env.whatsappRateLimitWindowMinutes,
  );
  const windowStart = new Date(now.getTime() - windowMs);

  const rows = await db
    .select({ id: whatsappMessages.id })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.channelId, channelId),
        eq(whatsappMessages.direction, 'outbound'),
        gte(whatsappMessages.createdAt, windowStart),
      ),
    );

  const current = rows.length;
  if (current >= limit) {
    // Safe upper bound: by then at least one counted message has left the window.
    return { ok: false, current, limit, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }
  return { ok: true, current, limit };
}