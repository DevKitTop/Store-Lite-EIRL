import { db } from '@/core/database/client';
import { webhookEvents } from '@/core/database/schema';
import { sql } from 'drizzle-orm';

/**
 * Webhook idempotency store.
 *
 * Production is DB-only (the `webhook_events` table). There is deliberately NO
 * per-instance in-memory fallback outside the test environment: a Map lives in
 * one serverless instance, so it cannot deduplicate a retry that lands on
 * another one. When the DB is unavailable the claim THROWS, and the caller must
 * return a retryable error so the provider redelivers later — never process the
 * event on a degraded, instance-local basis.
 */

const WEBHOOK_DEDUP_TTL_MS = 10 * 60 * 1000;

/** Test-only store. Never used outside the test environment. */
const seenInMemory = new Map<string, number>();

function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

function cleanupMem(now: number): void {
  for (const [key, expiresAt] of seenInMemory.entries()) {
    if (expiresAt <= now) seenInMemory.delete(key);
  }
}

function claimInMemory(eventId: string): boolean {
  const now = Date.now();
  cleanupMem(now);
  if (seenInMemory.has(eventId)) return false;
  seenInMemory.set(eventId, now + WEBHOOK_DEDUP_TTL_MS);
  return true;
}

function isProcessedInMemory(eventId: string): boolean {
  cleanupMem(Date.now());
  return seenInMemory.has(eventId);
}

export async function isWebhookEventProcessed(eventId: string): Promise<boolean> {
  if (isTestEnv()) return isProcessedInMemory(eventId);

  const row = await db.query.webhookEvents.findFirst({
    where: (table, { eq }) => eq(table.eventId, eventId),
    columns: { eventId: true, expiresAt: true },
  });

  if (!row) return false;

  if (row.expiresAt <= new Date()) {
    await db.delete(webhookEvents).where(sql`event_id = ${eventId} and expires_at <= now()`);
    return false;
  }

  return true;
}

/**
 * Claim a webhook event exactly once, returning `false` for a duplicate.
 *
 * The DB is the only arbiter: the unique insert decides the winner across every
 * instance. A rejected insert (duplicate) yields `false`; a DB error propagates
 * so the caller can answer the provider with a retryable status.
 */
export async function claimWebhookEvent(eventId: string, eventType?: string): Promise<boolean> {
  if (isTestEnv()) return claimInMemory(eventId);

  if (await isWebhookEventProcessed(eventId)) return false;

  const expiresAt = new Date(Date.now() + WEBHOOK_DEDUP_TTL_MS);
  const inserted = await db
    .insert(webhookEvents)
    .values({ eventId, eventType: eventType ?? null, expiresAt })
    .onConflictDoNothing()
    .returning({ eventId: webhookEvents.eventId });

  return inserted.length > 0;
}
