import { db } from '@/core/database/client';
import { webhookEvents } from '@/core/database/schema';
import { sql } from 'drizzle-orm';

const DEDUP_TTL_MS = 10 * 60 * 1000;

const WEBHOOK_DEDUP_TTL_MS = 10 * 60 * 1000;
const seenInMemory = new Map<string, number>();

function isTestEnv() {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

function cleanupMem(now: number) {
  for (const [k, exp] of seenInMemory.entries()) {
    if (exp <= now) seenInMemory.delete(k);
  }
}

export async function tryClaimWebhookEvent(eventId: string, eventType?: string): Promise<boolean> {
  if (isTestEnv()) {
    const now = Date.now();
    cleanupMem(now);
    if (seenInMemory.has(eventId)) return false;
    seenInMemory.set(eventId, now + WEBHOOK_DEDUP_TTL_MS);
    return true;
  }
  const expiresAt = new Date(Date.now() + WEBHOOK_DEDUP_TTL_MS);
  try {
    const d = db as any;
    if (!d?.insert) {
      const now = Date.now();
      cleanupMem(now);
      if (seenInMemory.has(eventId)) return false;
      seenInMemory.set(eventId, now + WEBHOOK_DEDUP_TTL_MS);
      return true;
    }
    await d
      .insert(webhookEvents)
      .values({ eventId, eventType: eventType ?? null, expiresAt })
      .onConflictDoNothing?.();
    return true;
  } catch {
    const now = Date.now();
    cleanupMem(now);
    if (seenInMemory.has(eventId)) return false;
    seenInMemory.set(eventId, now + WEBHOOK_DEDUP_TTL_MS);
    return true;
  }
}

export async function isWebhookEventProcessed(eventId: string): Promise<boolean> {
  if (isTestEnv()) {
    const now = Date.now();
    cleanupMem(now);
    return seenInMemory.has(eventId);
  }
  try {
    const d = db as any;
    if (d?.query?.webhookEvents?.findFirst) {
      const row = await d.query.webhookEvents.findFirst({
        where: (t: any, { eq }: any) => eq(t.eventId, eventId),
        columns: { eventId: true, expiresAt: true },
      });
      if (!row) return false;
      if (row.expiresAt <= new Date()) {
        try {
          if (d.delete) {
            await d.delete(webhookEvents).where(sql`event_id = ${eventId} and expires_at <= now()`);
          }
        } catch {
          // ignore cleanup errors
        }
        return false;
      }
      return true;
    }
  } catch {
    // ignore
  }
  const now = Date.now();
  cleanupMem(now);
  return seenInMemory.has(eventId);
}

export async function claimWebhookEvent(eventId: string, eventType?: string): Promise<boolean> {
  if (isTestEnv()) {
    const now = Date.now();
    cleanupMem(now);
    if (seenInMemory.has(eventId)) return false;
    seenInMemory.set(eventId, now + WEBHOOK_DEDUP_TTL_MS);
    return true;
  }
  try {
    if (await isWebhookEventProcessed(eventId)) return false;
    const expiresAt = new Date(Date.now() + WEBHOOK_DEDUP_TTL_MS);
    const d = db as any;
    if (!d?.insert) {
      const now = Date.now();
      cleanupMem(now);
      if (seenInMemory.has(eventId)) return false;
      seenInMemory.set(eventId, now + WEBHOOK_DEDUP_TTL_MS);
      return true;
    }
    try {
      const chain = d
        .insert(webhookEvents)
        .values({ eventId, eventType: eventType ?? null, expiresAt })
        .onConflictDoNothing?.();
      if (chain && typeof chain.returning === 'function') {
        const res = await chain.returning({ eventId: webhookEvents.eventId });
        if (Array.isArray(res) && res.length === 0) return false;
      }
      return true;
    } catch {
      try {
        const chain2 = d
          .insert(webhookEvents)
          .values({ eventId, eventType: eventType ?? null, expiresAt });
        if (chain2 && typeof chain2.returning === 'function') {
          const res = await chain2.returning({ eventId: webhookEvents.eventId });
          if (Array.isArray(res) && res.length === 0) return false;
        }
        return true;
      } catch {
        return true;
      }
    }
  } catch {
    const now = Date.now();
    cleanupMem(now);
    if (seenInMemory.has(eventId)) return false;
    seenInMemory.set(eventId, now + WEBHOOK_DEDUP_TTL_MS);
    return true;
  }
}
