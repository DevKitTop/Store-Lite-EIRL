import { db } from '@/core/database/client';
import { rateLimitWindows } from '@/core/database/schema';
import { eq, lt, sql } from 'drizzle-orm';

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
}

const CLEANUP_PROBABILITY = 0.01;

function maybeCleanup() {
  if (Math.random() > CLEANUP_PROBABILITY) return;
  try {
    const now = new Date();
    db.delete(rateLimitWindows)
      .where(lt(rateLimitWindows.expiresAt, now))
      .catch(() => {});
  } catch {
    // ignore in test environments
  }
}

export async function checkRateLimitShared(
  identifier: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  try {
    maybeCleanup();
    const now = Date.now();
    const windowMs = config.windowMs;
    const windowStartMs = Math.floor(now / windowMs) * windowMs;
    const windowStart = new Date(windowStartMs);
    const key = `${identifier}:${windowMs}`;
    const expiresAt = new Date(windowStartMs + windowMs * 2);

    const d = db as any;
    if (d?.insert) {
      const res = await d
        .insert(rateLimitWindows)
        .values({
          key,
          windowStart,
          count: 1,
          expiresAt,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [rateLimitWindows.key, rateLimitWindows.windowStart],
          set: {
            count: sql`${rateLimitWindows.count} + 1`,
            updatedAt: new Date(),
            expiresAt,
          },
        })
        .returning({ count: rateLimitWindows.count });

      const count = Array.isArray(res) && res[0]?.count ? Number(res[0].count) : 1;
      if (count > config.maxRequests) {
        return { allowed: false, remaining: 0, resetInMs: windowStartMs + windowMs - now };
      }
      return {
        allowed: true,
        remaining: Math.max(0, config.maxRequests - count),
        resetInMs: windowStartMs + windowMs - now,
      };
    }
  } catch {
    // fallback
  }

  return { allowed: true, remaining: config.maxRequests - 1, resetInMs: config.windowMs };
}

export async function resetRateLimitShared(
  identifier: string,
  config: RateLimitConfig,
): Promise<void> {
  try {
    const windowMs = config.windowMs;
    const key = `${identifier}:${windowMs}`;
    await db.delete(rateLimitWindows).where(eq(rateLimitWindows.key, key));
  } catch {
    // ignore
  }
}

export { getClientIpFromHeaders };
