/**
 * RateLimiter — Sliding window rate limiter.
 *
 * Tracks request timestamps per key and allows/denies based on
 * a configurable window and max requests per window.
 */
export class RateLimiter {
  private store = new Map<string, number[]>();
  private readonly window: number;
  private readonly maxRequests: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(windowMs = 30_000, maxRequests = 3) {
    this.window = windowMs;
    this.maxRequests = maxRequests;
  }

  /**
   * Check if a request for the given key is allowed.
   * Returns `true` if under the limit, `false` if rate-limited.
   */
  check(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.window;

    let timestamps = this.store.get(key) ?? [];
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      return false;
    }

    timestamps.push(now);
    this.store.set(key, timestamps);
    return true;
  }

  /**
   * Serverless-safe check against the shared Postgres window store.
   *
   * `check()` keeps per-instance state, so two concurrent serverless instances
   * each get their own budget and the limit is trivially bypassed by hitting a
   * different instance. This delegates to the atomic `rate_limit_windows`
   * upsert (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING count`) so the
   * decision holds across instances. Callers in request handlers MUST await it.
   *
   * The shared module is imported lazily (same pattern as `src/lib/rateLimit.ts`)
   * so the in-memory `check()` path never loads the database client.
   *
   * The shared store uses epoch-aligned FIXED windows, while `check()` is a
   * sliding window. After a shared ALLOW this still charges the local sliding
   * window, so a single instance never admits more than the pre-existing
   * behaviour at a window boundary. If the shared store cannot answer (it now
   * throws instead of failing open), the local limiter is the only gate.
   */
  async checkAsync(key: string): Promise<boolean> {
    try {
      const { checkRateLimitShared } = await import('@/core/payments/rateLimitShared');
      const result = await checkRateLimitShared(key, {
        windowMs: this.window,
        maxRequests: this.maxRequests,
      });
      if (!result.allowed) return false;
    } catch {
      // Shared store unavailable: enforce the per-instance window below.
    }
    // Per-instance sliding backstop (also the outage fallback).
    return this.check(key);
  }

  /**
   * Start periodic cleanup of stale entries to prevent memory leaks.
   */
  startCleanup(intervalMs = 60_000): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, timestamps] of this.store) {
        const valid = timestamps.filter((t) => t > now - this.window);
        if (valid.length === 0) {
          this.store.delete(key);
        } else {
          this.store.set(key, valid);
        }
      }
    }, intervalMs);
  }

  /**
   * Stop the cleanup interval.
   */
  stopCleanup(): void {
    if (this.cleanupInterval !== null) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

/**
 * Module-level singleton for the payment charge route.
 */
export const paymentRateLimiter = new RateLimiter();
paymentRateLimiter.startCleanup();
